import { describe, expect, it } from "vitest";
import {
	compareMinute,
	filterGoals,
	getEventType,
	getMinMinuteForNextEvent,
	isGoal,
	isPenaltyMissed,
	isRedCard,
	validateScoreTimeline,
} from "../../../src/api/helpers/timeline.helpers.js";
import {
	buildGoalEvent,
	buildPenaltyMissedEvent,
	buildRedCardEvent,
} from "../../test-utils.js";

describe("getEventType", () => {
	it("defaults to 'goal' when event_type is missing", () => {
		expect(getEventType({})).toBe("goal");
		expect(getEventType({ scored_by: "user-1" })).toBe("goal");
	});

	it("returns the explicit event_type when present", () => {
		expect(getEventType({ event_type: "red_card" })).toBe("red_card");
		expect(getEventType({ event_type: "penalty_missed" })).toBe(
			"penalty_missed",
		);
	});

	it("treats null entries as goals", () => {
		expect(getEventType(null)).toBe("goal");
		expect(getEventType(undefined)).toBe("goal");
	});
});

describe("isGoal / isRedCard / isPenaltyMissed", () => {
	it("classifies legacy entries without event_type as goals", () => {
		const legacy = { home: 1, away: 0, scored_by: "user-1" };
		expect(isGoal(legacy)).toBe(true);
		expect(isRedCard(legacy)).toBe(false);
		expect(isPenaltyMissed(legacy)).toBe(false);
	});

	it("classifies red cards", () => {
		const entry = buildRedCardEvent();
		expect(isRedCard(entry)).toBe(true);
		expect(isGoal(entry)).toBe(false);
	});

	it("classifies missed penalties", () => {
		const entry = buildPenaltyMissedEvent();
		expect(isPenaltyMissed(entry)).toBe(true);
		expect(isGoal(entry)).toBe(false);
	});
});

describe("filterGoals", () => {
	it("returns an empty array for non-array input", () => {
		expect(filterGoals(null)).toEqual([]);
		expect(filterGoals(undefined)).toEqual([]);
	});

	it("retains legacy entries (no event_type) as goals", () => {
		const timeline = [
			{ home: 1, away: 0, period: "regular" },
			{ home: 2, away: 0, period: "regular", scored_by: "user-1" },
		];
		expect(filterGoals(timeline)).toHaveLength(2);
	});

	it("drops red cards and missed penalties", () => {
		const timeline = [
			buildGoalEvent({ minute: 30 }),
			buildRedCardEvent({ minute: 60 }),
			buildPenaltyMissedEvent({ minute: 80 }),
		];
		const goals = filterGoals(timeline);
		expect(goals).toHaveLength(1);
		expect(goals[0].event_type).toBeUndefined();
	});

	it("preserves explicit event_type='goal' entries", () => {
		const timeline = [{ event_type: "goal", home: 1, away: 0 }];
		expect(filterGoals(timeline)).toHaveLength(1);
	});
});

describe("compareMinute", () => {
	it("orders by minute first", () => {
		expect(compareMinute({ minute: 11 }, { minute: 12 })).toBeLessThan(0);
		expect(compareMinute({ minute: 30 }, { minute: 12 })).toBeGreaterThan(0);
	});

	it("breaks ties with stoppage", () => {
		expect(
			compareMinute({ minute: 45, stoppage: 1 }, { minute: 45, stoppage: 2 }),
		).toBeLessThan(0);
		expect(
			compareMinute({ minute: 45, stoppage: 3 }, { minute: 45, stoppage: 1 }),
		).toBeGreaterThan(0);
	});

	it("returns 0 for identical pairs", () => {
		expect(
			compareMinute({ minute: 30, stoppage: 0 }, { minute: 30, stoppage: 0 }),
		).toBe(0);
	});

	it("treats missing stoppage as 0", () => {
		expect(compareMinute({ minute: 30 }, { minute: 30, stoppage: 0 })).toBe(0);
	});
});

