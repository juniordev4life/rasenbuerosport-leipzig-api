import { describe, expect, it } from "vitest";
import { computePercentileRank } from "../../../src/api/services/playerProfile/percentile.utils.js";

describe("computePercentileRank", () => {
	it("returns 50 for the empty population (sane default)", () => {
		expect(computePercentileRank(1.5, [])).toBe(50);
	});

	it("returns 50 for a single-element population", () => {
		expect(computePercentileRank(2.0, [2.0])).toBe(50);
	});

	it("ranks a top value at 100", () => {
		expect(computePercentileRank(3.0, [0.5, 1.0, 1.5, 2.0, 3.0])).toBeGreaterThanOrEqual(
			90,
		);
	});

	it("ranks a median value near 50", () => {
		const rank = computePercentileRank(1.5, [0.5, 1.0, 1.5, 2.0, 2.5]);
		expect(rank).toBeGreaterThanOrEqual(40);
		expect(rank).toBeLessThanOrEqual(60);
	});

	it("ranks a bottom value at the lowest perch (but not 0 due to half-equal)", () => {
		const rank = computePercentileRank(0.5, [0.5, 1.0, 1.5, 2.0, 2.5]);
		expect(rank).toBeGreaterThanOrEqual(5);
		expect(rank).toBeLessThan(15);
	});

	it("handles ties with the half-equal rule", () => {
		expect(computePercentileRank(2.0, [1.0, 2.0, 2.0, 2.0, 3.0])).toBeGreaterThanOrEqual(
			40,
		);
		expect(computePercentileRank(2.0, [1.0, 2.0, 2.0, 2.0, 3.0])).toBeLessThanOrEqual(
			60,
		);
	});

	it("ignores non-finite entries in the population", () => {
		expect(
			computePercentileRank(1.5, [0.5, Number.NaN, 1.5, 2.5]),
		).toBeGreaterThan(20);
	});

	it("returns 50 for non-finite value", () => {
		expect(computePercentileRank(Number.NaN, [0, 1, 2])).toBe(50);
	});
});
