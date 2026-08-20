#!/usr/bin/env node

/**
 * One-off backfill: replay every existing game in chronological order
 * and let the ELO engine assign a rating to each player + a snapshot
 * to each game. Use this before the prod cutover so the leaderboard,
 * profiles and old Spielbericht pages all show real ELO movements
 * instead of everyone starting at 1500.
 *
 * What it does (in one transaction per game):
 *   1. Optionally dump the current ELO state to a JSON backup file.
 *   2. Reset every profile to 1500 / 0 matches / empty history.
 *   3. Clear `games.elo_snapshot` on every row.
 *   4. Walk all finalized games ASC by `played_at` and call
 *      `replayGameElo` — the team engine plus the penalty-shootout and
 *      card overlays, in the same order the live save path applies
 *      them. Each pass reads the current rating, computes the delta and
 *      writes back the snapshot and the new rating.
 *
 * Pending games (zero-tracking flow, saved 0:0 until the capture
 * pipeline finalizes them) are excluded — the live path defers their
 * ELO to finalize time, so replaying them would invent ratings for
 * results that do not exist yet.
 *
 * Suggested workflow:
 *   node scripts/recompute-all-elo.js --dry-run
 *   node scripts/recompute-all-elo.js --apply --backup
 *   # If something went wrong:
 *   node scripts/recompute-all-elo.js --restore=scripts/.elo-backup-<ts>.json
 *
 * Optional flags:
 *   --backup        Write a JSON dump of profiles + game snapshots before
 *                   the reset. Default file:
 *                   scripts/.elo-backup-<timestamp>.json
 *   --backup-file=  Custom backup path (implies --backup).
 *   --restore=path  Restore ratings + snapshots from a previous backup
 *                   and exit. Skips all other steps.
 *   --skip-reset    Don't reset profiles first (resume a partial run).
 *   --limit=N       Only process the oldest N games. Spot-check helper.
 *   --since=ISO     Only recompute games played on/after this ISO date.
 *
 * A note on --since: ELO is path-dependent, so it is NOT a "recompute
 * just the recent games" switch. The reset in step 2 has no WHERE
 * clause — it wipes every profile and every snapshot — so combining
 * --since with --apply would leave everything before that date blank.
 * The combination is refused unless --skip-reset is passed too, which
 * is the resume-a-crashed-run case. To correct one old game, replay
 * the full history.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { replayGameElo } from "../src/api/services/elo/eloReplay.services.js";
import { getPool } from "../src/config/database.config.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));

if (!args.restore && !args.dryRun && !args.apply) {
	console.error(
		"\nMissing mode. Pass --dry-run, --apply or --restore=<file>.\n" +
			"Try:  node scripts/recompute-all-elo.js --dry-run\n",
	);
	process.exit(1);
}

// --since looks like a partial recompute but the reset it runs first is
// global: every profile back to 1500, every snapshot cleared. Replaying
// only the tail on top of that blanks all earlier history. Refuse the
// combination rather than let it look like it worked.
if (args.apply && args.since && !args.skipReset) {
	console.error(
		"\n--since cannot be combined with --apply: the reset clears ALL\n" +
			"profiles and snapshots, so only the games after the cutoff would\n" +
			"be rebuilt and everything before it would stay empty.\n\n" +
			"ELO is path-dependent — correcting one old game means replaying\n" +
			"the full history:\n" +
			"  node scripts/recompute-all-elo.js --apply --backup\n\n" +
			"If you are resuming a run that crashed part-way, opt out of the\n" +
			"reset explicitly:\n" +
			`  node scripts/recompute-all-elo.js --apply --skip-reset --since=${args.since}\n`,
	);
	process.exit(1);
}

const pool = getPool();
const stats = {
	processed: 0,
	skipped: 0,
	profilesReset: 0,
	restored: 0,
	penaltyOverlays: 0,
	cardOverlays: 0,
	pendingExcluded: 0,
};

/**
 * Host, port and database this run will touch — credentials left out.
 *
 * Printed before anything happens because `.env` carries the LOCAL dev
 * DATABASE_URL (Docker Postgres on :5434, see CLAUDE.md). A run meant for
 * production therefore hits the local database unless DATABASE_URL is
 * overridden — use scripts/with-prod-db.sh. Two runs already went to the
 * wrong database for exactly this reason, and the only symptom was a bare
 * ECONNREFUSED because the local container happened to be stopped.
 *
 * @returns {string} e.g. "127.0.0.1:5433/rasenbuerosport"
 * @example
 * describeTarget(); // "127.0.0.1:5434/rasenbuerosport"
 */
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

