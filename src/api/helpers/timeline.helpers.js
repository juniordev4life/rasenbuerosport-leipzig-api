/**
 * Pure helpers for working with `games.score_timeline` JSONB entries.
 *
 * The frontend mirrors the same comparator + floor logic in
 * `src/lib/utils/minute.utils.js`. Keep the two in sync — this is intentional
 * defense-in-depth rather than premature DRY: the frontend ships at every
 * release, and the API owns the database write barrier.
 *
 * Event types
 * -----------
 *  - `goal` (default for legacy entries without `event_type`): scores a goal
 *    for a side; `home`/`away` carry the running score.
 *  - `red_card` (Phase 3, **legacy**): records a sending-off without a
 *    discriminator. New writes should use `card` instead, but reader helpers
 *    treat existing entries as `card` with `card_type: "red"`.
 *  - `card` (Phase 7): unified yellow / red card event with a
 *    `card_type: "yellow" | "red"` discriminator — same shape as the goal
 *    `goal_type` enum. Does not affect score.
 *  - `penalty_missed` (Phase 4): records a missed/saved penalty; does not
 *    affect score.
 */

/** @type {ReadonlyArray<number>} */
const STOPPAGE_ENDPOINTS = Object.freeze([45, 90, 105, 120]);

/** @type {number} */
const MAX_STOPPAGE = 5;

/**
 * Resolve the discriminator of a timeline entry. Entries without an explicit
 * `event_type` are treated as goals — this preserves backwards compatibility
 * with games created before Phase 3 introduced the discriminator.
 *
 * @param {{ event_type?: string }} entry
 * @returns {"goal"|"red_card"|"penalty_missed"|string}
 * @example
 * getEventType({ scored_by: "user-1" });             // → "goal"
 * getEventType({ event_type: "red_card" });          // → "red_card"
 */
export function getEventType(entry) {
	return entry?.event_type ?? "goal";
}

/**
 * Whether the entry represents a goal (the default event type).
 * @param {{ event_type?: string }} entry
 * @returns {boolean}
 */
export function isGoal(entry) {
	return getEventType(entry) === "goal";
}

/**
 * Whether the entry represents any card event — covers both the unified
 * `card` shape (with a `card_type` discriminator) and the legacy
 * `red_card` event type that shipped first.
 *
 * @param {{ event_type?: string }} entry
 * @returns {boolean}
 */
export function isCard(entry) {
	const t = getEventType(entry);
	return t === "card" || t === "red_card";
}

/**
 * Resolve the colour of a card entry, normalising across the legacy
 * `red_card` event type and the unified `card` event with `card_type`.
 *
 * @param {{ event_type?: string, card_type?: string }} entry
 * @returns {"yellow"|"red"|null}
 * @example
 *   getCardColor({ event_type: "red_card" });                // → "red"
 *   getCardColor({ event_type: "card", card_type: "yellow"}); // → "yellow"
 *   getCardColor({ event_type: "goal" });                    // → null
 */
export function getCardColor(entry) {
	if (!isCard(entry)) return null;
	if (getEventType(entry) === "red_card") return "red";
	const c = entry?.card_type;
	return c === "yellow" || c === "red" ? c : null;
}

/**
 * Whether the entry represents a red card. True for the legacy
 * `red_card` event type as well as the unified `card` event with
 * `card_type: "red"`.
 *
 * @param {{ event_type?: string, card_type?: string }} entry
 * @returns {boolean}
 */
export function isRedCard(entry) {
	return getCardColor(entry) === "red";
}

/**
 * Whether the entry represents a yellow card (unified `card` event with
 * `card_type: "yellow"`). Pre-Phase-7 timelines never carry yellow cards
 * — those came from the FC26 stats image upload.
 *
 * @param {{ event_type?: string, card_type?: string }} entry
 * @returns {boolean}
 */
export function isYellowCard(entry) {
	return getCardColor(entry) === "yellow";
}

/**
 * Whether the entry represents a missed penalty.
 * @param {{ event_type?: string }} entry
 * @returns {boolean}
 */
export function isPenaltyMissed(entry) {
	return getEventType(entry) === "penalty_missed";
}