describe("getMinMinuteForNextEvent", () => {
	it("returns null for the penalty shootout period", () => {
		expect(getMinMinuteForNextEvent([], "penalty")).toBeNull();
	});

	it("starts regular play at minute 1", () => {
		expect(getMinMinuteForNextEvent([], "regular")).toEqual({
			minute: 1,
			stoppage: 0,
		});
	});

	it("starts extra time at minute 91 even when regular ended at 90+5", () => {
		const timeline = [buildGoalEvent({ minute: 90, stoppage: 5 })];
		expect(getMinMinuteForNextEvent(timeline, "extra_time")).toEqual({
			minute: 91,
			stoppage: 0,
		});
	});

	it("advances stoppage at endpoints when room remains", () => {
		const timeline = [buildGoalEvent({ minute: 45, stoppage: 2 })];
		expect(getMinMinuteForNextEvent(timeline, "regular")).toEqual({
			minute: 45,
			stoppage: 3,
		});
	});

	it("jumps past the half when the stoppage cap is reached", () => {
		const timeline = [buildGoalEvent({ minute: 45, stoppage: 5 })];
		expect(getMinMinuteForNextEvent(timeline, "regular")).toEqual({
			minute: 46,
			stoppage: 0,
		});
	});

	it("advances to the next minute outside endpoints", () => {
		const timeline = [buildGoalEvent({ minute: 30 })];
		expect(getMinMinuteForNextEvent(timeline, "regular")).toEqual({
			minute: 31,
			stoppage: 0,
		});
	});

	it("only considers events from the same period", () => {
		const timeline = [
			buildGoalEvent({ period: "regular", minute: 80 }),
			buildGoalEvent({ period: "extra_time", minute: 100 }),
		];
		expect(getMinMinuteForNextEvent(timeline, "regular")).toEqual({
			minute: 81,
			stoppage: 0,
		});
		expect(getMinMinuteForNextEvent(timeline, "extra_time")).toEqual({
			minute: 101,
			stoppage: 0,
		});
	});

	it("ignores out-of-order entries by picking the latest in the period", () => {
		const timeline = [
			buildGoalEvent({ minute: 60 }),
			buildGoalEvent({ minute: 30 }),
		];
		expect(getMinMinuteForNextEvent(timeline, "regular")).toEqual({
			minute: 61,
			stoppage: 0,
		});
	});
});

describe("validateScoreTimeline", () => {
	it("accepts an empty timeline", () => {
		expect(() => validateScoreTimeline([])).not.toThrow();
	});

	it("accepts strictly increasing minutes within a period", () => {
		const timeline = [
			buildGoalEvent({ minute: 11 }),
			buildGoalEvent({ minute: 30 }),
			buildGoalEvent({ minute: 90, stoppage: 1 }),
		];
		expect(() => validateScoreTimeline(timeline)).not.toThrow();
	});

	it("rejects a duplicate (minute, stoppage) within a period", () => {
		const timeline = [
			buildGoalEvent({ minute: 11 }),
			buildGoalEvent({ minute: 11 }),
		];
		try {
			validateScoreTimeline(timeline);
			expect.fail("expected validateScoreTimeline to throw");
		} catch (error) {
			expect(error.statusCode).toBe(400);
			expect(error.message).toContain("regular");
			expect(error.message).toContain("11+0");
		}
	});

	it("rejects a backwards minute within a period", () => {
		const timeline = [
			buildGoalEvent({ minute: 30 }),
			buildGoalEvent({ minute: 25 }),
		];
		expect(() => validateScoreTimeline(timeline)).toThrow(
			/strictly after/i,
		);
	});

	it("treats periods independently — regular and extra_time may overlap as long as each is increasing", () => {
		const timeline = [
			buildGoalEvent({ period: "regular", minute: 90, stoppage: 4 }),
			buildGoalEvent({ period: "extra_time", minute: 91 }),
			buildGoalEvent({ period: "extra_time", minute: 105, stoppage: 1 }),
		];
		expect(() => validateScoreTimeline(timeline)).not.toThrow();
	});

	it("skips penalty-shootout entries (no minute required)", () => {
		const timeline = [
			buildGoalEvent({ period: "penalty", minute: undefined }),
			buildGoalEvent({ period: "penalty", minute: undefined }),
		];
		expect(() => validateScoreTimeline(timeline)).not.toThrow();
	});

	it("skips entries that have no minute even within a regular period", () => {
		const timeline = [
			buildGoalEvent({ minute: 30 }),
			{ period: "regular", scored_by: "user-1" }, // legacy entry
			buildGoalEvent({ minute: 60 }),
		];
		expect(() => validateScoreTimeline(timeline)).not.toThrow();
	});

	it("validates non-goal event types alongside goals", () => {
		const timeline = [
			buildGoalEvent({ minute: 30 }),
			buildRedCardEvent({ minute: 67 }),
			buildPenaltyMissedEvent({ minute: 80 }),
		];
		expect(() => validateScoreTimeline(timeline)).not.toThrow();
	});

	it("rejects a red card placed before the previous goal of the same period", () => {
		const timeline = [
			buildGoalEvent({ minute: 30 }),
			buildRedCardEvent({ minute: 20 }),
		];
		expect(() => validateScoreTimeline(timeline)).toThrow(/strictly after/i);
	});
});
