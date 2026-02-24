import { getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Creates a new game with players
 * @param {object} params
 * @param {string} params.mode - '1v1' or '2v2'
 * @param {number} params.score_home
 * @param {number} params.score_away
 * @param {string[]} params.players_home - Array of player UUIDs
 * @param {string[]} params.players_away - Array of player UUIDs
 * @param {string} [params.played_at] - ISO date string
 * @param {string} params.created_by - User UUID
 * @returns {Promise<object>}
 */
export async function createGame({
	mode,
	score_home,
	score_away,
	players_home,
	players_away,
	played_at,
	created_by,
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
		})
		.select()
		.single();

	if (gameError) {
		const err = new Error(gameError.message);
		err.statusCode = 400;
		throw err;
	}

	const gamePlayers = [
		...players_home.map((playerId) => ({
			game_id: game.id,
			player_id: playerId,
			team: "home",
		})),
		...players_away.map((playerId) => ({
			game_id: game.id,
			player_id: playerId,
			team: "away",
		})),
	];

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
 * Gets recent games for a user
 * @param {string} userId
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
export async function getUserGames(userId, limit = 10) {
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
				profiles:player_id (username)
			)
		`)
		.in("id", gameIds)
		.order("played_at", { ascending: false })
		.limit(limit);

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	return games;
}
