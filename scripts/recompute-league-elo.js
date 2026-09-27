#!/usr/bin/env node

/**
 * League-ELO v2: switch-over, verification and rollback.
 *
 * The API itself replays all games after every write (leagueEloV2Persistence).
 * This script is for the one-off switch from the old engine and for checks:
 *
 *   --dry-run   (default) Computes the complete v2 state in a READ ONLY,
 *               REPEATABLE READ transaction and prints the ranking before →
 *               after, the number of rows that would change, the invariant
 *               check and two hashes: the input hash (what the replay read)
 *               and the plan hash (what it would write).
 *
 *   --apply --expect-input=<hash> --expect-plan=<hash>
 *               In ONE transaction: advisory lock, LOCK TABLE games and
 *               game_players (blocks writers, not readers), re-read, abort
 *               unless both hashes equal the dry run's, copy profiles and
 *               snapshots into dated backup tables, write the plan, activate
 *               the v2 engine (app_state 'elo'), re-check the stored
 *               invariants and that a new plan would change nothing, commit.
 *
 *   --restore=<suffix> [--force]
 *               Puts the backup tables of that apply back and deactivates
 *               v2. Refuses when games changed since the backup unless
 *               --force. Only run it AFTER traffic is back on a pre-v2
 *               Cloud Run revision — otherwise the next write re-rates.
 *
 * Target: DATABASE_URL. `.env` points at the LOCAL Docker DB; for production
 * run through scripts/with-prod-db.sh:
 *   bash scripts/with-prod-db.sh npm run elo:recompute-v2 -- --dry-run
 */

import "dotenv/config";
import {
	checkStoredInvariants,
	computePlan,
	diffPlan,
	getEloEngineState,
	inputHash,
	LEAGUE_ELO_LOCK_KEY,
	LEAGUE_ELO_VERSION,
	loadEloInputs,
	writePlanChanges,
} from "../src/api/services/elo/leagueEloV2Persistence.services.js";
import { closePool, getPool } from "../src/config/database.config.js";

const SUFFIX_PATTERN = /^\d{8}_\d{6}$/;

function parseArgs(argv) {
	const args = { mode: "dry-run" };
	for (const arg of argv) {
		const [key, value] = arg.replace(/^--/, "").split("=");
		if (key === "dry-run") args.mode = "dry-run";
		else if (key === "apply") args.mode = "apply";
		else if (key === "restore") {
			args.mode = "restore";
			args.suffix = value;
		} else if (key === "expect-input") args.expectInput = value;
		else if (key === "expect-plan") args.expectPlan = value;
		else if (key === "force") args.force = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return args;
}

function describeTarget() {
	const raw = process.env.DATABASE_URL;
	if (!raw) return "<DATABASE_URL not set>";
	try {
		const url = new URL(raw);
		return `${url.hostname}:${url.port || 5432}${url.pathname}`;
	} catch {
		return "<unparseable DATABASE_URL>";
	}
}

async function usernames(client) {
	const { rows } = await client.query("SELECT id, username FROM profiles");
	return new Map(rows.map((r) => [r.id, r.username]));
}

function printRanking(inputs, plan, names) {
	const stored = new Map(inputs.profiles.map((p) => [p.id, p]));
	const rows = plan.profiles
		.filter((p) => p.matches_played > 0)
		.sort((a, b) => b.current_rating - a.current_rating);
	console.log("\n  Spieler          jetzt → v2     Δ   Spiele  Peak");
	for (const p of rows) {
		const before = stored.get(p.id)?.current_rating ?? 1500;
		const delta = p.current_rating - before;
		console.log(
			`  ${String(names.get(p.id) ?? p.id).padEnd(15)} ${String(before).padStart(5)} → ${String(p.current_rating).padStart(4)}  ${String(delta > 0 ? `+${delta}` : delta).padStart(5)}  ${String(p.matches_played).padStart(6)}  ${p.peak_elo_value}`,
		);
	}
}

function printSeasons(plan, names) {
	for (const { season_id, payload } of plan.standings) {
		const top = [...payload.players]
			.sort((a, b) => b.rating_end - a.rating_end)
			.slice(0, 3)
			.map(
				(p) =>
					`${names.get(p.player_id) ?? p.player_id} ${p.rating_end} (${p.games} Sp.)`,
			)
			.join(", ");
		console.log(
			`  ${season_id}: ${payload.rated_games} gewertete Spiele, Top 3 am Ende: ${top}`,
		);
	}
}

function printSummary(inputs, plan, changes, state) {
	console.log(
		`\n  Engine-Status:  ${state ? JSON.stringify(state) : "nicht aktiviert"}`,
	);
	console.log(
		`  Spiele:         ${inputs.games.length} (gewertet ${plan.stats.rated}, ohne Wertung ${plan.stats.unrated}), Handicap H ${plan.stats.handicap}`,
	);
	console.log(
		`  Änderungen:     ${changes.games.length} Snapshots, ${changes.profiles.length} Profile, ${changes.standings.length} Saison-Stände`,
	);
	console.log(
		`  Invarianten:    ${plan.violations.length ? plan.violations.join("; ") : "ok"}`,
	);
}

async function dryRun(pool) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
		const inputs = await loadEloInputs(client);
		const state = await getEloEngineState(client);
		const names = await usernames(client);
		await client.query("COMMIT");
		const plan = computePlan(inputs);
		const changes = diffPlan(plan, inputs);
		printSummary(inputs, plan, changes, state);
		printRanking(inputs, plan, names);
		console.log("");
		printSeasons(plan, names);
		const hashIn = inputHash(inputs);
		console.log(`\n  input-hash: ${hashIn}\n  plan-hash:  ${plan.hash}`);
		console.log(
			`\n  Anwenden mit:\n  npm run elo:recompute-v2 -- --apply --expect-input=${hashIn} --expect-plan=${plan.hash}\n`,
		);
		return plan.violations.length ? 1 : 0;
	} finally {
		client.release();
	}
}

