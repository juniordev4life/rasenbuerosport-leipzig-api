import { getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Gets all available teams with optional filtering
 * @param {object} [filters]
 * @param {string} [filters.league] - Filter by league name
 * @param {string} [filters.country] - Filter by ISO country code
 * @param {string} [filters.search] - Search teams by name (case-insensitive)
 * @returns {Promise<object[]>}
 */
export async function getAllTeams(filters = {}) {
	const supabase = getSupabaseAdmin();

	let query = supabase
		.from("teams")
		.select("id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code")
		.order("name", { ascending: true });

	if (filters.league) {
		query = query.eq("league_name", filters.league);
	}

	if (filters.country) {
		query = query.eq("country_code", filters.country);
	}

	if (filters.search) {
		query = query.ilike("name", `%${filters.search}%`);
	}

	const { data, error } = await query;

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	return data;
}
