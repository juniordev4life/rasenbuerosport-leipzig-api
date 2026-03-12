import { query } from "../helpers/database.helpers.js";

/**
 * Gets all available teams with optional filtering
 * @param {object} [filters]
 * @param {string} [filters.league] - Filter by league name
 * @param {string} [filters.country] - Filter by ISO country code
 * @param {string} [filters.search] - Search teams by name (case-insensitive)
 * @returns {Promise<object[]>}
 */
export async function getAllTeams(filters = {}) {
	const conditions = [];
	const params = [];
	let idx = 1;

	if (filters.league) {
		conditions.push(`league_name = $${idx++}`);
		params.push(filters.league);
	}

	if (filters.country) {
		conditions.push(`country_code = $${idx++}`);
		params.push(filters.country);
	}

	if (filters.search) {
		conditions.push(`name ILIKE $${idx++}`);
		params.push(`%${filters.search}%`);
	}

	const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
	const sql = `SELECT id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code FROM teams ${where} ORDER BY name ASC`;

	return query(sql, params);
}
