import { getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Gets all available teams
 * @returns {Promise<object[]>}
 */
export async function getAllTeams() {
	const supabase = getSupabaseAdmin();

	const { data, error } = await supabase
		.from("teams")
		.select("id, name, short_name, logo_url")
		.order("name", { ascending: true });

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	return data;
}
