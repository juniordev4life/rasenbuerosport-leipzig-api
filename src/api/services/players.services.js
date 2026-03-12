import { query } from "../helpers/database.helpers.js";

/**
 * Gets all player profiles
 * @returns {Promise<object[]>}
 */
export async function getAllPlayers() {
	return query(
		"SELECT id, username, avatar_url FROM profiles ORDER BY username ASC",
	);
}
