import { describe, expect, it } from "vitest";
import {
	checkComeback,
	determineDramaLevel,
} from "../../src/api/utils/dramaLevel.utils.js";

describe("checkComeback", () => {
	it("returns true when away team trailed 0:2 and won 3:2", () => {
		const timeline = [
			{ event_type: "goal", home: 1, away: 0 },
			{ event_type: "goal", home: 2, away: 0 },
			{ event_type: "goal", home: 2, away: 1 },
			{ event_type: "goal", home: 2, away: 2 },
			{ event_type: "goal", home: 2, away: 3 },
		];
		expect(checkComeback(timeline, 2, 3)).toBe(true);
	});

	it("returns true on a 2-goal-deficit draw", () => {
		const timeline = [
			{ event_type: "goal", home: 2, away: 0 },
			{ event_type: "goal", home: 2, away: 1 },
			{ event_type: "goal", home: 2, away: 2 },
		];
		expect(checkComeback(timeline, 2, 2)).toBe(true);
	});

	it("returns false when trailing team also loses the game", () => {
		const timeline = [
			{ event_type: "goal", home: 2, away: 0 },
			{ event_type: "goal", home: 2, away: 1 },
			{ event_type: "goal", home: 4, away: 1 },
		];
		expect(checkComeback(timeline, 4, 1)).toBe(false);
	});

	it("returns false on an empty timeline", () => {
		expect(checkComeback([], 0, 0)).toBe(false);
		expect(checkComeback(null, 0, 0)).toBe(false);
	});
});

describe("determineDramaLevel", () => {
	it("returns high for a one-goal game", () => {
		expect(
			determineDramaLevel({
				score_home: 2,
				score_away: 1,
				score_timeline: [
					{ event_type: "goal", home: 1, away: 0, minute: 30 },
					{ event_type: "goal", home: 1, away: 1, minute: 55 },
					{ event_type: "goal", home: 2, away: 1, minute: 70 },
				],
			}),
		).toBe("high");
	});

	it("returns high when a red card is present", () => {
		expect(
			determineDramaLevel({
				score_home: 4,
				score_away: 0,
				score_timeline: [
					{ event_type: "red_card", minute: 7 },
					{ event_type: "goal", home: 1, away: 0, minute: 10 },
				],
			}),
		).toBe("high");
	});

	it("returns high on a comeback even with a clear final result", () => {
		expect(
			determineDramaLevel({
				score_home: 3,
				score_away: 2,
				score_timeline: [
					{ event_type: "goal", home: 0, away: 1, minute: 15 },
					{ event_type: "goal", home: 0, away: 2, minute: 35 },
					{ event_type: "goal", home: 1, away: 2, minute: 50 },
					{ event_type: "goal", home: 2, away: 2, minute: 70 },
					{ event_type: "goal", home: 3, away: 2, minute: 88 },
				],
			}),
		).toBe("high");
	});

	it("returns low for a clear win without late drama", () => {
		expect(
			determineDramaLevel({
				score_home: 5,
				score_away: 0,
				score_timeline: [
					{ event_type: "goal", home: 1, away: 0, minute: 10 },
					{ event_type: "goal", home: 2, away: 0, minute: 25 },
					{ event_type: "goal", home: 3, away: 0, minute: 40 },
					{ event_type: "goal", home: 4, away: 0, minute: 55 },
					{ event_type: "goal", home: 5, away: 0, minute: 70 },
				],
			}),
		).toBe("low");
	});

	it("returns medium for a 2-goal gap without red cards or late drama", () => {
		expect(
			determineDramaLevel({
				score_home: 3,
				score_away: 1,
				score_timeline: [
					{ event_type: "goal", home: 1, away: 0, minute: 20 },
					{ event_type: "goal", home: 2, away: 0, minute: 50 },
					{ event_type: "goal", home: 2, away: 1, minute: 60 },
					{ event_type: "goal", home: 3, away: 1, minute: 70 },
				],
			}),
		).toBe("medium");
	});
});
