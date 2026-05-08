import { describe, expect, it } from "vitest";
import { dramaScore } from "../../../src/api/services/matchOfTheWeek.services.js";
import {
	buildCardEvent,
	buildGoalEvent,
	buildMockGame,
	buildPenaltyMissedEvent,
} from "../../test-utils.js";

describe("dramaScore", () => {
	it("scores a 0-0 nothing-burger near zero", () => {
		const game = buildMockGame({
			score_home: 0,
			score_away: 0,
			score_timeline: [],
		});
		expect(dramaScore(game)).toBe(0);
	});

	it("rewards close 1-goal margins", () => {
		// 2-1 with 3 goals total: 3 base + 3 close-margin bonus
		const game = buildMockGame({
			score_home: 2,
			score_away: 1,
			score_timeline: [
				buildGoalEvent({ home: 1, away: 0, minute: 20 }),
				buildGoalEvent({ home: 1, away: 1, minute: 50, team: "away" }),
				buildGoalEvent({ home: 2, away: 1, minute: 70 }),
			],
		});
		expect(dramaScore(game)).toBeGreaterThanOrEqual(6);
	});

	it("adds points for cards", () => {
		const base = dramaScore(
			buildMockGame({
				score_home: 1,
				score_away: 0,
				score_timeline: [buildGoalEvent({ home: 1, away: 0, minute: 30 })],
			}),
		);
		const withCard = dramaScore(
			buildMockGame({
				score_home: 1,
				score_away: 0,
				score_timeline: [
					buildGoalEvent({ home: 1, away: 0, minute: 30 }),
					buildCardEvent({ minute: 60, card_type: "yellow" }),
				],
			}),
		);
		expect(withCard - base).toBe(2);
	});

	it("rewards a missed penalty", () => {
		const base = dramaScore(
			buildMockGame({
				score_home: 0,
				score_away: 0,
				score_timeline: [],
			}),
		);
		const withMiss = dramaScore(
			buildMockGame({
				score_home: 0,
				score_away: 0,
				score_timeline: [buildPenaltyMissedEvent({ minute: 50 })],
			}),
		);
		expect(withMiss - base).toBe(2);
	});

	it("adds late-goal bonus when a goal is scored in minute 85+", () => {
		// 2-1 with three goals; one in minute 89 → +3 vs the same scoreline earlier
		const base = dramaScore(
			buildMockGame({
				score_home: 2,
				score_away: 1,
				score_timeline: [
					buildGoalEvent({ home: 1, away: 0, minute: 10 }),
					buildGoalEvent({ home: 1, away: 1, minute: 30, team: "away" }),
					buildGoalEvent({ home: 2, away: 1, minute: 50 }),
				],
			}),
		);
		const lateWinner = dramaScore(
			buildMockGame({
				score_home: 2,
				score_away: 1,
				score_timeline: [
					buildGoalEvent({ home: 1, away: 0, minute: 10 }),
					buildGoalEvent({ home: 1, away: 1, minute: 30, team: "away" }),
					buildGoalEvent({ home: 2, away: 1, minute: 89 }),
				],
			}),
		);
		expect(lateWinner - base).toBe(3);
	});

	it("rewards extra time +2 and penalty shootout +4", () => {
		const base = buildMockGame({
			score_home: 2,
			score_away: 2,
			score_timeline: [],
			result_type: "regular",
		});
		const et = { ...base, result_type: "extra_time" };
		const pso = { ...base, result_type: "penalty" };
		expect(dramaScore(et) - dramaScore(base)).toBe(2);
		expect(dramaScore(pso) - dramaScore(base)).toBe(4);
	});

	it("rewards a heuristic comeback (≥2-goal swing during the game)", () => {
		// Away leads 0-2 then home wins 3-2 → swing of 5 (-2 → +1)
		const game = buildMockGame({
			score_home: 3,
			score_away: 2,
			score_timeline: [
				buildGoalEvent({ home: 0, away: 1, minute: 10, team: "away" }),
				buildGoalEvent({ home: 0, away: 2, minute: 25, team: "away" }),
				buildGoalEvent({ home: 1, away: 2, minute: 50 }),
				buildGoalEvent({ home: 2, away: 2, minute: 70 }),
				buildGoalEvent({ home: 3, away: 2, minute: 88 }),
			],
		});
		// 5 goals base + 3 close-margin + 5 comeback + 3 late-goal = 16
		expect(dramaScore(game)).toBeGreaterThanOrEqual(16);
	});

	it("returns the larger score for the more dramatic game when comparing two", () => {
		const blowout = buildMockGame({
			score_home: 5,
			score_away: 0,
			score_timeline: [
				buildGoalEvent({ home: 1, away: 0, minute: 10 }),
				buildGoalEvent({ home: 2, away: 0, minute: 25 }),
				buildGoalEvent({ home: 3, away: 0, minute: 40 }),
				buildGoalEvent({ home: 4, away: 0, minute: 55 }),
				buildGoalEvent({ home: 5, away: 0, minute: 70 }),
			],
		});
		const krimi = buildMockGame({
			score_home: 2,
			score_away: 1,
			result_type: "extra_time",
			score_timeline: [
				buildGoalEvent({ home: 1, away: 0, minute: 30 }),
				buildGoalEvent({ home: 1, away: 1, minute: 80, team: "away" }),
				buildGoalEvent({
					home: 2,
					away: 1,
					minute: 105,
					period: "extra_time",
				}),
			],
		});
		expect(dramaScore(krimi)).toBeGreaterThan(dramaScore(blowout));
	});
});
