/**
 * Contribution scoring — the layer that makes the ELO system fair
 * for 2v2 by valuing each player's individual share of the match.
 *
 * `computeContribution` produces a single number per player. The
 * baseline + goals/assists term is positive; red cards subtract a
 * time-weighted penalty (early red = big hit, late red = small hit).
 *
 * `computeTeamShares` converts a team's contribution scores into
 * normalised shares (sum = 1) that respect the configured min/max
 * bounds. Edge cases — degenerate inputs (all zero/negative
 * contributions, single-player team) — are handled explicitly.
 */

import { ELO_CONSTANTS } from "../../../constants/elo.constants.js";
import { clamp } from "./eloMath.services.js";

/**
 * @typedef {object} RedCardEvent
 * @property {number} minute - 1-based minute of the red card.
 */

/**
 * @typedef {object} PlayerMatchStats
 * @property {number} goals
 * @property {number} assists
 * @property {RedCardEvent[]} redCards
 */

/**
 * Compute a single player's contribution score for one match.
 *
 *   C = baseline
 *     + goals   * goalWeight
 *     + assists * assistWeight
 *     - sum_over_red_cards( redCardPenalty * timeFactor )
 *
 * The time factor for a red card in minute `m` of a `matchMinutes`-
 * long game is `(matchMinutes - m) / matchMinutes`. A red in minute
 * 1 of a 10-min match → factor 0.9 (almost the full penalty); a red
 * in minute 9 → factor 0.1 (almost no penalty).
 *
 * @param {PlayerMatchStats} stats
 * @param {number} matchMinutes - Total match duration; default 10.
 * @returns {number}
 *
 * @example
 *   computeContribution({ goals: 3, assists: 0, redCards: [] }, 10);
 *   // → 1.0 + 3*1.0 + 0*0.5 - 0 = 4.0
 *
 *   computeContribution(
 *     { goals: 1, assists: 2, redCards: [{ minute: 1 }] }, 10,
 *   );
 *   // → 1.0 + 1 + 1 - 2.0 * (9/10) = 1.2
 */
export function computeContribution(stats, matchMinutes = 10) {
	const goals = Number(stats?.goals ?? 0);
	const assists = Number(stats?.assists ?? 0);
	const redCards = Array.isArray(stats?.redCards) ? stats.redCards : [];

	let contribution =
		ELO_CONSTANTS.participationBaseline +
		goals * ELO_CONSTANTS.goalWeight +
		assists * ELO_CONSTANTS.assistWeight;

	const safeMatchMinutes =
		Number.isFinite(matchMinutes) && matchMinutes > 0 ? matchMinutes : 10;

	for (const card of redCards) {
		const minute = Number(card?.minute);
		if (!Number.isFinite(minute) || minute < 0) continue;
		const timeFactor = Math.max(
			0,
			(safeMatchMinutes - minute) / safeMatchMinutes,
		);
		contribution -= ELO_CONSTANTS.redCardPenalty * timeFactor;
	}

	return contribution;
}

/**
 * Convert a team's per-player contribution scores into normalised
 * shares that sum to 1. Each share is clamped to
 * [shareMin, shareMax] and the result is re-normalised so the sum
 * stays at 1 even after clamping.
 *
 * Edge cases:
 *   - empty / nullish input → []
 *   - all contributions <= 0 → equal split (1/n each)
 *   - single-player team → [1.0]
 *
 * Note: for 2-player teams (our 2v2 case), shareMin + shareMax = 1.0
 * so clamping is already self-normalising. The re-normalisation step
 * is defensive — it keeps the contract intact if shareMin/shareMax
 * are ever tuned to break that symmetry, and it generalises cleanly
 * to 3+ players if the league mode ever expands.
 *
 * @param {number[]} contributions
 * @returns {number[]} Shares (length matches input, summing to ~1).
 *
 * @example
 *   computeTeamShares([4.0, 1.0]);  // → [0.8, 0.2]
 *   computeTeamShares([2.0, 2.0]);  // → [0.5, 0.5]
 *   computeTeamShares([3.0, 1.0]);  // → [0.75, 0.25]
 *   computeTeamShares([10.0, 1.0]); // → [0.8, 0.2] (clamped)
 */
export function computeTeamShares(contributions) {
	if (!Array.isArray(contributions) || contributions.length === 0) return [];
	if (contributions.length === 1) return [1.0];

	const total = contributions.reduce((acc, c) => acc + c, 0);
	if (total <= 0) {
		// Degenerate input: everyone got 0 or negative. Fall back to
		// equal split so the ELO distribution still runs.
		const equal = 1 / contributions.length;
		return contributions.map(() => equal);
	}

	const rawShares = contributions.map((c) => c / total);
	const clamped = rawShares.map((s) =>
		clamp(s, ELO_CONSTANTS.shareMin, ELO_CONSTANTS.shareMax),
	);

	const clampedTotal = clamped.reduce((acc, s) => acc + s, 0);
	if (clampedTotal <= 0) {
		const equal = 1 / contributions.length;
		return contributions.map(() => equal);
	}
	return clamped.map((s) => s / clampedTotal);
}
