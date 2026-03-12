import { queryOne } from "../helpers/database.helpers.js";

/**
 * Gets the current user's profile, creating one if it doesn't exist
 * @param {string} userId - Firebase Auth UID
 * @param {string} [email] - User email (for auto-create)
 * @param {string} [displayName] - Google display name (for auto-create)
 * @returns {Promise<object>}
 */
export async function getUserProfile(userId, email, displayName) {
	let profile = await queryOne(
		"SELECT * FROM profiles WHERE id = $1",
		[userId],
	);

	if (!profile) {
		const username = displayName || email?.split("@")[0] || "User";
		profile = await queryOne(
			"INSERT INTO profiles (id, username) VALUES ($1, $2) RETURNING *",
			[userId, username],
		);
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
 */
export async function updateUserProfile(userId, { username, avatar_url }) {
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
