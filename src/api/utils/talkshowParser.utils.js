/**
 * Parser for the talk-show drehbuch produced by the LLM. The model
 * emits a script in the form:
 *
 *     [MARCEL] Willkommen zur Bürowoche…
 *     [SOPHIE] Aus statistischer Sicht…
 *     [FRANK] Meine Güte, Leute…
 *
 * This util turns that into a clean turn list the TTS pipeline can
 * iterate over — one ElevenLabs call per turn, then concatenate.
 */

const SPEAKER_TAG_PATTERN = /\[(MARCEL|SOPHIE|FRANK)\]\s*/g;

const SPEAKER_TO_REPORTER_ID = {
	MARCEL: "klassiker",
	SOPHIE: "analyst",
	FRANK: "euphoriker",
};

/**
 * Split the raw LLM script into ordered speaker turns. Drops any text
 * before the first speaker tag (LLM preamble) and collapses
 * whitespace inside turn text.
 *
 * @param {string|null|undefined} script - Raw LLM output.
 * @returns {Array<{ speaker: "MARCEL"|"SOPHIE"|"FRANK", reporter_id: "klassiker"|"analyst"|"euphoriker", text: string }>}
 *
 * @example
 *   parseTalkshowScript("[MARCEL] Hallo. [SOPHIE] Danke Marcel.");
 *   // → [{ speaker: "MARCEL", reporter_id: "klassiker", text: "Hallo." },
 *   //    { speaker: "SOPHIE", reporter_id: "analyst",  text: "Danke Marcel." }]
 */
export function parseTalkshowScript(script) {
	if (!script || typeof script !== "string") return [];

	const matches = [...script.matchAll(SPEAKER_TAG_PATTERN)];
	if (matches.length === 0) return [];

	const turns = [];
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const speaker = match[1];
		const startIdx = match.index + match[0].length;
		const endIdx =
			i + 1 < matches.length ? matches[i + 1].index : script.length;
		const rawText = script.slice(startIdx, endIdx);
		const text = rawText.replace(/\s+/g, " ").trim();
		if (!text) continue;
		turns.push({
			speaker,
			reporter_id: SPEAKER_TO_REPORTER_ID[speaker],
			text,
		});
	}
	return turns;
}

/**
 * Word-count helper for turn-length validation. Counts whitespace-
 * separated tokens after stripping audio direction tags. Used by the
 * generator to verify the LLM stayed within the target band.
 *
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
	if (!text) return 0;
	return text
		.replace(/\[[^\]\n]+\]/g, "")
		.trim()
		.split(/\s+/)
		.filter(Boolean).length;
}

/**
 * Summarise a parsed turn list: total turns, total word count and a
 * per-speaker word breakdown. Lets the API surface or logs report
 * "Sophie 110 / Marcel 180 / Frank 150" without callers re-walking
 * the array.
 *
 * @param {Array<{speaker:string,text:string}>} turns
 * @returns {{ total_words: number, total_turns: number, by_speaker: Record<string,{turns:number,words:number}> }}
 */
export function summariseScript(turns) {
	const bySpeaker = {};
	let totalWords = 0;
	for (const t of turns) {
		const words = countWords(t.text);
		totalWords += words;
		if (!bySpeaker[t.speaker]) bySpeaker[t.speaker] = { turns: 0, words: 0 };
		bySpeaker[t.speaker].turns += 1;
		bySpeaker[t.speaker].words += words;
	}
	return {
		total_words: totalWords,
		total_turns: turns.length,
		by_speaker: bySpeaker,
	};
}
