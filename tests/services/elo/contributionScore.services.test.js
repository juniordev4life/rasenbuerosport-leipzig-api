import { describe, expect, it } from "vitest";
import {
	computeContribution,
	computeTeamShares,
} from "../../../src/api/services/elo/contributionScore.services.js";

describe("computeContribution", () => {
	it("returns the baseline for a passive participant", () => {
		expect(
			computeContribution({ goals: 0, assists: 0, redCards: [] }, 10),
		).toBe(1.0);
	});

	it("adds goal weight per goal", () => {
		expect(
			computeContribution({ goals: 3, assists: 0, redCards: [] }, 10),
		).toBe(4.0);
	});

	it("adds half weight per assist", () => {
		expect(
			computeContribution({ goals: 0, assists: 2, redCards: [] }, 10),
		).toBe(2.0);
	});

	it("combines goals and assists additively", () => {
		expect(
			computeContribution({ goals: 1, assists: 2, redCards: [] }, 10),
		).toBe(3.0);
	});

	it("applies a big penalty for an early red card", () => {
		// 1 baseline + 1 goal + 1 assist - 2.0 * (9/10) = 1.2
		const c = computeContribution(
			{ goals: 1, assists: 2, redCards: [{ minute: 1 }] },
			10,
		);
		expect(c).toBeCloseTo(1.2, 5);
	});

	it("applies a tiny penalty for a late red card", () => {
		// 1 baseline + 1 goal + 1 assist - 2.0 * (1/10) = 2.8
		const c = computeContribution(
			{ goals: 1, assists: 2, redCards: [{ minute: 9 }] },
			10,
		);
		expect(c).toBeCloseTo(2.8, 5);
	});

	it("handles missing or malformed stats safely", () => {
		expect(computeContribution({}, 10)).toBe(1.0);
		expect(computeContribution(null, 10)).toBe(1.0);
		expect(
			computeContribution(
				{ goals: 1, assists: 0, redCards: [{ minute: Number.NaN }] },
				10,
			),
		).toBe(2.0);
	});

	it("defaults matchMinutes to 10 when missing or non-positive", () => {
		expect(
			computeContribution({ goals: 0, assists: 0, redCards: [] }),
		).toBe(1.0);
		expect(
			computeContribution({ goals: 0, assists: 0, redCards: [] }, 0),
		).toBe(1.0);
	});
});

describe("computeTeamShares", () => {
	it("splits evenly when contributions are equal", () => {
		expect(computeTeamShares([2.0, 2.0])).toEqual([0.5, 0.5]);
	});

	it("respects the asymmetric split when contributions differ", () => {
		expect(computeTeamShares([3.0, 1.0])).toEqual([0.75, 0.25]);
	});

	it("clamps shares at the configured min and max", () => {
		const [a, b] = computeTeamShares([10.0, 1.0]);
		expect(a).toBeCloseTo(0.8, 5);
		expect(b).toBeCloseTo(0.2, 5);
	});

	it("falls back to equal split when all contributions are zero", () => {
		expect(computeTeamShares([0, 0])).toEqual([0.5, 0.5]);
	});

	it("falls back to equal split when all contributions are negative", () => {
		expect(computeTeamShares([-1, -2])).toEqual([0.5, 0.5]);
	});

	it("returns [1.0] for a single-player team (1v1)", () => {
		expect(computeTeamShares([4.0])).toEqual([1.0]);
	});

	it("returns [] for empty input", () => {
		expect(computeTeamShares([])).toEqual([]);
	});

	it("ensures the resulting shares sum to ~1", () => {
		const inputs = [
			[2.0, 2.0],
			[3.0, 1.0],
			[10.0, 1.0],
			[5.0, 5.0],
		];
		for (const input of inputs) {
			const shares = computeTeamShares(input);
			const total = shares.reduce((acc, s) => acc + s, 0);
			expect(total).toBeCloseTo(1, 10);
		}
	});
});
