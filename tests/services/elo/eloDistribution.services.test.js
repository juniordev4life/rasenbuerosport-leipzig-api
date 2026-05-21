import { describe, expect, it } from "vitest";
import { distributeTeamDelta } from "../../../src/api/services/elo/eloDistribution.services.js";

describe("distributeTeamDelta — win/draw branch (teamDelta >= 0)", () => {
	it("splits a symmetric team-delta equally", () => {
		const out = distributeTeamDelta({
			teamDelta: 10,
			shares: [0.5, 0.5],
		});
		expect(out).toEqual([10, 10]);
		expect(out[0] + out[1]).toBe(20); // = 2 × teamDelta
	});

	it("rewards the higher-contribution player more on a win", () => {
		const out = distributeTeamDelta({
			teamDelta: 17.6,
			shares: [0.8, 0.2],
		});
		expect(out[0]).toBeCloseTo(28.16, 5);
		expect(out[1]).toBeCloseTo(7.04, 5);
	});

	it("collapses to single delta in a 1v1 win", () => {
		const out = distributeTeamDelta({
			teamDelta: 12,
			shares: [1.0],
		});
		expect(out).toEqual([12]);
	});
});

describe("distributeTeamDelta — loss branch (teamDelta < 0)", () => {
	it("inverts shares so the carry takes less of the loss", () => {
		const out = distributeTeamDelta({
			teamDelta: -17.6,
			shares: [0.8, 0.2],
		});
		expect(out[0]).toBeCloseTo(-7.04, 5);
		expect(out[1]).toBeCloseTo(-28.16, 5);
	});

	it("splits a symmetric loss equally", () => {
		const out = distributeTeamDelta({
			teamDelta: -10,
			shares: [0.5, 0.5],
		});
		expect(out).toEqual([-10, -10]);
	});
});

describe("distributeTeamDelta — invariants", () => {
	it("sum of player deltas equals team.length × teamDelta (win)", () => {
		const out = distributeTeamDelta({
			teamDelta: 17.6,
			shares: [0.75, 0.25],
		});
		const sum = out.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(17.6 * 2, 5);
	});

	it("sum of player deltas equals team.length × teamDelta (loss)", () => {
		const out = distributeTeamDelta({
			teamDelta: -20,
			shares: [0.7, 0.3],
		});
		const sum = out.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(-20 * 2, 5);
	});

	it("returns [] for empty shares", () => {
		expect(distributeTeamDelta({ teamDelta: 10, shares: [] })).toEqual([]);
	});
});
