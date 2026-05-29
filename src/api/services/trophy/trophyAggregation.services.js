/**
 * Single-pass aggregator that turns a player's chronological match
 * history into the stats blob the trophy conditions consume.
 *
 * Pure JS. Takes already-normalized matches (see
 * `trophyMatchNormalizer.services.js`) so the SQL adapter is the only
 * place that needs to change if the storage layer ever moves.
 *
 * The blob carries two kinds of data:
 *   - Lifetime aggregates (totalWins, totalGoals, peakElo, …) for
 *     the threshold-driven trophies.
 *   - Per-match maxima (maxGoalsInMatch, hasComebackWin3Plus, …) so
 *     the one-shot match-shape trophies can be checked against the
 *     aggregate without re-scanning.
 *   - Side maps (h2hWinsByOpponent, duoWinsByPartner, dayKeyMap) for
 *     the comparator-driven trophies that need to know "best vs any
 *     opponent" or "best calendar day".
 */

import {
	didPlayerWin,
	getOpponents,
	getPartnerId,
	getPlayerAssistsInMatch,
	getPlayerGoalDifferenceInMatch,
	getPlayerGoalsAgainstInMatch,
	getPlayerGoalsInMatch,
	getPlayerSide,
} from "./trophyMatchNormalizer.services.js";

/**
 * Calendar-day key YYYY-MM-DD in the local timezone of the Date.
 * Trophy timing is wall-clock for the league — "an einem Tag" means
 * a date you'd write on a paper calendar, not a UTC window.
 *
 * @param {Date} date
 * @returns {string}
 */
