/**
 * Finisher axis — goals per match, percentile-normalised against the
 * league. A "0 in the league means percentile is calibrated locally"
 * implementation: even the worst-scoring eligible player gets ≥ 0,
 * and the top scorer gets ≤ 100.
 */

import { computePercentileRank } from "../percentile.utils.js";

/**
 * @typedef {object} PlayerMatchHistory
 * @property {number} matchCount
 * @property {number} totalGoals
 * @property {number} totalAssists
 * @property {number} wins
 * @property {Array<{ minute: number, matchMinutes: number }>} redCards
 * @property {Array<{ type: "goal"|"assist", minute: number, matchMinutes: number }>} scoringEvents
 * @property {number[]} contributionScoresPerMatch
 * @property {Array<{ playerId: string, matchesTogether: number }>} partners
 */

/**
 * @typedef {object} LeaguePlayer
 * @property {string} playerId
 * @property {PlayerMatchHistory} matches
 */

function goalsPerMatch(history) {
	if (!history || !history.matchCount) return 0;
	return history.totalGoals / history.matchCount;
}

/**
 * Compute the Finisher axis value (0–100) for a player.
 *
 * @param {PlayerMatchHistory} history - Aggregated history of the player.
 * @param {LeaguePlayer[]} leaguePlayers - All players for percentile basis.
 * @returns {number}
 *
 * @example
 *   computeFinisherAxis(
 *     { matchCount: 30, totalGoals: 60 /* ... *\/ },
 *     [...leaguePlayers],
 *   );
 *   // → ~67  (if league median is ~1.5 goals/match)
 */
export function computeFinisherAxis(history, leaguePlayers) {
	const value = goalsPerMatch(history);
	const population = (leaguePlayers ?? [])
		.map((p) => goalsPerMatch(p?.matches))
		.filter((v) => Number.isFinite(v));
	return computePercentileRank(value, population);
}
