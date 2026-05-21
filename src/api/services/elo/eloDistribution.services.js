/**
 * Asymmetric distribution of the team-level ELO delta to individual
 * players based on their contribution shares.
 *
 *   Win/draw  (ΔR_team >= 0):  higher share → bigger gain
 *   Loss      (ΔR_team <  0):  higher share → smaller loss
 *
 * The factor `team.length` (i.e. 2 for 2v2, 1 for 1v1) keeps the
 * total player delta = team.length × team delta. For 2v2 that means
 * the sum of the two players' deltas equals 2 × team delta — which
 * matches what plain symmetric team-ELO would distribute (each
 * player gets the team delta once), but fairly redistributed.
 *
 * For 1v1 it collapses to "the player gets exactly the team delta",
 * which is the correct symmetric result.
 */

/**
 * Distribute a team-level ELO delta across players according to
 * contribution shares.
 *
 * @param {object} params
 * @param {number} params.teamDelta
 * @param {number[]} params.shares - Sum = 1, length matches the team.
 * @returns {number[]} Individual deltas, same length as `shares`.
 *
 * @example
 *   // Win, asymmetric shares: top performer gains more.
 *   distributeTeamDelta({ teamDelta: 17.6, shares: [0.8, 0.2] });
 *   // → [28.16, 7.04]
 *
 * @example
 *   // Loss with same shares: top performer loses less.
 *   distributeTeamDelta({ teamDelta: -17.6, shares: [0.8, 0.2] });
 *   // → [-7.04, -28.16]
 *
 * @example
 *   // 1v1 case — single player gets the full team delta.
 *   distributeTeamDelta({ teamDelta: 12, shares: [1.0] });
 *   // → [12]
 */
export function distributeTeamDelta({ teamDelta, shares }) {
	if (!Array.isArray(shares) || shares.length === 0) return [];
	const n = shares.length;

	if (teamDelta >= 0) {
		return shares.map((share) => teamDelta * n * share);
	}

	// Loss: invert the shares — whoever contributed 0.8 only takes
	// 0.2 of the loss. Re-normalise so the inverse shares sum to 1.
	const inverse = shares.map((s) => 1 - s);
	const inverseTotal = inverse.reduce((acc, s) => acc + s, 0);
	if (inverseTotal <= 0) {
		// All shares were 1 (impossible with our clamps, but defensive).
		const equal = 1 / n;
		return shares.map(() => teamDelta * n * equal);
	}
	const normalisedInverse = inverse.map((s) => s / inverseTotal);
	return normalisedInverse.map((share) => teamDelta * n * share);
}
