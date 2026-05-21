import { describe, expect, it } from "vitest";
import { computeFinisherAxis } from "../../../../src/api/services/playerProfile/axes/finisher.services.js";

const player = (gpm) => ({
	matches: { matchCount: 10, totalGoals: gpm * 10 },
});

describe("computeFinisherAxis", () => {
	it("ranks a median player near 50", () => {
		const league = [player(0.5), player(1.0), player(1.5), player(2.0), player(2.5)];
		const rank = computeFinisherAxis(
			{ matchCount: 10, totalGoals: 15 }, // 1.5 gpm
			league,
		);
		expect(rank).toBeGreaterThanOrEqual(40);
		expect(rank).toBeLessThanOrEqual(60);
	});

	it("ranks the top finisher in the top decile", () => {
		const league = [player(0.5), player(1.0), player(1.5), player(2.0), player(2.5)];
		const rank = computeFinisherAxis(
			{ matchCount: 10, totalGoals: 30 }, // 3.0 gpm — above league max
			league,
		);
		expect(rank).toBeGreaterThanOrEqual(90);
	});

	it("returns a low rank for the lowest-scoring player", () => {
		const league = [player(0.5), player(1.0), player(1.5), player(2.0), player(2.5)];
		const rank = computeFinisherAxis(
			{ matchCount: 10, totalGoals: 5 }, // 0.5 gpm
			league,
		);
		expect(rank).toBeLessThan(20);
	});

	it("treats a player with zero matches as 0 goals-per-match", () => {
		const league = [player(0.5), player(1.0)];
		const rank = computeFinisherAxis({ matchCount: 0, totalGoals: 0 }, league);
		expect(rank).toBeLessThanOrEqual(30);
	});
});
