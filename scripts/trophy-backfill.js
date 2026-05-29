#!/usr/bin/env node
/**
 * Trophy backfill — assigns every player the trophies they would
 * have earned across their full match history.
 *
 * Why it exists: the trophy system lands as a code change with no
 * historical state. Without backfill, the entire office starts with
 * zero trophies even after years of matches — which is both demoral-
 * izing and incorrect ("I have 110 wins but no Centurion"). The
 * backfill replays every player's history against the current trophy
 * definitions and persists the unlocks with `unlockedAt = now()` and
 * `triggered_by_match_id = <match that first satisfied the shape>`
 * (or null for pure lifetime-aggregate trophies).
 *
 * Idempotent. Re-runs only assign trophies that don't already exist
 * in the player's `trophies` JSONB map.
 *
 * Usage:
 *   node scripts/trophy-backfill.js                  # dry-run (default)
 *   node scripts/trophy-backfill.js --commit         # actually write
 *   node scripts/trophy-backfill.js --player <uid>   # single player
 *   node scripts/trophy-backfill.js --player <uid> --commit
 *
 * The script connects via `DATABASE_URL`. Point that at the local
 * Docker Postgres for testing against a PROD snapshot; never run
 * `--commit` against the live Cloud SQL without a backup.
 *
 * Output is line-per-player + a summary block at the end.
 */

import "dotenv/config";
import { evaluateTrophiesForPlayer } from "../src/api/services/trophy/trophyCalculation.services.js";
import { normalizeMatch } from "../src/api/services/trophy/trophyMatchNormalizer.services.js";
import { getPool } from "../src/config/database.config.js";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const SINGLE_PLAYER = (() => {
	const idx = args.indexOf("--player");
	return idx !== -1 ? args[idx + 1] : null;
})();

const log = {
	info: (msg) => console.log(`[INFO] ${msg}`),
	warn: (msg) => console.warn(`[WARN] ${msg}`),
	error: (msg) => console.error(`[ERROR] ${msg}`),
	result: (msg) => console.log(`[RESULT] ${msg}`),
};

/**
 * Load every game the player participated in, oldest first. Joins
 * `game_players` once to scope, then a second lookup grabs every
 * participant per game so the normalizer can reconstruct teams.
 *
 * @param {import('pg').Pool} pool
 * @param {string} playerId
 * @returns {Promise<Array<object>>}
 */
async function loadPlayerMatches(pool, playerId) {
	const { rows: gameRows } = await pool.query(
		`SELECT g.*
		   FROM games g
		   JOIN game_players gp ON gp.game_id = g.id
		  WHERE gp.player_id = $1
		  ORDER BY g.played_at ASC, g.id ASC`,
		[playerId],
	);
	if (gameRows.length === 0) return [];

	const gameIds = gameRows.map((g) => g.id);
	const { rows: playerRows } = await pool.query(
		`SELECT game_id, player_id, team
		   FROM game_players
		  WHERE game_id = ANY($1::uuid[])`,
		[gameIds],
	);
	const playersByGame = new Map();
	for (const row of playerRows) {
		let bucket = playersByGame.get(row.game_id);
		if (!bucket) {
			bucket = [];
			playersByGame.set(row.game_id, bucket);
		}
		bucket.push({ player_id: row.player_id, team: row.team });
	}

	return gameRows.map((game) =>
		normalizeMatch(game, playersByGame.get(game.id) ?? []),
	);
}

/**
 * Merge new unlocks into the player's existing `trophies` JSONB map.
 * Existing entries win — backfill never overwrites a live-earned
 * trophy. Returns the count of NEW entries that will be added.
 *
 * @param {Record<string, object> | null} existing
 * @param {Array<{ trophyId: string, triggeredByMatchId: string | null }>} unlocks
 * @param {string} now - ISO timestamp for unlockedAt
 * @returns {{ next: object, newCount: number }}
 */
function mergeTrophies(existing, unlocks, now) {
	const next = { ...(existing ?? {}) };
	let newCount = 0;
	for (const { trophyId, triggeredByMatchId } of unlocks) {
		if (next[trophyId]) continue;
		next[trophyId] = {
			unlocked_at: now,
			triggered_by_match_id: triggeredByMatchId,
			backfilled: true,
		};
		newCount += 1;
	}
	return { next, newCount };
}

/**
 * Process one player end-to-end: load matches, evaluate trophies,
 * (optionally) persist the additions.
 *
 * @param {import('pg').Pool} pool
 * @param {{ id: string, username: string, trophies: object | null }} player
 * @returns {Promise<{ playerId: string, evaluated: number, newTrophies: number }>}
 */
async function processPlayer(pool, player) {
	const matches = await loadPlayerMatches(pool, player.id);
	if (matches.length === 0) {
		log.info(`${player.username} (${player.id}): no matches, skipped`);
		return { playerId: player.id, evaluated: 0, newTrophies: 0 };
	}
	const unlocks = evaluateTrophiesForPlayer({
		playerId: player.id,
		matches,
	});
	const now = new Date().toISOString();
	const { next, newCount } = mergeTrophies(player.trophies, unlocks, now);

	if (COMMIT && newCount > 0) {
		await pool.query(`UPDATE profiles SET trophies = $1::jsonb WHERE id = $2`, [
			JSON.stringify(next),
			player.id,
		]);
	}

	log.result(
		`${player.username} (${player.id}): ${unlocks.length} trophies match, ${newCount} new ` +
			`${COMMIT ? "written" : "(dry-run, not written)"} ` +
			`[matches: ${matches.length}]`,
	);
	return {
		playerId: player.id,
		evaluated: unlocks.length,
		newTrophies: newCount,
	};
}

async function main() {
	log.info("=================================================");
	log.info("Trophy backfill");
	log.info(`Mode: ${COMMIT ? "COMMIT (writes to DB)" : "DRY-RUN (no writes)"}`);
	if (SINGLE_PLAYER) log.info(`Single player: ${SINGLE_PLAYER}`);
	log.info("=================================================");

	if (!COMMIT) {
		log.warn("Dry-run active. No data will be written.");
		log.warn("Add --commit when you're happy with the dry-run report.");
	}

	const pool = getPool();
	let players;
	if (SINGLE_PLAYER) {
		const { rows } = await pool.query(
			"SELECT id, username, trophies FROM profiles WHERE id = $1",
			[SINGLE_PLAYER],
		);
		if (rows.length === 0) {
			log.error(`Player ${SINGLE_PLAYER} not found`);
			process.exit(1);
		}
		players = rows;
	} else {
		const { rows } = await pool.query(
			"SELECT id, username, trophies FROM profiles ORDER BY id",
		);
		players = rows;
	}
	log.info(`${players.length} player(s) to process`);

	let totalNew = 0;
	let totalEvaluated = 0;
	for (const player of players) {
		const result = await processPlayer(pool, player);
		totalNew += result.newTrophies;
		totalEvaluated += result.evaluated;
	}

	log.info("=================================================");
	log.result(
		`Done. ${totalEvaluated} trophies satisfied across all players, ` +
			`${totalNew} ${COMMIT ? "newly written" : "would be written (dry-run)"}`,
	);
	log.warn(
		"Duo trophies are NOT covered by this script yet — separate pass needed.",
	);
	log.info("=================================================");

	await pool.end();
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		log.error(`Backfill failed: ${err.message}`);
		console.error(err);
		process.exit(1);
	});