console.log(`target database:   ${describeTarget()}`);

try {
	if (args.restore) {
		stats.restored = await restoreFromBackup(pool, args.restore);
		console.log("\n=== ELO restore summary ===");
		console.log(`source:            ${args.restore}`);
		console.log(`profiles restored: ${stats.restored.profiles}`);
		console.log(`snapshots restored:${stats.restored.snapshots}`);
		await pool.end();
		process.exit(0);
	}

	if (args.backup) {
		const path = await writeBackup(pool, args.backupFile);
		console.log(`Backup written → ${path}`);
	}

	if (!args.skipReset && args.apply) {
		stats.profilesReset = await resetProfiles(pool);
		await clearSnapshots(pool);
	} else if (!args.skipReset && args.dryRun) {
		const { rows } = await pool.query(
			"SELECT COUNT(*)::int AS n FROM profiles WHERE matches_played > 0 OR current_rating <> 1500",
		);
		stats.profilesReset = rows[0].n;
		console.log(`[dry-run] would reset ${rows[0].n} profile(s) to 1500/0`);
	}

	const games = await loadGames(pool, args);
	stats.pendingExcluded = await countPendingGames(pool, args);
	console.log(
		`Found ${games.length} finalized game(s) to replay${args.limit ? ` (limited to ${args.limit})` : ""}.`,
	);
	if (stats.pendingExcluded > 0) {
		console.log(
			`Skipping ${stats.pendingExcluded} pending game(s) — their ELO runs at finalize time.`,
		);
	}

	for (const game of games) {
		const { rows: gamePlayers } = await pool.query(
			"SELECT player_id, team FROM game_players WHERE game_id = $1 ORDER BY team, player_id",
			[game.id],
		);

		if (gamePlayers.length < 2) {
			stats.skipped += 1;
			continue;
		}

		if (args.dryRun) {
			// Same conditions replayGameElo uses, so the dry run reports the
			// overlay count an --apply run would actually produce.
			if (game.penalty_shootout?.shots?.length) stats.penaltyOverlays += 1;
			if (game.match_stats?.card_elo_applied) stats.cardOverlays += 1;
			stats.processed += 1;
			if (stats.processed % 25 === 0) {
				console.log(`[dry-run] ${stats.processed}/${games.length}`);
			}
			continue;
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const { penaltyDeltas, cardDeltas } = await replayGameElo({
				client,
				game,
				gamePlayers,
			});
			await client.query("COMMIT");
			if (penaltyDeltas) stats.penaltyOverlays += 1;
			if (cardDeltas) stats.cardOverlays += 1;
			stats.processed += 1;
		} catch (err) {
			await client.query("ROLLBACK");
			console.error(
				`✗ Game ${game.id} (${game.played_at}) failed:`,
				err.message,
			);
			stats.skipped += 1;
		} finally {
			client.release();
		}

		if (stats.processed % 25 === 0) {
			console.log(`  …${stats.processed}/${games.length} processed`);
		}
	}

	console.log("\n=== ELO backfill summary ===");
	console.log(`mode:              ${args.dryRun ? "dry-run" : "apply"}`);
	console.log(`profiles reset:    ${stats.profilesReset}`);
	console.log(`games processed:   ${stats.processed}`);
	console.log(`  penalty overlay: ${stats.penaltyOverlays}`);
	console.log(`  card overlay:    ${stats.cardOverlays}`);
	console.log(`games skipped:     ${stats.skipped}`);
	console.log(`pending excluded:  ${stats.pendingExcluded}`);

	if (!args.dryRun) {
		const ranked = await pool.query(
			`SELECT username, current_rating, matches_played
			   FROM profiles
			  WHERE matches_played > 0
			  ORDER BY current_rating DESC
			  LIMIT 15`,
		);
		console.log("\nTop 15 after backfill:");
		for (const row of ranked.rows) {
			console.log(
				`  ${String(row.current_rating).padStart(4)}  ${row.username}  (${row.matches_played} matches)`,
			);
		}
	}
} catch (err) {
	console.error("Fatal:", err);
	process.exitCode = 1;
} finally {
	await pool.end();
}

