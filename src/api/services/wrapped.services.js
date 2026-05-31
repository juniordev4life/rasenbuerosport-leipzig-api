import { query, queryOne } from "../helpers/database.helpers.js";
import { pickMatchOfTheWeek } from "./matchOfTheWeek.services.js";

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
			AND (entry->>'event_type' IS NULL OR entry->>'event_type' = 'goal')
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

	// Match of the Week — best-effort, fail-soft. The wrapped payload is
	// still useful without it, and the AI call is the only thing that can
	// realistically fail here.
	//
	// The persisted shape carries enough lineup metadata for the frontend
	// to render a hero card (team names, per-side player avatars, result
	// type) without a second `/games/:id` round-trip. The narrative
	// report is intentionally NOT embedded — it lives on the match-
	// detail page where it has the room it needs; here we only link to
	// it.
	let matchOfTheWeek = null;
	try {
		const picked = await pickMatchOfTheWeek(weekStart, weekEnd);
		if (picked) {
			const lineup = await loadMatchLineup(picked.id);
			matchOfTheWeek = {
				game_id: picked.id,
				mode: picked.mode,
				score: `${picked.score_home}:${picked.score_away}`,
				score_home: picked.score_home,
				score_away: picked.score_away,
				result_type: picked.result_type,
				played_at: picked.played_at,
				drama_score: picked._drama_score,
				home_team_name: lineup.home.team_name,
				away_team_name: lineup.away.team_name,
				home_players: lineup.home.players,
				away_players: lineup.away.players,
			};
		}
	} catch (err) {
		console.warn("[wrapped] Match of the Week generation failed:", err.message);
	}

	const biggestRiser = await computeBiggestEloMover(weekStart, weekEnd, "desc");
	const biggestLoser = await computeBiggestEloMover(weekStart, weekEnd, "asc");
	const hottestStreak = await computeHottestStreak(weekStart, weekEnd);
	const trophiesThisWeek = await computeTrophiesThisWeek(weekStart, weekEnd);

	return {
		total_games: totalsRow?.total_games ?? 0,
		total_goals: totalsRow?.total_goals ?? 0,
		mvp: mvpRow,
		topscorer: topscorerRow,
		most_active: mostActiveRow,
		top_duo: topDuo,
		match_of_the_week: matchOfTheWeek,
		biggest_riser: biggestRiser,
		biggest_loser: biggestLoser,
		hottest_streak: hottestStreak,
		trophies_this_week: trophiesThisWeek,
	};
}

/**
 * Sum every player's ELO delta across all matches in the week and
 * pick either the biggest gainer (`direction = "desc"`) or the
 * biggest loser (`direction = "asc"`). Returns null when no game
 * touched ELO at all (empty week, or all snapshots missing).
 *
 * Each `games.elo_snapshot` is a JSONB shape `{ teamA: [...], teamB:
 * [...] }` where each entry has `playerId`, `ratingBefore`,
 * `ratingAfter`, `delta`. We unnest both teams in SQL, sum deltas,
 * and read the first/last `ratingBefore`/`ratingAfter` from the
 * chronologically-bordering snapshots — that way `eloFrom` and
 * `eloTo` reflect the actual rating the player carried into and out
 * of the week, not the synthetic sum-of-rounded-deltas.
 *
 * @param {string} weekStart - YYYY-MM-DD
 * @param {string} weekEnd - YYYY-MM-DD
 * @param {"asc"|"desc"} direction - "desc" for biggest gainer, "asc" for biggest loser
 * @returns {Promise<object|null>}
 * @example
 *   const riser = await computeBiggestEloMover("2026-05-25", "2026-05-31", "desc");
 *   // → { id, username, avatar_url, elo_from: 1718, elo_to: 1796, elo_delta: 78 }
 */
