/**
 * Read-side ELO services. Thin SQL wrappers behind the
 * `/players/:id/rating` and `/matches/:id/elo` endpoints.
 *
 * Kept separate from the write-side persistence so the read path
 * stays trivially cacheable later (e.g. for leaderboard queries).
 */

import { queryOne } from "../../helpers/database.helpers.js";

/**
 * Fetch the rating + history block for one player.
 *
 * @param {string} playerId
 * @returns {Promise<{
 *   player_id: string,
 *   username: string,
 *   current_rating: number,
 *   matches_played: number,
 *   rating_updated_at: Date|null,
 *   rating_history: number[]
 * } | null>}
 */
export async function getPlayerRating(playerId) {
	const row = await queryOne(
		`SELECT id AS player_id, username, current_rating, matches_played,
		        rating_updated_at, rating_history
		   FROM profiles
		  WHERE id = $1`,
		[playerId],
	);
	if (!row) return null;
	return {
		...row,
		rating_history: Array.isArray(row.rating_history) ? row.rating_history : [],
	};
}

/**
 * Fetch the ELO snapshot stored on a single game row.
 *
 * @param {string} gameId
 * @returns {Promise<{
 *   game_id: string,
 *   elo_snapshot: object|null
 * } | null>}
 */
export async function getMatchElo(gameId) {
	const row = await queryOne(
		"SELECT id AS game_id, elo_snapshot FROM games WHERE id = $1",
		[gameId],
	);
	if (!row) return null;
	return row;
}
