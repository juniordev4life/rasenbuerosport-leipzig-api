/**
 * Playmaker axis — assists per match, percentile-normalised against
 * the league. If the entire league has zero recorded assists (early
 * days of an installation), every player receives the neutral
 * midpoint 50 rather than 0.
 */

import { computePercentileRank } from "../percentile.utils.js";

function assistsPerMatch(history) {
	if (!history || !history.matchCount) return 0;
	return history.totalAssists / history.matchCount;
}

/**
 * Compute the Playmaker axis value (0–100) for a player.
 *
 * @param {import("./finisher.services.js").PlayerMatchHistory} history
 * @param {import("./finisher.services.js").LeaguePlayer[]} leaguePlayers
 * @returns {number}
 *
 * @example
 *   computePlaymakerAxis(historyWith8Assists30Matches, league);
 *   // → percentile of (8/30 = 0.27) against the league assist-rates
 */
export function computePlaymakerAxis(history, leaguePlayers) {
	const value = assistsPerMatch(history);
	const population = (leaguePlayers ?? [])
		.map((p) => assistsPerMatch(p?.matches))
		.filter((v) => Number.isFinite(v));

	const leagueMax = population.length > 0 ? Math.max(...population) : 0;
	if (leagueMax === 0) {
		// Nobody in the league has any assists yet — neutral midpoint
		// rather than ranking everyone at 0.
		return 50;
	}

	return computePercentileRank(value, population);
}