function backupSuffix(now = new Date()) {
	return now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
}

async function lockForRatingWrite(client) {
	await client.query("SET LOCAL lock_timeout = '5s'");
	await client.query("SET LOCAL statement_timeout = '60s'");
	await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
	await client.query("SELECT pg_advisory_xact_lock($1)", [LEAGUE_ELO_LOCK_KEY]);
	await client.query(
		"LOCK TABLE games, game_players IN SHARE ROW EXCLUSIVE MODE",
	);
}

async function createBackup(client, suffix, hashes) {
	await client.query(
		`CREATE TABLE elo_backup_${suffix}_profiles AS
		 SELECT id, current_rating, matches_played, rating_history, peak_elo_value,
		        peak_elo_at, rating_updated_at, profile_cache, trophies
		   FROM profiles`,
	);
	await client.query(
		`CREATE TABLE elo_backup_${suffix}_games AS SELECT id, elo_snapshot FROM games`,
	);
	await client.query(
		`CREATE TABLE elo_backup_${suffix}_meta AS
		 SELECT $1::text AS input_hash, $2::text AS plan_hash, now() AS created_at,
		        (SELECT value FROM app_state WHERE key = 'elo') AS elo_state_before`,
		[hashes.input, hashes.plan],
	);
}

function assertHash(label, actual, expected) {
	if (actual !== expected) {
		throw new Error(
			`${label} mismatch: expected ${expected}, got ${actual}. The data changed since the dry run — run --dry-run again.`,
		);
	}
}

