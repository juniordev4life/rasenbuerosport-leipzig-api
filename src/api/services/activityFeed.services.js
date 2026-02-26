import { getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Fetches most recent games globally (not filtered by user)
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
export async function getRecentGames(limit = 10) {
	const supabase = getSupabaseAdmin();

	const { data: games, error } = await supabase
		.from("games")
		.select(`
			*,
			game_players (
				player_id,
				team,
				team_name,
				profiles:player_id (username, avatar_url)
			)
		`)
		.order("played_at", { ascending: false })
		.limit(limit);

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	return games;
}
