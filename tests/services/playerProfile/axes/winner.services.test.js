import { describe, expect, it } from "vitest";
import {
	computeRawWinnerScore,
	computeWinnerAxis,
} from "../../../../src/api/services/playerProfile/axes/winner.services.js";

const buildPlayer = (playerId, matchCount, wins) => ({
	playerId,
	matches: { matchCount, wins },
});

describe("computeRawWinnerScore", () => {
	it("returns the neutral 1.0 when no eligible partners exist", () => {
		const history = {
			matchCount: 10,
			wins: 6,
			partners: [{ playerId: "rare", matchesTogether: 1 }],
		};
		const league = [buildPlayer("rare", 5, 3)];
		expect(computeRawWinnerScore(history, league)).toBe(1.0);
	});

	it("returns >1 for a carrier with weaker partners", () => {
		const history = {
			matchCount: 10,
			wins: 7, // 0.7 win rate
			partners: [{ playerId: "weak", matchesTogether: 10 }],
		};
		const league = [buildPlayer("weak", 20, 5)]; // partner solo wr = 0.25
		const score = computeRawWinnerScore(history, league);
		expect(score).toBeGreaterThan(1);
	});

	it("returns <1 for someone buoyed by strong partners", () => {
		const history = {
			matchCount: 10,
			wins: 6,
			partners: [{ playerId: "strong", matchesTogether: 10 }],
		};
		const league = [buildPlayer("strong", 20, 18)]; // partner solo wr 0.9
		const score = computeRawWinnerScore(history, league);
		expect(score).toBeLessThan(1);
	});

	it("respects the min-partner-matches threshold", () => {
		const history = {
			matchCount: 10,
			wins: 6,
			partners: [
				{ playerId: "rare", matchesTogether: 2 }, // below threshold
				{ playerId: "ok", matchesTogether: 5 },
			],
		};
		const league = [
			buildPlayer("rare", 5, 0),
			buildPlayer("ok", 20, 10),
		];
		const score = computeRawWinnerScore(history, league);
		// Only ok counts (wr 0.5) — player wr 0.6 → score 1.2
		expect(score).toBeCloseTo(0.6 / 0.5, 5);
	});
});

describe("computeWinnerAxis", () => {
	it("ranks the carrier above the rest of the league", () => {
		const carrier = {
			matchCount: 10,
			wins: 8,
			partners: [{ playerId: "weak", matchesTogether: 10 }],
		};
		const average = {
			matchCount: 10,
			wins: 5,
			partners: [{ playerId: "weak", matchesTogether: 10 }],
		};
		const league = [
			{ playerId: "carrier", matches: carrier },
			{ playerId: "avg", matches: average },
			buildPlayer("weak", 20, 5),
		];
		expect(computeWinnerAxis(carrier, league)).toBeGreaterThan(
			computeWinnerAxis(average, league),
		);
	});
});
