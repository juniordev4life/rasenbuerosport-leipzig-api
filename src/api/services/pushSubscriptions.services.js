/**
 * Web-Push subscription store. Persists one row per browser/device
 * in `push_subscriptions` and exposes the small set of mutations the
 * push sender + API routes need.
 *
 * Subscriptions are immutable on the credentials side (endpoint +
 * keys are what the browser hands us); we only mutate timestamps,
 * failure counters and per-user preferences.
 */

import { query, queryOne } from "../helpers/database.helpers.js";

/**
 * @typedef {object} PushSubscriptionRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} endpoint
 * @property {string} p256dh
 * @property {string} auth
 * @property {string|null} user_agent
 * @property {object} preferences
 * @property {Date} created_at
 * @property {Date|null} last_used_at
 * @property {number} failure_count
 */

/**
 * Persist a new subscription, deduplicating on `endpoint` (browsers
 * sometimes call subscribe more than once for the same device — we
 * just re-bind the existing row to the current user).
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.endpoint
 * @param {string} args.p256dh
 * @param {string} args.auth
 * @param {string|null} [args.userAgent]
 * @returns {Promise<PushSubscriptionRow>}
 * @example
 *   const sub = await createSubscription({
 *     userId: "marco",
 *     endpoint: "https://fcm.googleapis.com/...",
 *     p256dh: "BLxX...",
 *     auth: "abc",
 *     userAgent: "Mozilla/5.0",
 *   });
 */
export async function createSubscription({
	userId,
	endpoint,
	p256dh,
	auth,
	userAgent = null,
}) {
	return queryOne(
		`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
		   VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (endpoint) DO UPDATE
		   SET user_id = EXCLUDED.user_id,
		       p256dh = EXCLUDED.p256dh,
		       auth = EXCLUDED.auth,
		       user_agent = EXCLUDED.user_agent,
		       failure_count = 0
		 RETURNING *`,
		[userId, endpoint, p256dh, auth, userAgent],
	);
}

/**
 * Subscriptions belonging to a user — used by the settings page so
 * the user can review and remove devices.
 *
 * @param {string} userId
 * @returns {Promise<PushSubscriptionRow[]>}
 */
export async function listUserSubscriptions(userId) {
	return query(
		`SELECT * FROM push_subscriptions
		  WHERE user_id = $1
		  ORDER BY created_at DESC`,
		[userId],
	);
}

/**
 * Drop a subscription by id, scoped to its owner so a user can't
 * remove someone else's device.
 *
 * @param {object} args
 * @param {string} args.id
 * @param {string} args.userId
 * @returns {Promise<boolean>}
 */
export async function deleteOwnSubscription({ id, userId }) {
	const result = await queryOne(
		`DELETE FROM push_subscriptions
		  WHERE id = $1 AND user_id = $2
		  RETURNING id`,
		[id, userId],
	);
	return !!result;
}

/**
 * Drop a subscription by id without an owner check. Used by the
 * sender after a 410/404 reply from the push service.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteSubscription(id) {
	await query("DELETE FROM push_subscriptions WHERE id = $1", [id]);
}

/**
 * Subscriptions of every user EXCEPT the ones in `excludeUserIds`,
 * filtered to those that have the given preference key still enabled.
 * Used by the match-notification fan-out.
 *
 * @param {object} args
 * @param {string[]} args.excludeUserIds
 * @param {string} args.preferenceKey
 * @returns {Promise<PushSubscriptionRow[]>}
 * @example
 *   const subs = await getSubscriptionsExcludingUsers({
 *     excludeUserIds: ["marco", "tobi", "jonas", "nikinho"],
 *     preferenceKey: "newMatch",
 *   });
 */
export async function getSubscriptionsExcludingUsers({
	excludeUserIds,
	preferenceKey,
}) {
	return query(
		`SELECT * FROM push_subscriptions
		  WHERE NOT (user_id = ANY($1::text[]))
		    AND COALESCE((preferences ->> $2)::boolean, true) = true
		  ORDER BY created_at DESC`,
		[excludeUserIds, preferenceKey],
	);
}

/** Bump `last_used_at` after a successful delivery. */
export async function markSubscriptionUsed(id) {
	await query(
		`UPDATE push_subscriptions
		    SET last_used_at = now(),
		        failure_count = 0
		  WHERE id = $1`,
		[id],
	);
}

/** Bump the failure counter after a soft delivery error. */
export async function incrementFailureCount(id) {
	await query(
		`UPDATE push_subscriptions
		    SET failure_count = failure_count + 1
		  WHERE id = $1`,
		[id],
	);
}

/**
 * Update the preferences map for a single subscription. Accepts a
 * partial object and merges with the current value so callers don't
 * need to know the full preference shape.
 *
 * @param {object} args
 * @param {string} args.id
 * @param {string} args.userId
 * @param {object} args.preferences
 * @returns {Promise<PushSubscriptionRow|null>}
 */
export async function updatePreferences({ id, userId, preferences }) {
	return queryOne(
		`UPDATE push_subscriptions
		    SET preferences = preferences || $3::jsonb
		  WHERE id = $1 AND user_id = $2
		  RETURNING *`,
		[id, userId, JSON.stringify(preferences)],
	);
}
