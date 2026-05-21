/**
 * Percentile rank — the league-relative normalisation step every
 * profile axis runs through. The implementation uses the standard
 * "below + half of equal" formula so ties don't collapse to the same
 * extreme bucket. Values are returned on a 0–100 scale and rounded
 * to integers because the UI displays integer percentiles.
 */

/**
 * Compute the percentile rank of `value` within `population` on a
 * 0–100 scale. The population must include the player's own value;
 * the function does not assume it is already included or not.
 *
 * @param {number} value - The raw value to rank.
 * @param {number[]} population - All comparable raw values (including the player's).
 * @returns {number} Integer percentile rank in [0, 100].
 *
 * @example
 *   computePercentileRank(2.4, [0.5, 1.0, 1.5, 2.0, 2.4, 3.0]);
 *   // → 75
 *
 *   computePercentileRank(0.5, [0.5, 1.0, 1.5, 2.0, 2.4, 3.0]);
 *   // → 8  (lowest value still gets a nonzero perch via the half-equal tie weight)
 */
export function computePercentileRank(value, population) {
	if (!Array.isArray(population) || population.length === 0) return 50;
	if (population.length === 1) return 50;
	if (!Number.isFinite(value)) return 50;

	let below = 0;
	let equal = 0;
	for (const v of population) {
		if (!Number.isFinite(v)) continue;
		if (v < value) below += 1;
		else if (v === value) equal += 1;
	}

	const rank = (below + equal / 2) / population.length;
	return Math.round(rank * 100);
}
