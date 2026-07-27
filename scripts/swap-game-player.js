#!/usr/bin/env node

/**
 * Replace one player with another in an already-recorded game.
 *
 * Correcting a lineup after the fact touches more than the
 * `game_players` row: the player id is denormalized into the game's
 * JSONB blobs as well. This script rewrites every occurrence in one
 * transaction so the game can never end up half-swapped.
 *
 * What it changes:
 *   1. `game_players.player_id`            — the lineup row itself
 *   2. `games.score_timeline`              — scored_by / assist_by /
 *                                            player_id / shooter_id /
 *                                            keeper_id
 *   3. `games.penalty_shootout`            — shooter_id / keeper_id and
 *                                            the `elo_deltas` KEYS
 *   4. `games.elo_snapshot`                — cleared; the recompute
 *                                            rebuilds it
 *   5. `profiles.profile_cache`            — nulled for BOTH players
 *   6. `games.match_report` (+ audio)      — cleared, it narrates the
 *                                            old lineup by name
 *                                            (keep with --keep-report)
 *
 * What it deliberately does NOT touch:
 *   - `match_stats` (team-level home/away counts, no player ids)
 *   - `home_pass_network` / `away_pass_network` (jersey numbers)
 *   - `reporter_id` (AI persona, not a player)
 *   - `created_by` (who recorded the match — still true after a swap)
 *   - `game_players.rating` (the slot's performance rating, carried
 *     over to the incoming player)
 *
 * This script does NOT recompute ELO. Ratings are path-dependent, so
 * the correction only lands once the full history is replayed:
 *
 *   node scripts/swap-game-player.js --game=<uuid> --from=X --to=Y --dry-run
 *   node scripts/swap-game-player.js --game=<uuid> --from=X --to=Y --apply --backup
 *   npm run elo:recompute -- --apply --backup
 *
 * Rolling back: run the same command with --from and --to reversed.
 * The cleared snapshot and report are rebuilt by the recompute and a
 * POST to /api/v1/games/<id>/match-report respectively.
 *
 * Flags:
 *   --game=UUID     Required. The game to correct.
 *   --from=REF      Required. Player to remove (id or username).
 *   --to=REF        Required. Player to insert (id or username).
 *   --dry-run       Report what would change, write nothing.
 *   --apply         Perform the swap.
 *   --backup        Dump the game row + lineup to JSON first.
 *   --backup-file=  Custom backup path (implies --backup).
 *   --keep-report   Leave `match_report` and its audio in place.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import {
	rewritePlayerInShootout,
	rewritePlayerInTimeline,
} from "../src/api/utils/playerReferences.utils.js";
import { getPool } from "../src/config/database.config.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));

if (!args.game || !args.from || !args.to) {
	console.error(
		"\nMissing arguments. Required: --game, --from, --to.\n" +
			"Try:  node scripts/swap-game-player.js --game=<uuid> --from=Hendrik --to=Alex --dry-run\n",
	);
	process.exit(1);
}

if (!args.dryRun && !args.apply) {
	console.error(
		"\nMissing mode. Pass --dry-run or --apply.\n" +
			"Start with --dry-run — it writes nothing.\n",
	);
	process.exit(1);
}

const pool = getPool();

try {
	const [fromPlayer, toPlayer] = await Promise.all([
		resolvePlayer(pool, args.from),
		resolvePlayer(pool, args.to),
	]);

	if (fromPlayer.id === toPlayer.id) {
		throw new Error(
			`--from and --to resolve to the same player (${fromPlayer.username}).`,
		);
	}

	const game = await loadGame(pool, args.game);
	const lineup = await loadLineup(pool, args.game);

	const fromRow = lineup.find((p) => p.player_id === fromPlayer.id);
	if (!fromRow) {
		throw new Error(
			`${fromPlayer.username} is not in this game. Lineup: ` +
				lineup.map((p) => `${p.username} (${p.team})`).join(", "),
		);
	}
	// game_players has UNIQUE(game_id, player_id) — a straight swap would
	// hit it. Exchanging two players who BOTH already played is a
	// different operation and needs a different fix.
	if (lineup.some((p) => p.player_id === toPlayer.id)) {
		throw new Error(
			`${toPlayer.username} already plays in this game — a swap would ` +
				"violate UNIQUE(game_id, player_id). Swapping two existing " +
				"players means exchanging their teams, not replacing one.",
		);
	}

	const timeline = rewritePlayerInTimeline(
		game.score_timeline,
		fromPlayer.id,
		toPlayer.id,
	);
	const shootout = rewritePlayerInShootout(
		game.penalty_shootout,
		fromPlayer.id,
		toPlayer.id,
	);
	const clearReport = !args.keepReport && Boolean(game.match_report);

	console.log(`\nGame:     ${game.id}`);
	console.log(
		`          ${game.home_team_name ?? "?"} ${game.score_home}:${game.score_away} ${game.away_team_name ?? "?"} · ${game.played_at.toISOString?.() ?? game.played_at}`,
	);
	console.log(
		`Lineup:   ${lineup.map((p) => `${p.username} (${p.team})`).join(", ")}`,
	);
	console.log(
		`Swap:     ${fromPlayer.username} → ${toPlayer.username} (${fromRow.team})\n`,
	);
	console.log("Changes:");
	console.log("  game_players row:        1");
	console.log(`  score_timeline refs:     ${timeline.changed}`);
	console.log(`  penalty_shootout refs:   ${shootout.changed}`);
	console.log(
		`  elo_snapshot:            ${game.elo_snapshot ? "cleared" : "already empty"}`,
	);
	console.log(`  match_report:            ${clearReport ? "cleared" : "kept"}`);
	console.log("  profile_cache:           2 (both players)");

	if (game.pending) {
		console.log(
			"\nNote: this game is still PENDING — its ELO has not run yet, so no\n" +
				"recompute is needed. finalizeGame will rate the corrected lineup.",
		);
	}

	if (args.dryRun) {
		console.log("\n[dry-run] Nothing was written.");
		await pool.end();
		process.exit(0);
	}

	if (args.backup) {
		const path = await writeBackup(args.backupFile, { game, lineup });
		console.log(`\nBackup written → ${path}`);
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		await client.query(
			"UPDATE game_players SET player_id = $1 WHERE game_id = $2 AND player_id = $3",
			[toPlayer.id, game.id, fromPlayer.id],
		);

		await client.query(
			`UPDATE games
			    SET score_timeline = $1::jsonb,
			        penalty_shootout = $2::jsonb,
			        elo_snapshot = NULL
			  WHERE id = $3`,
			[
				JSON.stringify(timeline.timeline),
				shootout.shootout ? JSON.stringify(shootout.shootout) : null,
				game.id,
			],
		);

		if (clearReport) {
			await client.query(
				`UPDATE games
				    SET match_report = NULL,
				        match_report_audio_url = NULL,
				        match_report_audio_generated_at = NULL,
				        reporter_id = NULL
				  WHERE id = $1`,
				[game.id],
			);
		}

		// Both profiles: the outgoing player loses a match, the incoming
		// one gains it, so neither cached snapshot is valid any more.
		await client.query(
			"UPDATE profiles SET profile_cache = NULL WHERE id = ANY($1::text[])",
			[[fromPlayer.id, toPlayer.id]],
		);

		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}

	console.log("\n✓ Swap committed.");
	if (!game.pending) {
		console.log("\nNext, replay the ratings — ELO is path-dependent, so every");
		console.log("game after this one shifts too:");
		console.log("  npm run elo:recompute -- --dry-run");
		console.log("  npm run elo:recompute -- --apply --backup");
	}
	if (clearReport) {
		console.log("\nThen regenerate the match report:");
		console.log(`  POST /api/v1/games/${game.id}/match-report`);
	}
	console.log(
		"\nStill manual: trophies are append-only (profiles.trophies,\n" +
			"duo_trophies) — a badge earned through this match stays awarded.",
	);
} catch (err) {
	console.error(`\nFailed: ${err.message}`);
	process.exitCode = 1;
} finally {
	await pool.end();
}

/**
 * Parses the CLI surface of this script.
 * @param {string[]} argv
 * @returns {object}
 * @example
 *   parseArgs(["--game=abc", "--from=A", "--to=B", "--apply"]);
 */
