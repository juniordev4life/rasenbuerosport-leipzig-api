import { query, queryOne } from "../helpers/database.helpers.js";

/**
 * Computes the date range of a given week (Mon 00:00 to Sun 23:59:59) for the
 * Friday of that week. The "wrapped" reflects the week ending on the Sunday after
 * the trigger Friday — i.e. the trigger Friday and the previous days back to Mon.
 * For a Friday-evening trigger, we cover Mon..Fri of the same week.
 * @param {Date} reference - reference date (the day the snapshot is generated)
 * @returns {{ weekStart: string, weekEnd: string }} ISO date strings (YYYY-MM-DD)
 */
export function getWeekRange(reference = new Date()) {
	const d = new Date(reference);
	const day = d.getUTCDay();
	const daysSinceMonday = (day + 6) % 7;
	const monday = new Date(d);
	monday.setUTCDate(d.getUTCDate() - daysSinceMonday);
	monday.setUTCHours(0, 0, 0, 0);

	const sunday = new Date(monday);
	sunday.setUTCDate(monday.getUTCDate() + 6);

	return {
		weekStart: monday.toISOString().slice(0, 10),
		weekEnd: sunday.toISOString().slice(0, 10),
	};
}

/**
 * Computes the wrapped payload for the given date range
 * @param {string} weekStart - YYYY-MM-DD
 * @param {string} weekEnd - YYYY-MM-DD
 * @returns {Promise<object>}
 */
export async function computeWrapped(weekStart, weekEnd) {
	const totalsRow = await queryOne(
		`SELECT COUNT(*)::int AS total_games,
			COALESCE(SUM(score_home + score_away), 0)::int AS total_goals
		FROM games
		WHERE played_at >= $1::date AND played_at < ($2::date + INTERVAL '1 day')`,
		[weekStart, weekEnd],
	);

	const mvpRow = await queryOne(
		`SELECT p.id, p.username, p.avatar_url, COUNT(*)::int AS wins
		FROM games g
		JOIN game_players gp ON gp.game_id = g.id
		JOIN profiles p ON p.id = gp.player_id
		WHERE g.played_at >= $1::date AND g.played_at < ($2::date + INTERVAL '1 day')
			AND (
				(gp.team = 'home' AND g.score_home > g.score_away)
				OR (gp.team = 'away' AND g.score_away > g.score_home)
			)
		GROUP BY p.id, p.username, p.avatar_url
		ORDER BY wins DESC, p.username ASC
		LIMIT 1`,
		[weekStart, weekEnd],
	);

	const topscorerRow = await queryOne(
		`SELECT p.id, p.username, p.avatar_url, COUNT(*)::int AS goals
		FROM games g
		CROSS JOIN LATERAL jsonb_array_elements(g.score_timeline) AS entry
		JOIN profiles p ON p.id = entry->>'scored_by'
		WHERE g.played_at >= $1::date AND g.played_at < ($2::date + INTERVAL '1 day')
			AND g.score_timeline IS NOT NULL
			AND entry->>'scored_by' IS NOT NULL
		GROUP BY p.id, p.username, p.avatar_url
		ORDER BY goals DESC, p.username ASC
		LIMIT 1`,
		[weekStart, weekEnd],
	);

	const mostActiveRow = await queryOne(
		`SELECT p.id, p.username, p.avatar_url, COUNT(*)::int AS games_played
		FROM games g
		JOIN game_players gp ON gp.game_id = g.id
		JOIN profiles p ON p.id = gp.player_id
		WHERE g.played_at >= $1::date AND g.played_at < ($2::date + INTERVAL '1 day')
		GROUP BY p.id, p.username, p.avatar_url
		ORDER BY games_played DESC, p.username ASC
		LIMIT 1`,
		[weekStart, weekEnd],
	);

	const duoRows = await query(
		`SELECT
			LEAST(gp1.player_id, gp2.player_id) AS p1_id,
			GREATEST(gp1.player_id, gp2.player_id) AS p2_id,
			COUNT(*)::int AS games,
			SUM(CASE
				WHEN gp1.team = 'home' AND g.score_home > g.score_away THEN 1
				WHEN gp1.team = 'away' AND g.score_away > g.score_home THEN 1
				ELSE 0
			END)::int AS wins
		FROM games g
		JOIN game_players gp1 ON gp1.game_id = g.id
		JOIN game_players gp2 ON gp2.game_id = g.id
			AND gp2.team = gp1.team
			AND gp2.player_id > gp1.player_id
		WHERE g.played_at >= $1::date AND g.played_at < ($2::date + INTERVAL '1 day')
			AND g.mode = '2v2'
		GROUP BY LEAST(gp1.player_id, gp2.player_id), GREATEST(gp1.player_id, gp2.player_id)
		HAVING COUNT(*) >= 2
		ORDER BY (SUM(CASE
			WHEN gp1.team = 'home' AND g.score_home > g.score_away THEN 1
			WHEN gp1.team = 'away' AND g.score_away > g.score_home THEN 1
			ELSE 0
		END)::float / COUNT(*)) DESC, COUNT(*) DESC
		LIMIT 1`,
		[weekStart, weekEnd],
	);

	let topDuo = null;
	if (duoRows.length > 0) {
		const duo = duoRows[0];
		const profiles = await query(
			`SELECT id, username, avatar_url FROM profiles WHERE id IN ($1, $2)`,
			[duo.p1_id, duo.p2_id],
		);
		const p1 = profiles.find((p) => p.id === duo.p1_id);
		const p2 = profiles.find((p) => p.id === duo.p2_id);
		topDuo = {
			players: [p1, p2].filter(Boolean),
			games: duo.games,
			wins: duo.wins,
			win_rate: duo.games > 0 ? duo.wins / duo.games : 0,
		};
	}

	return {
		total_games: totalsRow?.total_games ?? 0,
		total_goals: totalsRow?.total_goals ?? 0,
		mvp: mvpRow,
		topscorer: topscorerRow,
		most_active: mostActiveRow,
		top_duo: topDuo,
	};
}

/**
 * Generates and persists the wrapped for the week containing the given reference date.
 * Replaces an existing snapshot for the same week_start.
 * @param {Date} [reference]
 * @returns {Promise<object>} the saved row
 */
export async function generateWrapped(reference = new Date()) {
	const { weekStart, weekEnd } = getWeekRange(reference);
	const payload = await computeWrapped(weekStart, weekEnd);

	const row = await queryOne(
		`INSERT INTO weekly_wrapped (week_start, week_end, payload)
		VALUES ($1, $2, $3)
		ON CONFLICT (week_start) DO UPDATE
			SET payload = EXCLUDED.payload,
				week_end = EXCLUDED.week_end,
				generated_at = now()
		RETURNING *`,
		[weekStart, weekEnd, JSON.stringify(payload)],
	);

	return row;
}

/**
 * Returns the most recent wrapped snapshot, or null if none exists
 * @returns {Promise<object|null>}
 */
export async function getLatestWrapped() {
	return queryOne(
		`SELECT id, week_start, week_end, generated_at, payload
		FROM weekly_wrapped
		ORDER BY week_start DESC
		LIMIT 1`,
	);
}

/**
 * Returns all wrapped snapshots, newest first
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
export async function listWrapped(limit = 20) {
	return query(
		`SELECT id, week_start, week_end, generated_at, payload
		FROM weekly_wrapped
		ORDER BY week_start DESC
		LIMIT $1`,
		[limit],
	);
}
