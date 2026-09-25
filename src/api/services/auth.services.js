import { queryOne } from "../helpers/database.helpers.js";

/** Google serves account profile photos (the Firebase `photoURL`) from here. */
const GOOGLE_PHOTO_PREFIX = "https://lh3.googleusercontent.com/";

/**
 * Looks up the current user's profile. Returns null if no row exists yet.
 * Access control has already happened in `requireAuth`.
 * @param {string} userId - Firebase Auth UID
 * @returns {Promise<object|null>}
 */
export async function getUserProfile(userId) {
	return queryOne("SELECT * FROM profiles WHERE id = $1", [userId]);
}

/**
 * Checks whether an avatar URL may be stored for a user. Allowed are the
 * user's own upload in the project's Firebase Storage bucket (the app writes
 * `avatars/<uid>/avatar.<ext>`) and Google account photos. Anything else would
 * make every viewer's browser load an image from a host of the user's choice.
 *
 * The Storage prefix is built on each call from `FIREBASE_STORAGE_BUCKET`;
 * without that variable no Storage URL is allowed.
 *
 * @param {string} url - Candidate avatar URL
 * @param {string} userId - Firebase Auth UID of the profile owner
 * @returns {boolean}
 * @example
 * // FIREBASE_STORAGE_BUCKET=my-app.firebasestorage.app
 * isAllowedAvatarUrl(
 *   "https://firebasestorage.googleapis.com/v0/b/my-app.firebasestorage.app/o/avatars%2Fuid-1%2Favatar.png?alt=media",
 *   "uid-1",
 * ); // → true
 * isAllowedAvatarUrl("https://tracker.example/pixel.png", "uid-1"); // → false
 */
export function isAllowedAvatarUrl(url, userId) {
	const bucket = process.env.FIREBASE_STORAGE_BUCKET;
	const prefixes = [GOOGLE_PHOTO_PREFIX];
	if (bucket) {
		prefixes.push(
			`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/avatars%2F${userId}%2F`,
		);
	}
	return prefixes.some((prefix) => url.startsWith(prefix));
}

/**
 * Updates a user's profile (creates it if it does not exist)
 * @param {string} userId - Firebase Auth UID
 * @param {object} updates
 * @param {string} [updates.username]
 * @param {string|null} [updates.avatar_url] - Must pass `isAllowedAvatarUrl`; null keeps the current avatar
 * @param {string[]} [updates.voice_aliases] - Replaces the stored aliases; an empty array clears them
 * @returns {Promise<object>}
 * @throws {Error} With `statusCode` 400 when `avatar_url` is not allowed
 * @example
 * await updateUserProfile("uid-1", { username: "Max" }); // avatar stays as it is
 */
export async function updateUserProfile(
	userId,
	{ username, avatar_url, voice_aliases },
) {
	if (avatar_url != null && !isAllowedAvatarUrl(avatar_url, userId)) {
		const err = new Error("Invalid avatar URL");
		err.statusCode = 400;
		throw err;
	}

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
