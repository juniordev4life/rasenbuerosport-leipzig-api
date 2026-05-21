/**
 * Deterministic decision tree that maps the six axis values onto one
 * of the canonical base archetypes. The rules are checked in order;
 * the first one to match wins. Specific patterns (Hitzkopf, Carrier,
 * Spätzünder) precede broad ones (Vollstrecker, Allrounder) so they
 * are not accidentally swallowed.
 *
 * Same inputs ⇒ same archetype. The flavor adjective + bio in the
 * UI come from the LLM layer, but the underlying category is stable.
 *
 * Exports `determineArchetype(axes)` plus the helpers
 * `isBalanced` / `isMidRange` for unit-testing.
 */

import { ARCHETYPE_KEYS } from "../../../constants/profileArchetypes.constants.js";

/**
 * @typedef {object} AxisValues
 * @property {number} finisher
 * @property {number} playmaker
 * @property {number} clutch
 * @property {number} consistency
 * @property {number} discipline
 * @property {number} winner
 */

/**
 * @param {number[]} values
 * @param {number} maxSpread
 * @returns {boolean}
 */
export function isBalanced(values, maxSpread) {
	if (!Array.isArray(values) || values.length === 0) return false;
	return Math.max(...values) - Math.min(...values) <= maxSpread;
}

/**
 * @param {number[]} values
 * @param {number} min
 * @param {number} max
 * @returns {boolean}
 */
export function isMidRange(values, min, max) {
	if (!Array.isArray(values) || values.length === 0) return false;
	return values.every((v) => v >= min && v <= max);
}

const FALLBACK_BY_DOMINANT_AXIS = {
	finisher: "vollstrecker",
	playmaker: "taktgeber",
	clutch: "spaetzuender",
	consistency: "zuverlaessige",
	discipline: "zuverlaessige",
	winner: "carrier",
};

/**
 * Pick the archetype matching the dominant axis when no rule
 * pattern matches. Final safety net so the function always returns
 * a known archetype key.
 *
 * @param {AxisValues} axes
 * @returns {string}
 */
export function determineArchetypeByDominantAxis(axes) {
	const entries = Object.entries(axes).sort(([, a], [, b]) => b - a);
	const [topAxis] = entries[0];
	return FALLBACK_BY_DOMINANT_AXIS[topAxis] ?? "allrounder";
}

/**
 * Decide the base archetype for a player from their six axis values.
 *
 * @param {AxisValues} axes
 * @returns {string} A key from `ARCHETYPE_KEYS`.
 *
 * @example
 *   determineArchetype({
 *     finisher: 92, playmaker: 35, clutch: 85,
 *     consistency: 40, discipline: 60, winner: 70,
 *   });
 *   // → "vollstrecker"
 *
 * @example
 *   determineArchetype({
 *     finisher: 88, playmaker: 30, clutch: 70,
 *     consistency: 50, discipline: 22, winner: 55,
 *   });
 *   // → "hitzkopf"  (Finisher hoch + Discipline kritisch)
 */
export function determineArchetype(axes) {
	const { finisher, playmaker, clutch, consistency, discipline, winner } =
		axes ?? {};
	const allDefined = [
		finisher,
		playmaker,
		clutch,
		consistency,
		discipline,
		winner,
	].every((v) => Number.isFinite(v));
	if (!allDefined) return "allrounder";

	// 1. Hitzkopf — Finisher hoch, Discipline auffällig niedrig.
	if (finisher >= 70 && discipline <= 30) return "hitzkopf";

	// 2. Carrier — Winner deutlich höher als Finisher und Playmaker.
	if (winner >= 75 && winner - Math.max(finisher, playmaker) >= 20) {
		return "carrier";
	}

	// 3. Spätzünder — Clutch deutlich höher als Finisher.
	if (clutch >= 70 && clutch - finisher >= 25) return "spaetzuender";

	// 4. Vollstrecker — Finisher und Clutch beide hoch.
	if (finisher >= 70 && clutch >= 65) return "vollstrecker";

	// 5. Stratege — Playmaker hoch + Consistency hoch + Discipline hoch.
	if (playmaker >= 70 && consistency >= 65 && discipline >= 60) {
		return "stratege";
	}

	// 6. Taktgeber — Playmaker hoch, alle anderen Werte ausgeglichen.
	if (
		playmaker >= 65 &&
		isBalanced([finisher, clutch, consistency, discipline, winner], 25)
	) {
		return "taktgeber";
	}

	// 7. Zuverlässige — Consistency hoch, alle anderen mittel.
	if (
		consistency >= 70 &&
		isMidRange([finisher, playmaker, clutch, discipline, winner], 30, 70)
	) {
		return "zuverlaessige";
	}

	// 8. Allrounder — alle Achsen 45–75, kein Höhepunkt.
	if (
		isMidRange(
			[finisher, playmaker, clutch, consistency, discipline, winner],
			45,
			75,
		)
	) {
		return "allrounder";
	}

	return determineArchetypeByDominantAxis(axes);
}

/**
 * Defensive utility: confirm a candidate string is one of the known
 * archetype keys. Used at boundaries (LLM output, DB rows) to fail
 * fast on typos / drift.
 *
 * @param {unknown} key
 * @returns {boolean}
 */
export function isKnownArchetype(key) {
	return typeof key === "string" && ARCHETYPE_KEYS.includes(key);
}
