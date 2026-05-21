/**
 * Pronunciation overrides applied before sending a reporter comment to
 * ElevenLabs TTS. ElevenLabs' multilingual v3 model occasionally
 * butchers unusual usernames; this map rewrites them to a phonetic
 * spelling that the engine pronounces reliably.
 *
 * Only add entries when ElevenLabs actually mispronounces the name —
 * over-mapping makes the audio sound robotic. Test with the live
 * voice before adding.
 *
 * Keys are matched **case-insensitively as whole words** to avoid
 * partial substitutions inside other words.
 */

/** @type {Record<string, string>} */
export const PLAYER_PRONUNCIATION = {
	BlackIVmaniac: "Black-Four-Maniac",
	Nikinho: "Nikkinjo",
	FlorAIn: "Florian",
};

/**
 * Apply the pronunciation map to a piece of reporter text. Whole-word,
 * case-insensitive replacement that preserves the original casing
 * boundaries.
 *
 * @param {string} text
 * @returns {string}
 *
 * @example
 *   applyPronunciation("BlackIVmaniac legt für Nikinho auf.");
 *   // → "Black-Vier-Maniac legt für Nikkinjo auf."
 */
export function applyPronunciation(text) {
	if (!text) return "";
	let out = text;
	for (const [from, to] of Object.entries(PLAYER_PRONUNCIATION)) {
		const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), to);
	}
	return out;
}
