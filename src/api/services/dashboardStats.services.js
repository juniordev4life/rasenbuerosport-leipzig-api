import { query, queryOne } from "../helpers/database.helpers.js";

/**
 * Gets the full game result history for a player (oldest first).
 * Returns one row per game with the player's W/D/L result.
 * @param {string} playerId
 * @param {string} [from]
 * @param {string} [to]
 * @returns {Promise<Array<{result: string, played_at: string}>>}
 */
export async function getFullResultHistory(playerId, from, to) {
	let sql = `
		SELECT g.played_at, g.score_home, g.score_away, gp.team
		FROM game_players gp
		JOIN games g ON g.id = gp.game_id
		WHERE gp.player_id = $1`;
	const params = [playerId];

	if (from) {
		params.push(from);
		sql += ` AND g.played_at >= $${params.length}`;
	}
	if (to) {
		params.push(to);
		sql += ` AND g.played_at <= $${params.length}`;
	}

	sql += " ORDER BY g.played_at ASC";

	const rows = await query(sql, params);

	return rows.map((row) => {
		const isHome = row.team === "home";
		const isDraw = row.score_home === row.score_away;
		const isWin = isHome
			? row.score_home > row.score_away
			: row.score_away > row.score_home;

		return {
			result: isDraw ? "D" : isWin ? "W" : "L",
			played_at: row.played_at,
		};
	});
}

/**
 * Computes rolling win rate from result history entries
 * @param {Array<{result: string}>} history - Sorted ASC
 * @returns {Array<{game_number: number, win_rate_10: number|null, win_rate_20: number|null}>}
 */
export function computeRollingWinRate(history) {
	const results = [];
	for (let i = 0; i < history.length; i++) {
		const gameNumber = i + 1;
		let winRate10 = null;
		let winRate20 = null;

		if (gameNumber >= 10) {
			const window10 = history.slice(i - 9, i + 1);
			const wins10 = window10.filter((g) => g.result === "W").length;
			winRate10 = Math.round((wins10 / 10) * 100);
		}

		if (gameNumber >= 20) {
			const window20 = history.slice(i - 19, i + 1);
			const wins20 = window20.filter((g) => g.result === "W").length;
			winRate20 = Math.round((wins20 / 20) * 100);
		}

		if (winRate10 !== null) {
			results.push({
				game_number: gameNumber,
				win_rate_10: winRate10,
				win_rate_20: winRate20,
			});
		}
	}
	return results;
}

/**
 * Gets xG vs actual goals for a player
 * @param {string} playerId
 * @param {string} [from]
 * @param {string} [to]
 * @returns {Promise<{total_xg: number, total_goals: number, games_with_xg: number}>}
 */
export async function getXgVsGoals(playerId, from, to) {
	let sql = `
		SELECT
			COALESCE(SUM(
				CASE WHEN gp.team = 'home' THEN (g.match_stats->'xg'->>'home')::numeric
					ELSE (g.match_stats->'xg'->>'away')::numeric END
			), 0) AS total_xg,
			COALESCE(SUM(
				CASE WHEN gp.team = 'home' THEN g.score_home ELSE g.score_away END
			), 0) AS total_goals,
			COUNT(*) AS games_with_xg
		FROM game_players gp
		JOIN games g ON g.id = gp.game_id
		WHERE gp.player_id = $1
			AND g.match_stats IS NOT NULL
			AND g.match_stats->'xg' IS NOT NULL`;
	const params = [playerId];

	if (from) {
		params.push(from);
		sql += ` AND g.played_at >= $${params.length}`;
	}
	if (to) {
		params.push(to);
		sql += ` AND g.played_at <= $${params.length}`;
	}

	const row = await queryOne(sql, params);
	return {
		total_xg: Number.parseFloat(Number(row?.total_xg || 0).toFixed(1)),
		total_goals: Number(row?.total_goals || 0),
		games_with_xg: Number(row?.games_with_xg || 0),
	};
}

/**
 * Gets game count per month for a player
 * @param {string} playerId
 * @param {string} [from]
 * @param {string} [to]
 * @returns {Promise<Array<{month: string, count: number}>>}
 */
