/**
 * Pure helpers for working with `games.score_timeline` JSONB entries.
 *
 * The frontend mirrors the same comparator + floor logic in
 * `src/lib/utils/minute.utils.js`. Keep the two in sync — this is intentional
 * defense-in-depth rather than premature DRY: the frontend ships at every
 * release, and the API owns the database write barrier.
 */

/** @type {ReadonlyArray<number>} */
const STOPPAGE_ENDPOINTS = Object.freeze([45, 90, 105, 120]);

/** @type {number} */
const MAX_STOPPAGE = 5;

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
 * is strictly after the previous event of the same period. Throws an `Error`
 * with `statusCode = 400` on the first violation, otherwise returns silently.
 *
 * Penalty-shootout entries (`period === "penalty"`) and entries without a
 * minute are skipped — both are valid in their own right.
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