async function computeBiggestEloMover(weekStart, weekEnd, direction) {
	// Sum per-player deltas across the week. The CTE unnests both
	// teams of each game's elo_snapshot, sums the per-game deltas, and
	// reads `ratingBefore` from the chronologically FIRST snapshot
	// (DISTINCT ON, ASC) and `ratingAfter` from the LAST (DISTINCT ON,
	// DESC) for the same player. That gives us the true week-bordering
	// ratings, not the sum-of-rounded-deltas which can drift.
	const order = direction === "asc" ? "ASC" : "DESC";
	const row = await queryOne(
		`WITH per_game AS (
			SELECT g.id AS game_id,
			       g.played_at,
			       entry->>'playerId' AS player_id,
			       (entry->>'ratingBefore')::float AS rating_before,
			       (entry->>'ratingAfter')::float AS rating_after,
			       (entry->>'delta')::float AS delta
			FROM games g
			CROSS JOIN LATERAL jsonb_array_elements(
				COALESCE(g.elo_snapshot->'teamA', '[]'::jsonb)
				|| COALESCE(g.elo_snapshot->'teamB', '[]'::jsonb)
			) AS entry
			WHERE g.played_at >= $1::date
			  AND g.played_at < ($2::date + INTERVAL '1 day')
			  AND g.elo_snapshot IS NOT NULL
			  AND entry->>'playerId' IS NOT NULL
		),
		summed AS (
			SELECT player_id,
			       SUM(delta) AS total_delta
			FROM per_game
			GROUP BY player_id
		),
		bordered AS (
			SELECT s.player_id,
			       s.total_delta,
			       (SELECT rating_before FROM per_game
			          WHERE player_id = s.player_id
			          ORDER BY played_at ASC LIMIT 1) AS rating_from,
			       (SELECT rating_after FROM per_game
			          WHERE player_id = s.player_id
			          ORDER BY played_at DESC LIMIT 1) AS rating_to
			FROM summed s
		)
		SELECT p.id, p.username, p.avatar_url,
		       ROUND(b.rating_from)::int AS elo_from,
		       ROUND(b.rating_to)::int AS elo_to,
		       ROUND(b.total_delta)::int AS elo_delta
		FROM bordered b
		JOIN profiles p ON p.id = b.player_id
		ORDER BY b.total_delta ${order}, p.username ASC
		LIMIT 1`,
		[weekStart, weekEnd],
	);
	if (!row) return null;
	// For a "biggest loser" lookup, only return the row if the player
	// actually lost ELO. Same gate on the riser — no point claiming a
	// gainer when nobody gained.
	if (direction === "desc" && row.elo_delta <= 0) return null;
	if (direction === "asc" && row.elo_delta >= 0) return null;
	return row;
}

/**
 * Longest consecutive win streak inside the week, per player. We
 * scan every game chronologically and run through each player's
 * results, resetting on losses / draws and tracking the running max.
 *
 * The query returns rows sorted by `played_at` so the JS pass is
 * stable. Returns null when nobody put even a single win together.
 *
 * @param {string} weekStart - YYYY-MM-DD
 * @param {string} weekEnd - YYYY-MM-DD
 * @returns {Promise<object|null>}
 * @example
 *   const streak = await computeHottestStreak("2026-05-25", "2026-05-31");
 *   // → { id, username, avatar_url, wins_in_a_row: 7 }
 */
