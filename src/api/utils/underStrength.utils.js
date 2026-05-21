/**
 * Pre-compute time-in-state derivations for the AI match report. The
 * LLM is unreliable at converting "red card in minute 70" + "match
 * ends at 90" into "team was under strength for 20 minutes" — it
 * often confuses the two numbers. By pushing the computed durations
 * into the prompt context as an explicit field, the model only needs
 * to read, not calculate.
 */

const TEAM_SIDES = /** @type {const} */ (["home", "away"]);

/**
 * Match length in minutes, derived from `result_type`. Stoppage time
 * is intentionally ignored — the LLM does not need second precision
 * and stoppage is not reliably captured in `score_timeline`.
 *
 * @param {string|null|undefined} resultType
 * @returns {number}
 */
function endMinuteFor(resultType) {
	if (resultType === "extra_time") return 120;
	if (resultType === "penalties") return 120;
	return 90;
}

/**
 * Whether a timeline entry counts as a red card (either an explicit
 * `red_card` event or a `card` event with `card_type: "red"`).
 *
 * @param {object} entry
 * @returns {boolean}
 */
function isRedCard(entry) {
	return (
		entry?.event_type === "red_card" ||
		(entry?.event_type === "card" && entry?.card_type === "red")
	);
}

/**
 * Compute one entry per red card describing how long that team played
 * a player short. Multiple reds for the same team produce multiple
 * entries; the LLM is expected to pick the most narratively useful
 * one rather than us trying to merge overlapping periods.
 *
 * @param {Array<object>} timeline - Score timeline entries.
 * @param {string|null|undefined} resultType
 * @param {{ home: string, away: string }} teamNames - Resolved team names.
 * @param {Map<string, string>} [nameMap] - Optional player-id → username
 *   resolver so the entry can name the player who saw red.
 * @returns {Array<{ team_name: string, side: "home"|"away", from_minute: number, until_minute: number, duration_minutes: number, reason: string, player?: string }>}
 *
 * @example
 *   computeUnderStrengthPeriods(
 *     [{ event_type: "red_card", team: "away", minute: 70 }],
 *     "regular",
 *     { home: "Arsenal", away: "Inter" },
 *   );
 *   // → [{ team_name: "Inter", side: "away", from_minute: 70,
 *   //      until_minute: 90, duration_minutes: 20, reason: "red_card" }]
 */
export function computeUnderStrengthPeriods(
	timeline,
	resultType,
	teamNames,
	nameMap,
) {
	if (!Array.isArray(timeline)) return [];
	const end = endMinuteFor(resultType);
	const periods = [];
	for (const entry of timeline) {
		if (!isRedCard(entry)) continue;
		const minute = typeof entry?.minute === "number" ? entry.minute : null;
		if (minute === null) continue;
		const side = TEAM_SIDES.includes(entry?.team) ? entry.team : null;
		if (!side) continue;
		const teamName = teamNames[side];
		if (!teamName) continue;
		const duration = Math.max(0, end - minute);
		const period = {
			team_name: teamName,
			side,
			from_minute: minute,
			until_minute: end,
			duration_minutes: duration,
			reason: "red_card",
		};
		const player = nameMap?.get?.(entry?.player_id);
		if (player) period.player = player;
		periods.push(period);
	}
	return periods;
}
