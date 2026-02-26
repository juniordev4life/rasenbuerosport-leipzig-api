import { getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Calculates leaderboard: 3 points for win, 1 for draw, 0 for loss
 * @param {number} limit
 * @param {string} [from] - Optional start date (ISO format, e.g. "2026-01-01")
 * @param {string} [to] - Optional end date (ISO format, e.g. "2026-01-31")
 * @returns {Promise<object[]>}
 */
export async function getLeaderboard(limit = 10, from, to) {
	const supabase = getSupabaseAdmin();

	let query = supabase
		.from("games")
		.select(`
			id,
			score_home,
			score_away,
			played_at,
			game_players (
				player_id,
				team,
				profiles:player_id (username, avatar_url)
			)
		`);

	if (from) {
		query = query.gte("played_at", from);
	}
	if (to) {
		query = query.lte("played_at", to);
	}

	const { data: games, error } = await query;

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	const playerPoints = {};
	/** @type {Record<string, Array<{played_at: string, result: string, clean_sheet: boolean, goals_scored: number}>>} */
	const playerResults = {};

	for (const game of games) {
		const isHomeWin = game.score_home > game.score_away;
		const isDraw = game.score_home === game.score_away;

		for (const gp of game.game_players) {
			const id = gp.player_id;
			if (!playerPoints[id]) {
				playerPoints[id] = {
					player_id: id,
					username: gp.profiles?.username || "Unknown",
					avatar_url: gp.profiles?.avatar_url,
					points: 0,
					wins: 0,
					draws: 0,
					losses: 0,
					games: 0,
					last_played_at: null,
					current_streak: null,
					badges: [],
				};
				playerResults[id] = [];
			}

			playerPoints[id].games += 1;

			// Track most recent game
			if (!playerPoints[id].last_played_at || game.played_at > playerPoints[id].last_played_at) {
				playerPoints[id].last_played_at = game.played_at;
			}

			const isWinner =
				(gp.team === "home" && isHomeWin) ||
				(gp.team === "away" && !isHomeWin && !isDraw);

			// Clean sheet: opponent scored 0 and player won
			const conceded = gp.team === "home" ? game.score_away : game.score_home;
			const cleanSheet = isWinner && conceded === 0;

			// Goals scored by player's team
			const goalsScored = gp.team === "home" ? game.score_home : game.score_away;

			if (isDraw) {
				playerPoints[id].points += 1;
				playerPoints[id].draws += 1;
				playerResults[id].push({ played_at: game.played_at, result: "draw", clean_sheet: false, goals_scored: goalsScored });
			} else if (isWinner) {
				playerPoints[id].points += 3;
				playerPoints[id].wins += 1;
				playerResults[id].push({ played_at: game.played_at, result: "win", clean_sheet: cleanSheet, goals_scored: goalsScored });
			} else {
				playerPoints[id].losses += 1;
				playerResults[id].push({ played_at: game.played_at, result: "loss", clean_sheet: false, goals_scored: goalsScored });
			}
		}
	}

	// Calculate streaks and badges per player
	for (const id of Object.keys(playerPoints)) {
		const results = playerResults[id];
		playerPoints[id].current_streak = calculatePlayerStreak(results);
		playerPoints[id].badges = calculateBadges(results);
	}

	return Object.values(playerPoints)
		.sort((a, b) => b.points - a.points)
		.slice(0, limit);
}

/**
 * Calculates the current win/loss streak from a player's game results
 * @param {Array<{played_at: string, result: string}>} results
 * @returns {{ type: string, count: number }|null}
 */
function calculatePlayerStreak(results) {
	if (!results.length) return null;

	// Sort by played_at descending (most recent first)
	const sorted = [...results].sort(
		(a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime(),
	);

	let streakType = null;
	let streakCount = 0;

	for (const { result } of sorted) {
		// Skip draws at the start
		if (streakType === null && result === "draw") continue;

		if (streakType === null) {
			streakType = result;
			streakCount = 1;
		} else if (result === streakType) {
			streakCount++;
		} else if (result === "draw") {
			// Draws in the middle don't break the streak
			continue;
		} else {
			break;
		}
	}

	if (!streakType || streakCount < 2) return null;
	return { type: streakType, count: streakCount };
}

/**
 * Calculates active badges (wall, scorer) from recent game results.
 * Multiple badges can be active at the same time.
 * @param {Array<{played_at: string, result: string, clean_sheet: boolean, goals_scored: number}>} results
 * @returns {Array<{type: string, count: number}>}
 */
function calculateBadges(results) {
	if (!results.length) return [];

	const sorted = [...results].sort(
		(a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime(),
	);

	const badges = [];

	// Wall: consecutive wins with clean sheet (opponent scored 0)
	const wallCount = countConsecutive(sorted, (r) => r.clean_sheet);
	if (wallCount >= 2) {
		badges.push({ type: "wall", count: wallCount });
	}

	// Scorer: consecutive games with 3+ goals scored
	const scorerCount = countConsecutive(sorted, (r) => r.goals_scored >= 3);
	if (scorerCount >= 2) {
		badges.push({ type: "scorer", count: scorerCount });
	}

	return badges;
}

/**
 * Counts consecutive games from the most recent where a condition is true
 * @param {Array<object>} sortedResults - Results sorted descending by date
 * @param {Function} condition - Predicate function
 * @returns {number}
 */
function countConsecutive(sortedResults, condition) {
	let count = 0;
	for (const result of sortedResults) {
		if (condition(result)) {
			count++;
		} else {
			break;
		}
	}
	return count;
}