async function computeHottestStreak(weekStart, weekEnd) {
	const rows = await query(
		`SELECT gp.player_id,
		        g.played_at,
		        CASE
		            WHEN gp.team = 'home' AND g.score_home > g.score_away THEN 1
		            WHEN gp.team = 'away' AND g.score_away > g.score_home THEN 1
		            ELSE 0
		        END AS won
		FROM games g
		JOIN game_players gp ON gp.game_id = g.id
		WHERE g.played_at >= $1::date AND g.played_at < ($2::date + INTERVAL '1 day')
		ORDER BY gp.player_id, g.played_at ASC, g.id ASC`,
		[weekStart, weekEnd],
	);

	let bestPlayerId = null;
	let bestStreak = 0;
	let currentPlayer = null;
	let currentStreak = 0;
	for (const row of rows) {
		if (row.player_id !== currentPlayer) {
			currentPlayer = row.player_id;
			currentStreak = 0;
		}
		if (row.won === 1) {
			currentStreak += 1;
			if (currentStreak > bestStreak) {
				bestStreak = currentStreak;
				bestPlayerId = currentPlayer;
			}
		} else {
			currentStreak = 0;
		}
	}
	if (!bestPlayerId || bestStreak < 2) return null;

	const profile = await queryOne(
		"SELECT id, username, avatar_url FROM profiles WHERE id = $1",
		[bestPlayerId],
	);
	if (!profile) return null;
	return { ...profile, wins_in_a_row: bestStreak };
}

/**
 * Trophies that were live-unlocked inside the week, grouped by
 * player. `profiles.trophies` is a JSONB map keyed by trophy id,
 * each value carries `unlocked_at` + `backfilled`. Backfill entries
 * all share one timestamp (the Backfill run) which would otherwise
 * dominate one specific week; they are excluded by the
 * `(value->>'backfilled' IS DISTINCT FROM 'true')` predicate.
 *
 * The aggregate returns `{ count, breakdown: [...] }` so the
 * frontend can render either "4 neue Trophäen" with an avatar row
 * or fall back to the bare count.
 *
 * @param {string} weekStart - YYYY-MM-DD
 * @param {string} weekEnd - YYYY-MM-DD
 * @returns {Promise<{ count: number, breakdown: Array<object> }|null>}
 * @example
 *   const trophies = await computeTrophiesThisWeek("2026-05-25", "2026-05-31");
 *   // → { count: 4, breakdown: [
 *   //     { id, username, avatar_url, count: 2 }, ...
 *   //   ] }
 */
