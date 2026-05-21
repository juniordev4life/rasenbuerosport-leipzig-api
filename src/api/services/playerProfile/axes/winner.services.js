/**
 * Winner axis — does the player improve their teammates? Compared
 * to alternatives like raw win-rate, this looks at the player's
 * win-rate against the average solo win-rate of the partners they
 * actually played with (weighted by joint matches).
 *
 * A "carrier" pulls weaker partners up: their win-rate is higher
 * than the partners' baseline → score > 1. A "buddy" only plays
 * with the league's best, looks good in raw wins, but ratio sits
 * around 1 (or below).
 *
 * Partners with fewer than `winnerMinPartnerMatches` joint matches
 * are ignored so a single random fixture cannot move the needle.
 */

import { PROFILE_CONSTANTS } from "../../../../constants/profile.constants.js";
import { computePercentileRank } from "../percentile.utils.js";

/**
 * Compute the raw winner score (a ratio, typically around 1.0).
 * Exported for testing.
 *
 * @param {import("./finisher.services.js").PlayerMatchHistory} history
 * @param {import("./finisher.services.js").LeaguePlayer[]} allPlayers
 * @returns {number}
 */
export function computeRawWinnerScore(history, allPlayers) {
	if (!history || !history.matchCount) return 0;
	const playerWinRate = history.wins / history.matchCount;

	const partners = Array.isArray(history.partners) ? history.partners : [];
	let weightedSum = 0;
	let totalWeight = 0;

	for (const stat of partners) {
		const matchesTogether = Number(stat?.matchesTogether);
		if (!Number.isFinite(matchesTogether)) continue;
		if (matchesTogether < PROFILE_CONSTANTS.winnerMinPartnerMatches) continue;

		const partner = (allPlayers ?? []).find(
			(p) => p?.playerId === stat?.playerId,
		);
		if (!partner || !partner.matches?.matchCount) continue;

		const partnerSoloWinRate =
			partner.matches.wins / partner.matches.matchCount;
		weightedSum += partnerSoloWinRate * matchesTogether;
		totalWeight += matchesTogether;
	}

	if (totalWeight === 0) {
		// No established partner relationships → neutral ratio.
		return 1.0;
	}
	const avgPartnerWinRate = weightedSum / totalWeight;
	if (avgPartnerWinRate === 0) {
		// Carrier with all-zero-winrate partners: cap at 2.0 so a single
		// blowout series doesn't run away.
		return 2.0;
	}

	return playerWinRate / avgPartnerWinRate;
}

/**
 * Compute the Winner axis value (0–100) for a player.
 *
 * @param {import("./finisher.services.js").PlayerMatchHistory} history
 * @param {import("./finisher.services.js").LeaguePlayer[]} leaguePlayers
 * @returns {number}
 */
export function computeWinnerAxis(history, leaguePlayers) {
	const value = computeRawWinnerScore(history, leaguePlayers);
	const population = (leaguePlayers ?? [])
		.map((p) => computeRawWinnerScore(p?.matches, leaguePlayers))
		.filter((v) => Number.isFinite(v));
	return computePercentileRank(value, population);
}
