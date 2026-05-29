/**
 * Trophy calculation orchestrator.
 *
 * Inputs:  a player id + chronologically-sorted, normalized matches.
 * Output:  the set of trophies they have unlocked, each with the id
 *          of the match that triggered it (or null for pure
 *          lifetime-aggregate shapes where no single match counts).
 *
 * The runtime split:
 *
 *   1. AGGREGATION — one pass over the matches builds the stats
 *      blob (lifetime counters, max-per-match, side-maps, day/week
 *      buckets, flag→matchId pointers for one-shot shapes).
 *
 *   2. PER-TROPHY EVALUATION — for each individual-scope trophy:
 *        - aggregate-shape conditions run once against the blob;
 *        - match-bound shapes (goalsInMatch, lateWinner, …) either
 *          read their pre-computed flag from the blob OR, for shapes
 *          the aggregator can't pre-compute cheaply (rollercoaster,
 *          h2hComeback), get a chronological re-walk via the
 *          `matches` field.
 *
 * Duo-scope trophies are calculated separately because they're keyed
 * by player-pair, not by individual. The backfill walks every
 * 2-player team appearance and produces a duo aggregate.
 */

import { TROPHIES } from "../../../constants/trophies.constants.js";
import { aggregatePlayerForTrophies } from "./trophyAggregation.services.js";
import {
	getFlagTriggerMatchId,
	trophyConditions,
} from "./trophyConditions.services.js";

/**
 * Map condition keys that read from a one-shot flag back to the
 * flag key the aggregator stores. Lets `triggered_by_match_id` get
 * resolved without re-walking matches.
 */
const FLAG_KEY_BY_CONDITION = Object.freeze({
	cleanSheetWin: "hasCleanSheetWin",
	goalDifferenceWin: "hasGoalDifferenceWin5Plus",
	goalDifferenceExactWin: "hasGoalDifferenceExactWin1",
	totalGoalsInMatchWin: "hasTotalGoalsInMatchWin8Plus",
	comebackWin: "hasComebackWin3Plus",
	lateWinner: "hasLateWinner90",
	penaltyShootoutWin: "hasPenaltyShootoutWin",
	perfectPenaltyShootout: "hasPerfectPenaltyShootout",
	penaltiesSavedInShootout: "maxPenaltiesSavedInShootout",
	earlyConceded: "hasEarlyConceded",
	redCardWin: "hasRedCardWin",
	midnightMatch: "hasMidnightMatch",
	endLossStreak: "hadEndedLossStreak5Plus",
	unluckyShootout: "hasUnluckyShootout4",
});

/**
 * Resolve a trigger match id for the condition. Some shapes (the
 * "extra-time late winner" branch of `lateWinner`) have a separate
 * flag; this helper handles the small set of polymorphic shapes.
 *
 * @param {object} trophy
 * @param {object} stats
 * @returns {string | null}
 */
function resolveTriggerMatchId(trophy, stats) {
	if (trophy.conditionKey === "lateWinner") {
		if (
			trophy.conditionParams.minMinute === 91 &&
			trophy.conditionParams.maxMinute === 120
		) {
			return getFlagTriggerMatchId("hasLateWinnerExtraTime", stats);
		}
		return getFlagTriggerMatchId("hasLateWinner90", stats);
	}
	const flagKey = FLAG_KEY_BY_CONDITION[trophy.conditionKey];
	if (!flagKey) return null;
	return getFlagTriggerMatchId(flagKey, stats);
}

/**
 * Walks all trophies for a player against their full match history
 * + the pre-computed aggregate stats. Returns one entry per unlocked
 * trophy.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {Array<object>} args.matches - Normalized, chronological ASC.
 * @param {object} [args.stats] - Pre-aggregated stats. Built on the
 *   fly when omitted.
 * @returns {Array<{ trophyId: string, triggeredByMatchId: string | null }>}
 */
export function evaluateTrophiesForPlayer({ playerId, matches, stats }) {
	const aggregate = stats ?? aggregatePlayerForTrophies(playerId, matches);
	const unlocked = [];

	for (const trophy of TROPHIES) {
		if (trophy.scope !== "individual") continue;
		const conditionFn = trophyConditions[trophy.conditionKey];
		if (!conditionFn) continue;

		const passed = conditionFn({
			stats: aggregate,
			matches,
			playerId,
			params: trophy.conditionParams,
		});
		if (!passed) continue;

		unlocked.push({
			trophyId: trophy.id,
			triggeredByMatchId: resolveTriggerMatchId(trophy, aggregate),
		});
	}

	return unlocked;
}

/**
 * Aggregate a duo's matches into the same-shaped stats blob and
 * evaluate every duo-scope trophy against it.
 *
 * The duo "won" a match if BOTH players were on the winning side.
 * The blob mirrors the individual aggregator's shape closely enough
 * that the duoWins / duoWinRate conditions can be evaluated against
 * a duo aggregate by mapping the duo's matches into a "wins/losses
 * / matches" counter.
 *
 * @param {object} args
 * @param {[string, string]} args.duoPlayers - Sorted pair.
 * @param {Array<object>} args.matches - Matches where BOTH players
 *   were on the same side.
 * @returns {Array<{ trophyId: string, triggeredByMatchId: string | null }>}
 */
export function evaluateDuoTrophies({ duoPlayers, matches }) {
	let wins = 0;
	for (const match of matches) {
		const sideA = match.homePlayers.includes(duoPlayers[0])
			? "home"
			: match.awayPlayers.includes(duoPlayers[0])
				? "away"
				: null;
		const sideB = match.homePlayers.includes(duoPlayers[1])
			? "home"
			: match.awayPlayers.includes(duoPlayers[1])
				? "away"
				: null;
		if (!sideA || sideA !== sideB) continue;
		if (match.winnerSide === sideA) wins += 1;
	}
	const total = matches.length;

	const unlocked = [];
	for (const trophy of TROPHIES) {
		if (trophy.scope !== "duo") continue;
		const params = trophy.conditionParams;
		let passed = false;
		if (trophy.conditionKey === "duoWins") {
			passed = wins >= params.threshold;
		} else if (trophy.conditionKey === "duoWinRate") {
			passed =
				total >= params.minMatches && total > 0 && wins / total >= params.rate;
		}
		if (passed) {
			unlocked.push({ trophyId: trophy.id, triggeredByMatchId: null });
		}
	}
	return unlocked;
}
