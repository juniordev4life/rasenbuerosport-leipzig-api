import { describe, expect, it } from "vitest";
import {
	computeConsistencyAxis,
	computeRawConsistency,
} from "../../../../src/api/services/playerProfile/axes/consistency.services.js";

describe("computeRawConsistency", () => {
	it("returns 0 for fewer than 3 data points", () => {
		expect(
			computeRawConsistency({
				matchCount: 2,
				contributionScoresPerMatch: [2, 3],
			}),
		).toBe(0);
	});

	it("returns 0 when the mean is non-positive", () => {
		expect(
			computeRawConsistency({
				matchCount: 5,
				contributionScoresPerMatch: [0, 0, 0, 0, 0],
			}),
		).toBe(0);
	});

	it("returns near 1 for an extremely steady contribution", () => {
		const v = computeRawConsistency({
			matchCount: 5,
			contributionScoresPerMatch: [3, 3, 3, 3, 3],
		});
		expect(v).toBeCloseTo(1, 5);
	});

	it("returns lower for volatile inputs", () => {
		const steady = computeRawConsistency({
			matchCount: 5,
			contributionScoresPerMatch: [3, 3, 3, 3, 3],
		});
		const volatile = computeRawConsistency({
			matchCount: 5,
			contributionScoresPerMatch: [6, 0, 6, 0, 3],
		});
		expect(steady).toBeGreaterThan(volatile);
	});
});

describe("computeConsistencyAxis", () => {
	it("ranks a steady player above a volatile peer", () => {
		const steady = {
			matchCount: 5,
			contributionScoresPerMatch: [3, 3, 3, 3, 3],
		};
		const volatile = {
			matchCount: 5,
			contributionScoresPerMatch: [6, 0, 6, 0, 6],
		};
		const league = [{ matches: steady }, { matches: volatile }];
		expect(computeConsistencyAxis(steady, league)).toBeGreaterThan(
			computeConsistencyAxis(volatile, league),
		);
	});
});
