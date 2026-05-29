/**
 * Player-match loader used by every trophy entry point — backfill,
 * live-evaluation, and the read endpoint. Returns a chronological
 * (oldest first) list of normalized match shapes ready for the
 * aggregator + condition layer.
 *
 * Two queries because Postgres can't return a tree directly:
 *   1) Every game the player took part in, ordered by played_at.
 *   2) Every participant for those games (so we can rebuild teams).
 *
 * Both are parameterized — no string interpolation of user input.
 */

import { query } from "../../helpers/database.helpers.js";
import { normalizeMatch } from "./trophyMatchNormalizer.services.js";

/**
 * Load every game `playerId` participated in, normalized for the
 * trophy aggregator. Empty array when the player has no matches.
 *
 * @param {string} playerId - profiles.id (Firebase uid)
 * @returns {Promise<Array<object>>} Normalized matches, oldest first
 * @example
 *   const matches = await loadPlayerMatches("uid-123");
 *   const stats = aggregatePlayerForTrophies("uid-123", matches);
 */
export async function loadPlayerMatches(playerId) {
	const gameRows = await query(
		`SELECT g.*
		   FROM games g
		   JOIN game_players gp ON gp.game_id = g.id
		  WHERE gp.player_id = $1
		  ORDER BY g.played_at ASC, g.id ASC`,
		[playerId],
	);
	if (gameRows.length === 0) return [];

	const gameIds = gameRows.map((g) => g.id);
	const playerRows = await query(
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
