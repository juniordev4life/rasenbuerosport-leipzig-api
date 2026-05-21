import { describe, expect, it } from "vitest";
import {
	clamp,
	computeExpectedScore,
	computeMarginFactor,
	computeTeamDelta,
	computeTeamRating,
	resolveKFactor,
} from "../../../src/api/services/elo/eloMath.services.js";

describe("clamp", () => {
	it("returns the value when in range", () => {
		expect(clamp(0.5, 0.2, 0.8)).toBe(0.5);
	});

	it("clamps to min when below", () => {
		expect(clamp(0.1, 0.2, 0.8)).toBe(0.2);
	});

	it("clamps to max when above", () => {
		expect(clamp(0.9, 0.2, 0.8)).toBe(0.8);
	});
});

describe("computeTeamRating", () => {
	it("averages two ratings", () => {
		expect(computeTeamRating([1500, 1500])).toBe(1500);
		expect(computeTeamRating([1600, 1400])).toBe(1500);
	});

	it("returns the single rating for a 1v1 player", () => {
		expect(computeTeamRating([1700])).toBe(1700);
	});

	it("falls back to starting rating for empty input", () => {
		expect(computeTeamRating([])).toBe(1500);
	});
});

describe("computeExpectedScore", () => {
	it("returns 0.5 for equal ratings", () => {
		expect(computeExpectedScore(1500, 1500)).toBe(0.5);
	});

	it("favours the higher-rated team", () => {
		expect(computeExpectedScore(1700, 1500)).toBeGreaterThan(0.7);
		expect(computeExpectedScore(1700, 1500)).toBeLessThan(0.8);
	});

	it("disfavours the lower-rated team", () => {
		expect(computeExpectedScore(1300, 1500)).toBeLessThan(0.3);
		expect(computeExpectedScore(1300, 1500)).toBeGreaterThan(0.2);
	});

	it("is symmetric — sum of opposing expectations is 1", () => {
		const eA = computeExpectedScore(1600, 1400);
		const eB = computeExpectedScore(1400, 1600);
		expect(eA + eB).toBeCloseTo(1, 10);
	});
});

describe("computeMarginFactor", () => {
	it("returns 0 for a draw", () => {
		expect(computeMarginFactor(0, 0)).toBe(0);
		expect(computeMarginFactor(0, 200)).toBe(0);
	});

	it("scales up with goal difference (no rating gap)", () => {
		const one = computeMarginFactor(1, 0);
		const three = computeMarginFactor(3, 0);
		const five = computeMarginFactor(5, 0);
		expect(one).toBeCloseTo(Math.log(2), 5);
		expect(three).toBeCloseTo(Math.log(4), 5);
		expect(five).toBeCloseTo(Math.log(6), 5);
		expect(one).toBeLessThan(three);
		expect(three).toBeLessThan(five);
	});

	it("dampens when the favourite wins as expected", () => {
		const no_dampening = computeMarginFactor(3, 0);
		const dampened = computeMarginFactor(3, 200);
		expect(dampened).toBeLessThan(no_dampening);
	});

	it("handles absolute values — sign of goalDifference doesn't matter", () => {
		expect(computeMarginFactor(2, 0)).toBe(computeMarginFactor(-2, 0));
	});
});

describe("computeTeamDelta", () => {
	it("is positive for an unexpected win", () => {
		const delta = computeTeamDelta({
			kFactor: 32,
			marginFactor: 1.1,
			actualScore: 1,
			expectedScore: 0.3,
		});
		expect(delta).toBeGreaterThan(0);
	});

	it("is negative for an unexpected loss", () => {
		const delta = computeTeamDelta({
			kFactor: 32,
			marginFactor: 1.0,
			actualScore: 0,
			expectedScore: 0.7,
		});
		expect(delta).toBeLessThan(0);
	});

	it("is zero when actual matches expected exactly", () => {
		const delta = computeTeamDelta({
			kFactor: 32,
			marginFactor: 1.0,
			actualScore: 0.5,
			expectedScore: 0.5,
		});
		expect(delta).toBe(0);
	});
});

describe("resolveKFactor", () => {
	it("returns the new-player K below the threshold", () => {
		expect(resolveKFactor(0)).toBe(48);
		expect(resolveKFactor(15)).toBe(48);
		expect(resolveKFactor(29)).toBe(48);
	});

	it("returns the standard K at and above the threshold", () => {
		expect(resolveKFactor(30)).toBe(32);
		expect(resolveKFactor(100)).toBe(32);
	});

	it("treats invalid input as new player", () => {
		expect(resolveKFactor(-1)).toBe(48);
		expect(resolveKFactor(Number.NaN)).toBe(48);
	});
});
