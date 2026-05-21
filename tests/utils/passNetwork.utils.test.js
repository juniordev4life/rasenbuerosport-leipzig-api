import { describe, expect, it } from "vitest";
import {
	__test__,
	normalisePassNetwork,
} from "../../src/api/utils/passNetwork.utils.js";

const { lateralityFromScore, verticalityFromScore } = __test__;

describe("lateralityFromScore", () => {
	it("classifies clear left-side play", () => {
		expect(lateralityFromScore(-80)).toBe("links");
		expect(lateralityFromScore(-60)).toBe("links");
	});

	it("classifies clear right-side play", () => {
		expect(lateralityFromScore(75)).toBe("rechts");
		expect(lateralityFromScore(60)).toBe("rechts");
	});

	it("classifies anything between as symmetric", () => {
		expect(lateralityFromScore(-50)).toBe("symmetrisch");
		expect(lateralityFromScore(0)).toBe("symmetrisch");
		expect(lateralityFromScore(50)).toBe("symmetrisch");
	});
});

describe("verticalityFromScore", () => {
	it("classifies central play above 70", () => {
		expect(verticalityFromScore(70)).toBe("zentral");
		expect(verticalityFromScore(95)).toBe("zentral");
	});

	it("classifies wing play at 30 or below", () => {
		expect(verticalityFromScore(30)).toBe("flügel");
		expect(verticalityFromScore(5)).toBe("flügel");
	});

	it("classifies between as mixed", () => {
		expect(verticalityFromScore(50)).toBe("gemischt");
	});
});

describe("normalisePassNetwork", () => {
	it("returns null for nullish input", () => {
		expect(normalisePassNetwork(null)).toBe(null);
		expect(normalisePassNetwork(undefined)).toBe(null);
		expect(normalisePassNetwork("not-an-object")).toBe(null);
	});

	it("returns null when both scores are missing", () => {
		expect(
			normalisePassNetwork({ lateralityScore: null, verticalityScore: null }),
		).toBe(null);
		expect(normalisePassNetwork({})).toBe(null);
	});

	it("normalises a clean indicators object", () => {
		const out = normalisePassNetwork({
			laterality: "rechts",
			verticality: "flügel",
			lateralityScore: 75,
			verticalityScore: 22,
			centralPlayer: "8",
			topPassConnections: [
				{ from: "8", to: "10" },
				{ from: "10", to: "9" },
			],
		});
		expect(out).toEqual({
			laterality: "rechts",
			verticality: "flügel",
			lateralityScore: 75,
			verticalityScore: 22,
			centralPlayer: "8",
			topPassConnections: [
				{ from: "8", to: "10" },
				{ from: "10", to: "9" },
			],
		});
	});

	it("derives labels from scores (LLM label is ignored if it disagrees)", () => {
		const out = normalisePassNetwork({
			laterality: "links", // LLM says left, but score is +80 (right)
			verticality: "zentral",
			lateralityScore: 80,
			verticalityScore: 22,
		});
		expect(out.laterality).toBe("rechts");
		expect(out.verticality).toBe("flügel");
	});

	it("clamps out-of-range scores into the allowed bounds", () => {
		const out = normalisePassNetwork({
			lateralityScore: 250,
			verticalityScore: -30,
		});
		expect(out.lateralityScore).toBe(100);
		expect(out.verticalityScore).toBe(0);
	});

	it("accepts numeric centralPlayer and stringifies it", () => {
		const out = normalisePassNetwork({
			lateralityScore: 0,
			verticalityScore: 50,
			centralPlayer: 8,
		});
		expect(out.centralPlayer).toBe("8");
	});

	it("drops malformed pass connections and caps at 3", () => {
		const out = normalisePassNetwork({
			lateralityScore: 0,
			verticalityScore: 50,
			topPassConnections: [
				{ from: "8", to: "10" },
				{ from: "missing-to" },
				null,
				{ from: 9, to: 11 },
				{ from: "5", to: "6" },
				{ from: "7", to: "8" }, // would be 4th valid, must be dropped
			],
		});
		expect(out.topPassConnections).toEqual([
			{ from: "8", to: "10" },
			{ from: "9", to: "11" },
			{ from: "5", to: "6" },
		]);
	});

	it("handles partial input gracefully — only verticality", () => {
		const out = normalisePassNetwork({
			verticalityScore: 85,
		});
		expect(out).toEqual({
			laterality: null,
			verticality: "zentral",
			lateralityScore: null,
			verticalityScore: 85,
			centralPlayer: null,
			topPassConnections: [],
		});
	});
});
