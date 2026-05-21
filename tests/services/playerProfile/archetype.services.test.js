import { describe, expect, it } from "vitest";
import {
	determineArchetype,
	determineArchetypeByDominantAxis,
	isBalanced,
	isKnownArchetype,
	isMidRange,
} from "../../../src/api/services/playerProfile/archetype.services.js";

describe("isBalanced / isMidRange helpers", () => {
	it("isBalanced returns true for tight clusters", () => {
		expect(isBalanced([50, 55, 60], 15)).toBe(true);
		expect(isBalanced([50, 75, 60], 15)).toBe(false);
	});

	it("isMidRange honours both bounds", () => {
		expect(isMidRange([50, 55, 60], 45, 75)).toBe(true);
		expect(isMidRange([50, 75, 80], 45, 75)).toBe(false);
	});

	it("guards against empty arrays", () => {
		expect(isBalanced([], 5)).toBe(false);
		expect(isMidRange([], 0, 100)).toBe(false);
	});
});

describe("determineArchetype — explicit rule branches", () => {
	it("classifies the Marco-style scorer with discipline issues as hitzkopf", () => {
		expect(
			determineArchetype({
				finisher: 88,
				playmaker: 30,
				clutch: 70,
				consistency: 50,
				discipline: 22,
				winner: 55,
			}),
		).toBe("hitzkopf");
	});

	it("classifies a balanced top winner as carrier", () => {
		expect(
			determineArchetype({
				finisher: 50,
				playmaker: 50,
				clutch: 60,
				consistency: 55,
				discipline: 60,
				winner: 85,
			}),
		).toBe("carrier");
	});

	it("classifies the late-bloomer as spaetzuender", () => {
		expect(
			determineArchetype({
				finisher: 40,
				playmaker: 50,
				clutch: 80,
				consistency: 55,
				discipline: 60,
				winner: 55,
			}),
		).toBe("spaetzuender");
	});

	it("classifies the classic Vollstrecker", () => {
		expect(
			determineArchetype({
				finisher: 92,
				playmaker: 35,
				clutch: 85,
				consistency: 40,
				discipline: 60,
				winner: 70,
			}),
		).toBe("vollstrecker");
	});

	it("classifies the all-round playmaker with discipline + consistency as stratege", () => {
		expect(
			determineArchetype({
				finisher: 40,
				playmaker: 75,
				clutch: 50,
				consistency: 75,
				discipline: 70,
				winner: 55,
			}),
		).toBe("stratege");
	});

	it("classifies the balanced rhythm player as taktgeber", () => {
		expect(
			determineArchetype({
				finisher: 55,
				playmaker: 70,
				clutch: 55,
				consistency: 60,
				discipline: 60,
				winner: 55,
			}),
		).toBe("taktgeber");
	});

	it("classifies the steady-eddy as zuverlaessige", () => {
		expect(
			determineArchetype({
				finisher: 45,
				playmaker: 45,
				clutch: 50,
				consistency: 80,
				discipline: 55,
				winner: 50,
			}),
		).toBe("zuverlaessige");
	});

	it("classifies a calm middle as allrounder", () => {
		expect(
			determineArchetype({
				finisher: 50,
				playmaker: 55,
				clutch: 60,
				consistency: 60,
				discipline: 65,
				winner: 60,
			}),
		).toBe("allrounder");
	});

	it("falls back via dominant axis when no pattern matches", () => {
		const result = determineArchetype({
			finisher: 95,
			playmaker: 5,
			clutch: 5,
			consistency: 5,
			discipline: 95,
			winner: 5,
		});
		expect(["vollstrecker", "zuverlaessige"]).toContain(result);
	});

	it("returns allrounder for missing/NaN axes", () => {
		expect(determineArchetype({ finisher: 50 })).toBe("allrounder");
		expect(determineArchetype(null)).toBe("allrounder");
	});
});

describe("determineArchetypeByDominantAxis", () => {
	it("picks vollstrecker when finisher dominates", () => {
		expect(
			determineArchetypeByDominantAxis({
				finisher: 90,
				playmaker: 30,
				clutch: 40,
				consistency: 40,
				discipline: 40,
				winner: 50,
			}),
		).toBe("vollstrecker");
	});

	it("picks carrier when winner dominates", () => {
		expect(
			determineArchetypeByDominantAxis({
				finisher: 50,
				playmaker: 50,
				clutch: 50,
				consistency: 50,
				discipline: 50,
				winner: 95,
			}),
		).toBe("carrier");
	});
});

describe("isKnownArchetype", () => {
	it("accepts existing keys", () => {
		expect(isKnownArchetype("vollstrecker")).toBe(true);
	});
	it("rejects unknown strings and non-strings", () => {
		expect(isKnownArchetype("foo")).toBe(false);
		expect(isKnownArchetype(null)).toBe(false);
		expect(isKnownArchetype(42)).toBe(false);
	});
});
