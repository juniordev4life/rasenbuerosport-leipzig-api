/**
 * Nominal match duration for a `games.result_type`, used to time-weight
 * events such as red cards. A penalty shootout follows extra time, so field
 * play ends at 120 minutes.
 *
 * @param {string|null|undefined} resultType - "regular" | "extra_time" | "penalty"
 * @returns {number} 90 or 120
 * @example
 * matchMinutesForResultType("penalty"); // 120
 */
export function matchMinutesForResultType(resultType) {
	// "penalty" is the value the games.result_type enum stores — the plural
	// "penalties" never reaches the column.
	if (resultType === "extra_time" || resultType === "penalty") return 120;
	return 90;
}
