/**
 * Server-side web-push sender. Reads the VAPID details from env once
 * and exposes a thin `sendPushNotification` wrapper that handles the
 * mismatched-subscription cleanup case (410/404 → delete the row) and
 * the soft-failure counter (5xx/timeout → increment).
 *
 * Higher-level orchestrators (`notifyMatchCreated`) live here too —
 * the call site (e.g. `games.services.createGame`) only needs to
 * fire-and-forget one function.
 */

import webpush from "web-push";
import { logger } from "../../config/logger.config.js";
import {
	deleteSubscription,
	getSubscriptionsExcludingUsers,
	incrementFailureCount,
	markSubscriptionUsed,
} from "./pushSubscriptions.services.js";

/** @type {boolean} */
let vapidConfigured = false;

/**
 * Lazily set up VAPID details on the first send so missing env vars
 * fail loudly at send time instead of crashing the boot.
 */
function ensureVapidConfigured() {
	if (vapidConfigured) return true;
	const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY;
	const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY;
	const subject = process.env.PUSH_VAPID_SUBJECT;
	if (!publicKey || !privateKey || !subject) {
		logger.warn(
			"Push notifications disabled — set PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY / PUSH_VAPID_SUBJECT to enable.",
		);
		return false;
	}
	webpush.setVapidDetails(subject, publicKey, privateKey);
	vapidConfigured = true;
	return true;
}

/**
 * Master on/off switch for actually delivering push notifications. Push is on
 * unless PUSH_ENABLED is explicitly "false". Lets a local/dev environment
 * silence web-push — which would otherwise reach colleagues' real devices when
 * the API runs against a PROD-snapshot DB holding their live subscriptions.
 *
 * @returns {boolean}
 * @example
 * if (!pushEnabled()) return; // local dev: never deliver
 */
function pushEnabled() {
	return process.env.PUSH_ENABLED !== "false";
}

/**
 * @typedef {object} PushPayload
 * @property {string} title
 * @property {string} body
 * @property {string} url - In-app path to navigate to on click.
 * @property {string} [tag] - Browser-side de-dupe key per device.
 * @property {string} [type] - Logical type ("newMatch", …) for filtering on the client.
 */

/**
 * Deliver a payload to one subscription and clean up if the browser
 * push service tells us the endpoint is gone.
 *
 * @param {import('./pushSubscriptions.services.js').PushSubscriptionRow} sub
 * @param {PushPayload} payload
 * @returns {Promise<{ success: boolean, statusCode?: number }>}
 * @example
 *   await sendPushNotification(sub, {
 *     title: "Neues Spiel",
 *     body: "Marco & Tobi 4:2 gegen Jonas & Nikinho",
 *     url: "/app/games/abc123",
 *     type: "newMatch",
 *   });
 */
export async function sendPushNotification(sub, payload) {
	if (!pushEnabled()) return { success: false };
	if (!ensureVapidConfigured()) return { success: false, statusCode: 500 };

	try {
		await webpush.sendNotification(
			{
				endpoint: sub.endpoint,
				keys: { p256dh: sub.p256dh, auth: sub.auth },
			},
			JSON.stringify(payload),
		);
		await markSubscriptionUsed(sub.id);
		return { success: true };
	} catch (error) {
		const statusCode = error?.statusCode;
		if (statusCode === 410 || statusCode === 404) {
			// Endpoint reported as gone — drop the row so we don't try again.
			await deleteSubscription(sub.id);
			logger.info(
				{ subscriptionId: sub.id, statusCode },
				"Removed stale push subscription",
			);
		} else {
			await incrementFailureCount(sub.id);
			logger.warn(
				{ subscriptionId: sub.id, statusCode, error: error?.message },
				"Push send failed",
			);
		}
		return { success: false, statusCode };
	}
}

/**
 * Notify every user who was NOT involved in the match about its
 * result. Fire-and-forget — the caller doesn't await the network
 * round-trip per subscription, only the initial subscription lookup.
 *
 * @param {object} args
 * @param {object} args.game - Inserted game row.
 * @param {Array<{ player_id: string, team: "home"|"away" }>} args.players
 * @param {(playerId: string) => Promise<string|null>} args.resolveDisplayName
 * @returns {Promise<{ recipients: number }>}
 * @example
 *   await notifyMatchCreated({
 *     game,
 *     players: gamePlayers,
 *     resolveDisplayName: (id) => fetchUsername(id),
 *   });
 */
export async function notifyMatchCreated({
	game,
	players,
	resolveDisplayName,
}) {
	if (!pushEnabled()) {
		logger.info(
			"Push disabled (PUSH_ENABLED=false) — skipping match notification.",
		);
		return { recipients: 0 };
	}

	const involvedIds = players.map((p) => p.player_id);
	const subs = await getSubscriptionsExcludingUsers({
		excludeUserIds: involvedIds,
		preferenceKey: "newMatch",
	});

	if (subs.length === 0) return { recipients: 0 };

	const homeIds = players
		.filter((p) => p.team === "home")
		.map((p) => p.player_id);
	const awayIds = players
		.filter((p) => p.team === "away")
		.map((p) => p.player_id);

	const homeNames = await Promise.all(
		homeIds.map((id) => resolveDisplayName(id).then((n) => n ?? "?")),
	);
	const awayNames = await Promise.all(
		awayIds.map((id) => resolveDisplayName(id).then((n) => n ?? "?")),
	);

	const home = homeNames.join(" & ");
	const away = awayNames.join(" & ");
	const body = `${home} ${game.score_home}:${game.score_away} ${away}`;

	const payload = {
		title: "Neues Spiel",
		body,
		url: `/app/games/${game.id}`,
		tag: `match-${game.id}`,
		type: "newMatch",
	};

	// Fan out in parallel — failures are absorbed by sendPushNotification's
	// own try/catch so one bad subscription can't crash the batch.
	await Promise.allSettled(subs.map((s) => sendPushNotification(s, payload)));
	return { recipients: subs.length };
}
