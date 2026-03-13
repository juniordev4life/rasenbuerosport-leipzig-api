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
 * Updates a user's profile
 * @param {string} userId - Firebase Auth UID
 * @param {object} updates
 * @param {string} [updates.username]
 * @param {string} [updates.avatar_url]
 * @returns {Promise<object>}
 * @throws {Error} 403 if profile does not exist (user not authorized)
 */
export async function updateUserProfile(userId, { username, avatar_url }) {
	const existing = await queryOne("SELECT id FROM profiles WHERE id = $1", [
		userId,
	]);

	if (!existing) {
		const error = new Error("User not authorized");
		error.statusCode = 403;
		throw error;
	}

	const fields = [];
	const params = [];
	let idx = 1;

	if (username !== undefined) {
		fields.push(`username = $${idx++}`);
		params.push(username.trim());
	}

	if (avatar_url !== undefined) {
		fields.push(`avatar_url = $${idx++}`);
		params.push(avatar_url);
	}

	if (!fields.length) {
		return queryOne("SELECT * FROM profiles WHERE id = $1", [userId]);
	}

	params.push(userId);
	return queryOne(
		`UPDATE profiles SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
		params,
	);
}
