import { query } from "../helpers/database.helpers.js";
import {
	computePlayerWeekStatsPure,
	computeProgress,
	getWeekRangeBerlin,
	msUntilWeekEndBerlin,
	pickChallengesForWeek,
} from "../helpers/challenges.helpers.js";

const ACTIVE_CHALLENGES_PER_WEEK = 3;

/**
 * Resolve the active challenges for the current Berlin week — including the
 * caller's progress for each.
 *
 * Lazy-rotates when no `challenge_weeks` rows exist for the current week so
 * the system works without a Cloud Scheduler — the first GET each week
 * deterministically seeds the slate.
 *
 * @param {string} playerId
 * @returns {Promise<{
 *   week_start: string,
 *   week_end: string,
 *   ms_remaining: number,
 *   challenges: Array<object>,
 * }>}
 */
export async function getActiveChallengesForPlayer(playerId) {
	const now = new Date();
	const { weekStart, weekEnd } = getWeekRangeBerlin(now);

	let week = await query(
		`SELECT cw.id AS week_id, cd.id AS definition_id, cd.metric,
			cd.target_value, cd.reward_points, cd.difficulty,
			cd.label_de, cd.label_en, cd.description_de, cd.description_en, cd.emoji
		FROM challenge_weeks cw
		JOIN challenge_definitions cd ON cd.id = cw.definition_id
		WHERE cw.week_start = $1::date
		ORDER BY cd.difficulty, cd.target_value`,
		[weekStart],
	);

	if (week.length === 0) {
		await rotateForWeek(weekStart, weekEnd);
		week = await query(
			`SELECT cw.id AS week_id, cd.id AS definition_id, cd.metric,
				cd.target_value, cd.reward_points, cd.difficulty,
				cd.label_de, cd.label_en, cd.description_de, cd.description_en, cd.emoji
			FROM challenge_weeks cw
			JOIN challenge_definitions cd ON cd.id = cw.definition_id
			WHERE cw.week_start = $1::date
			ORDER BY cd.difficulty, cd.target_value`,
			[weekStart],
		);
	}

	const stats = await getPlayerWeekStats(playerId, weekStart, weekEnd);
	const challenges = week.map((c) => ({
		...c,
		progress: computeProgress(c, stats),
	}));

	return {
		week_start: weekStart,
		week_end: weekEnd,
		ms_remaining: Math.max(0, msUntilWeekEndBerlin(now)),
		challenges,
	};
}

/**
 * Past weeks in reverse-chronological order, each annotated with how the
 * caller fared on the active challenges of that week.
 *
 * @param {string} playerId
 * @param {number} [limit=12]
 * @returns {Promise<Array<{
 *   week_start: string,
 *   week_end: string,
 *   challenges: Array<object>,
 *   completed_count: number,
 *   reward_points: number,
 * }>>}
 */
export async function getChallengeHistory(playerId, limit = 12) {
	const { weekStart: currentStart } = getWeekRangeBerlin();

	const rows = await query(
		`SELECT cw.id AS week_id, cw.week_start, cw.week_end,
			cd.id AS definition_id, cd.metric,
			cd.target_value, cd.reward_points, cd.difficulty,
			cd.label_de, cd.label_en, cd.description_de, cd.description_en, cd.emoji
		FROM challenge_weeks cw
		JOIN challenge_definitions cd ON cd.id = cw.definition_id
		WHERE cw.week_start < $1::date
		ORDER BY cw.week_start DESC, cd.difficulty, cd.target_value
		LIMIT $2`,
		[currentStart, limit * ACTIVE_CHALLENGES_PER_WEEK],
	);

	const byWeek = new Map();
	for (const row of rows) {
		const key = String(row.week_start);
		if (!byWeek.has(key)) {
			byWeek.set(key, { week_start: key, week_end: row.week_end, items: [] });
		}
		byWeek.get(key).items.push(row);
	}

	const result = [];
	for (const { week_start, week_end, items } of byWeek.values()) {
		const stats = await getPlayerWeekStats(playerId, week_start, week_end);
		const challenges = items.map((c) => ({
			...c,
			progress: computeProgress(c, stats),
		}));
		const completedCount = challenges.filter(
			(c) => c.progress.completed,
		).length;
		const rewardPoints = challenges
			.filter((c) => c.progress.completed)
			.reduce((sum, c) => sum + c.reward_points, 0);
		result.push({
			week_start,
			week_end: String(week_end),
			challenges,
			completed_count: completedCount,
			reward_points: rewardPoints,
		});
	}

	return result.slice(0, limit);
}

/**
 * Cumulative bonus-points leaderboard across every completed weekly
 * challenge to date. Excludes the current (in-progress) week to avoid
 * showing speculative points.
 *
 * @param {number} [limit=20]
 * @returns {Promise<Array<{ player: object, total_points: number, weeks_completed: number }>>}
 */