/**
 * Parses the small CLI surface of this script.
 * @param {string[]} argv
 */
function parseArgs(argv) {
	const result = {
		dryRun: false,
		apply: false,
		skipReset: false,
		limit: null,
		since: null,
		backup: false,
		backupFile: null,
		restore: null,
	};
	for (const raw of argv) {
		if (raw === "--dry-run") result.dryRun = true;
		else if (raw === "--apply") result.apply = true;
		else if (raw === "--skip-reset") result.skipReset = true;
		else if (raw === "--backup") result.backup = true;
		else if (raw.startsWith("--backup-file=")) {
			result.backupFile = raw.slice("--backup-file=".length);
			result.backup = true;
		} else if (raw.startsWith("--restore=")) {
			result.restore = raw.slice("--restore=".length);
		} else if (raw.startsWith("--limit=")) {
			result.limit = Number(raw.slice("--limit=".length));
		} else if (raw.startsWith("--since=")) {
			result.since = raw.slice("--since=".length);
		}
	}
	return result;
}

/**
 * Dump the current ELO state to a JSON file so an `--apply` run can
 * be rolled back later via `--restore`. Includes every profile's
 * rating/history/matches and every game's `elo_snapshot`.
 *
 * @param {import("pg").Pool} pool
 * @param {string|null} customPath
 * @returns {Promise<string>} Absolute path of the written backup.
 */
async function writeBackup(pool, customPath) {
	const [{ rows: profiles }, { rows: snapshots }] = await Promise.all([
		pool.query(
			`SELECT id, current_rating, matches_played, rating_history,
			        rating_updated_at, peak_elo_value, peak_elo_at
			   FROM profiles`,
		),
		pool.query(
			"SELECT id, elo_snapshot FROM games WHERE elo_snapshot IS NOT NULL",
		),
	]);

	const dump = {
		version: 1,
		createdAt: new Date().toISOString(),
		profiles,
		gameSnapshots: snapshots,
	};

	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const target = customPath
		? resolve(customPath)
		: resolve(SCRIPT_DIR, `.elo-backup-${ts}.json`);

	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, JSON.stringify(dump, null, 2), "utf8");
	return target;
}

/**
 * Restore profile ratings + game snapshots from a backup file written
 * by `writeBackup`. Safe to run on its own — does not touch any game
 * that is not part of the backup.
 *
 * @param {import("pg").Pool} pool
 * @param {string} path
 * @returns {Promise<{ profiles: number, snapshots: number }>}
 */