/**
 * Return only the goal entries from a timeline. Use this in any reader that
 * derives score-related stats so red cards / penalty-missed entries do not
 * inflate goal counts.
 *
 * @param {Array<{ event_type?: string }>} timeline
 * @returns {Array<{ event_type?: string }>}
 * @example
 * filterGoals([
 *   { scored_by: "u1" },
 *   { event_type: "red_card", player_id: "u2" },
 * ]);
 * // → [{ scored_by: "u1" }]
 */
export function filterGoals(timeline) {
	if (!Array.isArray(timeline)) return [];
	return timeline.filter(isGoal);
}

/**
 * Lexicographic comparator for `(minute, stoppage)` pairs.
 *
 * @param {{ minute?: number, stoppage?: number }} a
 * @param {{ minute?: number, stoppage?: number }} b
 * @returns {number}
 * @example
 * compareMinute({ minute: 11 }, { minute: 12 });              // → < 0
 * compareMinute({ minute: 45, stoppage: 2 }, { minute: 45 }); // → > 0
 */
export function compareMinute(a, b) {
	const am = a?.minute ?? 0;
	const bm = b?.minute ?? 0;
	if (am !== bm) return am - bm;
	return (a?.stoppage ?? 0) - (b?.stoppage ?? 0);
}

/**
 * Compute the smallest `(minute, stoppage)` pair that may legally come AFTER
 * the latest event already on the timeline within the given period.
 *
 * @param {Array<{ period?: string, minute?: number, stoppage?: number }>} [timeline]
 * @param {"regular"|"extra_time"|"penalty"} period
 * @returns {{ minute: number, stoppage: number }|null}
 * @example
 * getMinMinuteForNextEvent([], "regular");
 * // → { minute: 1, stoppage: 0 }
 *
 * getMinMinuteForNextEvent(
 *   [{ period: "regular", minute: 45, stoppage: 2 }],
 *   "regular"
 * );
 * // → { minute: 45, stoppage: 3 }
 */
export function getMinMinuteForNextEvent(timeline, period) {
	if (period === "penalty") return null;

	const events = (timeline ?? []).filter(
		(e) => (e?.period ?? "regular") === period && typeof e?.minute === "number",
	);

	if (events.length === 0) {
		return period === "extra_time"
			? { minute: 91, stoppage: 0 }
			: { minute: 1, stoppage: 0 };
	}

	let last = events[0];
	for (const e of events) {
		if (compareMinute(e, last) > 0) last = e;
	}

	const lastMin = last.minute;
	const lastStop = last.stoppage ?? 0;

	if (STOPPAGE_ENDPOINTS.includes(lastMin) && lastStop < MAX_STOPPAGE) {
		return { minute: lastMin, stoppage: lastStop + 1 };
	}
	return { minute: lastMin + 1, stoppage: 0 };
}

/**
 * Walk the timeline in array order and assert that every event with a minute
 * is strictly after the previous event of the same period — regardless of
 * event type. Throws an `Error` with `statusCode = 400` on the first
 * violation, otherwise returns silently.
 *
 * Penalty-shootout entries (`period === "penalty"`) and entries without a
 * minute are skipped.
 *
 * @param {Array<{ period?: string, minute?: number, stoppage?: number }>} timeline
 * @returns {void}
 * @throws {Error & { statusCode: number }}
 * @example
 * validateScoreTimeline([
 *   { period: "regular", minute: 11 },
 *   { period: "regular", minute: 30 },
 * ]);
 * // → void
 *
 * validateScoreTimeline([
 *   { period: "regular", minute: 11 },
 *   { period: "regular", minute: 11 },
 * ]);
 * // throws Error { statusCode: 400, message: "..." }
 */
export function validateScoreTimeline(timeline) {
	if (!Array.isArray(timeline) || timeline.length === 0) return;

	/** @type {Record<string, { minute: number, stoppage?: number }>} */
	const lastByPeriod = {};

	for (const event of timeline) {
		const period = event?.period ?? "regular";
		if (period === "penalty") continue;
		if (typeof event?.minute !== "number") continue;

		const last = lastByPeriod[period];
		if (last && compareMinute(event, last) <= 0) {
			const candidate = `${event.minute}+${event.stoppage ?? 0}'`;
			const previous = `${last.minute}+${last.stoppage ?? 0}'`;
			const error = new Error(
				`Score timeline event in period "${period}" at ${candidate} must be strictly after previous event at ${previous}.`,
			);
			error.statusCode = 400;
			throw error;
		}
		lastByPeriod[period] = event;
	}
}
