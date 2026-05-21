/**
 * German ordinal / cardinal pre-processor for the TTS pipeline.
 *
 * Deutsche Ordinalzahlen aus Ziffern ("71.") werden von ElevenLabs
 * unzuverlässig artikuliert — das Modell konstruiert dann manchmal
 * Phantasie-Endungen wie "einundsiebddchte". Die saubere Lösung ist,
 * Spielminuten in der Audio-Pipeline auf ausgeschriebene Wörter zu
 * konvertieren, BEVOR der Text an ElevenLabs geht. Der gespeicherte
 * Bericht / das Drehbuch behält die übliche Ziffern-Schreibweise für
 * die Lese-Ansicht — diese Util berührt nur die Audio-Eingabe.
 *
 * Behandelte Muster (kontextspezifisch auf Fußball-Berichte):
 *   "in der 71. Minute"     → "in der einundsiebzigsten Minute"
 *   "in der 71."            → "in der einundsiebzigsten"
 *   "der 89. Minute"        → "der neunundachtzigsten Minute"
 *   "Minute 71"             → "Minute einundsiebzig"
 *
 * Ziffern in Tor-Ergebnissen ("2:3"), Quoten ("3,5"), Spielmodus
 * ("2v2") werden bewusst NICHT angefasst — die spricht ElevenLabs
 * korrekt.
 */

const CARDINAL_UNITS_COMPOUND = [
	"",
	"ein",
	"zwei",
	"drei",
	"vier",
	"fünf",
	"sechs",
	"sieben",
	"acht",
	"neun",
];

const CARDINAL_TEENS = [
	"zehn",
	"elf",
	"zwölf",
	"dreizehn",
	"vierzehn",
	"fünfzehn",
	"sechzehn",
	"siebzehn",
	"achtzehn",
	"neunzehn",
];

const CARDINAL_TENS = [
	"",
	"zehn",
	"zwanzig",
	"dreißig",
	"vierzig",
	"fünfzig",
	"sechzig",
	"siebzig",
	"achtzig",
	"neunzig",
];

/**
 * Convert an integer 0–199 to its German cardinal word form.
 *
 * @param {number} n
 * @returns {string}
 *
 * @example
 *   cardinal(71); // → "einundsiebzig"
 *   cardinal(14); // → "vierzehn"
 *   cardinal(1);  // → "eins"
 *   cardinal(100); // → "einhundert"
 */
export function cardinal(n) {
	if (!Number.isInteger(n) || n < 0 || n > 199) return String(n);
	if (n === 0) return "null";
	if (n === 1) return "eins";
	if (n < 10) return CARDINAL_UNITS_COMPOUND[n];
	if (n < 20) return CARDINAL_TEENS[n - 10];
	if (n < 100) {
		const tens = Math.floor(n / 10);
		const units = n % 10;
		if (units === 0) return CARDINAL_TENS[tens];
		return `${CARDINAL_UNITS_COMPOUND[units]}und${CARDINAL_TENS[tens]}`;
	}
	if (n === 100) return "einhundert";
	const rest = n - 100;
	return `einhundert${cardinal(rest)}`;
}

const ORDINAL_SPECIAL_DATIVE = {
	1: "ersten",
	3: "dritten",
	7: "siebten",
	8: "achten",
};

/**
 * Convert an integer 1–199 to its German ordinal word form in dative
 * case (the most common form in match commentary — "in der 71." =
 * dative). Falls back to nominative-like suffix for other contexts
 * if needed, but in our pipeline we always want dative because the
 * surrounding regex matches dative-likely patterns.
 *
 * @param {number} n
 * @returns {string}
 *
 * @example
 *   ordinalDative(71); // → "einundsiebzigsten"
 *   ordinalDative(7);  // → "siebten"
 *   ordinalDative(1);  // → "ersten"
 *   ordinalDative(20); // → "zwanzigsten"
 */
export function ordinalDative(n) {
	if (!Number.isInteger(n) || n < 1 || n > 199) return String(n);
	if (ORDINAL_SPECIAL_DATIVE[n]) return ORDINAL_SPECIAL_DATIVE[n];
	const card = cardinal(n);
	return n < 20 ? `${card}ten` : `${card}sten`;
}

/**
 * Rewrite all minute references in a chunk of reporter text into
 * pronunciation-friendly word form. Designed to be idempotent for
 * already-written-out words — the regex only matches numeric
 * patterns.
 *
 * Patterns handled (longer/more specific first to avoid partial
 * replacements):
 *   "X. Minute"     → "<ordinal-dative> Minute"
 *   "in der X."     → "in der <ordinal-dative>"
 *   "(?<!in )der X." → "der <ordinal-dative>"
 *   "Minute X"      → "Minute <cardinal>"
 *
 * @param {string|null|undefined} text
 * @returns {string}
 *
 * @example
 *   convertOrdinalsForSpeech("BlackIVmaniac trifft in der 71. Minute");
 *   // → "BlackIVmaniac trifft in der einundsiebzigsten Minute"
 *
 *   convertOrdinalsForSpeech("Marco in der 31., dann FlorAIn in der 78.");
 *   // → "Marco in der einunddreißigsten, dann FlorAIn in der achtundsiebzigsten"
 */
