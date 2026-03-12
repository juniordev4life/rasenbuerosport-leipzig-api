import { getPool } from "../../config/database.config.js";
import { query } from "../helpers/database.helpers.js";

/**
 * Creates a new game with players
 * @param {object} params
 * @param {string} params.mode - '1v1' or '2v2'
 * @param {number} params.score_home
 * @param {number} params.score_away
 * @param {object[]} params.players - Array of {id, team, team_name?, rating?}
 * @param {string} [params.played_at] - ISO date string
 * @param {string} params.created_by - User UUID
 * @param {object[]} [params.score_timeline] - Array of {home, away, period}
 * @param {string} [params.result_type] - 'regular', 'extra_time', or 'penalty'
 * @returns {Promise<object>}
 */
export async function createGame({
	mode,
	score_home,
	score_away,
	players,
	played_at,
	created_by,
	score_timeline,
	result_type,
}) {
	const client = await getPool().connect();

	try {
		await client.query("BEGIN");

		const {
			rows: [game],
		} = await client.query(
			`INSERT INTO games (mode, score_home, score_away, played_at, created_by, score_timeline, result_type)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING *`,
			[
				mode,
				score_home,
				score_away,
				played_at || new Date().toISOString(),
				created_by,
				score_timeline ? JSON.stringify(score_timeline) : null,
				result_type || "regular",
			],
		);

		for (const player of players) {
			await client.query(
				`INSERT INTO game_players (game_id, player_id, team, team_name, rating)
				VALUES ($1, $2, $3, $4, $5)`,
				[
					game.id,
					player.id,
					player.team,
					player.team_name || null,
					player.rating || null,
				],
			);
		}

		await client.query("COMMIT");
		return game;
	} catch (error) {
		await client.query("ROLLBACK");
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Gets recent games for a user with offset pagination
 * @param {string} userId
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<object[]>}
 */
export async function getUserGames(userId, limit = 10, offset = 0) {
	const games = await query(
		`SELECT g.*,
			json_agg(
				json_build_object(
					'player_id', gp.player_id,
					'team', gp.team,
					'team_name', gp.team_name,
					'rating', gp.rating,
					'profiles', json_build_object('username', p.username, 'avatar_url', p.avatar_url)
				)
			) AS game_players
		FROM games g
		INNER JOIN game_players gp2 ON gp2.game_id = g.id AND gp2.player_id = $1
		LEFT JOIN game_players gp ON gp.game_id = g.id
		LEFT JOIN profiles p ON p.id = gp.player_id
		GROUP BY g.id
		ORDER BY g.played_at DESC
		LIMIT $2 OFFSET $3`,
		[userId, limit, offset],
	);

	return games;
}