function parseArgs(argv) {
	const result = {
		game: null,
		from: null,
		to: null,
		dryRun: false,
		apply: false,
		backup: false,
		backupFile: null,
		keepReport: false,
	};
	for (const raw of argv) {
		if (raw === "--dry-run") result.dryRun = true;
		else if (raw === "--apply") result.apply = true;
		else if (raw === "--backup") result.backup = true;
		else if (raw === "--keep-report") result.keepReport = true;
		else if (raw.startsWith("--game="))
			result.game = raw.slice("--game=".length);
		else if (raw.startsWith("--from="))
			result.from = raw.slice("--from=".length);
		else if (raw.startsWith("--to=")) result.to = raw.slice("--to=".length);
		else if (raw.startsWith("--backup-file=")) {
			result.backupFile = raw.slice("--backup-file=".length);
			result.backup = true;
		}
	}
	return result;
}

/**
 * Resolves a player reference — either a profile id or a username — to
 * a single profile. Username matching is case-insensitive; an
 * ambiguous match is an error rather than a guess.
 *
 * @param {import("pg").Pool} pool
 * @param {string} ref
 * @returns {Promise<{ id: string, username: string }>}
 * @example
 *   await resolvePlayer(pool, "Hendrik"); // → { id: "uid-...", username: "Hendrik" }
 */
