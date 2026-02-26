import { getSupabaseAdmin } from "../../config/supabase.config.js";

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
	const supabase = getSupabaseAdmin();

	const { data: game, error: gameError } = await supabase
		.from("games")
		.insert({
			mode,
			score_home,
			score_away,
			played_at: played_at || new Date().toISOString(),
			created_by,
			score_timeline: score_timeline || null,
			result_type: result_type || "regular",
		})
		.select()
		.single();

	if (gameError) {
		const err = new Error(gameError.message);
		err.statusCode = 400;
		throw err;
	}

	const gamePlayers = players.map((player) => ({
		game_id: game.id,
		player_id: player.id,
		team: player.team,
		team_name: player.team_name || null,
		rating: player.rating || null,
	}));

	const { error: playersError } = await supabase
		.from("game_players")
		.insert(gamePlayers);

	if (playersError) {
		const err = new Error(playersError.message);
		err.statusCode = 400;
		throw err;
	}

	return game;
}

/**
 * Gets recent games for a user with offset pagination
 * @param {string} userId
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<object[]>}
 */
export async function getUserGames(userId, limit = 10, offset = 0) {
	const supabase = getSupabaseAdmin();

	const { data: playerGames } = await supabase
		.from("game_players")
		.select("game_id")
		.eq("player_id", userId);

	if (!playerGames?.length) {
		return [];
	}

	const gameIds = playerGames.map((pg) => pg.game_id);

	const { data: games, error } = await supabase
		.from("games")
		.select(`
			*,
			game_players (
				player_id,
				team,
				team_name,
				rating,
				profiles:player_id (username, avatar_url)
			)
		`)
		.in("id", gameIds)
		.order("played_at", { ascending: false })
		.range(offset, offset + limit - 1);

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	return games;
}