async function apply(pool, args) {
	if (!args.expectInput || !args.expectPlan) {
		throw new Error(
			"--apply needs --expect-input and --expect-plan from a dry run",
		);
	}
	const suffix = backupSuffix();
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await lockForRatingWrite(client);
		const inputs = await loadEloInputs(client);
		assertHash("input-hash", inputHash(inputs), args.expectInput);
		const plan = computePlan(inputs);
		assertHash("plan-hash", plan.hash, args.expectPlan);
		if (plan.violations.length) throw new Error(plan.violations.join("; "));

		await createBackup(client, suffix, {
			input: args.expectInput,
			plan: plan.hash,
		});
		const changes = diffPlan(plan, inputs);
		await writePlanChanges(client, changes);
		await client.query(
			`INSERT INTO app_state (key, value, updated_at) VALUES ('elo', $1::jsonb, now())
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
			[
				JSON.stringify({
					engine: "v2",
					version: LEAGUE_ELO_VERSION,
					activated_at: new Date().toISOString(),
					input_hash: args.expectInput,
					plan_hash: plan.hash,
					backup: suffix,
				}),
			],
		);

		const stored = await checkStoredInvariants(client);
		if (stored.length) throw new Error(stored.join("; "));
		const reloaded = await loadEloInputs(client);
		const leftover = diffPlan(computePlan(reloaded), reloaded);
		const rest =
			leftover.games.length +
			leftover.profiles.length +
			leftover.standings.length;
		if (rest !== 0) throw new Error(`${rest} rows still differ after writing`);

		await client.query("COMMIT");
		console.log(
			`\n  Angewendet: ${changes.games.length} Snapshots, ${changes.profiles.length} Profile, ${changes.standings.length} Saison-Stände.`,
		);
		console.log(`  Sicherung:  elo_backup_${suffix}_{profiles,games,meta}`);
		console.log(
			`  Rückweg:    npm run elo:recompute-v2 -- --restore=${suffix}\n`,
		);
		return 0;
	} catch (error) {
		await client.query("ROLLBACK").catch(() => {});
		throw error;
	} finally {
		client.release();
	}
}

async function restore(pool, args) {
	if (!SUFFIX_PATTERN.test(args.suffix ?? "")) {
		throw new Error(
			"--restore needs the backup suffix printed by --apply (YYYYMMDD_HHMMSS)",
		);
	}
	const t = (name) => `elo_backup_${args.suffix}_${name}`;
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await lockForRatingWrite(client);
		const {
			rows: [meta],
		} = await client.query(`SELECT * FROM ${t("meta")}`);
		const inputs = await loadEloInputs(client);
		if (inputHash(inputs) !== meta.input_hash && !args.force) {
			throw new Error(
				"Games changed since the backup. Restoring gives those games no old rating. Re-run with --force to accept.",
			);
		}
		await client.query(
			`UPDATE games g SET elo_snapshot = b.elo_snapshot FROM ${t("games")} b WHERE g.id = b.id`,
		);
		await client.query(
			`UPDATE games SET elo_snapshot = NULL WHERE id NOT IN (SELECT id FROM ${t("games")})`,
		);
		await client.query(
			`UPDATE profiles p
			    SET current_rating = b.current_rating, matches_played = b.matches_played,
			        rating_history = b.rating_history, peak_elo_value = b.peak_elo_value,
			        peak_elo_at = b.peak_elo_at, rating_updated_at = b.rating_updated_at,
			        trophies = b.trophies, profile_cache = NULL
			   FROM ${t("profiles")} b WHERE p.id = b.id`,
		);
		await client.query("DELETE FROM season_elo_standings");
		if (meta.elo_state_before) {
			await client.query(
				"UPDATE app_state SET value = $1::jsonb, updated_at = now() WHERE key = 'elo'",
				[JSON.stringify(meta.elo_state_before)],
			);
		} else {
			await client.query("DELETE FROM app_state WHERE key = 'elo'");
		}
		await client.query("COMMIT");
		console.log(
			`\n  Wiederhergestellt aus elo_backup_${args.suffix}_*. League-ELO v2 ist deaktiviert.\n`,
		);
		return 0;
	} catch (error) {
		await client.query("ROLLBACK").catch(() => {});
		throw error;
	} finally {
		client.release();
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	console.log(
		`\n  League-ELO v2 · Modus ${args.mode} · Ziel ${describeTarget()}`,
	);
	const pool = getPool();
	try {
		if (args.mode === "apply") return await apply(pool, args);
		if (args.mode === "restore") return await restore(pool, args);
		return await dryRun(pool);
	} finally {
		await closePool();
	}
}

main()
	.then((code) => process.exit(code))
	.catch((error) => {
		console.error(`\n  Abgebrochen: ${error.message}\n`);
		process.exit(1);
	});
