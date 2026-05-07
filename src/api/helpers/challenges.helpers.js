/**
 * Pure helpers for the weekly-challenges feature.
 *
 * Time-zone handling is anchored on Europe/Berlin so that ISO weeks line up
 * with how players experience the week locally — Mon 00:00 Berlin to
 * Sun 23:59:59 Berlin.
 */

import { filterGoals } from "./timeline.helpers.js";

/**
 * Compute the ISO week range (Monday → Sunday) containing the reference date,
 * interpreted in Europe/Berlin time. Returned as inclusive `YYYY-MM-DD`
 * strings so they can be passed straight to a `::date` SQL parameter.
 *
 * The implementation extracts the Berlin-local calendar day, anchors a UTC
 * date at noon (avoiding DST edges), then walks Monday-relative offsets.
 *
 * @param {Date} [reference]
 * @returns {{ weekStart: string, weekEnd: string }}
 * @example
 * // Wednesday 2026-05-06 in Berlin
 * getWeekRangeBerlin(new Date("2026-05-06T10:00:00+02:00"));
 * // → { weekStart: "2026-05-04", weekEnd: "2026-05-10" }
 */
export function getWeekRangeBerlin(reference = new Date()) {
	const berlinDate = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Berlin",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(reference);

	const [year, month, day] = berlinDate.split("-").map(Number);
	const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

	// JS day-of-week: 0=Sun, 1=Mon, ..., 6=Sat. Convert to Mon-based 0..6.
	const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;

	const monday = new Date(anchor);
	monday.setUTCDate(anchor.getUTCDate() - daysSinceMonday);
	const sunday = new Date(monday);
	sunday.setUTCDate(monday.getUTCDate() + 6);

	return {
		weekStart: monday.toISOString().slice(0, 10),
		weekEnd: sunday.toISOString().slice(0, 10),
	};
}

/**
 * Number of milliseconds remaining until the end of the Berlin-local week
 * that contains `reference` (Sunday 23:59:59.999 Berlin).
 *
 * @param {Date} [reference]
 * @returns {number}
 * @example
 * msUntilWeekEndBerlin(new Date("2026-05-08T22:00:00+02:00")); // ~ 2 days
 */
export function msUntilWeekEndBerlin(reference = new Date()) {
	const { weekEnd } = getWeekRangeBerlin(reference);
	// Convert weekEnd (Berlin date) to the corresponding UTC instant for
	// 23:59:59.999 Berlin. We don't know Berlin's offset directly, but
	// formatting the end-of-day Berlin string and asking the platform to parse
	// it back through Intl yields the correct instant.
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone: "Europe/Berlin",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});

	// Find the UTC instant that, when shown in Berlin, reads as
	// `weekEnd` 23:59:59. Binary search the offset: Berlin is UTC+1 (winter)
	// or UTC+2 (summer); try both and pick the one whose Berlin display
	// matches the target.
	const [y, m, d] = weekEnd.split("-").map(Number);
	for (const offset of [-2, -1]) {
		const candidate = new Date(
			Date.UTC(y, m - 1, d, 23, 0, 0, 0) + offset * 3600 * 1000,
		);
		// Set seconds + ms to 59.999 *after* offset is applied
		candidate.setUTCSeconds(59, 999);
		candidate.setUTCMinutes(59);
		const parts = fmt.formatToParts(candidate);
		const map = Object.fromEntries(
			parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
		);
		if (
			Number(map.year) === y &&
			Number(map.month) === m &&
			Number(map.day) === d &&
			Number(map.hour) === 23 &&
			Number(map.minute) === 59
		) {
			return candidate.getTime() - reference.getTime();
		}
	}
	// Fallback: assume UTC+1
	const fallback = new Date(Date.UTC(y, m - 1, d, 22, 59, 59, 999));
	return fallback.getTime() - reference.getTime();
}

/**
 * Aggregate one player's relevant week-stats from the games they played in
 * the window. Pure — no DB access.
 *
 * The caller is responsible for filtering games to a single player and a
 * single Berlin week range. `userTeams` maps `gameId → "home" | "away"` so
 * we know which side the user was on without re-querying.
 *
 * @param {Array<{ id: string, mode: string, score_home: number, score_away: number, score_timeline: any[] | null }>} games
 * @param {Record<string, "home"|"away">} userTeams
 * @param {string} userId
 * @returns {{
 *   goals_scored: number,
 *   clean_sheets: number,
 *   wins: number,
 *   games_played: number,
 *   hattricks: number,
 *   comeback_wins: number,
 *   duo_wins: number,
 * }}
 *
 * @example
 *   const stats = computePlayerWeekStatsPure(games, { g1: "home" }, "u1");
 *   // → { goals_scored: 4, clean_sheets: 1, wins: 2, ... }
 */
