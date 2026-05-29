/**
 * Registry of trophy condition functions, keyed by the `conditionKey`
 * field on each trophy definition in `src/constants/trophies.constants.js`.
 *
 * Every function takes the same shape — `{ stats, match, params }` —
 * and returns a boolean. The match-bound flavour passes a `match`
 * field; the aggregate flavour omits it. The condition itself decides
 * which to read.
 *
 * Aggregate vs match-bound:
 *
 *   AGGREGATE — checked once against the pre-computed stats blob.
 *     Example: `totalWins` reads `stats.wins`. Backfill resolves these
 *     in one shot; live-match-save hooks check the same way after the
 *     match's contribution is folded in.
 *
 *   MATCH-BOUND — checked per-match, true if THIS match satisfies the
 *     shape. Example: `goalsInMatch` reads `getPlayerGoalsInMatch(...)`.
 *     During backfill the runner walks the chronological match list
 *     and stops at the first match that unlocks it, stamping that
 *     match's id onto the trophy.
 *
 * The aggregation stage in `trophyAggregation.services.js` already
 * stores `hasXyz` flags + match-trigger ids for many match-bound
 * shapes — those conditions then resolve from the aggregate (faster)
 * even though the underlying signal was per-match.
 */

import {
	didPlayerWin,
	getPlayerAssistsInMatch,
	getPlayerGoalDifferenceInMatch,
	getPlayerGoalsAgainstInMatch,
	getPlayerGoalsInMatch,
	getPlayerSide,
} from "./trophyMatchNormalizer.services.js";

/**
 * Returns true when the player has won at least `params.threshold`
 * matches in their lifetime.
 *
 * @example
 *   totalWins({ stats: { wins: 110 }, params: { threshold: 100 } }) // true
 */
const totalWins = ({ stats, params }) => stats.wins >= params.threshold;

const totalGoals = ({ stats, params }) => stats.goals >= params.threshold;
const totalAssists = ({ stats, params }) => stats.assists >= params.threshold;
const totalMatches = ({ stats, params }) => stats.matches >= params.threshold;
const totalCleanSheets = ({ stats, params }) =>
	stats.cleanSheets >= params.threshold;
const peakElo = ({ stats, params }) => stats.peakElo >= params.threshold;

const winRate = ({ stats, params }) => {
	if (stats.matches < params.minMatches) return false;
	if (stats.matches === 0) return false;
	return stats.wins / stats.matches >= params.rate;
};

// ----- Per-match scoring shapes — resolve from aggregate maxima.
const goalsInMatch = ({ stats, params }) =>
	stats.maxGoalsInMatch >= params.threshold;
const assistsInMatch = ({ stats, params }) =>
	stats.maxAssistsInMatch >= params.threshold;
const scorerPointsInMatch = ({ stats, params }) =>
	stats.maxScorerPointsInMatch >= params.threshold;

// ----- One-shot match shapes — boolean flags pre-computed by the aggregator.
const cleanSheetWin = ({ stats }) => stats.hasCleanSheetWin;
const goalDifferenceWin = ({ stats, params }) => {
	// Currently only one threshold (5) is required by trophy D5.
	if (params.threshold === 5) return stats.hasGoalDifferenceWin5Plus;
	return false;
};
const goalDifferenceExactWin = ({ stats, params }) => {
	if (params.difference === 1) return stats.hasGoalDifferenceExactWin1;
	return false;
};
const totalGoalsInMatchWin = ({ stats, params }) => {
	if (params.threshold === 8) return stats.hasTotalGoalsInMatchWin8Plus;
	return false;
};

// ----- Streaks
const maxWinStreak = ({ stats, params }) =>
	stats.maxWinStreak >= params.threshold;
const maxCleanSheetStreak = ({ stats, params }) =>
	stats.maxCleanSheetStreak >= params.threshold;
const endLossStreak = ({ stats }) => stats.hadEndedLossStreak5Plus;

// ----- Special shapes
const comebackWin = ({ stats, params }) => {
	if (params.minDeficit === 3) return stats.hasComebackWin3Plus;
	return false;
};
const lateWinner = ({ stats, params }) => {
	if (params.minMinute === 90 && params.maxMinute === 90) {
		return stats.hasLateWinner90;
	}
	if (params.minMinute === 91 && params.maxMinute === 120) {
		return stats.hasLateWinnerExtraTime;
	}
	return false;
};

// ----- Penalty shootout
const penaltyShootoutWin = ({ stats }) => stats.hasPenaltyShootoutWin;
const perfectPenaltyShootout = ({ stats }) => stats.hasPerfectPenaltyShootout;
const penaltiesSavedInShootout = ({ stats, params }) =>
	stats.maxPenaltiesSavedInShootout >= params.threshold;

// ----- H2H comparator-driven shapes
const h2hWins = ({ stats, params }) => {
	const max = Math.max(0, ...Object.values(stats.h2hWinsByOpponent ?? {}));
	return max >= params.threshold;
};
const h2hMatches = ({ stats, params }) => {
	const max = Math.max(0, ...Object.values(stats.h2hMatchesByOpponent ?? {}));
	return max >= params.threshold;
};

/**
 * Did the player ever flip an H2H ledger from a `<= -minDeficit`
 * deficit to a positive saldo? Requires a chronological replay of
 * each opponent's win/loss ledger — pure walk, no allocation hot path.
 *
 * @param {object} args
 * @param {Array<object>} args.matches - chronological matches
 * @param {string} args.playerId
 * @param {{ minDeficit: number }} args.params
 * @returns {boolean}
 */
