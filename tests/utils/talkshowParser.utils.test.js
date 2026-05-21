import { describe, expect, it } from "vitest";
import {
	countWords,
	parseTalkshowScript,
	summariseScript,
} from "../../src/api/utils/talkshowParser.utils.js";

describe("parseTalkshowScript", () => {
	it("splits a multi-turn script in order", () => {
		const script = `[MARCEL] Willkommen zur Bürowoche.\n[SOPHIE] Danke Marcel, die Zahlen sind interessant.\n[FRANK] Meine Güte, Leute!`;
		const turns = parseTalkshowScript(script);
		expect(turns).toEqual([
			{
				speaker: "MARCEL",
				reporter_id: "klassiker",
				text: "Willkommen zur Bürowoche.",
			},
			{
				speaker: "SOPHIE",
				reporter_id: "analyst",
				text: "Danke Marcel, die Zahlen sind interessant.",
			},
			{
				speaker: "FRANK",
				reporter_id: "euphoriker",
				text: "Meine Güte, Leute!",
			},
		]);
	});

	it("preserves audio direction tags inside turn text", () => {
		const turns = parseTalkshowScript(
			"[MARCEL] [nachdenklich] Es war ein Abend, an dem… [trocken] Hätte.",
		);
		expect(turns[0].text).toBe(
			"[nachdenklich] Es war ein Abend, an dem… [trocken] Hätte.",
		);
	});

	it("drops preamble text before the first speaker tag", () => {
		const turns = parseTalkshowScript(
			"Hier ist das Drehbuch:\n[MARCEL] Los geht's.",
		);
		expect(turns).toHaveLength(1);
		expect(turns[0].text).toBe("Los geht's.");
	});

	it("skips empty turns", () => {
		const turns = parseTalkshowScript("[MARCEL]  \n[SOPHIE] Inhalt.");
		expect(turns).toHaveLength(1);
		expect(turns[0].speaker).toBe("SOPHIE");
	});

	it("collapses internal whitespace and trims", () => {
		const turns = parseTalkshowScript(
			"[FRANK]   Was   für   ein  Match!   ",
		);
		expect(turns[0].text).toBe("Was für ein Match!");
	});

	it("returns empty array on invalid input", () => {
		expect(parseTalkshowScript(null)).toEqual([]);
		expect(parseTalkshowScript("")).toEqual([]);
		expect(parseTalkshowScript("kein Speaker-Tag drin")).toEqual([]);
	});

	it("ignores unknown speaker tags (regex restricts to MARCEL/SOPHIE/FRANK)", () => {
		const turns = parseTalkshowScript(
			"[BORIS] Soll nicht passieren.\n[MARCEL] Korrekt.",
		);
		expect(turns).toHaveLength(1);
		expect(turns[0].speaker).toBe("MARCEL");
	});
});

describe("countWords", () => {
	it("counts whitespace-separated tokens", () => {
		expect(countWords("Eins zwei drei vier fünf")).toBe(5);
	});

	it("strips audio tags before counting", () => {
		expect(countWords("[nachdenklich] Drei Wörter hier.")).toBe(3);
	});

	it("returns 0 for empty / nullish input", () => {
		expect(countWords("")).toBe(0);
		expect(countWords(null)).toBe(0);
	});
});

describe("summariseScript", () => {
	it("aggregates per-speaker turn and word counts", () => {
		const turns = [
			{ speaker: "MARCEL", text: "Eins zwei drei." },
			{ speaker: "SOPHIE", text: "Vier fünf." },
			{ speaker: "MARCEL", text: "Sechs." },
		];
		const s = summariseScript(turns);
		expect(s.total_turns).toBe(3);
		expect(s.total_words).toBe(6);
		expect(s.by_speaker.MARCEL).toEqual({ turns: 2, words: 4 });
		expect(s.by_speaker.SOPHIE).toEqual({ turns: 1, words: 2 });
	});
});