export function computePlayerWeekStatsPure(games, userTeams, userId) {
	let goalsScored = 0;
	let cleanSheets = 0;
	let wins = 0;
	let gamesPlayed = 0;
	let hattricks = 0;
	let comebackWins = 0;
	let duoWins = 0;

	for (const game of games) {
		const team = userTeams[game.id];
		if (!team) continue;

		gamesPlayed++;

		const userScore = team === "home" ? game.score_home : game.score_away;
		const oppScore = team === "home" ? game.score_away : game.score_home;
		const isWin = userScore > oppScore;
		if (isWin) wins++;
		if (isWin && oppScore === 0) cleanSheets++;
		if (isWin && game.mode && game.mode.includes("2v2")) duoWins++;

		const goalEvents = filterGoals(game.score_timeline);
		const personalGoals = goalEvents.filter(
			(e) => e.scored_by === userId,
		).length;
		// Fallback for legacy 1v1 entries where scored_by was never recorded:
		// every goal of the user's side is theirs.
		if (personalGoals === 0 && game.mode === "1v1") {
			goalsScored += userScore;
			if (userScore >= 3) hattricks++;
		} else {
			goalsScored += personalGoals;
			if (personalGoals >= 3) hattricks++;
		}

		// Comeback: walk goals, track running tally, see if user-side ever
		// trailed by ≥2 before winning.
		if (isWin && goalEvents.length >= 3) {
			let userRun = 0;
			let oppRun = 0;
			for (const entry of goalEvents) {
				if (entry.team === team) {
					userRun++;
				} else {
					oppRun++;
				}
				if (oppRun - userRun >= 2) {
					comebackWins++;
					break;
				}
			}
		}
	}

	return {
		goals_scored: goalsScored,
		clean_sheets: cleanSheets,
		wins,
		games_played: gamesPlayed,
		hattricks,
		comeback_wins: comebackWins,
		duo_wins: duoWins,
	};
}

/**
 * Read the current value for a metric out of a player-week-stats object.
 * Switching here keeps the metric column free-form (no enum lock-in) — new
 * metrics need a single new case rather than a schema migration.
 *
 * @param {string} metric
 * @param {ReturnType<typeof computePlayerWeekStatsPure>} stats
 * @returns {number}
 * @example
 *   currentValueFor("goals_scored", { goals_scored: 4, ... }); // → 4
 */
export function currentValueFor(metric, stats) {
	switch (metric) {
		case "goals_scored":
			return stats.goals_scored;
		case "clean_sheets":
			return stats.clean_sheets;
		case "wins":
			return stats.wins;
		case "games_played":
			return stats.games_played;
		case "hattricks":
			return stats.hattricks;
		case "comeback_wins":
			return stats.comeback_wins;
		case "duo_wins":
			return stats.duo_wins;
		default:
			return 0;
	}
}

/**
 * Compute the progress payload returned by the API for a single challenge.
 *
 * @param {{ metric: string, target_value: number }} challenge
 * @param {ReturnType<typeof computePlayerWeekStatsPure>} stats
 * @returns {{ current: number, target: number, completed: boolean }}
 */
export function computeProgress(challenge, stats) {
	const current = currentValueFor(challenge.metric, stats);
	return {
		current,
		target: challenge.target_value,
		completed: current >= challenge.target_value,
	};
}

/**
 * Deterministically pick `count` challenges from the active set for a given
 * week. The same `weekStart` always selects the same items in the same order
 * so the lazy-rotate path is reproducible and idempotent.
 *
 * Strategy: hash `weekStart` × each definition's id into a 32-bit integer,
 * sort ascending, take the top `count`. For variety, we lightly weight by
 * difficulty so a typical week mixes one easy / one medium / one hard.
 *
 * @param {Array<{ id: string, difficulty: string }>} definitions
 * @param {string} weekStart
 * @param {number} [count=3]
 * @returns {Array<{ id: string, difficulty: string }>}
 */
export function pickChallengesForWeek(definitions, weekStart, count = 3) {
	if (!definitions.length) return [];

	const buckets = { easy: [], medium: [], hard: [] };
	for (const def of definitions) {
		const bucket = buckets[def.difficulty] ?? buckets.medium;
		bucket.push(def);
	}

	const seed = hashString(weekStart);
	for (const key of Object.keys(buckets)) {
		buckets[key] = buckets[key]
			.map((def) => ({ def, key: hashString(`${seed}:${def.id}`) }))
			.sort((a, b) => a.key - b.key)
			.map((x) => x.def);
	}

	// Round-robin easy → medium → hard until we have `count` items, falling
	// back to whatever's left when a bucket runs out.
	const order = ["easy", "medium", "hard"];
	const picked = [];
	let cursor = 0;
	while (picked.length < count) {
		const exhausted = order.every((k) => buckets[k].length === 0);
		if (exhausted) break;
		const bucket = buckets[order[cursor % order.length]];
		if (bucket.length > 0) picked.push(bucket.shift());
		cursor++;
		if (cursor > order.length * count) break;
	}

	return picked;
}

/**
 * 32-bit FNV-1a hash. Chosen for being tiny, deterministic, and dependency
 * free — we are not relying on it for security, only for stable pseudo-
 * random ordering keyed off the week start.
 *
 * @param {string} input
 * @returns {number}
 */
function hashString(input) {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}
