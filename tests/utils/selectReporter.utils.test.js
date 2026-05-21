import { describe, expect, it } from "vitest";
import {
	__test__,
	selectReporter,
} from "../../src/api/utils/selectReporter.utils.js";

const {
	hasHattrick,
	hasEarlyRedCard,
	applyHardRules,
	applyAntiRepetition,
	weightedRandomChoice,
	REPORTER_WEIGHTS_BY_DRAMA,
} = __test__;

describe("hasHattrick", () => {
	it("detects three goals by the same scorer", () => {
		const timeline = [
			{ event_type: "goal", scored_by: "p1" },
			{ event_type: "goal", scored_by: "p2" },
			{ event_type: "goal", scored_by: "p1" },
			{ event_type: "goal", scored_by: "p1" },
		];
		expect(hasHattrick(timeline)).toBe(true);
	});

	it("returns false when goals are spread across players", () => {
		const timeline = [
			{ event_type: "goal", scored_by: "p1" },
			{ event_type: "goal", scored_by: "p2" },
			{ event_type: "goal", scored_by: "p1" },
		];
		expect(hasHattrick(timeline)).toBe(false);
	});
});

describe("hasEarlyRedCard", () => {
	it("true for red_card before minute 15", () => {
		expect(
			hasEarlyRedCard([{ event_type: "red_card", minute: 7 }]),
		).toBe(true);
	});

	it("true for card event with card_type red before 15", () => {
		expect(
			hasEarlyRedCard([
				{ event_type: "card", card_type: "red", minute: 12 },
			]),
		).toBe(true);
	});

	it("false when red card is later than minute 15", () => {
		expect(
			hasEarlyRedCard([{ event_type: "red_card", minute: 60 }]),
		).toBe(false);
	});
});

describe("applyHardRules", () => {
	it("returns euphoriker for a big comeback (≥3-goal deficit)", () => {
		const game = {
			score_home: 4,
			score_away: 3,
			score_timeline: [
				{ event_type: "goal", home: 0, away: 1, minute: 10 },
				{ event_type: "goal", home: 0, away: 2, minute: 20 },
				{ event_type: "goal", home: 0, away: 3, minute: 30 },
				{ event_type: "goal", home: 1, away: 3, minute: 50 },
				{ event_type: "goal", home: 2, away: 3, minute: 65 },
				{ event_type: "goal", home: 3, away: 3, minute: 75 },
				{ event_type: "goal", home: 4, away: 3, minute: 88 },
			],
		};
		expect(applyHardRules(game)).toBe("euphoriker");
	});

	it("does NOT force euphoriker on a 2-goal-deficit comeback (drama-only)", () => {
		const game = {
			score_home: 3,
			score_away: 2,
			score_timeline: [
				{ event_type: "goal", home: 0, away: 1, minute: 15 },
				{ event_type: "goal", home: 0, away: 2, minute: 30 },
				{ event_type: "goal", home: 1, away: 2, minute: 50 },
				{ event_type: "goal", home: 2, away: 2, minute: 70 },
				{ event_type: "goal", home: 3, away: 2, minute: 85 },
			],
		};
		expect(applyHardRules(game)).toBe(null);
	});

	it("returns euphoriker for a hattrick even without comeback", () => {
		const game = {
			score_home: 4,
			score_away: 1,
			score_timeline: [
				{ event_type: "goal", scored_by: "p1", home: 1, away: 0 },
				{ event_type: "goal", scored_by: "p1", home: 2, away: 0 },
				{ event_type: "goal", scored_by: "p1", home: 3, away: 0 },
				{ event_type: "goal", scored_by: "p2", home: 3, away: 1 },
				{ event_type: "goal", scored_by: "p2", home: 4, away: 1 },
			],
		};
		expect(applyHardRules(game)).toBe("euphoriker");
	});

	it("returns klassiker for an early red card", () => {
		const game = {
			score_home: 2,
			score_away: 0,
			score_timeline: [
				{ event_type: "red_card", minute: 7 },
				{ event_type: "goal", home: 1, away: 0, minute: 30 },
				{ event_type: "goal", home: 2, away: 0, minute: 70 },
			],
		};
		expect(applyHardRules(game)).toBe("klassiker");
	});

	it("returns analyst for a clear win without drama", () => {
		const game = {
			score_home: 5,
			score_away: 0,
			score_timeline: [
				{ event_type: "goal", home: 1, away: 0, minute: 10 },
				{ event_type: "goal", home: 2, away: 0, minute: 25 },
				{ event_type: "goal", home: 3, away: 0, minute: 40 },
				{ event_type: "goal", home: 4, away: 0, minute: 55 },
				{ event_type: "goal", home: 5, away: 0, minute: 70 },
			],
		};
		expect(applyHardRules(game)).toBe("analyst");
	});

	it("returns null when no hard rule fires", () => {
		const game = {
			score_home: 3,
			score_away: 1,
			score_timeline: [
				{ event_type: "goal", home: 1, away: 0, minute: 20 },
				{ event_type: "goal", home: 2, away: 0, minute: 50 },
				{ event_type: "goal", home: 2, away: 1, minute: 60 },
				{ event_type: "goal", home: 3, away: 1, minute: 75 },
			],
		};
		expect(applyHardRules(game)).toBe(null);
	});
});