export async function getGamesPerMonth(playerId, from, to) {
	let sql = `
		SELECT to_char(g.played_at, 'YYYY-MM') AS month, COUNT(*)::int AS count
		FROM game_players gp
		JOIN games g ON g.id = gp.game_id
		WHERE gp.player_id = $1`;
	const params = [playerId];

	if (from) {
		params.push(from);
		sql += ` AND g.played_at >= $${params.length}`;
	}
	if (to) {
		params.push(to);
		sql += ` AND g.played_at <= $${params.length}`;
	}

	sql += " GROUP BY month ORDER BY month ASC";
	return query(sql, params);
}

/**
 * Gets game count per weekday for a player
 * @param {string} playerId
 * @param {string} [from]
 * @param {string} [to]
 * @returns {Promise<Array<{weekday: number, count: number}>>}
 */
export async function getGamesPerWeekday(playerId, from, to) {
	let sql = `
		SELECT EXTRACT(DOW FROM g.played_at)::int AS weekday, COUNT(*)::int AS count
		FROM game_players gp
		JOIN games g ON g.id = gp.game_id
		WHERE gp.player_id = $1`;
	const params = [playerId];

	if (from) {
		params.push(from);
		sql += ` AND g.played_at >= $${params.length}`;
	}
	if (to) {
		params.push(to);
		sql += ` AND g.played_at <= $${params.length}`;
	}

	sql += " GROUP BY weekday ORDER BY weekday ASC";
	return query(sql, params);
}

/**
 * Gets team usage stats with win rate for a player (min 3 games)
 * @param {string} playerId
 * @param {string} [from]
 * @param {string} [to]
 * @returns {Promise<Array<{team_name: string, games: number, wins: number, win_rate: number}>>}
 */
export async function getTeamStats(playerId, from, to) {
	let sql = `
		SELECT gp.team_name,
			COUNT(*)::int AS games,
			SUM(CASE
				WHEN (gp.team = 'home' AND g.score_home > g.score_away)
					OR (gp.team = 'away' AND g.score_away > g.score_home) THEN 1 ELSE 0
			END)::int AS wins
		FROM game_players gp
		JOIN games g ON g.id = gp.game_id
		WHERE gp.player_id = $1
			AND gp.team_name IS NOT NULL`;
	const params = [playerId];

	if (from) {
		params.push(from);
		sql += ` AND g.played_at >= $${params.length}`;
	}
	if (to) {
		params.push(to);
		sql += ` AND g.played_at <= $${params.length}`;
	}

	sql +=
		" GROUP BY gp.team_name HAVING COUNT(*) >= 3 ORDER BY COUNT(*) DESC LIMIT 15";
	const rows = await query(sql, params);

	return rows.map((r) => ({
		team_name: r.team_name,
		games: r.games,
		wins: r.wins,
		win_rate: r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0,
	}));
}

/**
 * Gets the most common scores across all games
 * @param {string} [from]
 * @param {string} [to]
 * @returns {Promise<Array<{score: string, count: number}>>}
 */
export async function getCommonScores(from, to) {
	let sql = `
		SELECT
			CASE WHEN score_home >= score_away
				THEN score_home || '-' || score_away
				ELSE score_away || '-' || score_home
			END AS score,
			COUNT(*)::int AS count
		FROM games
		WHERE 1=1`;
	const params = [];

	if (from) {
		params.push(from);
		sql += ` AND played_at >= $${params.length}`;
	}
	if (to) {
		params.push(to);
		sql += ` AND played_at <= $${params.length}`;
	}

	sql += " GROUP BY score ORDER BY count DESC LIMIT 10";
	return query(sql, params);
}

/**
 * Gets the distribution of total goals per game
 * @param {string} [from]
 * @param {string} [to]
 * @returns {Promise<Array<{total_goals: number, count: number}>>}
 */
export async function getGoalsDistribution(from, to) {
	let sql = `
		SELECT (score_home + score_away)::int AS total_goals, COUNT(*)::int AS count
		FROM games
		WHERE 1=1`;
	const params = [];

	if (from) {
		params.push(from);
		sql += ` AND played_at >= $${params.length}`;
	}
	if (to) {
		params.push(to);
		sql += ` AND played_at <= $${params.length}`;
	}

	sql += " GROUP BY total_goals ORDER BY total_goals ASC";
	return query(sql, params);
}
