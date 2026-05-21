/**
 * Clutch axis — measures how much of a player's offensive impact
 * happens in the late phase of a match. Goals and assists in the
 * Schlussphase (last `clutchLateGameThreshold` of match time) get
 * a `clutchLateGameBonus` multiplier; everything in the second half
 * counts at base weight; first-half events don't count at all.
 *
 * The raw clutch score is then percentile-normalised across the
 * league so 100 means "most clutch player in the office", not "scored
 * X goals after minute 80".
 */

import { PROFILE_CONSTANTS } from "../../../../constants/profile.constants.js";
import { computePercentileRank } from "../percentile.utils.js";

/**
 * Compute the raw clutch score (weighted late-phase actions per match).
 * Exported for unit-testing the building block in isolation.
 *
 * @param {import("./finisher.services.js").PlayerMatchHistory} history
 * @returns {number}
 */
export function computeRawClutchScore(history) {
	if (!history || !history.matchCount) return 0;
	const events = Array.isArray(history.scoringEvents)
		? history.scoringEvents
		: [];
	let total = 0;
	for (const event of events) {
		const matchMinutes = Number(event?.matchMinutes);
		const minute = Number(event?.minute);
		if (!Number.isFinite(matchMinutes) || matchMinutes <= 0) continue;
		if (!Number.isFinite(minute)) continue;
		const relative = minute / matchMinutes;
		if (relative < 0.5) continue;
		const weight =
			relative >= PROFILE_CONSTANTS.clutchLateGameThreshold
				? PROFILE_CONSTANTS.clutchLateGameBonus
				: 1.0;
		const actionValue = event?.type === "assist" ? 0.5 : 1.0;
		total += actionValue * weight;
	}
	return total / history.matchCount;
}

/**
 * Compute the Clutch axis value (0–100) for a player.
 *
 * @param {import("./finisher.services.js").PlayerMatchHistory} history
 * @param {import("./finisher.services.js").LeaguePlayer[]} leaguePlayers
 * @returns {number}
 */
export function computeClutchAxis(history, leaguePlayers) {
	const value = computeRawClutchScore(history);
	const population = (leaguePlayers ?? [])
		.map((p) => computeRawClutchScore(p?.matches))
		.filter((v) => Number.isFinite(v));
	return computePercentileRank(value, population);
}
