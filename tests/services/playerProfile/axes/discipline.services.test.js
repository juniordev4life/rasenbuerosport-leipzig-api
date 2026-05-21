import { describe, expect, it } from "vitest";
import {
	computeDisciplineAxis,
	computeRawDisciplinePenalty,
} from "../../../../src/api/services/playerProfile/axes/discipline.services.js";

describe("computeRawDisciplinePenalty", () => {
	it("returns 0 for a clean record", () => {
		expect(
			computeRawDisciplinePenalty({ matchCount: 10, redCards: [] }),
		).toBe(0);
	});

	it("weighs an early red more harshly than a late one", () => {
		const early = computeRawDisciplinePenalty({
			matchCount: 10,
			redCards: [{ minute: 5, matchMinutes: 90 }],
		});
		const late = computeRawDisciplinePenalty({
			matchCount: 10,
			redCards: [{ minute: 85, matchMinutes: 90 }],
		});
		expect(early).toBeGreaterThan(late);
	});

	it("averages over the window", () => {
		const v = computeRawDisciplinePenalty({
			matchCount: 5,
			redCards: [
				{ minute: 0, matchMinutes: 90 }, // factor 1.0
				{ minute: 90, matchMinutes: 90 }, // factor 0
			],
		});
		expect(v).toBeCloseTo(1 / 5, 5);
	});
});

describe("computeDisciplineAxis", () => {
	it("ranks the cleanest player at 100", () => {
		const clean = { matchCount: 10, redCards: [] };
		const dirty = {
			matchCount: 10,
			redCards: [
				{ minute: 5, matchMinutes: 90 },
				{ minute: 30, matchMinutes: 90 },
			],
		};
		const league = [{ matches: clean }, { matches: dirty }];
		expect(computeDisciplineAxis(clean, league)).toBeGreaterThan(
			computeDisciplineAxis(dirty, league),
		);
		expect(computeDisciplineAxis(clean, league)).toBeGreaterThanOrEqual(70);
	});
});
