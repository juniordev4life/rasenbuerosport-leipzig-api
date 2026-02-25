import { getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Gets all player profiles
 * @returns {Promise<object[]>}
 */
export async function getAllPlayers() {
	const supabase = getSupabaseAdmin();

	const { data, error } = await supabase
		.from("profiles")
		.select("id, username, avatar_url")
		.order("username", { ascending: true });

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	return data;
}
