import { describe, expect, it } from "vitest";
import {
	cardinal,
	convertGameModeForSpeech,
	convertOrdinalsForSpeech,
	convertScoresForSpeech,
	normalizePunctuationForSpeech,
	ordinalDative,
	prepareTextForSpeech,
} from "../../src/api/utils/germanOrdinals.utils.js";

describe("cardinal", () => {
	it("handles units", () => {
		expect(cardinal(0)).toBe("null");
		expect(cardinal(1)).toBe("eins");
		expect(cardinal(7)).toBe("sieben");
		expect(cardinal(9)).toBe("neun");
	});

	it("handles teens", () => {
		expect(cardinal(10)).toBe("zehn");
		expect(cardinal(11)).toBe("elf");
		expect(cardinal(12)).toBe("zwölf");
		expect(cardinal(14)).toBe("vierzehn");
		expect(cardinal(17)).toBe("siebzehn");
		expect(cardinal(19)).toBe("neunzehn");
	});

	it("handles round tens", () => {
		expect(cardinal(20)).toBe("zwanzig");
		expect(cardinal(30)).toBe("dreißig");
		expect(cardinal(70)).toBe("siebzig");
		expect(cardinal(90)).toBe("neunzig");
	});

	it("handles compound tens", () => {
		expect(cardinal(21)).toBe("einundzwanzig");
		expect(cardinal(31)).toBe("einunddreißig");
		expect(cardinal(71)).toBe("einundsiebzig");
		expect(cardinal(78)).toBe("achtundsiebzig");
		expect(cardinal(89)).toBe("neunundachtzig");
	});

	it("handles hundred + remainder", () => {
		expect(cardinal(100)).toBe("einhundert");
		expect(cardinal(105)).toBe("einhundertfünf");
		expect(cardinal(120)).toBe("einhundertzwanzig");
	});
});

describe("ordinalDative", () => {
	it("handles specials", () => {
		expect(ordinalDative(1)).toBe("ersten");
		expect(ordinalDative(3)).toBe("dritten");
		expect(ordinalDative(7)).toBe("siebten");
		expect(ordinalDative(8)).toBe("achten");
	});

	it("uses -ten suffix below 20", () => {
		expect(ordinalDative(14)).toBe("vierzehnten");
		expect(ordinalDative(17)).toBe("siebzehnten");
		expect(ordinalDative(19)).toBe("neunzehnten");
	});

	it("uses -sten suffix at 20+", () => {
		expect(ordinalDative(20)).toBe("zwanzigsten");
		expect(ordinalDative(21)).toBe("einundzwanzigsten");
		expect(ordinalDative(71)).toBe("einundsiebzigsten");
		expect(ordinalDative(78)).toBe("achtundsiebzigsten");
		expect(ordinalDative(89)).toBe("neunundachtzigsten");
		expect(ordinalDative(90)).toBe("neunzigsten");
	});

	it("handles hundred-range", () => {
		expect(ordinalDative(100)).toBe("einhundertsten");
		expect(ordinalDative(120)).toBe("einhundertzwanzigsten");
	});
});

describe("convertOrdinalsForSpeech", () => {
	it("rewrites 'X. Minute' to ordinal-dative + Minute", () => {
		expect(
			convertOrdinalsForSpeech("BlackIVmaniac trifft in der 71. Minute"),
		).toBe("BlackIVmaniac trifft in der einundsiebzigsten Minute");
	});

	it("rewrites standalone 'in der X.'", () => {
		expect(
			convertOrdinalsForSpeech("Marco in der 31., dann FlorAIn in der 78."),
		).toBe(
			"Marco in der einunddreißigsten, dann FlorAIn in der achtundsiebzigsten",
		);
	});

	it("rewrites 'Minute X' as cardinal", () => {
		expect(convertOrdinalsForSpeech("Und dann, Minute 90")).toBe(
			"Und dann, Minute neunzig",
		);
	});

	it("leaves score-style digits untouched", () => {
		const input = "Es endet 3:2 nach 90 Minuten — keine Verlängerung.";
		expect(convertOrdinalsForSpeech(input)).toBe(input);
	});

	it("leaves decimal stats untouched", () => {
		const input = "3,5 Tore im Schnitt, eine produktive Woche.";
		expect(convertOrdinalsForSpeech(input)).toBe(input);
	});

	it("leaves game mode tokens untouched", () => {
		const input = "Ein 2v2 auf dem virtuellen Rasen.";
		expect(convertOrdinalsForSpeech(input)).toBe(input);
	});

	it("handles multiple references in one sentence", () => {
		const input =
			"Jay trifft in der 14., Marco legt in der 31. nach, BlackIVmaniac in der 71.";
		const expected =
			"Jay trifft in der vierzehnten, Marco legt in der einunddreißigsten nach, BlackIVmaniac in der einundsiebzigsten";
		expect(convertOrdinalsForSpeech(input)).toBe(expected);
	});

	it("returns empty string on nullish input", () => {
		expect(convertOrdinalsForSpeech(null)).toBe("");
		expect(convertOrdinalsForSpeech(undefined)).toBe("");
		expect(convertOrdinalsForSpeech("")).toBe("");
	});

	it("is idempotent when no numeric patterns are present", () => {
		const input = "In der vierzehnten Minute trifft Jay vom Punkt.";
		expect(convertOrdinalsForSpeech(input)).toBe(input);
	});
});

