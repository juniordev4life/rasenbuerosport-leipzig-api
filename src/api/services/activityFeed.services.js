import { query } from "../helpers/database.helpers.js";

/**
 * Fetches most recent games globally (not filtered by user)
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
export async function getRecentGames(limit = 10) {
	const games = await query(
		`SELECT g.*,
			json_agg(
				json_build_object(
					'player_id', gp.player_id,
					'team', gp.team,
					'team_name', gp.team_name,
					'profiles', json_build_object('username', p.username, 'avatar_url', p.avatar_url)
				)
			) AS game_players
		FROM games g
		LEFT JOIN game_players gp ON gp.game_id = g.id
		LEFT JOIN profiles p ON p.id = gp.player_id
		GROUP BY g.id
		ORDER BY g.played_at DESC
		LIMIT $1`,
		[limit],
	);

	return games;
}