async function computeTrophiesThisWeek(weekStart, weekEnd) {
	const rows = await query(
		`SELECT p.id, p.username, p.avatar_url,
		        COUNT(*)::int AS unlock_count
		FROM profiles p
		CROSS JOIN LATERAL jsonb_each(COALESCE(p.trophies, '{}'::jsonb)) AS t(key, value)
		WHERE (value->>'backfilled') IS DISTINCT FROM 'true'
		  AND (value->>'unlocked_at')::timestamptz >= $1::date
		  AND (value->>'unlocked_at')::timestamptz < ($2::date + INTERVAL '1 day')
		GROUP BY p.id, p.username, p.avatar_url
		ORDER BY unlock_count DESC, p.username ASC`,
		[weekStart, weekEnd],
	);
	if (rows.length === 0) return { count: 0, breakdown: [] };
	const total = rows.reduce((sum, r) => sum + r.unlock_count, 0);
	return {
		count: total,
		breakdown: rows.map((r) => ({
			id: r.id,
			username: r.username,
			avatar_url: r.avatar_url,
			count: r.unlock_count,
		})),
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
 * Lineup snapshot for the Match-of-the-Week card. Loads each
 * participant's profile + the per-side team name (the FC26 club /
 * label the players selected when the match was created) and groups
 * the players by side.
 *
 * Designed for the card UI: the frontend renders home + away side
 * by side with player avatars and team names, then linkst to the
 * full match detail page. The shape is deliberately flat — id,
 * username, avatar_url — so a tap on a player can navigate to the
 * profile without an extra fetch.
 *
 * @param {string} gameId
 * @returns {Promise<{
 *   home: { team_name: string|null, players: Array<{id, username, avatar_url}> },
 *   away: { team_name: string|null, players: Array<{id, username, avatar_url}> }
 * }>}
 * @example
 *   const lineup = await loadMatchLineup("game-uuid-123");
 *   // → { home: { team_name: "Galatasaray", players: [...] }, away: {...} }
 */
async function loadMatchLineup(gameId) {
	const rows = await query(
		`SELECT gp.player_id, gp.team, gp.team_name,
		        p.username, p.avatar_url
		FROM game_players gp
		LEFT JOIN profiles p ON p.id = gp.player_id
		WHERE gp.game_id = $1
		ORDER BY gp.team, p.username`,
		[gameId],
	);
	const home = { team_name: null, players: [] };
	const away = { team_name: null, players: [] };
	for (const row of rows) {
		const bucket = row.team === "away" ? away : home;
		bucket.team_name = bucket.team_name ?? row.team_name;
		if (row.player_id) {
			bucket.players.push({
				id: row.player_id,
				username: row.username,
				avatar_url: row.avatar_url,
			});
		}
	}
	return { home, away };
}

/**
 * Pulls the matching talkshow episode (by `week_start`) for a wrapped
 * row and folds it into a `talkrunde` block on the row. Keeps the
 * separate-tables architecture but presents the joined shape the
 * frontend Wrapped page expects.
 *
 * Status mapping:
 *   - no episode persisted              → status "pending"
 *   - episode persisted, audio_url NULL → status "generating"
 *   - episode persisted, audio_url set  → status "ready"
 *
 * Duration is not currently tracked on `talkshow_episodes` — the
 * Talkrunde-Player reads it from the mp3 metadata itself. We surface
 * `duration_seconds: null` so the contract stays consistent with the
 * spec.
 *
 * @param {object|null} row - A wrapped row (or null)
 * @returns {Promise<object|null>}
 * @example
 *   const enriched = await embedTalkrunde(rawWrappedRow);
 *   // enriched.talkrunde = { status, audio_url, ... }
 */
async function embedTalkrunde(row) {
	if (!row) return row;
	const weekStart =
		typeof row.week_start === "string"
			? row.week_start
			: row.week_start.toISOString().slice(0, 10);
	const episode = await queryOne(
		`SELECT audio_url, generated_at
		   FROM talkshow_episodes
		  WHERE week_start = $1`,
		[weekStart],
	);
	let status = "pending";
	if (episode) status = episode.audio_url ? "ready" : "generating";
	return {
		...row,
		talkrunde: {
			status,
			audio_url: episode?.audio_url ?? null,
			duration_seconds: null,
			generated_at: episode?.generated_at ?? null,
		},
	};
}

/**
 * Returns the most recent wrapped snapshot, or null if none exists.
 * Folds the matching talkshow episode into a `talkrunde` block on
 * the response.
 *
 * @returns {Promise<object|null>}
 */
export async function getLatestWrapped() {
	const row = await queryOne(
		`SELECT id, week_start, week_end, generated_at, payload
		FROM weekly_wrapped
		ORDER BY week_start DESC
		LIMIT 1`,
	);
	return embedTalkrunde(row);
}

/**
 * Returns the wrapped snapshot for a specific Monday, or null when
 * the week has not been generated yet. Used by the Wrapped page's
 * week navigation (deep link to a specific week).
 *
 * @param {string} weekStart - YYYY-MM-DD (must be the Monday of the target week)
 * @returns {Promise<object|null>}
 * @example
 *   const wrapped = await getWrappedByWeekStart("2026-05-25");
 */
export async function getWrappedByWeekStart(weekStart) {
	const row = await queryOne(
		`SELECT id, week_start, week_end, generated_at, payload
		FROM weekly_wrapped
		WHERE week_start = $1`,
		[weekStart],
	);
	return embedTalkrunde(row);
}

/**
 * Returns all wrapped snapshots, newest first. Each row carries the
 * folded `talkrunde` block so the frontend list view can render
 * status pills without a second round-trip.
 *
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
export async function listWrapped(limit = 20) {
	const rows = await query(
		`SELECT id, week_start, week_end, generated_at, payload
		FROM weekly_wrapped
		ORDER BY week_start DESC
		LIMIT $1`,
		[limit],
	);
	return Promise.all(rows.map((r) => embedTalkrunde(r)));
}
