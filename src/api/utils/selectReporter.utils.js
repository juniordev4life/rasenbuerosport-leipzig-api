/**
 * Reporter selection for the multi-reporter match-report system. The
 * decision is a three-step pipeline:
 *
 *   1. Hard rules — if a match has a defining characteristic (early red
 *      card, hattrick, comeback, clear win with nothing special), the
 *      reporter is fixed by rule.
 *   2. Drama-weighted random — fallback when no hard rule fires.
 *   3. Anti-repetition — if the two most recent reports were narrated
 *      by the same reporter, that reporter's weight is divided by 4.
 *
 * The selection is deterministic given the same RNG seed; tests inject
 * a fake RNG via the `random` option.
 */

import {
	ALL_REPORTERS,
	REPORTER_IDS,
} from "../../constants/reporters.constants.js";
import { checkComeback, determineDramaLevel } from "./dramaLevel.utils.js";

/**
 * Reporter probability weights per drama level. Each row sums to 100.
 *
 * @type {Record<"low"|"medium"|"high", Record<string, number>>}
 */
const REPORTER_WEIGHTS_BY_DRAMA = {
	low: {
		[REPORTER_IDS.KLASSIKER]: 25,
		[REPORTER_IDS.ANALYST]: 60,
		[REPORTER_IDS.EUPHORIKER]: 15,
	},
	medium: {
		[REPORTER_IDS.KLASSIKER]: 50,
		[REPORTER_IDS.ANALYST]: 30,
		[REPORTER_IDS.EUPHORIKER]: 20,
	},
	high: {
		[REPORTER_IDS.KLASSIKER]: 50,
		[REPORTER_IDS.ANALYST]: 15,
		[REPORTER_IDS.EUPHORIKER]: 35,
	},
};

/**
 * Whether a single player scored at least 3 goals in this game.
 *
 * @param {Array<object>} timeline
 * @returns {boolean}
 */
function hasHattrick(timeline) {
	if (!Array.isArray(timeline)) return false;
	const counts = new Map();
	for (const entry of timeline) {
		if (entry?.event_type !== "goal") continue;
		const scorer = entry.scored_by ?? entry.scorer;
		if (!scorer) continue;
		const next = (counts.get(scorer) ?? 0) + 1;
		if (next >= 3) return true;
		counts.set(scorer, next);
	}
	return false;
}

/**
 * Red card (`red_card` event, or `card` event with `card_type: red`)
 * before minute 15.
 *
 * @param {Array<object>} timeline
 * @returns {boolean}
 */
function hasEarlyRedCard(timeline) {
	if (!Array.isArray(timeline)) return false;
	return timeline.some((entry) => {
		const isRed =
			entry?.event_type === "red_card" ||
			(entry?.event_type === "card" && entry?.card_type === "red");
		return isRed && typeof entry?.minute === "number" && entry.minute < 15;
	});
}

/**
 * Hard-rule layer: returns a fixed reporter id when the match has a
 * defining characteristic, or `null` if the weighted draw should run.
 *
 * @param {object} game
 * @returns {string|null}
 */
function applyHardRules(game) {
	const timeline = Array.isArray(game?.score_timeline)
		? game.score_timeline
		: [];
	const home = Number(game?.score_home ?? 0);
	const away = Number(game?.score_away ?? 0);

	if (checkComeback(timeline, home, away, 3)) return REPORTER_IDS.EUPHORIKER;
	if (hasHattrick(timeline)) return REPORTER_IDS.EUPHORIKER;
	if (hasEarlyRedCard(timeline)) return REPORTER_IDS.KLASSIKER;

	const goalDiff = Math.abs(home - away);
	const hasAnyRedCard = timeline.some(
		(e) =>
			e?.event_type === "red_card" ||
			(e?.event_type === "card" && e?.card_type === "red"),
	);
	const lateGoals = timeline.filter(
		(e) =>
			e?.event_type === "goal" &&
			typeof e?.minute === "number" &&
			e.minute > 80,
	).length;
	if (goalDiff >= 4 && !hasAnyRedCard && lateGoals === 0) {
		return REPORTER_IDS.ANALYST;
	}

	return null;
}

/**
 * Down-weight the most-recent reporter when the last two reports were
 * narrated by the same persona. Cluster-breaker — not a hard ban.
 *
 * @param {Record<string, number>} weights
 * @param {Array<string>} recentReporters - newest first.
 * @returns {Record<string, number>}
 */
function applyAntiRepetition(weights, recentReporters) {
	const adjusted = { ...weights };
	if (
		recentReporters?.length >= 2 &&
		recentReporters[0] === recentReporters[1] &&
		adjusted[recentReporters[0]] != null
	) {
		const id = recentReporters[0];
		adjusted[id] = Math.max(1, Math.floor(adjusted[id] / 4));
	}
	return adjusted;
}

/**
 * Pick a reporter by weighted draw. `random` is injectable for tests.
 *
 * @param {Record<string, number>} weights
 * @param {() => number} [random=Math.random]
 * @returns {string}
 */
function weightedRandomChoice(weights, random = Math.random) {
	const entries = Object.entries(weights).filter(([, w]) => w > 0);
	const total = entries.reduce((sum, [, w]) => sum + w, 0);
	if (total <= 0) return REPORTER_IDS.KLASSIKER;
	let roll = random() * total;
	for (const [id, w] of entries) {
		roll -= w;
		if (roll <= 0) return id;
	}
	return entries[entries.length - 1][0];
}

/**
 * Pick the reporter for a finished match.
 *
 * @param {object} game - Game row including `score_timeline`.
 * @param {object} [options]
 * @param {Array<string>} [options.recentReporters=[]] - Newest first,
 *   max two entries used for anti-repetition.
 * @param {() => number} [options.random] - RNG override for tests.
 * @returns {"klassiker"|"analyst"|"euphoriker"}
 *
 * @example
 *   selectReporter(game, { recentReporters: ["klassiker", "klassiker"] });
 *   // → likely "analyst" or "euphoriker"
 */
export function selectReporter(game, options = {}) {
	const { recentReporters = [], random } = options;

	const hard = applyHardRules(game);
	if (hard) return hard;

	const dramaLevel = determineDramaLevel(game);
	const baseWeights = REPORTER_WEIGHTS_BY_DRAMA[dramaLevel];
	const adjusted = applyAntiRepetition(baseWeights, recentReporters);
	const choice = weightedRandomChoice(adjusted, random);
	return ALL_REPORTERS.includes(choice) ? choice : REPORTER_IDS.KLASSIKER;
}

export const __test__ = {
	hasHattrick,
	hasEarlyRedCard,
	applyHardRules,
	applyAntiRepetition,
	weightedRandomChoice,
	REPORTER_WEIGHTS_BY_DRAMA,
};
