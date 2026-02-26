import { getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Fetches a single game by ID with all players and profiles
 * @param {string} gameId - Game UUID
 * @returns {Promise<object|null>}
 */
export async function getGameById(gameId) {
	const supabase = getSupabaseAdmin();

	const { data: game, error } = await supabase
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
		.eq("id", gameId)
		.single();

	if (error) {
		if (error.code === "PGRST116") {
			return null;
		}
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	return game;
}
