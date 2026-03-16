import { queryOne } from "../helpers/database.helpers.js";

/**
 * Gets the current user's profile
 * @param {string} userId - Firebase Auth UID
 * @returns {Promise<object>}
 * @throws {Error} 403 if profile does not exist (user not authorized)
 */
export async function getUserProfile(userId) {
	const profile = await queryOne("SELECT * FROM profiles WHERE id = $1", [
		userId,
	]);

	if (!profile) {
		const error = new Error("User not authorized");
		error.statusCode = 403;
		throw error;
	}

	return profile;
}

/**
 * Updates a user's profile (creates it if it does not exist)
 * @param {string} userId - Firebase Auth UID
 * @param {object} updates
 * @param {string} [updates.username]
 * @param {string} [updates.avatar_url]
 * @returns {Promise<object>}
 */
export async function updateUserProfile(userId, { username, avatar_url }) {
	return queryOne(
		`INSERT INTO profiles (id, username, avatar_url)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (id) DO UPDATE SET
		   username = COALESCE($2, profiles.username),
		   avatar_url = COALESCE($3, profiles.avatar_url)
		 RETURNING *`,
		[userId, username?.trim() ?? null, avatar_url ?? null],
	);
}
