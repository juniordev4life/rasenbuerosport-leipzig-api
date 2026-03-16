import { query } from "../helpers/database.helpers.js";

/**
 * Fetches most recent games globally, optionally filtered by date range
 * @param {number} limit
 * @param {string} [from] - ISO date string for start boundary
 * @param {string} [to] - ISO date string for end boundary
 * @returns {Promise<object[]>}
 */
export async function getRecentGames(limit = 10, from, to) {
	const conditions = [];
	const params = [];
	let idx = 1;

	if (from) {
		conditions.push(`g.played_at >= $${idx++}`);
		params.push(from);
	}
	if (to) {
		conditions.push(`g.played_at <= $${idx++}`);
		params.push(to);
	}

	const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
	params.push(limit);

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
		${where}
		GROUP BY g.id
		ORDER BY g.played_at DESC
		LIMIT $${idx}`,
		params,
	);

	return games;
}
