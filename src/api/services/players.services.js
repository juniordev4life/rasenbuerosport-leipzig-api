import { query } from "../helpers/database.helpers.js";

/**
 * Gets all player profiles, alphabetically, each with the number of games
 * the player has taken part in. The new-game lobby sorts by that count so
 * the regulars come first.
 * @returns {Promise<Array<{id: string, username: string, avatar_url: string|null, games_played: number}>>}
 * @example
 * const players = await getAllPlayers();
 * // [{ id: "uid-1", username: "AH", avatar_url: null, games_played: 42 }, …]
 */
export async function getAllPlayers() {
	return query(
		`SELECT p.id, p.username, p.avatar_url, COUNT(gp.id)::int AS games_played
		FROM profiles p
		LEFT JOIN game_players gp ON gp.player_id = p.id
		GROUP BY p.id
		ORDER BY p.username ASC`,
	);
}
