/**
 * Central tuning constants for the player-profile computation layer.
 *
 * Like `ELO_CONSTANTS`, this file is the single source of truth for
 * thresholds, windows and cache parameters. Changing a value here
 * changes the behaviour for all axis calculations and archetype
 * decisions. If the change is semantic (different decision-tree
 * thresholds, different rolling window etc.), bump
 * `PROFILE_ALGORITHM_VERSION` so cached profile snapshots stay
 * traceable to the constants they were computed with.
 */

/**
 * @typedef {object} ProfileConstants
 * @property {number} rollingMatchWindow - Number of recent matches that feed into every axis.
 * @property {number} freshmanMaxMatches - Inclusive upper bound for the "Frischling" state.
 * @property {number} developingMaxMatches - Inclusive upper bound for the "Im Aufbau" state.
 * @property {number} clutchLateGameThreshold - Fraction of match time above which actions count as "Schlussphase".
 * @property {number} clutchLateGameBonus - Multiplier applied to actions in the Schlussphase.
 * @property {number} disciplineCardBaseMalus - Multiplier on the red-card penalty.
 * @property {number} winnerMinPartnerMatches - Min. joint matches before a partner counts in the Winner axis.
 * @property {number} noPlaymakerFloor - Reserved for league-wide assist drought.
 * @property {number} profileCacheTtlSeconds - Lifetime of the cached profile.
 * @property {number} bioRegenerateAfterMatches - Re-generate the LLM bio after this many fresh matches.
 * @property {boolean} bioRegenerateOnArchetypeChange - Re-generate the bio whenever the base archetype flips.
 */

/** @type {ProfileConstants} */
export const PROFILE_CONSTANTS = Object.freeze({
	rollingMatchWindow: 30,

	freshmanMaxMatches: 4,
	developingMaxMatches: 14,

	clutchLateGameThreshold: 0.85,
	clutchLateGameBonus: 1.5,

	disciplineCardBaseMalus: 1.0,

	winnerMinPartnerMatches: 3,

	noPlaymakerFloor: 5,

	profileCacheTtlSeconds: 3600,

	bioRegenerateAfterMatches: 5,
	bioRegenerateOnArchetypeChange: true,
});

/**
 * Algorithm version stamped onto every cached profile so we can
 * detect stale caches after constants or decision-tree changes.
 */
export const PROFILE_ALGORITHM_VERSION = "v1.0";
