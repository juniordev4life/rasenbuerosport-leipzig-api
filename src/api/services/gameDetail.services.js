import { query, queryOne } from "../helpers/database.helpers.js";

/**
 * Fetches a single game by ID with all players and profiles
 * @param {string} gameId - Game UUID
 * @returns {Promise<object|null>}
 */
export async function getGameById(gameId) {
	const game = await queryOne("SELECT * FROM games WHERE id = $1", [gameId]);

	if (!game) return null;

	const players = await query(
		`SELECT gp.player_id, gp.team, gp.team_name, gp.rating,
			json_build_object('username', p.username, 'avatar_url', p.avatar_url) AS profiles
		FROM game_players gp
		LEFT JOIN profiles p ON p.id = gp.player_id
		WHERE gp.game_id = $1`,
		[gameId],
	);

	game.game_players = players;
	return game;
}
