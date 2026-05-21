import { describe, expect, it } from "vitest";
import {
	computeClutchAxis,
	computeRawClutchScore,
} from "../../../../src/api/services/playerProfile/axes/clutch.services.js";

const goal = (minute, matchMinutes = 90) => ({
	type: "goal",
	minute,
	matchMinutes,
});
const assist = (minute, matchMinutes = 90) => ({
	type: "assist",
	minute,
	matchMinutes,
});

describe("computeRawClutchScore", () => {
	it("ignores first-half actions entirely", () => {
		const score = computeRawClutchScore({
			matchCount: 1,
			scoringEvents: [goal(20), goal(40)],
		});
		expect(score).toBe(0);
	});

	it("counts second-half actions at base weight", () => {
		const score = computeRawClutchScore({
			matchCount: 1,
			scoringEvents: [goal(60)],
		});
		expect(score).toBeCloseTo(1.0, 5);
	});

	it("applies the late-game bonus above the threshold", () => {
		const score = computeRawClutchScore({
			matchCount: 1,
			scoringEvents: [goal(85)], // 85/90 ≈ 0.944 → above 0.85 threshold
		});
		expect(score).toBeCloseTo(1.5, 5);
	});

	it("weights assists at half value", () => {
		const score = computeRawClutchScore({
			matchCount: 1,
			scoringEvents: [assist(60)],
		});
		expect(score).toBeCloseTo(0.5, 5);
	});

	it("averages over the match window", () => {
		const score = computeRawClutchScore({
			matchCount: 5,
			scoringEvents: [goal(85), goal(85)],
		});
		// 2 × 1.5 = 3.0, divided by 5 matches
		expect(score).toBeCloseTo(0.6, 5);
	});

	it("returns 0 for empty history", () => {
		expect(computeRawClutchScore({ matchCount: 0, scoringEvents: [] })).toBe(0);
		expect(computeRawClutchScore(null)).toBe(0);
	});

	it("safely skips malformed events", () => {
		const score = computeRawClutchScore({
			matchCount: 1,
			scoringEvents: [
				{ type: "goal", minute: "bad", matchMinutes: 90 },
				{ type: "goal", minute: 85, matchMinutes: 0 },
				goal(85),
			],
		});
		expect(score).toBeCloseTo(1.5, 5);
	});
});

describe("computeClutchAxis", () => {
	it("ranks a clutch player above the league average", () => {
		const player = {
			matchCount: 10,
			scoringEvents: Array.from({ length: 8 }, () => goal(85)),
		};
		const league = [
			{ matches: { matchCount: 10, scoringEvents: [] } },
			{ matches: { matchCount: 10, scoringEvents: [goal(85)] } },
			{ matches: { matchCount: 10, scoringEvents: [goal(60), goal(85)] } },
		];
		expect(computeClutchAxis(player, league)).toBeGreaterThan(60);
	});
});
