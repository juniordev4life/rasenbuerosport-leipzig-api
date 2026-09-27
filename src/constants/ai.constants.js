/**
 * The Claude model every AI feature uses, and the three request presets.
 *
 * Claude Sonnet 5 thinks adaptively unless told otherwise, so every call
 * spreads one preset instead of passing `model` alone:
 *  - AI_FAST: thinking off — short structured answers where latency matters
 *    (live voice commands, the profile bio).
 *  - AI_LIGHT: adaptive thinking at low effort — short texts (prediction,
 *    weekly recap, match of the week, season summary).
 *  - AI_THOROUGH: adaptive thinking at medium effort, roughly Sonnet 4.6 at
 *    its default — match reports, talk-show scripts, screenshot extraction.
 *
 * Sonnet 5 rejects temperature/top_p/top_k and assistant prefills, and a
 * response may start with a thinking block: read the answer with
 * `firstTextOf()` from ai.helpers.js, never `content[0].text`. Its tokenizer
 * counts ~30% more tokens than Sonnet 4.6, so size `max_tokens` with room
 * for thinking.
 */

/** Model id of every Claude call. */
export const CLAUDE_MODEL = "claude-sonnet-5";

/** Thinking off, for fast short answers. */
export const AI_FAST = Object.freeze({
	model: CLAUDE_MODEL,
	thinking: { type: "disabled" },
});

/** Adaptive thinking at low effort, for short texts. */
export const AI_LIGHT = Object.freeze({
	model: CLAUDE_MODEL,
	thinking: { type: "adaptive" },
	output_config: { effort: "low" },
});

/** Adaptive thinking at medium effort, for long texts and image extraction. */
export const AI_THOROUGH = Object.freeze({
	model: CLAUDE_MODEL,
	thinking: { type: "adaptive" },
	output_config: { effort: "medium" },
});
