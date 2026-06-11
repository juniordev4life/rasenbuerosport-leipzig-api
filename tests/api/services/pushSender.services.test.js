import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("web-push", () => ({
	default: {
		setVapidDetails: vi.fn(),
		sendNotification: vi.fn().mockResolvedValue({}),
	},
}));
vi.mock("../../../src/config/logger.config.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/api/services/pushSubscriptions.services.js", () => ({
	deleteSubscription: vi.fn(),
	getSubscriptionsExcludingUsers: vi.fn(async () => []),
	incrementFailureCount: vi.fn(),
	markSubscriptionUsed: vi.fn(),
}));

import webpush from "web-push";
import { getSubscriptionsExcludingUsers } from "../../../src/api/services/pushSubscriptions.services.js";
import {
	notifyMatchCreated,
	sendPushNotification,
} from "../../../src/api/services/pushSender.services.js";

const SUB = { id: "sub-1", endpoint: "https://push.example/abc", p256dh: "k", auth: "a" };
const PAYLOAD = { title: "Neues Spiel", body: "A 1:0 B", url: "/app/games/x" };

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
	vi.clearAllMocks();
	process.env.PUSH_VAPID_PUBLIC_KEY = "pub";
	process.env.PUSH_VAPID_PRIVATE_KEY = "priv";
	process.env.PUSH_VAPID_SUBJECT = "mailto:dev@example.com";
});

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

describe("sendPushNotification with PUSH_ENABLED toggle", () => {
	it("does NOT deliver when PUSH_ENABLED is 'false'", async () => {
		process.env.PUSH_ENABLED = "false";

		const result = await sendPushNotification(SUB, PAYLOAD);

		expect(result.success).toBe(false);
		expect(webpush.sendNotification).not.toHaveBeenCalled();
	});

	it("delivers when PUSH_ENABLED is unset (on by default)", async () => {
		process.env.PUSH_ENABLED = undefined;

		const result = await sendPushNotification(SUB, PAYLOAD);

		expect(result.success).toBe(true);
		expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
	});
});

describe("notifyMatchCreated with PUSH_ENABLED toggle", () => {
	it("short-circuits without even looking up subscriptions when disabled", async () => {
		process.env.PUSH_ENABLED = "false";

		const result = await notifyMatchCreated({
			game: { id: "g1", score_home: 1, score_away: 0 },
			players: [{ player_id: "p1", team: "home" }],
			resolveDisplayName: async () => "A",
		});

		expect(result).toEqual({ recipients: 0 });
		expect(getSubscriptionsExcludingUsers).not.toHaveBeenCalled();
		expect(webpush.sendNotification).not.toHaveBeenCalled();
	});
});
