import { describe, expect, it } from "vitest";
import { computePlaymakerAxis } from "../../../../src/api/services/playerProfile/axes/playmaker.services.js";

const player = (apm) => ({
	matches: { matchCount: 10, totalAssists: apm * 10 },
});

describe("computePlaymakerAxis", () => {
	it("ranks the top assister in the upper decile", () => {
		const league = [player(0.1), player(0.3), player(0.5), player(0.8), player(1.2)];
		expect(
			computePlaymakerAxis({ matchCount: 10, totalAssists: 15 }, league),
		).toBeGreaterThanOrEqual(80);
	});

	it("falls back to neutral 50 when the entire league has 0 assists", () => {
		const league = [player(0), player(0), player(0)];
		const rank = computePlaymakerAxis(
			{ matchCount: 10, totalAssists: 0 },
			league,
		);
		expect(rank).toBe(50);
	});

	it("ranks a median playmaker near the middle", () => {
		const league = [player(0.0), player(0.2), player(0.5), player(0.8), player(1.0)];
		const rank = computePlaymakerAxis(
			{ matchCount: 10, totalAssists: 5 }, // 0.5 apm
			league,
		);
		expect(rank).toBeGreaterThanOrEqual(40);
		expect(rank).toBeLessThanOrEqual(60);
	});
});