export function convertOrdinalsForSpeech(text) {
	if (!text || typeof text !== "string") return "";
	let out = text;

	out = out.replace(/\b(\d{1,3})\.\s+(Minute)\b/g, (_match, n, word) => {
		const num = Number.parseInt(n, 10);
		return `${ordinalDative(num)} ${word}`;
	});

	out = out.replace(/\bin der (\d{1,3})\.(?!\s*Minute)/gi, (_match, n) => {
		const num = Number.parseInt(n, 10);
		return `in der ${ordinalDative(num)}`;
	});

	out = out.replace(/(?<!in )\bder (\d{1,3})\.(?!\s*Minute)/g, (_match, n) => {
		const num = Number.parseInt(n, 10);
		return `der ${ordinalDative(num)}`;
	});

	out = out.replace(/\bMinute (\d{1,3})\b/g, (_match, n) => {
		const num = Number.parseInt(n, 10);
		return `Minute ${cardinal(num)}`;
	});

	return out;
}

/**
 * Convert football-style score expressions "X:Y" into spoken form
 * "<cardinal-X> zu <cardinal-Y>". ElevenLabs otherwise pronounces
 * "2:0" as "zwei punkt null" or — worse — "2 pnt 0". Restricted to
 * single- and double-digit scores so timestamps or other colon-
 * separated values would only be touched if they happen to look
 * like scores; in practice scores rarely exceed 20.
 *
 * @param {string|null|undefined} text
 * @returns {string}
 *
 * @example
 *   convertScoresForSpeech("Es endet 3:2 nach Verlängerung.");
 *   // → "Es endet drei zu zwei nach Verlängerung."
 */
export function convertScoresForSpeech(text) {
	if (!text || typeof text !== "string") return "";
	return text.replace(/\b(\d{1,2}):(\d{1,2})\b/g, (match, a, b) => {
		const na = Number.parseInt(a, 10);
		const nb = Number.parseInt(b, 10);
		if (na > 20 || nb > 20) return match;
		return `${cardinal(na)} zu ${cardinal(nb)}`;
	});
}

/**
 * Convert game-mode shorthand like "2v2" or "1v1" into spoken form
 * "zwei gegen zwei" / "eins gegen eins". ElevenLabs reads the "v"
 * as English "vee" otherwise. Matches digit-v-digit only (no "vs"
 * spelled out — that already spreads naturally in German).
 *
 * @param {string|null|undefined} text
 * @returns {string}
 *
 * @example
 *   convertGameModeForSpeech("Ein 2v2 auf dem virtuellen Rasen");
 *   // → "Ein zwei gegen zwei auf dem virtuellen Rasen"
 */
export function convertGameModeForSpeech(text) {
	if (!text || typeof text !== "string") return "";
	return text.replace(
		/\b(\d{1,2})\s*v(?:s\.?)?\s*(\d{1,2})\b/gi,
		(match, a, b) => {
			const na = Number.parseInt(a, 10);
			const nb = Number.parseInt(b, 10);
			if (na > 11 || nb > 11) return match;
			return `${cardinal(na)} gegen ${cardinal(nb)}`;
		},
	);
}

/**
 * Normalise typographic punctuation that confuses ElevenLabs. Em-
 * dashes ("—"), en-dashes ("–") and stand-alone hyphens used as
 * dashes (" - ") all become commas — that gives the TTS a clean
 * natural pause instead of trying to articulate the dash as "minus"
 * or fumbling through it. Hyphens INSIDE compound words (e.g.
 * "Black-Four-Maniac" from the pronunciation map) are preserved
 * because the regex requires whitespace on both sides.
 *
 * @param {string|null|undefined} text
 * @returns {string}
 *
 * @example
 *   normalizePunctuationForSpeech("Brett — vom anderen Stern");
 *   // → "Brett, vom anderen Stern"
 *
 *   normalizePunctuationForSpeech("Black-Four-Maniac legt auf");
 *   // → "Black-Four-Maniac legt auf"   (compound hyphens preserved)
 */
export function normalizePunctuationForSpeech(text) {
	if (!text || typeof text !== "string") return "";
	return text
		.replace(/\s*[—–]\s*/g, ", ")
		.replace(/\s+-\s+/g, ", ")
		.replace(/,\s*,/g, ",")
		.replace(/\s+([,.!?])/g, "$1")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

/**
 * Umbrella helper: prepare a German reporter text for TTS by
 * converting ordinals, scores, game-mode shorthand and typographic
 * dashes into spoken forms. This is what the audio-rendering
 * services call — keeping the individual functions exported for
 * unit-testability.
 *
 * Order matters: punctuation normalisation runs first so that
 * "Es endet 2:0 — Dortmund verdient" becomes
 * "Es endet 2:0, Dortmund verdient" before the score-to-words step
 * sees the digits — otherwise the em-dash would survive into the
 * audio output.
 *
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function prepareTextForSpeech(text) {
	return convertGameModeForSpeech(
		convertScoresForSpeech(
			convertOrdinalsForSpeech(normalizePunctuationForSpeech(text)),
		),
	);
}
