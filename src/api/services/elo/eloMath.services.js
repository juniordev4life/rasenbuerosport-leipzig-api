/**
 * Core ELO math — pure functions, no side effects, no I/O.
 *
 * These are the building blocks the engine composes into a full
 * match-level ELO computation. Every function takes plain numbers,
 * returns plain numbers, and is independently testable.
 *
 * Reference: World Football Elo Ratings extended with a contribution
 * layer. The classical formulas (expected score on base 10 / scale
 * 400, K-factor scaling) are unchanged; the only addition vs.
 * textbook ELO is the goal-difference margin factor.
 */

import { ELO_CONSTANTS } from "../../../constants/elo.constants.js";

/**
 * Clamp a value to a closed numeric interval.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

/**
 * Compute a team's combined rating as the arithmetic mean of its
 * players' individual ratings. Works for 1v1 (single-element input)
 * and 2v2 alike.
 *
 * @param {number[]} playerRatings
 * @returns {number}
 *
 * @example
 *   computeTeamRating([1500, 1500]); // → 1500
 *   computeTeamRating([1600, 1400]); // → 1500
 *   computeTeamRating([1700]);       // → 1700  (1v1)
 */
export function computeTeamRating(playerRatings) {
	if (!Array.isArray(playerRatings) || playerRatings.length === 0) {
		return ELO_CONSTANTS.startingRating;
	}
	const sum = playerRatings.reduce((acc, r) => acc + r, 0);
	return sum / playerRatings.length;
}

/**
 * Classical ELO expected-score formula on base 10 / scale 400.
 * Returns a value in [0, 1] — the probability of team A winning
 * against team B based on their rating gap.
 *
 * @param {number} ratingA
 * @param {number} ratingB
 * @returns {number}
 *
 * @example
 *   computeExpectedScore(1500, 1500); // → 0.5
 *   computeExpectedScore(1700, 1500); // → ~0.76
 *   computeExpectedScore(1300, 1500); // → ~0.24
 */
export function computeExpectedScore(ratingA, ratingB) {
	return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * Margin-of-victory factor following the World Football ELO recipe:
 * a larger goal difference scales ELO movement up logarithmically,
 * but when the favourite wins as expected the bonus is dampened by
 * the rating gap. Returns 0 for a draw so draw-paths can short-
 * circuit downstream.
 *
 * @param {number} goalDifference - Absolute goal difference (always >= 0).
 * @param {number} ratingDifference - Rating gap from the winner's perspective; can be negative when the underdog wins.
 * @returns {number}
 *
 * @example
 *   computeMarginFactor(0, 0);    // → 0  (draw)
 *   computeMarginFactor(1, 0);    // → ln(2) * 1.0 ≈ 0.693
 *   computeMarginFactor(5, 0);    // → ln(6) * 1.0 ≈ 1.792
 *   computeMarginFactor(3, 200);  // dampened because favourite winning
 */
export function computeMarginFactor(goalDifference, ratingDifference) {
	if (!Number.isFinite(goalDifference) || goalDifference === 0) return 0;
	const absDiff = Math.abs(goalDifference);
	const dampening = 2.2 / (Math.abs(ratingDifference) * 0.001 + 2.2);
	return Math.log(absDiff + 1) * dampening;
}

/**
 * Team-level ELO delta (positive = team gains, negative = team loses).
 * Combines the standard K-factor scaling with the margin multiplier.
 *
 * @param {object} params
 * @param {number} params.kFactor
 * @param {number} params.marginFactor
 * @param {number} params.actualScore - 1 (win), 0.5 (draw), 0 (loss).
 * @param {number} params.expectedScore - From `computeExpectedScore`.
 * @returns {number}
 *
 * @example
 *   computeTeamDelta({
 *     kFactor: 32, marginFactor: 1.1,
 *     actualScore: 1, expectedScore: 0.5,
 *   }); // → 17.6
 */
export function computeTeamDelta({
	kFactor,
	marginFactor,
	actualScore,
	expectedScore,
}) {
	return kFactor * marginFactor * (actualScore - expectedScore);
}

/**
 * Resolve the K-factor for a player based on how many matches they
 * have already played. New players move faster so they sort into the
 * league quickly; established players move slower so their rating is
 * stable.
 *
 * @param {number} matchesPlayed - Match count BEFORE the current match.
 * @returns {number}
 *
 * @example
 *   resolveKFactor(5);  // → 48 (new)
 *   resolveKFactor(50); // → 32 (established)
 */
export function resolveKFactor(matchesPlayed) {
	if (!Number.isFinite(matchesPlayed) || matchesPlayed < 0) {
		return ELO_CONSTANTS.kFactorNewPlayer;
	}
	return matchesPlayed < ELO_CONSTANTS.newPlayerThreshold
		? ELO_CONSTANTS.kFactorNewPlayer
		: ELO_CONSTANTS.kFactor;
}
