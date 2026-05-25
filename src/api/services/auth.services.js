import { queryOne } from "../helpers/database.helpers.js";

/**
 * Looks up the current user's profile. Returns null if no row exists yet.
 * Authorization is decided by the caller based on email domain.
 * @param {string} userId - Firebase Auth UID
 * @returns {Promise<object|null>}
 */
export async function getUserProfile(userId) {
	return queryOne("SELECT * FROM profiles WHERE id = $1", [userId]);
}

/**
 * Updates a user's profile (creates it if it does not exist)
 * @param {string} userId - Firebase Auth UID
 * @param {object} updates
 * @param {string} [updates.username]
 * @param {string} [updates.avatar_url]
 * @returns {Promise<object>}
 */
export async function updateUserProfile(
	userId,
	{ username, avatar_url, voice_aliases },
) {
	// `voice_aliases` is passed as a JSON string so the COALESCE
	// keeps the existing column when the caller didn't include it.
	// Empty arrays are valid and DO overwrite — that's how a user
	// clears all aliases from the settings page.
	const aliasesPayload = Array.isArray(voice_aliases)
		? JSON.stringify(voice_aliases.map((s) => s.trim()).filter(Boolean))
		: null;

	return queryOne(
		`INSERT INTO profiles (id, username, avatar_url, voice_aliases)
		 VALUES ($1, $2, $3, COALESCE($4::jsonb, '[]'::jsonb))
		 ON CONFLICT (id) DO UPDATE SET
		   username = COALESCE($2, profiles.username),
		   avatar_url = COALESCE($3, profiles.avatar_url),
		   voice_aliases = COALESCE($4::jsonb, profiles.voice_aliases)
		 RETURNING *`,
		[userId, username?.trim() ?? null, avatar_url ?? null, aliasesPayload],
	);
}
