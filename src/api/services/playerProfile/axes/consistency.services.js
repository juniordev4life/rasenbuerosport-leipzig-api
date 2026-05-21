/**
 * Consistency axis — 1 − coefficient of variation of the player's
 * contribution score across the last N matches. Low coefficient of
 * variation means low spread → high consistency.
 *
 * Raw value is in [0, 1]; we percentile-rank it across the league so
 * the league's most consistent player anchors at 100 and the most
 * volatile at 0. Players with too few data points (< 3 matches in
 * the rolling window) get a raw 0 — too small a sample to make a
 * consistency claim.
 */

import { computePercentileRank } from "../percentile.utils.js";

/**
 * Compute the raw consistency value (in [0, 1]) for a single
 * history. Exported for testing.
 *
 * @param {import("./finisher.services.js").PlayerMatchHistory} history
 * @returns {number}
 */
export function computeRawConsistency(history) {
	if (!history) return 0;
	const scores = Array.isArray(history.contributionScoresPerMatch)
		? history.contributionScoresPerMatch.filter((s) => Number.isFinite(s))
		: [];
	if (scores.length < 3) return 0;

	const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
	if (mean <= 0) return 0;

	const variance =
		scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length;
	const stdDev = Math.sqrt(variance);
	const coefficientOfVariation = stdDev / mean;

	// Map cv=0 → 1, cv=2 → 0, cap below.
	return Math.max(0, 1 - coefficientOfVariation / 2);
}

/**
 * Compute the Consistency axis value (0–100) for a player.
 *
 * @param {import("./finisher.services.js").PlayerMatchHistory} history
 * @param {import("./finisher.services.js").LeaguePlayer[]} leaguePlayers
 * @returns {number}
 */
export function computeConsistencyAxis(history, leaguePlayers) {
	const value = computeRawConsistency(history);
	const population = (leaguePlayers ?? [])
		.map((p) => computeRawConsistency(p?.matches))
		.filter((v) => Number.isFinite(v));
	return computePercentileRank(value, population);
}