export async function getChallengeLeaderboard(limit = 20) {
	const { weekStart: currentStart } = getWeekRangeBerlin();

	const weekRows = await query(
		`SELECT cw.week_start, cw.week_end,
			cd.metric, cd.target_value, cd.reward_points
		FROM challenge_weeks cw
		JOIN challenge_definitions cd ON cd.id = cw.definition_id
		WHERE cw.week_start < $1::date
		ORDER BY cw.week_start DESC`,
		[currentStart],
	);
	if (weekRows.length === 0) return [];

	const byWeek = new Map();
	for (const row of weekRows) {
		const key = String(row.week_start);
		if (!byWeek.has(key)) {
			byWeek.set(key, {
				week_start: key,
				week_end: String(row.week_end),
				challenges: [],
			});
		}
		byWeek.get(key).challenges.push(row);
	}

	const earliestStart = [...byWeek.keys()].sort()[0];
	const latestEnd = weekRows.reduce((max, r) => {
		const d = String(r.week_end);
		return d > max ? d : max;
	}, "0000-00-00");

	const players = await query(
		`SELECT DISTINCT p.id, p.username, p.avatar_url
		FROM profiles p
		JOIN game_players gp ON gp.player_id = p.id
		JOIN games g ON g.id = gp.game_id
		WHERE g.played_at >= $1::date AT TIME ZONE 'Europe/Berlin'
			AND g.played_at < (($2::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Berlin')`,
		[earliestStart, latestEnd],
	);

	const board = [];
	for (const player of players) {
		let totalPoints = 0;
		let weeksCompleted = 0;
		for (const week of byWeek.values()) {
			const stats = await getPlayerWeekStats(
				player.id,
				week.week_start,
				week.week_end,
			);
			let weekHadCompletion = false;
			for (const c of week.challenges) {
				const { completed } = computeProgress(c, stats);
				if (completed) {
					totalPoints += c.reward_points;
					weekHadCompletion = true;
				}
			}
			if (weekHadCompletion) weeksCompleted++;
		}
		if (totalPoints > 0) {
			board.push({
				player,
				total_points: totalPoints,
				weeks_completed: weeksCompleted,
			});
		}
	}

	board.sort(
		(a, b) =>
			b.total_points - a.total_points ||
			a.player.username.localeCompare(b.player.username),
	);
	return board.slice(0, limit);
}

/**
 * Insert challenge_weeks rows for the given week using the deterministic
 * pick algorithm. Idempotent — relies on `UNIQUE (week_start, definition_id)`
 * and `ON CONFLICT DO NOTHING`.
 *
 * Exported so a future Cloud Scheduler endpoint can call it directly.
 *
 * @param {string} weekStart YYYY-MM-DD
 * @param {string} weekEnd   YYYY-MM-DD
 * @returns {Promise<void>}
 */
export async function rotateForWeek(weekStart, weekEnd) {
	const definitions = await query(
		`SELECT id, difficulty FROM challenge_definitions WHERE active = TRUE`,
	);
	const picks = pickChallengesForWeek(
		definitions,
		weekStart,
		ACTIVE_CHALLENGES_PER_WEEK,
	);
	for (const def of picks) {
		await query(
			`INSERT INTO challenge_weeks (week_start, week_end, definition_id)
			VALUES ($1::date, $2::date, $3)
			ON CONFLICT (week_start, definition_id) DO NOTHING`,
			[weekStart, weekEnd, def.id],
		);
	}
}

/**
 * Fetch the calling player's stats for a Berlin-local week and aggregate
 * them through the pure helper. The DB query covers the full Berlin window
 * via `AT TIME ZONE 'Europe/Berlin'` so DST transitions are handled.
 *
 * @param {string} playerId
 * @param {string} weekStart YYYY-MM-DD
 * @param {string} weekEnd   YYYY-MM-DD
 * @returns {Promise<ReturnType<typeof computePlayerWeekStatsPure>>}
 */
async function getPlayerWeekStats(playerId, weekStart, weekEnd) {
	const games = await query(
		`SELECT g.id, g.mode, g.score_home, g.score_away, g.score_timeline, gp.team
		FROM games g
		JOIN game_players gp ON gp.game_id = g.id
		WHERE gp.player_id = $1
			AND g.played_at >= $2::date AT TIME ZONE 'Europe/Berlin'
			AND g.played_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Berlin')
		ORDER BY g.played_at ASC`,
		[playerId, weekStart, weekEnd],
	);

	const userTeams = {};
	for (const game of games) {
		userTeams[game.id] = game.team;
	}
	return computePlayerWeekStatsPure(games, userTeams, playerId);
}