function h2hComeback({ matches, playerId, params }) {
	if (!Array.isArray(matches) || !playerId) return false;
	const min = -Math.abs(params.minDeficit);
	const saldoByOpp = {};
	const wasInDeficitBy = {};
	for (const match of matches) {
		const side = getPlayerSide(playerId, match);
		if (!side) continue;
		const won = match.winnerSide === side;
		const lost = match.winnerSide !== null && match.winnerSide !== side;
		const opps = side === "home" ? match.awayPlayers : match.homePlayers;
		for (const opp of opps) {
			saldoByOpp[opp] ??= 0;
			if (won) saldoByOpp[opp] += 1;
			else if (lost) saldoByOpp[opp] -= 1;
			if (saldoByOpp[opp] <= min) wasInDeficitBy[opp] = true;
			if (wasInDeficitBy[opp] && saldoByOpp[opp] > 0) return true;
		}
	}
	return false;
}

// ----- Duo
const duoWins = ({ stats, params }) => {
	const max = Math.max(0, ...Object.values(stats.duoWinsByPartner ?? {}));
	return max >= params.threshold;
};
const duoWinRate = ({ stats, params }) => {
	// Best partner where matches >= minMatches AND wins/matches >= rate.
	for (const [partnerId, matches] of Object.entries(
		stats.duoMatchesByPartner ?? {},
	)) {
		if (matches < params.minMatches) continue;
		const wins = stats.duoWinsByPartner?.[partnerId] ?? 0;
		if (wins / matches >= params.rate) return true;
	}
	return false;
};
const distinctWinningPartners = ({ stats, params }) =>
	(stats.distinctWinningPartners ?? 0) >= params.threshold;

// ----- Day / week
const perfectDay = ({ stats, params }) => stats.bestDayWins >= params.minWins;
const perfectWeek = ({ stats, params }) =>
	stats.bestWeekMatchesNoLoss >= params.minMatches;

// ----- Hidden
const earlyConceded = ({ stats }) => stats.hasEarlyConceded;
const redCardWin = ({ stats }) => stats.hasRedCardWin;
const midnightMatch = ({ stats }) => stats.hasMidnightMatch;
const hattrickDay = ({ stats, params }) =>
	stats.maxHattricksInDay >= params.count;
const sameScoreStreak = ({ stats, params }) =>
	stats.maxSameScoreStreak >= params.count;
const unluckyShootout = ({ stats, params }) => {
	// Aggregator only tracks the "4+" flavour right now.
	if (params.minOwnGoals === 4) return stats.hasUnluckyShootout4;
	return false;
};

/**
 * H2 — Achterbahn. Has the player ever experienced BOTH a 3+ goal
 * deficit AND a 3+ goal lead in the same match? Requires per-match
 * replay; uncommon path, so we walk on demand rather than store a
 * flag in the aggregate.
 *
 * @param {object} args
 * @param {Array<object>} args.matches
 * @param {string} args.playerId
 * @param {{ swing: number }} args.params
 * @returns {boolean}
 */
function rollercoaster({ matches, playerId, params }) {
	if (!Array.isArray(matches) || !playerId) return false;
	const swing = params.swing ?? 3;
	for (const match of matches) {
		const side = getPlayerSide(playerId, match);
		if (!side) continue;
		let homeRunning = 0;
		let awayRunning = 0;
		let maxDeficit = 0;
		let maxLead = 0;
		for (const g of match.goals) {
			if (g.period === "penalty") continue;
			if (g.side === "home") homeRunning += 1;
			else if (g.side === "away") awayRunning += 1;
			const lead =
				side === "home" ? homeRunning - awayRunning : awayRunning - homeRunning;
			if (lead > maxLead) maxLead = lead;
			if (-lead > maxDeficit) maxDeficit = -lead;
		}
		if (maxLead >= swing && maxDeficit >= swing) return true;
	}
	return false;
}

/**
 * Public registry. Lookup keys match `conditionKey` values in
 * `src/constants/trophies.constants.js`.
 */
export const trophyConditions = Object.freeze({
	totalWins,
	totalGoals,
	totalAssists,
	totalMatches,
	totalCleanSheets,
	peakElo,
	winRate,
	goalsInMatch,
	assistsInMatch,
	scorerPointsInMatch,
	cleanSheetWin,
	goalDifferenceWin,
	goalDifferenceExactWin,
	totalGoalsInMatchWin,
	maxWinStreak,
	maxCleanSheetStreak,
	endLossStreak,
	comebackWin,
	lateWinner,
	penaltyShootoutWin,
	perfectPenaltyShootout,
	penaltiesSavedInShootout,
	h2hWins,
	h2hMatches,
	h2hComeback,
	duoWins,
	duoWinRate,
	distinctWinningPartners,
	perfectDay,
	perfectWeek,
	earlyConceded,
	redCardWin,
	midnightMatch,
	hattrickDay,
	sameScoreStreak,
	unluckyShootout,
	rollercoaster,
});

/**
 * Resolve the trigger match id for a one-shot shape. Looks first in
 * the aggregator's `flagTriggerMatchId` map; falls back to null when
 * the shape resolves from a pure aggregate (e.g. totalWins).
 *
 * @param {string} flagKey
 * @param {object} stats
 * @returns {string | null}
 */
export function getFlagTriggerMatchId(flagKey, stats) {
	return stats?.flagTriggerMatchId?.[flagKey] ?? null;
}

// Re-export helpers so callers don't have to know which module exposes them.
export {
	didPlayerWin,
	getPlayerGoalsInMatch,
	getPlayerAssistsInMatch,
	getPlayerGoalDifferenceInMatch,
	getPlayerGoalsAgainstInMatch,
	getPlayerSide,
};
