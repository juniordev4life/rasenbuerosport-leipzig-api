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
 * Canonical five-state pass-distribution classification used for UI
 * tags and downstream aggregation. Derived deterministically from
 * the two numeric scores so the same input always produces the same
 * label.
 *
 * @type {ReadonlyArray<"Zentral"|"Rechtslastig"|"Linkslastig"|"Ausgewogen"|"Flügelspiel">}
 */
export const PASS_STYLES = [
	"Zentral",
	"Rechtslastig",
	"Linkslastig",
	"Ausgewogen",
	"Flügelspiel",
];

/**
 * Classify a pair of pass-network scores into one of the five
 * canonical states. Lateral dominance trumps verticality — a team
 * that runs everything down one flank is "Linkslastig" or
 * "Rechtslastig", regardless of where on the field the action
 * happens. Only when laterality is balanced do we look at
 * verticality. Anything else is "Ausgewogen".
 *
 * Thresholds match the same bounds used by the LLM-side prompt so
 * label decisions cannot drift between layers:
 *   |lateralityScore| ≥ 60  → Links- or Rechtslastig
 *   verticalityScore  ≥ 70  → Zentral
 *   verticalityScore  ≤ 30  → Flügelspiel
 *   otherwise              → Ausgewogen
 *
 * @param {number|null} lateralityScore  -100..+100 or null
 * @param {number|null} verticalityScore 0..100 or null
 * @returns {"Zentral"|"Rechtslastig"|"Linkslastig"|"Ausgewogen"|"Flügelspiel"|null}
 *
 * @example
 *   derivePassStyle(75, 50);  // → "Rechtslastig"
 *   derivePassStyle(-80, 80); // → "Linkslastig"
 *   derivePassStyle(0, 85);   // → "Zentral"
 *   derivePassStyle(20, 22);  // → "Flügelspiel"
 *   derivePassStyle(10, 55);  // → "Ausgewogen"
 *   derivePassStyle(null, null); // → null
 */
export function derivePassStyle(lateralityScore, verticalityScore) {
	if (lateralityScore == null && verticalityScore == null) return null;
	if (lateralityScore != null) {
		if (lateralityScore <= -60) return "Linkslastig";
		if (lateralityScore >= 60) return "Rechtslastig";
	}
	if (verticalityScore != null) {
		if (verticalityScore >= 70) return "Zentral";
		if (verticalityScore <= 30) return "Flügelspiel";
	}
	return "Ausgewogen";
}

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
		passStyle: derivePassStyle(lateralityScore, verticalityScore),
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
 * Build the UI-facing pass-style tag list for a single team. With
 * the canonical five-state model this is currently a one-element
 * array (the team's `passStyle`), but the array shape keeps the
 * door open for additional pass-related tags later (e.g. "Hohe
 * Konsistenz" once duo aggregation lands in Phase 2).
 *
 * Returns an empty array when the indicators are null or carry no
 * usable signal — the UI then simply shows no tag rather than a
 * placeholder.
 *
 * @param {object|null} indicators - Output of normalisePassNetwork.
 * @returns {string[]}
 *
 * @example
 *   generatePassNetworkTags({
 *     passStyle: "Rechtslastig",
 *     lateralityScore: 75,
 *     verticalityScore: 22,
 *     ...
 *   });
 *   // → ["Rechtslastig"]
 *
 *   generatePassNetworkTags(null);
 *   // → []
 */
export function generatePassNetworkTags(indicators) {
	if (!indicators || !indicators.passStyle) return [];
	return [indicators.passStyle];
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
