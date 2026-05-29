/**
 * Build the trophy-room response shape for a single player.
 *
 * Inputs:
 *   - `trophiesMap`: the persisted `profiles.trophies` JSONB. Keys
 *     are trophy IDs, values carry `unlocked_at` +
 *     `triggered_by_match_id`.
 *   - `stats`: aggregated stats blob produced by
 *     `aggregatePlayerForTrophies`. Drives the progress numbers for
 *     locked threshold trophies.
 *
 * Output mirrors what the Striker trophy room renders directly:
 *   {
 *     playerId,
 *     summary: { total, unlocked, byRarity, byCategory },
 *     latest:  { id, name, rarity, unlockedAt } | null,
 *     trophies: [
 *       earned   →  { id, ..., unlocked: true, unlockedAt, triggeredByMatchId },
 *       locked   →  { id, ..., unlocked: false, progress: {current,target,percent} | null },
 *       masked   →  { id, unlocked: false, masked: true, hidden: true, rarity, category }
 *     ]
 *   }
 *
 * The masking rule: a trophy with `hidden: true` AND not unlocked
 * yields a stripped-down entry — no name, no description, no
 * progress. Once unlocked, masking lifts.
 */

import { TROPHIES } from "../../../constants/trophies.constants.js";

/**
 * Progressable condition keys — locked trophies whose progress can
 * be expressed as `current / target`. One-shot conditions
 * (cleanSheetWin etc.) intentionally omit progress because "you
 * either did it or you didn't" doesn't fit a percent bar.
 */
const PROGRESSABLE_CONDITIONS = new Map([
	["totalWins", (stats) => stats.wins ?? 0],
	["totalGoals", (stats) => stats.goals ?? 0],
	["totalAssists", (stats) => stats.assists ?? 0],
	["totalMatches", (stats) => stats.matches ?? 0],
	["totalCleanSheets", (stats) => stats.cleanSheets ?? 0],
	["peakElo", (stats) => stats.peakElo ?? 0],
	["maxWinStreak", (stats) => stats.maxWinStreak ?? 0],
	["maxCleanSheetStreak", (stats) => stats.maxCleanSheetStreak ?? 0],
	["distinctWinningPartners", (stats) => stats.distinctWinningPartners ?? 0],
	[
		"h2hWins",
		(stats) => Math.max(0, ...Object.values(stats.h2hWinsByOpponent ?? {})),
	],
	[
		"h2hMatches",
		(stats) => Math.max(0, ...Object.values(stats.h2hMatchesByOpponent ?? {})),
	],
	[
		"duoWins",
		(stats) => Math.max(0, ...Object.values(stats.duoWinsByPartner ?? {})),
	],
	["goalsInMatch", (stats) => stats.maxGoalsInMatch ?? 0],
	["assistsInMatch", (stats) => stats.maxAssistsInMatch ?? 0],
	["scorerPointsInMatch", (stats) => stats.maxScorerPointsInMatch ?? 0],
	[
		"penaltiesSavedInShootout",
		(stats) => stats.maxPenaltiesSavedInShootout ?? 0,
	],
	["hattrickDay", (stats) => stats.maxHattricksInDay ?? 0],
	["sameScoreStreak", (stats) => stats.maxSameScoreStreak ?? 0],
	["perfectDay", (stats) => stats.bestDayWins ?? 0],
	["perfectWeek", (stats) => stats.bestWeekMatchesNoLoss ?? 0],
]);

/**
 * Compute the progress triple for a locked trophy. Returns null when
 * the trophy has no meaningful numeric progress (one-shot shapes).
 *
 * @param {object} trophy
 * @param {object} stats
 * @returns {{ current: number, target: number, percent: number } | null}
 */
function computeProgress(trophy, stats) {
	const getter = PROGRESSABLE_CONDITIONS.get(trophy.conditionKey);
	if (!getter) return null;
	const params = trophy.conditionParams ?? {};
	const target =
		params.threshold ??
		params.minMatches ??
		params.minWins ??
		params.count ??
		null;
	if (target == null) return null;
	const current = getter(stats);
	const percent = Math.min(
		100,
		Math.max(0, Math.round((current / target) * 100)),
	);
	return { current, target, percent };
}

/**
 * Pick the player's most recently unlocked trophy. Used by the
 * "Featured" card on the trophy room. Returns null when nothing is
 * unlocked yet.
 *
 * @param {Record<string, object>} trophiesMap
 * @returns {{ id: string, name: string, rarity: string, unlockedAt: string } | null}
 */
function findLatestUnlock(trophiesMap) {
	if (!trophiesMap) return null;
	let latestId = null;
	let latestAt = null;
	for (const [trophyId, entry] of Object.entries(trophiesMap)) {
		const unlockedAt = entry?.unlocked_at;
		if (!unlockedAt) continue;
		if (!latestAt || unlockedAt > latestAt) {
			latestId = trophyId;
			latestAt = unlockedAt;
		}
	}
	if (!latestId) return null;
	const def = TROPHIES.find((t) => t.id === latestId);
	if (!def) return null;
	return {
		id: latestId,
		name: def.name,
		rarity: def.rarity,
		unlockedAt: latestAt,
	};
}

/**
 * Build the full response payload for `GET /api/v1/players/:id/trophies`.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {Record<string, object> | null} args.trophiesMap - From profiles.trophies
 * @param {object} args.stats - Aggregated stats blob (matches → fed into the same aggregator the backfill uses)
 * @returns {object}
 */
export function buildTrophyResponse({ playerId, trophiesMap, stats }) {
	const trophies = [];
	const byRarity = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
	const byCategory = {};
	let unlockedCount = 0;

	for (const def of TROPHIES) {
		const persisted = trophiesMap?.[def.id];
		const unlocked = !!persisted;
		const isMasked = def.hidden && !unlocked;

		if (unlocked) {
			unlockedCount += 1;
			byRarity[def.rarity] = (byRarity[def.rarity] ?? 0) + 1;
			byCategory[def.category] = (byCategory[def.category] ?? 0) + 1;
		}

		if (isMasked) {
			trophies.push({
				id: def.id,
				category: def.category,
				rarity: def.rarity,
				hidden: true,
				masked: true,
				unlocked: false,
			});
			continue;
		}

		const entry = {
			id: def.id,
			category: def.category,
			name: def.name,
			description: def.description,
			rarity: def.rarity,
			hidden: def.hidden,
			scope: def.scope,
			unlocked,
		};
		if (unlocked) {
			entry.unlockedAt = persisted.unlocked_at ?? null;
			entry.triggeredByMatchId = persisted.triggered_by_match_id ?? null;
		} else {
			entry.progress = computeProgress(def, stats);
		}
		trophies.push(entry);
	}

	return {
		playerId,
		summary: {
			total: TROPHIES.length,
			unlocked: unlockedCount,
			byRarity,
			byCategory,
		},
		latest: findLatestUnlock(trophiesMap),
		trophies,
	};
}
