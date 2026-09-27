import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/logger.config.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/config/anthropic.config.js", () => ({
	getAnthropicClient: vi.fn(),
}));
vi.mock("../../../src/api/helpers/database.helpers.js", () => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	withTransaction: vi.fn(),
}));
vi.mock("../../../src/api/services/leagueSeason.services.js", () => ({
	requireLeagueSeason: vi.fn(),
	toSeasonDto: vi.fn((s) => ({ id: s.id })),
}));
vi.mock("../../../src/api/services/pushSender.services.js", () => ({
	sendPushNotification: vi.fn(async () => ({ success: true })),
}));
vi.mock("../../../src/api/services/pushSubscriptions.services.js", () => ({
	getSubscriptionsExcludingUsers: vi.fn(),
}));

import { getAnthropicClient } from "../../../src/config/anthropic.config.js";
import { query } from "../../../src/api/helpers/database.helpers.js";
import { requireLeagueSeason } from "../../../src/api/services/leagueSeason.services.js";
import { sendPushNotification } from "../../../src/api/services/pushSender.services.js";
import { getSubscriptionsExcludingUsers } from "../../../src/api/services/pushSubscriptions.services.js";
import {
	generateAiSummary,
	generateSeasonRecap,
	notifySeasonRecap,
} from "../../../src/api/services/season/seasonRecap.services.js";

const SEASON = {
	id: "fc26",
	name: "EA FC 26",
	game_version: "FC26",
	ends_at: "2026-09-22T13:00:00Z",
	recap_generated_at: "2026-09-27T18:00:00Z",
	recap_notified_at: null,
};

function mockRecapRows() {
	query.mockImplementation(async (sql) => {
		if (sql.includes("FROM season_recaps")) {
			return [
				{ player_id: "a", league: { games: 397, goals: 1977 } },
				{ player_id: "b", league: { games: 397, goals: 1977 } },
			];
		}
		return [];
	});
	getSubscriptionsExcludingUsers.mockResolvedValue([
		{ id: "s1", user_id: "a" },
		{ id: "s2", user_id: "a" },
		{ id: "s3", user_id: "b" },
		{ id: "s4", user_id: "stranger" },
	]);
}

describe("notifySeasonRecap", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("pushes to every device of players with a recap and marks the season", async () => {
		requireLeagueSeason.mockResolvedValue(SEASON);
		mockRecapRows();

		const result = await notifySeasonRecap("fc26");

		expect(result).toEqual({ recipients: 2, sent: 3, failed: 0 });
		const [, payload] = sendPushNotification.mock.calls[0];
		expect(payload).toMatchObject({
			title: "Dein Rückblick auf FC26 ist fertig",
			url: "/app/recap/fc26",
			type: "seasonRecap",
		});
		expect(getSubscriptionsExcludingUsers).toHaveBeenCalledWith({
			excludeUserIds: [],
			preferenceKey: "seasonRecap",
		});
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("SET recap_notified_at = now()"),
			["fc26"],
		);
	});

	it("sends a test to one player without marking the season", async () => {
		requireLeagueSeason.mockResolvedValue(SEASON);
		mockRecapRows();

		const result = await notifySeasonRecap("fc26", { onlyUser: "b" });

		expect(result).toEqual({ recipients: 1, sent: 1, failed: 0 });
		expect(query).not.toHaveBeenCalledWith(
			expect.stringContaining("recap_notified_at"),
			expect.anything(),
		);
	});

	it("refuses a second full send", async () => {
		requireLeagueSeason.mockResolvedValue({ ...SEASON, recap_notified_at: "2026-09-28T06:00:00Z" });

		await expect(notifySeasonRecap("fc26")).rejects.toMatchObject({ statusCode: 409 });
		expect(sendPushNotification).not.toHaveBeenCalled();
	});

	it("refuses before the recap exists", async () => {
		requireLeagueSeason.mockResolvedValue({ ...SEASON, recap_generated_at: null });

		await expect(notifySeasonRecap("fc26")).rejects.toMatchObject({ statusCode: 409 });
	});
});

describe("generateSeasonRecap", () => {
	it("refuses a season that is still running", async () => {
		requireLeagueSeason.mockResolvedValue({ ...SEASON, id: "fc27", ends_at: null });

		await expect(generateSeasonRecap("fc27")).rejects.toMatchObject({ statusCode: 409 });
	});
});

describe("generateAiSummary", () => {
	const recap = {
		player: { player_id: "a", username: "Anna" },
		stats: {
			games: 40, wins: 25, losses: 15, win_rate: 0.625, goals: 50, assists: 20,
			longest_win_streak: 6, biggest_win: { score: "7:0" },
			best_partner: { username: "Ben" }, nemesis: null, favorite_victim: null,
			favorite_club: { name: "Real Madrid" }, best_club: null,
		},
		elo: { start: 1500, end: 1560, peak: { value: 1590 }, rank: 2, of: 9 },
		awards_won: ["top_scorer"],
	};

	function mockModel(response) {
		const create = vi.fn(async () => response);
		getAnthropicClient.mockReturnValue({ beta: { messages: { create } } });
		return create;
	}

	it("asks claude-opus-5 with refusal fallbacks and returns the text", async () => {
		const create = mockModel({
			stop_reason: "end_turn",
			content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Anna schießt 50 Tore. Ben jubelt mit." }],
		});

		const summary = await generateAiSummary(recap, SEASON);

		expect(summary.text).toBe("Anna schießt 50 Tore. Ben jubelt mit.");
		const [payload] = create.mock.calls[0];
		expect(payload).toMatchObject({
			model: "claude-opus-5",
			betas: ["server-side-fallback-2026-07-01"],
			fallbacks: "default",
			output_config: { effort: "low" },
		});
	});

	it("drops a summary that invents people and a refusal", async () => {
		mockModel({ stop_reason: "end_turn", content: [{ type: "text", text: "Anna schlägt Zlatan." }] });
		expect(await generateAiSummary(recap, SEASON)).toBeNull();

		mockModel({ stop_reason: "refusal", content: [] });
		expect(await generateAiSummary(recap, SEASON)).toBeNull();
	});
});