describe("applyAntiRepetition", () => {
	it("divides the overused reporter's weight by 4 when used twice", () => {
		const base = { klassiker: 40, analyst: 30, euphoriker: 30 };
		const adjusted = applyAntiRepetition(base, ["klassiker", "klassiker"]);
		expect(adjusted.klassiker).toBe(10);
		expect(adjusted.analyst).toBe(30);
		expect(adjusted.euphoriker).toBe(30);
	});

	it("leaves weights untouched when last two reporters differ", () => {
		const base = { klassiker: 40, analyst: 30, euphoriker: 30 };
		const adjusted = applyAntiRepetition(base, ["klassiker", "analyst"]);
		expect(adjusted).toEqual(base);
	});

	it("handles fewer than two history entries", () => {
		const base = { klassiker: 40, analyst: 30, euphoriker: 30 };
		expect(applyAntiRepetition(base, [])).toEqual(base);
		expect(applyAntiRepetition(base, ["klassiker"])).toEqual(base);
	});
});

describe("weightedRandomChoice", () => {
	it("returns the only positive-weight reporter", () => {
		const choice = weightedRandomChoice(
			{ klassiker: 0, analyst: 100, euphoriker: 0 },
			() => 0.5,
		);
		expect(choice).toBe("analyst");
	});

	it("respects the cumulative-weight ranges", () => {
		const weights = { klassiker: 50, analyst: 30, euphoriker: 20 };
		expect(weightedRandomChoice(weights, () => 0.0)).toBe("klassiker");
		expect(weightedRandomChoice(weights, () => 0.6)).toBe("analyst");
		expect(weightedRandomChoice(weights, () => 0.9)).toBe("euphoriker");
	});
});

describe("selectReporter", () => {
	it("respects hard rules over the weighted draw", () => {
		const game = {
			score_home: 0,
			score_away: 5,
			score_timeline: [
				{ event_type: "goal", home: 0, away: 1, minute: 10 },
				{ event_type: "goal", home: 0, away: 2, minute: 25 },
				{ event_type: "goal", home: 0, away: 3, minute: 40 },
				{ event_type: "goal", home: 0, away: 4, minute: 55 },
				{ event_type: "goal", home: 0, away: 5, minute: 70 },
			],
		};
		expect(
			selectReporter(game, { random: () => 0.99 }),
		).toBe("analyst");
	});

	it("returns weighted choice when no hard rule applies", () => {
		const game = {
			score_home: 3,
			score_away: 1,
			score_timeline: [
				{ event_type: "goal", home: 1, away: 0, minute: 20 },
				{ event_type: "goal", home: 2, away: 0, minute: 50 },
				{ event_type: "goal", home: 2, away: 1, minute: 60 },
				{ event_type: "goal", home: 3, away: 1, minute: 75 },
			],
		};
		const { klassiker } = REPORTER_WEIGHTS_BY_DRAMA.medium;
		expect(klassiker).toBeGreaterThan(0);
		expect(selectReporter(game, { random: () => 0.0 })).toBe("klassiker");
	});
});
