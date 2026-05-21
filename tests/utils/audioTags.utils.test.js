import { describe, expect, it } from "vitest";
import { stripAudioTags } from "../../src/api/utils/audioTags.utils.js";

describe("stripAudioTags", () => {
	it("removes single bracketed mood tag at the start", () => {
		expect(stripAudioTags("[nachdenklich] Zwei zu vier.")).toBe(
			"Zwei zu vier.",
		);
	});

	it("removes multiple inline tags and normalises whitespace", () => {
		const input =
			"[nachdenklich] Zwei zu vier. [resigniert seufzend] Tja… [trocken] Genützt hat es nichts.";
		expect(stripAudioTags(input)).toBe(
			"Zwei zu vier. Tja… Genützt hat es nichts.",
		);
	});

	it("returns empty string for null/undefined/empty input", () => {
		expect(stripAudioTags(null)).toBe("");
		expect(stripAudioTags(undefined)).toBe("");
		expect(stripAudioTags("")).toBe("");
	});

	it("keeps text without tags untouched", () => {
		expect(stripAudioTags("Vier zu eins, klare Sache.")).toBe(
			"Vier zu eins, klare Sache.",
		);
	});

	it("collapses spacing before punctuation introduced by tag removal", () => {
		expect(stripAudioTags("Donnerwetter [staunend] !")).toBe("Donnerwetter!");
	});
});
