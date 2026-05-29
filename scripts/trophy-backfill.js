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
import {
	evaluateDuoTrophies,
	evaluateTrophiesForPlayer,
} from "../src/api/services/trophy/trophyCalculation.services.js";
import { normalizeMatch } from "../src/api/services/trophy/trophyMatchNormalizer.services.js";
import { getPool } from "../src/config/database.config.js";
import { TROPHIES_BY_ID } from "../src/constants/trophies.constants.js";

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

	// In single-player mode print every unlocked trophy so the operator
	// can sanity-check WHICH 27 trophies the player would receive before
	// running with --commit. Suppressed during full-league runs to keep
	// the log readable.
	if (SINGLE_PLAYER) {
		for (const { trophyId, triggeredByMatchId } of unlocks) {
			const def = TROPHIES_BY_ID.get(trophyId);
			const newFlag = (player.trophies ?? {})[trophyId] ? "ALREADY" : "NEW";
			const trigger = triggeredByMatchId
				? `match ${triggeredByMatchId}`
				: "lifetime aggregate";
			log.info(
				`  [${newFlag}] ${trophyId} · ${def?.name ?? "?"} ` +
					`(${def?.rarity ?? "?"}/${def?.category ?? "?"}) — ${trigger}`,
			);
		}
	}

	return {
		playerId: player.id,
		evaluated: unlocks.length,
		newTrophies: newCount,
	};
}

/**
 * Find every sorted duo pair that has played together in 2v2 matches.
 * "Together" = both on the same side of the same game. When the script
 * runs in single-player mode the result is restricted to pairs that
 * include the focal player.
 *
 * @param {import('pg').Pool} pool
 * @param {string | null} restrictToPlayer
 * @returns {Promise<Array<[string, string]>>} Sorted pairs (a < b)
 */
async function loadAllDuoPairs(pool, restrictToPlayer) {
	const baseSql = `
		SELECT DISTINCT
		       LEAST(gp1.player_id, gp2.player_id) AS player1,
		       GREATEST(gp1.player_id, gp2.player_id) AS player2
		  FROM game_players gp1
		  JOIN game_players gp2
		    ON gp1.game_id = gp2.game_id
		   AND gp1.team = gp2.team
		   AND gp1.player_id < gp2.player_id
	`;
	const sql = restrictToPlayer
		? `${baseSql} WHERE gp1.player_id = $1 OR gp2.player_id = $1`
		: baseSql;
	const params = restrictToPlayer ? [restrictToPlayer] : [];
	const { rows } = await pool.query(sql, params);
	return rows.map((r) => [r.player1, r.player2]);
}

/**
 * Load every match a duo played together — both players on the SAME
 * side — chronologically. Used as the input to `evaluateDuoTrophies`.
 *
 * @param {import('pg').Pool} pool
 * @param {[string, string]} pair
 * @returns {Promise<Array<object>>}
 */
async function loadDuoMatches(pool, pair) {
	const [a, b] = pair;
	const { rows: gameRows } = await pool.query(
		`SELECT g.*
		   FROM games g
		   JOIN game_players gp1 ON gp1.game_id = g.id AND gp1.player_id = $1
		   JOIN game_players gp2 ON gp2.game_id = g.id AND gp2.player_id = $2
		                         AND gp2.team = gp1.team
		  ORDER BY g.played_at ASC, g.id ASC`,
		[a, b],
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
 * Process one duo end-to-end. Same idempotency rule as the individual
 * pass: existing trophy entries are never overwritten.
 *
 * @param {import('pg').Pool} pool
 * @param {[string, string]} pair - sorted (a < b)
 * @param {Map<string, string>} usernameById
 * @returns {Promise<{ pair: [string, string], evaluated: number, newTrophies: number }>}
 */
async function processDuo(pool, pair, usernameById) {
	const [a, b] = pair;
	const matches = await loadDuoMatches(pool, pair);
	if (matches.length === 0) {
		return { pair, evaluated: 0, newTrophies: 0 };
	}
	const unlocks = evaluateDuoTrophies({ duoPlayers: pair, matches });

	const { rows } = await pool.query(
		"SELECT trophies FROM duo_trophies WHERE player1_id = $1 AND player2_id = $2",
		[a, b],
	);
	const existing = rows[0]?.trophies ?? {};
	const now = new Date().toISOString();
	const { next, newCount } = mergeTrophies(existing, unlocks, now);

	if (COMMIT && newCount > 0) {
		await pool.query(
			`INSERT INTO duo_trophies (player1_id, player2_id, trophies)
			 VALUES ($1, $2, $3::jsonb)
			 ON CONFLICT (player1_id, player2_id)
			 DO UPDATE SET trophies = EXCLUDED.trophies`,
			[a, b, JSON.stringify(next)],
		);
	}

	const aName = usernameById.get(a) ?? a;
	const bName = usernameById.get(b) ?? b;
	log.result(
		`Duo ${aName} + ${bName}: ${unlocks.length} trophies match, ${newCount} new ` +
			`${COMMIT ? "written" : "(dry-run, not written)"} ` +
			`[shared matches: ${matches.length}]`,
	);
	if (SINGLE_PLAYER) {
		for (const { trophyId } of unlocks) {
			const def = TROPHIES_BY_ID.get(trophyId);
			const newFlag = existing[trophyId] ? "ALREADY" : "NEW";
			log.info(
				`  [${newFlag}] ${trophyId} · ${def?.name ?? "?"} ` +
					`(${def?.rarity ?? "?"}/${def?.category ?? "?"})`,
			);
		}
	}

	return { pair, evaluated: unlocks.length, newTrophies: newCount };
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

	// Duo pass — every distinct sorted pair that ever shared a team.
	// Pre-build a username lookup so the per-duo log lines stay
	// human-readable (player ids look like Firebase uids and aren't fun
	// to read in a status report).
	log.info("=================================================");
	log.info("Duo pass");
	const usernameById = new Map(players.map((p) => [p.id, p.username]));
	// In single-player mode the individual pass only loaded one row, but
	// we want every duo that player is part of. Re-resolve names so the
	// log line isn't just bare uids.
	if (SINGLE_PLAYER) {
		const { rows: nameRows } = await pool.query(
			"SELECT id, username FROM profiles",
		);
		for (const row of nameRows) usernameById.set(row.id, row.username);
	}
	const duoPairs = await loadAllDuoPairs(pool, SINGLE_PLAYER);
	log.info(`${duoPairs.length} duo pair(s) to process`);

	let duoTotalNew = 0;
	let duoTotalEvaluated = 0;
	for (const pair of duoPairs) {
		const result = await processDuo(pool, pair, usernameById);
		duoTotalNew += result.newTrophies;
		duoTotalEvaluated += result.evaluated;
	}

	log.info("=================================================");
	log.result(
		`Individuals: ${totalEvaluated} trophies satisfied, ` +
			`${totalNew} ${COMMIT ? "newly written" : "would be written (dry-run)"}`,
	);
	log.result(
		`Duos:        ${duoTotalEvaluated} trophies satisfied, ` +
			`${duoTotalNew} ${COMMIT ? "newly written" : "would be written (dry-run)"}`,
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