describe("convertScoresForSpeech", () => {
	it("converts a simple score", () => {
		expect(convertScoresForSpeech("Es endet 2:0")).toBe(
			"Es endet zwei zu null",
		);
	});

	it("handles multiple scores in one sentence", () => {
		expect(
			convertScoresForSpeech(
				"Palace führte zur Halbzeit 2:0, am Ende stand es 2:3.",
			),
		).toBe(
			"Palace führte zur Halbzeit zwei zu null, am Ende stand es zwei zu drei.",
		);
	});

	it("skips suspicious matches with numbers > 20", () => {
		// Timestamp-like patterns are not scores in this domain
		expect(convertScoresForSpeech("Anpfiff 14:30")).toBe("Anpfiff 14:30");
	});

	it("leaves text without colon-separated digits untouched", () => {
		const input = "Eine Aufholjagd, die alles drehte.";
		expect(convertScoresForSpeech(input)).toBe(input);
	});
});

describe("convertGameModeForSpeech", () => {
	it("converts 2v2 to 'zwei gegen zwei'", () => {
		expect(convertGameModeForSpeech("Ein 2v2 auf dem virtuellen Rasen")).toBe(
			"Ein zwei gegen zwei auf dem virtuellen Rasen",
		);
	});

	it("converts 1v1", () => {
		expect(convertGameModeForSpeech("Ein 1v1 Duell")).toBe(
			"Ein eins gegen eins Duell",
		);
	});

	it("handles 'vs' and 'vs.' variants", () => {
		expect(convertGameModeForSpeech("2vs2")).toBe("zwei gegen zwei");
		expect(convertGameModeForSpeech("3 vs. 3")).toBe("drei gegen drei");
	});

	it("ignores nonsense large numbers", () => {
		expect(convertGameModeForSpeech("100v200")).toBe("100v200");
	});
});

describe("normalizePunctuationForSpeech", () => {
	it("replaces em-dashes with comma + space", () => {
		expect(normalizePunctuationForSpeech("Brett — vom anderen Stern")).toBe(
			"Brett, vom anderen Stern",
		);
	});

	it("replaces en-dashes with comma + space", () => {
		expect(normalizePunctuationForSpeech("Brett – vom anderen Stern")).toBe(
			"Brett, vom anderen Stern",
		);
	});

	it("replaces space-hyphen-space with comma + space", () => {
		expect(normalizePunctuationForSpeech("Reicht nicht - aber Hut ab")).toBe(
			"Reicht nicht, aber Hut ab",
		);
	});

	it("preserves hyphens INSIDE compound words", () => {
		expect(normalizePunctuationForSpeech("Black-Four-Maniac legt auf")).toBe(
			"Black-Four-Maniac legt auf",
		);
		expect(normalizePunctuationForSpeech("Flor-AI-n trifft")).toBe(
			"Flor-AI-n trifft",
		);
	});

	it("collapses double commas if a comma was already there", () => {
		expect(normalizePunctuationForSpeech("Verdient, — sagen wir das so")).toBe(
			"Verdient, sagen wir das so",
		);
	});

	it("returns empty string on nullish input", () => {
		expect(normalizePunctuationForSpeech(null)).toBe("");
		expect(normalizePunctuationForSpeech(undefined)).toBe("");
	});
});

describe("prepareTextForSpeech (umbrella)", () => {
	it("applies ordinals, scores, game mode AND dashes together", () => {
		const input =
			"Ein 2v2 in der 71. Minute — am Ende stand es 3:2 für Dortmund.";
		const expected =
			"Ein zwei gegen zwei in der einundsiebzigsten Minute, am Ende stand es drei zu zwei für Dortmund.";
		expect(prepareTextForSpeech(input)).toBe(expected);
	});

	it("preserves hyphenated player names while normalising dashes", () => {
		const input = "Black-Four-Maniac trifft — und Flor-AI-n legt auf.";
		const expected = "Black-Four-Maniac trifft, und Flor-AI-n legt auf.";
		expect(prepareTextForSpeech(input)).toBe(expected);
	});
});