async function resolvePlayer(pool, ref) {
	const { rows } = await pool.query(
		"SELECT id, username FROM profiles WHERE id = $1 OR lower(username) = lower($1)",
		[ref],
	);
	if (rows.length === 0) throw new Error(`No player matches "${ref}".`);
	if (rows.length > 1) {
		throw new Error(
			`"${ref}" is ambiguous: ${rows.map((r) => `${r.username} (${r.id})`).join(", ")}. Pass the id.`,
		);
	}
	return rows[0];
}

/**
 * Loads the game row to correct.
 * @param {import("pg").Pool} pool
 * @param {string} gameId
 * @returns {Promise<object>}
 * @example
 *   await loadGame(pool, "8f3c...");
 */
async function loadGame(pool, gameId) {
	const { rows } = await pool.query("SELECT * FROM games WHERE id = $1", [
		gameId,
	]);
	if (rows.length === 0) throw new Error(`No game with id ${gameId}.`);
	return rows[0];
}

/**
 * Loads the lineup with usernames attached, for validation and output.
 * @param {import("pg").Pool} pool
 * @param {string} gameId
 * @returns {Promise<Array<{ player_id: string, team: string, username: string }>>}
 * @example
 *   await loadLineup(pool, "8f3c..."); // → [{ player_id, team, username }, ...]
 */
async function loadLineup(pool, gameId) {
	const { rows } = await pool.query(
		`SELECT gp.player_id, gp.team, p.username
		   FROM game_players gp
		   JOIN profiles p ON p.id = gp.player_id
		  WHERE gp.game_id = $1
		  ORDER BY gp.team, p.username`,
		[gameId],
	);
	return rows;
}

/**
 * Dumps the pre-swap game row and lineup to JSON for forensics.
 * @param {string|null} customPath
 * @param {{ game: object, lineup: Array<object> }} payload
 * @returns {Promise<string>} Absolute path of the written file.
 * @example
 *   await writeBackup(null, { game, lineup });
 */
async function writeBackup(customPath, payload) {
	const dump = { version: 1, createdAt: new Date().toISOString(), ...payload };
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const target = customPath
		? resolve(customPath)
		: resolve(SCRIPT_DIR, `.swap-backup-${ts}.json`);

	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, JSON.stringify(dump, null, 2), "utf8");
	return target;
}
