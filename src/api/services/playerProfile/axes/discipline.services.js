/**
 * Discipline axis — players are ranked on how few red-card minutes
 * they accumulate. Lower raw penalty = better discipline.
 *
 * Per-match penalty contribution per red card:
 *   penalty = 1 − (cardMinute / matchMinutes)
 * → early red ≈ 0.9 (almost full), late red ≈ 0.1 (almost free).
 *
 * The raw penalty is summed over the window, divided by matchCount,
 * then percentile-inverted across the league so the cleanest player
 * gets 100 and the dirtiest 0.
 */

import { computePercentileRank } from "../percentile.utils.js";

/**
 * Compute the raw discipline penalty (lower = cleaner). Exported for
 * testing.
 *
 * @param {import("./finisher.services.js").PlayerMatchHistory} history
 * @returns {number}
 */
export function computeRawDisciplinePenalty(history) {
	if (!history || !history.matchCount) return 0;
	const cards = Array.isArray(history.redCards) ? history.redCards : [];
	let total = 0;
	for (const card of cards) {
		const matchMinutes = Number(card?.matchMinutes);
		const minute = Number(card?.minute);
		if (!Number.isFinite(matchMinutes) || matchMinutes <= 0) continue;
		if (!Number.isFinite(minute) || minute < 0) continue;
		const timeFactor = Math.max(0, 1 - minute / matchMinutes);
		total += timeFactor;
	}
	return total / history.matchCount;
}

/**
 * Compute the Discipline axis value (0–100) for a player.
 *
 * Inverts the percentile rank because the underlying signal is
 * "lower is better": the player with the smallest penalty becomes
 * the 100th percentile of discipline.
 *
 * @param {import("./finisher.services.js").PlayerMatchHistory} history
 * @param {import("./finisher.services.js").LeaguePlayer[]} leaguePlayers
 * @returns {number}
 */
export function computeDisciplineAxis(history, leaguePlayers) {
	const value = computeRawDisciplinePenalty(history);
	const population = (leaguePlayers ?? [])
		.map((p) => computeRawDisciplinePenalty(p?.matches))
		.filter((v) => Number.isFinite(v));
	const rank = computePercentileRank(value, population);
	return 100 - rank;
}
