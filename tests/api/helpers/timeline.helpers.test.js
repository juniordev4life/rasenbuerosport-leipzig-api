import { describe, expect, it } from "vitest";
import {
	compareMinute,
	getMinMinuteForNextEvent,
	validateScoreTimeline,
} from "../../../src/api/helpers/timeline.helpers.js";
import {
	buildGoalEvent,
	buildPenaltyMissedEvent,
	buildRedCardEvent,
} from "../../test-utils.js";

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
