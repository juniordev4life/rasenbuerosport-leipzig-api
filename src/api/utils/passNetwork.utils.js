/**
 * Pass-network indicators extracted from the Pässe screenshot.
 *
 * The AI extractor returns one indicators object per team (home /
 * away). We never trust LLM output for downstream consumers without
 * a validation pass — `normalisePassNetwork` enforces the bounds
 * and label vocabulary defined by the spec, returning `null` when
 * the LLM hallucinated something off-schema. This keeps the audio
 * report and future duo aggregation safe from out-of-range values.
 */

const LATERALITY_LABELS = ["links", "rechts", "symmetrisch"];
const VERTICALITY_LABELS = ["zentral", "flügel", "gemischt"];

/**
 * Clamp a numeric score to the given bounds, returning `null` for
 * anything that is not a finite number.
 *
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number|null}
 */
function clamp(value, min, max) {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.max(min, Math.min(max, value));
}

/**
 * Derive the canonical laterality label from a numeric score, using
 * the same thresholds the extraction prompt asks the LLM to apply.
 *
 * @param {number} score
 * @returns {"links"|"rechts"|"symmetrisch"}
 */
function lateralityFromScore(score) {
	if (score <= -60) return "links";
	if (score >= 60) return "rechts";
	return "symmetrisch";
}

/**
 * Derive the canonical verticality label from a numeric score.
 *
 * @param {number} score
 * @returns {"zentral"|"flügel"|"gemischt"}
 */
function verticalityFromScore(score) {
	if (score >= 70) return "zentral";
	if (score <= 30) return "flügel";
	return "gemischt";
}

/**
 * Validate and normalise one team's pass-network indicators object.
 *
 * Returns `null` when:
 *   - the input is missing or not an object
 *   - both scores are null/non-numeric (no usable signal)
 *
 * When valid: the returned object has clamped scores, canonical
 * labels (derived from scores so we cannot drift), a trimmed
 * `centralPlayer` string and at most 3 connection entries. Any
 * field the LLM left unset or invalid becomes `null` in the
 * returned object.
 *
 * @param {unknown} raw - The AI-extracted indicators block.
 * @returns {object|null}
 *
 * @example
 *   normalisePassNetwork({
 *     laterality: "rechts",
 *     verticality: "flügel",
 *     lateralityScore: 75,
 *     verticalityScore: 22,
 *     centralPlayer: "8",
 *     topPassConnections: [{ from: "8", to: "10" }],
 *   });
 *   // → { laterality: "rechts", verticality: "flügel",
 *   //     lateralityScore: 75, verticalityScore: 22,
 *   //     centralPlayer: "8", topPassConnections: [...] }
 */
export function normalisePassNetwork(raw) {
	if (!raw || typeof raw !== "object") return null;

	const lateralityScore = clamp(raw.lateralityScore, -100, 100);
	const verticalityScore = clamp(raw.verticalityScore, 0, 100);

	if (lateralityScore == null && verticalityScore == null) return null;

	const result = {
		laterality:
			lateralityScore != null ? lateralityFromScore(lateralityScore) : null,
		verticality:
			verticalityScore != null ? verticalityFromScore(verticalityScore) : null,
		lateralityScore,
		verticalityScore,
		centralPlayer: null,
		topPassConnections: [],
	};

	if (typeof raw.centralPlayer === "string" && raw.centralPlayer.trim()) {
		result.centralPlayer = raw.centralPlayer.trim();
	} else if (typeof raw.centralPlayer === "number") {
		result.centralPlayer = String(raw.centralPlayer);
	}

	if (Array.isArray(raw.topPassConnections)) {
		for (const entry of raw.topPassConnections) {
			if (!entry || typeof entry !== "object") continue;
			const from =
				typeof entry.from === "string"
					? entry.from.trim()
					: typeof entry.from === "number"
						? String(entry.from)
						: null;
			const to =
				typeof entry.to === "string"
					? entry.to.trim()
					: typeof entry.to === "number"
						? String(entry.to)
						: null;
			if (!from || !to) continue;
			result.topPassConnections.push({ from, to });
			if (result.topPassConnections.length === 3) break;
		}
	}

	return result;
}

/**
 * Helpers exported for unit-testing the label derivation in
 * isolation. Not part of the public API.
 */
export const __test__ = {
	lateralityFromScore,
	verticalityFromScore,
	LATERALITY_LABELS,
	VERTICALITY_LABELS,
};