function dayKey(date) {
	if (!date) return "";
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/**
 * ISO-week-ish key YYYY-Www. Calendar weeks are good enough for the
 * "perfect week" trophy — no need for ISO 8601 exactness, the league
 * doesn't span year boundaries weirdly.
 *
 * @param {Date} date
 * @returns {string}
 */
function weekKey(date) {
	if (!date) return "";
	const onejan = new Date(date.getFullYear(), 0, 1);
	const week = Math.ceil(
		((date.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7,
	);
	return `${date.getFullYear()}-W${week}`;
}

/**
 * Aggregate the focal player's full match history into the trophy
 * stats blob.
 *
 * @param {string} playerId
 * @param {Array<object>} matches - Normalized matches, chronological ASC.
 * @returns {object}
 */
export function aggregatePlayerForTrophies(playerId, matches) {
	const stats = {
		// Lifetime counters
		matches: 0,
		wins: 0,
		losses: 0,
		draws: 0,
		goals: 0,
		assists: 0,
		cleanSheets: 0,
		peakElo: 0,

		// Streaks (max over all time)
		maxWinStreak: 0,
		maxCleanSheetStreak: 0,
		maxSameScoreStreak: 0,

		// Match-shape one-shots — set to the max observed value so the
		// condition "did this player ever score N+ goals in a single
		// match" reduces to `maxGoalsInMatch >= N`.
		maxGoalsInMatch: 0,
		maxAssistsInMatch: 0,
		maxScorerPointsInMatch: 0,
		maxPenaltiesSavedInShootout: 0,

		// Boolean flags for single-event shapes
		hasCleanSheetWin: false,
		hasGoalDifferenceWin5Plus: false,
		hasGoalDifferenceExactWin1: false,
		hasTotalGoalsInMatchWin8Plus: false,
		hasComebackWin3Plus: false,
		hasLateWinner90: false,
		hasLateWinnerExtraTime: false,
		hasPerfectPenaltyShootout: false,
		hasPenaltyShootoutWin: false,
		hasEarlyConceded: false,
		hasRedCardWin: false,
		hasMidnightMatch: false,
		hasUnluckyShootout4: false,
		hadEndedLossStreak5Plus: false,

		// Side-maps
		winningPartners: new Set(),
		h2hWinsByOpponent: {},
		h2hMatchesByOpponent: {},
		duoWinsByPartner: {},
		duoMatchesByPartner: {},

		// Day/week clusters for perfect-day / perfect-week / hattrick-day
		bestDayWins: 0,
		bestWeekMatchesNoLoss: 0,
		maxHattricksInDay: 0,

		// Reference back to which match triggered each one-shot flag.
		// Useful so the backfill can stamp `triggered_by_match_id`.
		flagTriggerMatchId: {},
	};

	let currentWinStreak = 0;
	let currentCleanSheetStreak = 0;
	let currentLossStreak = 0;
	let lastScoreKey = null;
	let currentSameScoreStreak = 0;

	const dayBucket = new Map();
	const weekBucket = new Map();

	for (const match of matches) {
		const side = getPlayerSide(playerId, match);
		if (!side) continue;
		stats.matches += 1;

		const won = didPlayerWin(playerId, match);
		const lost = match.winnerSide !== null && match.winnerSide !== side;
		const isDraw = match.winnerSide === null;
		const goalsFor = getPlayerGoalsInMatch(playerId, match);
		const assistsFor = getPlayerAssistsInMatch(playerId, match);
		const goalsAgainst = getPlayerGoalsAgainstInMatch(playerId, match);
		const diff = getPlayerGoalDifferenceInMatch(playerId, match);

		// Lifetime counters
		stats.goals += goalsFor;
		stats.assists += assistsFor;
		if (won) stats.wins += 1;
		else if (lost) stats.losses += 1;
		else if (isDraw) stats.draws += 1;

		// Clean sheet — regular-time goals against == 0 counts even when
		// the shootout itself decided the match later.
		const isCleanSheet = goalsAgainst === 0;
		if (isCleanSheet) stats.cleanSheets += 1;

		// Streaks
		if (won) {
			currentWinStreak += 1;
			stats.maxWinStreak = Math.max(stats.maxWinStreak, currentWinStreak);

			if (currentLossStreak >= 5) {
				stats.hadEndedLossStreak5Plus = true;
				stats.flagTriggerMatchId.hadEndedLossStreak5Plus ??= match.id;
			}
			currentLossStreak = 0;

			// Same-score streak — only counts among consecutive wins by
			// the same final score.
			const scoreKey = `${match.scoreHome}:${match.scoreAway}`;
			if (scoreKey === lastScoreKey) currentSameScoreStreak += 1;
			else currentSameScoreStreak = 1;
			lastScoreKey = scoreKey;
			stats.maxSameScoreStreak = Math.max(
				stats.maxSameScoreStreak,
				currentSameScoreStreak,
			);
		} else {
			currentWinStreak = 0;
			currentSameScoreStreak = 0;
			lastScoreKey = null;
			if (lost) currentLossStreak += 1;
			else currentLossStreak = 0;
		}

		if (isCleanSheet) {
			currentCleanSheetStreak += 1;
			stats.maxCleanSheetStreak = Math.max(
				stats.maxCleanSheetStreak,
				currentCleanSheetStreak,
			);
		} else {
			currentCleanSheetStreak = 0;
		}

		// Per-match maxima + one-shot flags
		const scorerPoints = goalsFor + assistsFor;
		if (goalsFor > stats.maxGoalsInMatch) stats.maxGoalsInMatch = goalsFor;
		if (assistsFor > stats.maxAssistsInMatch)
			stats.maxAssistsInMatch = assistsFor;
		if (scorerPoints > stats.maxScorerPointsInMatch) {
			stats.maxScorerPointsInMatch = scorerPoints;
		}

		if (won && isCleanSheet && !stats.hasCleanSheetWin) {
			stats.hasCleanSheetWin = true;
			stats.flagTriggerMatchId.hasCleanSheetWin = match.id;
		}
		if (won && diff >= 5 && !stats.hasGoalDifferenceWin5Plus) {
			stats.hasGoalDifferenceWin5Plus = true;
			stats.flagTriggerMatchId.hasGoalDifferenceWin5Plus = match.id;
		}
		if (won && diff === 1 && !stats.hasGoalDifferenceExactWin1) {
			stats.hasGoalDifferenceExactWin1 = true;
			stats.flagTriggerMatchId.hasGoalDifferenceExactWin1 = match.id;
		}
		const totalGoalsInMatch = match.scoreHome + match.scoreAway;
		if (won && totalGoalsInMatch >= 8 && !stats.hasTotalGoalsInMatchWin8Plus) {
			stats.hasTotalGoalsInMatchWin8Plus = true;
			stats.flagTriggerMatchId.hasTotalGoalsInMatchWin8Plus = match.id;
		}

		// Late-winner shapes — was the focal player's own goal the one
		// that pushed the side ahead for good, in a winning match?
		if (won) {
			const lateGoalRegular = match.goals.find(
				(g) =>
					g.scorerId === playerId &&
					g.side === side &&
					typeof g.minute === "number" &&
					g.minute === 90,
			);
			if (lateGoalRegular && !stats.hasLateWinner90) {
				stats.hasLateWinner90 = true;
				stats.flagTriggerMatchId.hasLateWinner90 = match.id;
			}
			const lateGoalExtra = match.goals.find(
				(g) =>
					g.scorerId === playerId &&
					g.side === side &&
					typeof g.minute === "number" &&
					g.minute > 90 &&
					g.minute <= 120,
			);
			if (lateGoalExtra && !stats.hasLateWinnerExtraTime) {
				stats.hasLateWinnerExtraTime = true;
				stats.flagTriggerMatchId.hasLateWinnerExtraTime = match.id;
			}
		}

		// Penalty shootout shapes
		if (match.penaltyShootout) {
			const ownShots = match.penaltyShootout.shots.filter(
				(s) => s.shooterId === playerId,
			);
			const ownGoals = ownShots.filter((s) => s.result === "goal").length;
			const ownSaves = match.penaltyShootout.shots.filter(
				(s) => s.keeperId === playerId,
			).length;
			if (ownSaves > stats.maxPenaltiesSavedInShootout) {
				stats.maxPenaltiesSavedInShootout = ownSaves;
				stats.flagTriggerMatchId.maxPenaltiesSavedInShootout = match.id;
			}
			const playerShootoutSide =
				match.penaltyShootout.winnerSide === side ? "won" : "lost";
			if (
				playerShootoutSide === "won" &&
				ownShots.length > 0 &&
				ownShots.every((s) => s.result === "goal") &&
				!stats.hasPerfectPenaltyShootout
			) {
				stats.hasPerfectPenaltyShootout = true;
				stats.flagTriggerMatchId.hasPerfectPenaltyShootout = match.id;
			}
			if (playerShootoutSide === "won" && !stats.hasPenaltyShootoutWin) {
				stats.hasPenaltyShootoutWin = true;
				stats.flagTriggerMatchId.hasPenaltyShootoutWin = match.id;
			}
			if (
				playerShootoutSide === "lost" &&
				ownGoals >= 4 &&
				!stats.hasUnluckyShootout4
			) {
				stats.hasUnluckyShootout4 = true;
				stats.flagTriggerMatchId.hasUnluckyShootout4 = match.id;
			}
		}

		// Hidden shapes
		const earlyConcession = match.goals.find(
			(g) => g.side !== side && typeof g.minute === "number" && g.minute <= 1,
		);
		if (earlyConcession && !stats.hasEarlyConceded) {
			stats.hasEarlyConceded = true;
			stats.flagTriggerMatchId.hasEarlyConceded = match.id;
		}
		const ownRed = match.redCards.find((c) => c.playerId === playerId);
		if (ownRed && won && !stats.hasRedCardWin) {
			stats.hasRedCardWin = true;
			stats.flagTriggerMatchId.hasRedCardWin = match.id;
		}
		if (match.playedAt) {
			const hour = match.playedAt.getHours();
			if (hour >= 0 && hour < 4 && !stats.hasMidnightMatch) {
				stats.hasMidnightMatch = true;
				stats.flagTriggerMatchId.hasMidnightMatch = match.id;
			}
		}

		// Comeback win: at some point during the regular goals, the
		// focal side was behind by >=3, and they ended up winning. We
		// only count regular-time progression (period !== "penalty").
		if (won) {
			let maxDeficit = 0;
			let homeRunning = 0;
			let awayRunning = 0;
			for (const g of match.goals) {
				if (g.period === "penalty") continue;
				if (g.side === "home") homeRunning += 1;
				else if (g.side === "away") awayRunning += 1;
				const deficit =
					side === "home"
						? awayRunning - homeRunning
						: homeRunning - awayRunning;
				if (deficit > maxDeficit) maxDeficit = deficit;
			}
			if (maxDeficit >= 3 && !stats.hasComebackWin3Plus) {
				stats.hasComebackWin3Plus = true;
				stats.flagTriggerMatchId.hasComebackWin3Plus = match.id;
			}
		}

		// Peak ELO from the per-match snapshot
		const ratingAfter = match.eloAfter?.[playerId];
		if (typeof ratingAfter === "number" && ratingAfter > stats.peakElo) {
			stats.peakElo = ratingAfter;
		}

		// Partner / opponent maps
		const partner = getPartnerId(playerId, match);
		if (partner) {
			stats.duoMatchesByPartner[partner] =
				(stats.duoMatchesByPartner[partner] ?? 0) + 1;
			if (won) {
				stats.duoWinsByPartner[partner] =
					(stats.duoWinsByPartner[partner] ?? 0) + 1;
				stats.winningPartners.add(partner);
			}
		}
		for (const opp of getOpponents(playerId, match)) {
			stats.h2hMatchesByOpponent[opp] =
				(stats.h2hMatchesByOpponent[opp] ?? 0) + 1;
			if (won) {
				stats.h2hWinsByOpponent[opp] = (stats.h2hWinsByOpponent[opp] ?? 0) + 1;
			}
		}

		// Day / week buckets — store per-match summary for later passes
		if (match.playedAt) {
			const dKey = dayKey(match.playedAt);
			const wKey = weekKey(match.playedAt);
			let dayEntry = dayBucket.get(dKey);
			if (!dayEntry) {
				dayEntry = { wins: 0, losses: 0, matches: 0, hattricks: 0 };
				dayBucket.set(dKey, dayEntry);
			}
			dayEntry.matches += 1;
			if (won) dayEntry.wins += 1;
			else if (lost) dayEntry.losses += 1;
			if (goalsFor >= 3) dayEntry.hattricks += 1;

			let weekEntry = weekBucket.get(wKey);
			if (!weekEntry) {
				weekEntry = { matches: 0, losses: 0 };
				weekBucket.set(wKey, weekEntry);
			}
			weekEntry.matches += 1;
			if (lost) weekEntry.losses += 1;
		}
	}

	// Resolve day/week aggregates
	for (const entry of dayBucket.values()) {
		if (entry.losses === 0 && entry.wins > stats.bestDayWins) {
			stats.bestDayWins = entry.wins;
		}
		if (entry.hattricks > stats.maxHattricksInDay) {
			stats.maxHattricksInDay = entry.hattricks;
		}
	}
	for (const entry of weekBucket.values()) {
		if (entry.losses === 0 && entry.matches > stats.bestWeekMatchesNoLoss) {
			stats.bestWeekMatchesNoLoss = entry.matches;
		}
	}

	// Convert Set → number for the trophy comparator
	stats.distinctWinningPartners = stats.winningPartners.size;
	return stats;
}
