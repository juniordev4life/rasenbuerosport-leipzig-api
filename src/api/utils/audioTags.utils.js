/**
 * Helpers for the reporter-style match report. The LLM emits inline
 * audio directives in square brackets (`[nachdenklich]`, `[seufzen]`,
 * `[Pause]`) that ElevenLabs interprets as mood / pacing cues. The DB
 * stores the raw text, but the API response strips the tags so the
 * frontend can render clean prose.
 */

const TAG_PATTERN = /\[[^\]\n]+\]/g;

/**
 * Remove ElevenLabs-style audio direction tags (`[tag]`) from a reporter
 * comment so it can be rendered as plain text. Collapses double spaces
 * and trims leftover whitespace around punctuation.
 *
 * @param {string|null|undefined} text
 * @returns {string} The text without `[…]` tags, normalised whitespace.
 *
 * @example
 *   stripAudioTags("[nachdenklich] Zwei zu vier. [seufzen] Tja.");
 *   // → "Zwei zu vier. Tja."
 */
export function stripAudioTags(text) {
	if (!text) return "";
	return text
		.replace(TAG_PATTERN, "")
		.replace(/[ \t]+/g, " ")
		.replace(/ +([,.!?…])/g, "$1")
		.replace(/\n[ \t]+/g, "\n")
		.trim();
}
