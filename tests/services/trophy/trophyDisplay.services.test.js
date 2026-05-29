/**
 * Display-service tests — the layer that translates the per-player
 * trophies JSONB + aggregated stats into the API response.
 *
 * Three things matter here and each gets its own test:
 *   1. Unlocked trophies carry full metadata + unlocked_at.
 *   2. Locked threshold trophies carry `progress`, locked one-shot
 *      trophies don't.
 *   3. Hidden + locked trophies are masked — no name leakage.
 *
 * The "latest" picker and summary counters round it out.
 */

import { describe, expect, it } from "vitest";
import { TROPHIES } from "../../../src/constants/trophies.constants.js";
import { buildTrophyResponse } from "../../../src/api/services/trophy/trophyDisplay.services.js";

const emptyStats = {
	wins: 0,
	goals: 0,
	assists: 0,
	matches: 0,
	cleanSheets: 0,
	peakElo: 0,
	maxWinStreak: 0,
	maxCleanSheetStreak: 0,
	distinctWinningPartners: 0,
	h2hWinsByOpponent: {},
	h2hMatchesByOpponent: {},
	duoWinsByPartner: {},
	maxGoalsInMatch: 0,
	maxAssistsInMatch: 0,
	maxScorerPointsInMatch: 0,
	maxPenaltiesSavedInShootout: 0,
	maxSameScoreStreak: 0,
	maxHattricksInDay: 0,
	bestDayWins: 0,
	bestWeekMatchesNoLoss: 0,
};

describe("buildTrophyResponse", () => {
	it("returns the full trophy roster with empty inputs", () => {
		const res = buildTrophyResponse({
			playerId: "p1",
			trophiesMap: null,
			stats: emptyStats,
		});

		expect(res.playerId).toBe("p1");
		expect(res.trophies.length).toBe(TROPHIES.length);
		expect(res.summary.total).toBe(TROPHIES.length);
		expect(res.summary.unlocked).toBe(0);
		expect(res.latest).toBeNull();
	});

	it("masks hidden trophies when not unlocked", () => {
		const res = buildTrophyResponse({
			playerId: "p1",
			trophiesMap: null,
			stats: emptyStats,
		});

		const hiddenLocked = res.trophies.filter((t) => t.hidden && !t.unlocked);
		expect(hiddenLocked.length).toBeGreaterThan(0);
		for (const trophy of hiddenLocked) {
			expect(trophy.masked).toBe(true);
			expect(trophy.name).toBeUndefined();
			expect(trophy.description).toBeUndefined();
		}
	});

	it("lifts masking once a hidden trophy is unlocked", () => {
		// Find a hidden trophy to seed
		const hiddenDef = TROPHIES.find((t) => t.hidden);
		expect(hiddenDef).toBeDefined();

		const res = buildTrophyResponse({
			playerId: "p1",
			trophiesMap: {
				[hiddenDef.id]: {
					unlocked_at: "2026-05-01T10:00:00Z",
					triggered_by_match_id: "match-1",
				},
			},
			stats: emptyStats,
		});

		const entry = res.trophies.find((t) => t.id === hiddenDef.id);
		expect(entry.unlocked).toBe(true);
		expect(entry.masked).toBeUndefined();
		expect(entry.name).toBe(hiddenDef.name);
		expect(entry.description).toBe(hiddenDef.description);
		expect(entry.unlockedAt).toBe("2026-05-01T10:00:00Z");
		expect(entry.triggeredByMatchId).toBe("match-1");
	});

	it("attaches progress to threshold-based locked trophies", () => {
		const stats = { ...emptyStats, wins: 25 };
		const res = buildTrophyResponse({
			playerId: "p1",
			trophiesMap: null,
			stats,
		});

		// Find a totalWins trophy with threshold 50 (W2 in default set).
		const winTrophy = TROPHIES.find(
			(t) =>
				t.conditionKey === "totalWins" && t.conditionParams?.threshold === 50,
		);
		expect(winTrophy).toBeDefined();

		const entry = res.trophies.find((t) => t.id === winTrophy.id);
		expect(entry.unlocked).toBe(false);
		expect(entry.progress).toEqual({ current: 25, target: 50, percent: 50 });
	});

	it("omits progress on one-shot locked trophies", () => {
		const res = buildTrophyResponse({
			playerId: "p1",
			trophiesMap: null,
			stats: emptyStats,
		});

		const cleanSheetWin = TROPHIES.find(
			(t) => t.conditionKey === "cleanSheetWin",
		);
		expect(cleanSheetWin).toBeDefined();
		const entry = res.trophies.find((t) => t.id === cleanSheetWin.id);
		expect(entry.unlocked).toBe(false);
		expect(entry.progress).toBeNull();
	});

	it("returns the most recently unlocked trophy as `latest`", () => {
		const someTrophies = TROPHIES.filter((t) => !t.hidden).slice(0, 3);
		const trophiesMap = {
			[someTrophies[0].id]: {
				unlocked_at: "2026-05-01T10:00:00Z",
				triggered_by_match_id: null,
			},
			[someTrophies[1].id]: {
				unlocked_at: "2026-05-10T10:00:00Z",
				triggered_by_match_id: null,
			},
			[someTrophies[2].id]: {
				unlocked_at: "2026-05-05T10:00:00Z",
				triggered_by_match_id: null,
			},
		};
		const res = buildTrophyResponse({
			playerId: "p1",
			trophiesMap,
			stats: emptyStats,
		});

		expect(res.latest.id).toBe(someTrophies[1].id);
		expect(res.latest.unlockedAt).toBe("2026-05-10T10:00:00Z");
	});

	it("counts unlocked totals by rarity and category", () => {
		const bronzeIds = TROPHIES.filter((t) => t.rarity === "bronze")
			.slice(0, 2)
			.map((t) => t.id);
		const trophiesMap = Object.fromEntries(
			bronzeIds.map((id) => [
				id,
				{ unlocked_at: "2026-05-01T10:00:00Z", triggered_by_match_id: null },
			]),
		);

		const res = buildTrophyResponse({
			playerId: "p1",
			trophiesMap,
			stats: emptyStats,
		});

		expect(res.summary.unlocked).toBe(2);
		expect(res.summary.byRarity.bronze).toBe(2);
		expect(res.summary.byRarity.silver).toBe(0);
	});

	it("caps progress at 100% even when current overshoots target", () => {
		const stats = { ...emptyStats, wins: 9999 };
		const res = buildTrophyResponse({
			playerId: "p1",
			trophiesMap: null,
			stats,
		});

		const winTrophy = TROPHIES.find(
			(t) =>
				t.conditionKey === "totalWins" && t.conditionParams?.threshold === 50,
		);
		const entry = res.trophies.find((t) => t.id === winTrophy.id);
		expect(entry.progress.percent).toBe(100);
		expect(entry.progress.current).toBe(9999);
	});
});