async function restoreFromBackup(pool, path) {
	const raw = await readFile(resolve(path), "utf8");
	/** @type {{ profiles: Array<object>, gameSnapshots: Array<object> }} */
	const dump = JSON.parse(raw);
	if (!Array.isArray(dump.profiles) || !Array.isArray(dump.gameSnapshots)) {
		throw new Error("Backup file has an unexpected shape.");
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		for (const p of dump.profiles) {
			await client.query(
				`UPDATE profiles
				    SET current_rating = $1,
				        matches_played = $2,
				        rating_history = $3::jsonb,
				        rating_updated_at = COALESCE($4::timestamptz, now()),
				        peak_elo_value = COALESCE($5, 1500),
				        peak_elo_at = $6::timestamptz
				  WHERE id = $7`,
				[
					p.current_rating,
					p.matches_played,
					JSON.stringify(p.rating_history ?? []),
					p.rating_updated_at ?? null,
					p.peak_elo_value ?? null,
					p.peak_elo_at ?? null,
					p.id,
				],
			);
		}

		await client.query(
			"UPDATE games SET elo_snapshot = NULL WHERE elo_snapshot IS NOT NULL",
		);

		for (const g of dump.gameSnapshots) {
			await client.query(
				"UPDATE games SET elo_snapshot = $1::jsonb WHERE id = $2",
				[JSON.stringify(g.elo_snapshot), g.id],
			);
		}

		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}

	return {
		profiles: dump.profiles.length,
		snapshots: dump.gameSnapshots.length,
	};
}

/**
 * Wipes every profile back to the default 1500/0/empty state.
 * @param {import("pg").Pool} pool
 * @returns {Promise<number>} Number of rows touched.
 */
async function resetProfiles(pool) {
	const { rowCount } = await pool.query(
		`UPDATE profiles
		    SET current_rating = 1500,
		        matches_played = 0,
		        rating_history = '[]'::jsonb,
		        rating_updated_at = now(),
		        peak_elo_value = 1500,
		        peak_elo_at = NULL`,
	);
	console.log(`Reset ${rowCount} profile(s) to 1500 / 0 matches.`);
	return rowCount;
}

/**
 * Clears `games.elo_snapshot` for every row so the replay rewrites
 * snapshots cleanly without leftover state from previous runs.
 * @param {import("pg").Pool} pool
 */
async function clearSnapshots(pool) {
	const { rowCount } = await pool.query(
		"UPDATE games SET elo_snapshot = NULL WHERE elo_snapshot IS NOT NULL",
	);
	console.log(`Cleared elo_snapshot on ${rowCount} game(s).`);
}

/**
 * Loads the finalized games to replay, oldest first. Order matters
 * because each call to `replayGameElo` reads each player's current
 * rating from the profile — that rating is the cumulative result of
 * every previous game's outcome.
 *
 * @param {import("pg").Pool} pool
 * @param {{ limit: number|null, since: string|null }} opts
 */
async function loadGames(pool, opts) {
	// `pending` games are 0:0 placeholders whose real result has not been
	// extracted yet. createGame deliberately skips ELO for them and
	// finalizeGame applies it later; replaying them here would rate a
	// result that does not exist.
	const where = ["pending = false"];
	const params = [];
	if (opts.since) {
		params.push(opts.since);
		where.push(`played_at >= $${params.length}::timestamptz`);
	}
	const limitClause = opts.limit ? `LIMIT ${Number(opts.limit)}` : "";

	const { rows } = await pool.query(
		`SELECT *
		   FROM games
		  WHERE ${where.join(" AND ")}
		  ORDER BY played_at ASC, id ASC
		  ${limitClause}`,
		params,
	);
	return rows;
}

/**
 * Counts the pending games `loadGames` filtered out, so the run reports
 * what it left alone instead of silently narrowing the set.
 *
 * @param {import("pg").Pool} pool
 * @param {{ since: string|null }} opts
 * @returns {Promise<number>}
 * @example
 *   await countPendingGames(pool, { since: null }); // → 2
 */
async function countPendingGames(pool, opts) {
	const params = [];
	let sinceClause = "";
	if (opts.since) {
		params.push(opts.since);
		sinceClause = ` AND played_at >= $${params.length}::timestamptz`;
	}
	const { rows } = await pool.query(
		`SELECT COUNT(*)::int AS n FROM games WHERE pending = true${sinceClause}`,
		params,
	);
	return rows[0].n;
}
