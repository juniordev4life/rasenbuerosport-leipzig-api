/**
 * Weekly talk-show data bundler. Pulls together everything the three
 * AI reporter personas (Marcel, Sophie, Frank) need to host their
 * Friday round-up of the office FIFA week — without re-implementing
 * aggregations that already live in `wrapped.services.js` and
 * `matchOfTheWeek.services.js`.
 *
 * The output of `buildShowContext` is the JSON that ships to Claude
 * for script generation. The structure mirrors the same "truth-first"
 * principles used in the match-report context: pre-resolved winners,
 * named drama signals, and curated key events instead of raw
 * timeline blobs.
 */

import { callAnthropicWithRetry } from "../helpers/ai.helpers.js";
import { query, queryOne } from "../helpers/database.helpers.js";
import {
	parseTalkshowScript,
	summariseScript,
} from "../utils/talkshowParser.utils.js";
import { buildTalkshowPrompt } from "../utils/talkshowPrompt.utils.js";
import { pickMatchOfTheWeek } from "./matchOfTheWeek.services.js";
import { getWeekRange } from "./wrapped.services.js";

/**
 * Compute Monday-of-week for a date. UTC-stable; matches the
 * convention used by `wrapped.services.js → getWeekRange`.
 *
 * @param {Date} date
 * @returns {Date}
 */
function previousWeekRange(weekStart) {
	const start = new Date(weekStart);
	const prevEnd = new Date(start);
	prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
	const prevStart = new Date(prevEnd);
	prevStart.setUTCDate(prevStart.getUTCDate() - 6);
	return {
		weekStart: prevStart.toISOString().slice(0, 10),
		weekEnd: prevEnd.toISOString().slice(0, 10),
	};
}

/**
 * League-wide game / goal / extra-time counters for a week. One SQL
 * round-trip; intentionally separate from `computeWrapped`'s totals
 * so we can add fields without touching the wrapped payload.
 *
 * @param {string} weekStart - ISO date.
 * @param {string} weekEnd - ISO date.
 * @returns {Promise<{
 *   total_games: number,
 *   total_goals: number,
 *   extra_time_games: number,
 *   penalty_shootouts: number,
 *   average_goals_per_game: number
 * }>}
 */
export async function buildLeagueSummary(weekStart, weekEnd) {
	const row = await query(
		`SELECT
			COUNT(*)::int AS total_games,
			COALESCE(SUM(score_home + score_away), 0)::int AS total_goals,
			COUNT(*) FILTER (WHERE result_type = 'extra_time')::int AS extra_time_games,
			COUNT(*) FILTER (WHERE result_type = 'penalties')::int AS penalty_shootouts
		FROM games
		WHERE played_at >= $1::date AND played_at < ($2::date + INTERVAL '1 day')`,
		[weekStart, weekEnd],
	);
	const r = row[0] ?? {};
	const totalGames = r.total_games ?? 0;
	const totalGoals = r.total_goals ?? 0;
	return {
		total_games: totalGames,
		total_goals: totalGoals,
		extra_time_games: r.extra_time_games ?? 0,
		penalty_shootouts: r.penalty_shootouts ?? 0,
		average_goals_per_game:
			totalGames > 0 ? Math.round((totalGoals / totalGames) * 10) / 10 : 0,
	};
}

/**
 * Per-player stats for a week. Wins/losses/games are derived from
 * `game_players` joined back onto `games`; goals are parsed from
 * `score_timeline`. Returns an array keyed by `player_id` with both
 * usernames and totals so callers can either sort or look players
 * up by id.
 *
 * @param {string} weekStart - ISO date.
 * @param {string} weekEnd - ISO date.
 * @returns {Promise<Array<{
 *   player_id: string, username: string,
 *   games: number, wins: number, losses: number, goals: number
 * }>>}
 */
export async function buildPlayerStatsForWeek(weekStart, weekEnd) {
	const rows = await query(
		`WITH per_player AS (
			SELECT
				gp.player_id,
				p.username,
				COUNT(*) AS games,
				SUM(CASE
					WHEN gp.team = 'home' AND g.score_home > g.score_away THEN 1
					WHEN gp.team = 'away' AND g.score_away > g.score_home THEN 1
					ELSE 0
				END) AS wins,
				SUM(CASE
					WHEN gp.team = 'home' AND g.score_home < g.score_away THEN 1
					WHEN gp.team = 'away' AND g.score_away < g.score_home THEN 1
					ELSE 0
				END) AS losses
			FROM games g
			JOIN game_players gp ON gp.game_id = g.id
			JOIN profiles p ON p.id = gp.player_id
			WHERE g.played_at >= $1::date AND g.played_at < ($2::date + INTERVAL '1 day')
			GROUP BY gp.player_id, p.username
		),
		goals_per_player AS (
			SELECT
				entry->>'scored_by' AS player_id,
				COUNT(*) AS goals
			FROM games g
			CROSS JOIN LATERAL jsonb_array_elements(g.score_timeline) AS entry
			WHERE g.played_at >= $1::date AND g.played_at < ($2::date + INTERVAL '1 day')
				AND g.score_timeline IS NOT NULL
				AND entry->>'scored_by' IS NOT NULL
				AND (entry->>'event_type' IS NULL OR entry->>'event_type' = 'goal')
			GROUP BY entry->>'scored_by'
		)
		SELECT
			pp.player_id,
			pp.username,
			pp.games::int AS games,
			pp.wins::int AS wins,
			pp.losses::int AS losses,
			COALESCE(gpp.goals, 0)::int AS goals
		FROM per_player pp
		LEFT JOIN goals_per_player gpp ON gpp.player_id = pp.player_id
		ORDER BY pp.username ASC`,
		[weekStart, weekEnd],
	);
	return rows;
}

/**
 * Identify the players whose form has improved or declined the most
 * versus the previous week. Returns up to `limit` risers and `limit`
 * fallers, sorted by absolute win-rate change. Players with fewer
 * than `minGames` games this week are excluded — too small a sample
 * to call a trend.
 *
 * @param {Array<{player_id:string, username:string, games:number, wins:number}>} thisWeek
 * @param {Array<{player_id:string, username:string, games:number, wins:number}>} lastWeek
 * @param {{ minGames?: number, limit?: number }} [options]
 * @returns {{ form_risers: Array<object>, form_fallers: Array<object> }}
 *
 * @example
 *   computeFormTrends(thisWeek, lastWeek, { minGames: 2, limit: 2 });
 *   // → { form_risers: [{ name, win_rate_change, ... }], form_fallers: [...] }
 */
export function computeFormTrends(thisWeek, lastWeek, options = {}) {
	const minGames = options.minGames ?? 2;
	const limit = options.limit ?? 2;
	const prevByPlayer = new Map(lastWeek.map((p) => [p.player_id, p]));

	const changes = [];
	for (const cur of thisWeek) {
		if (cur.games < minGames) continue;
		const prev = prevByPlayer.get(cur.player_id);
		const curRate = cur.wins / cur.games;
		const prevRate =
			prev && prev.games >= minGames ? prev.wins / prev.games : null;
		const change = prevRate == null ? null : curRate - prevRate;
		changes.push({
			player_id: cur.player_id,
			name: cur.username,
			win_rate_this_week: Math.round(curRate * 100) / 100,
			win_rate_last_week:
				prevRate == null ? null : Math.round(prevRate * 100) / 100,
			win_rate_change: change == null ? null : Math.round(change * 100) / 100,
			games_this_week: cur.games,
			wins_this_week: cur.wins,
		});
	}

	const withChange = changes.filter((c) => c.win_rate_change != null);
	const risers = withChange
		.filter((c) => c.win_rate_change > 0)
		.sort((a, b) => b.win_rate_change - a.win_rate_change)
		.slice(0, limit);
	const fallers = withChange
		.filter((c) => c.win_rate_change < 0)
		.sort((a, b) => a.win_rate_change - b.win_rate_change)
		.slice(0, limit);

	return { form_risers: risers, form_fallers: fallers };
}

/**
 * Pick player spotlights for the show. Prefers form movers (rising
 * + falling) so the Spieler-Spotlight block has a clear narrative
 * angle. Falls back to the topscorer of the week when no movers
 * qualify (early-season, low data).
 *
 * @param {{ form_risers: Array<object>, form_fallers: Array<object> }} trends
 * @param {Array<{player_id:string, username:string, goals:number, games:number, wins:number}>} thisWeek
 * @returns {Array<{ name: string, role: "rising"|"falling"|"topscorer", note: string, stats: object }>}
 */
export function buildPlayerSpotlights(trends, thisWeek) {
	const spotlights = [];
	for (const r of trends.form_risers) {
		spotlights.push({
			name: r.name,
			role: "rising",
			note: `Win-Rate von ${(r.win_rate_last_week ?? 0) * 100}% auf ${
				r.win_rate_this_week * 100
			}%`,
			stats: { games: r.games_this_week, wins: r.wins_this_week },
		});
	}
	for (const f of trends.form_fallers) {
		spotlights.push({
			name: f.name,
			role: "falling",
			note: `Win-Rate von ${(f.win_rate_last_week ?? 0) * 100}% auf ${
				f.win_rate_this_week * 100
			}%`,
			stats: { games: f.games_this_week, wins: f.wins_this_week },
		});
	}
	if (spotlights.length === 0) {
		const ts = [...thisWeek].sort((a, b) => b.goals - a.goals)[0];
		if (ts && ts.goals > 0) {
			spotlights.push({
				name: ts.username,
				role: "topscorer",
				note: `${ts.goals} Tore in ${ts.games} Spielen`,
				stats: { games: ts.games, goals: ts.goals },
			});
		}
	}
	return spotlights;
}

/**
 * Boil a game's `score_timeline` down to the events a reporter would
 * call out on air. Capped at `limit` entries so the LLM context stays
 * lean.
 *
 * @param {Array<object>} timeline - Raw `score_timeline` entries.
 * @param {Map<string,string>} nameMap - Player-id → username resolver.
 * @param {number} [limit=8]
 * @returns {Array<object>}
 */
export function buildKeyEvents(timeline, nameMap, limit = 8) {
	if (!Array.isArray(timeline)) return [];
	const events = [];
	for (const entry of timeline) {
		const minute = typeof entry?.minute === "number" ? entry.minute : null;
		if (entry?.event_type === "goal" || entry?.event_type === undefined) {
			events.push({
				minute,
				type: "goal",
				scorer: entry?.scored_by ? nameMap.get(entry.scored_by) : null,
				assist: entry?.assist_by ? nameMap.get(entry.assist_by) : null,
				goal_type: entry?.goal_type ?? "play",
			});
		} else if (
			entry?.event_type === "red_card" ||
			(entry?.event_type === "card" && entry?.card_type === "red")
		) {
			events.push({
				minute,
				type: "red_card",
				player: entry?.player_id ? nameMap.get(entry.player_id) : null,
			});
		} else if (entry?.event_type === "penalty_missed") {
			events.push({
				minute,
				type: "penalty_missed",
				shooter: entry?.shooter_id ? nameMap.get(entry.shooter_id) : null,
			});
		}
	}
	return events.slice(0, limit);
}

/**
 * Tag a game with high-level drama signals the LLM can drop into the
 * narrative without recomputing them. Reads `result_type` for
 * extra-time / penalty markers and walks the timeline for red cards,
 * late goals and comebacks (≥2-goal swing).
 *
 * @param {object} game - Raw game row.
 * @returns {string[]}
 *
 * @example
 *   buildDramaSignals(game);
 *   // → ["red_card_min_7", "extra_time_winner", "comeback_2_goal"]
 */
export function buildDramaSignals(game) {
	const signals = [];
	if (game?.result_type === "extra_time") signals.push("extra_time_winner");
	if (game?.result_type === "penalties") signals.push("penalty_shootout");

	const timeline = Array.isArray(game?.score_timeline)
		? game.score_timeline
		: [];

	let homePeak = 0;
	let awayPeak = 0;
	for (const entry of timeline) {
		const minute = typeof entry?.minute === "number" ? entry.minute : null;
		const isGoal =
			entry?.event_type === "goal" || entry?.event_type === undefined;
		if (
			entry?.event_type === "red_card" ||
			(entry?.event_type === "card" && entry?.card_type === "red")
		) {
			if (minute != null) signals.push(`red_card_min_${minute}`);
		}
		if (isGoal && minute != null && minute >= 85) {
			signals.push(`late_goal_min_${minute}`);
		}
		if (isGoal) {
			const h = typeof entry?.home === "number" ? entry.home : null;
			const a = typeof entry?.away === "number" ? entry.away : null;
			if (h != null && a != null) {
				if (a - h >= 2 && a > awayPeak) awayPeak = a - h;
				if (h - a >= 2 && h > homePeak) homePeak = h - a;
			}
		}
	}
	const finalHome = Number(game?.score_home ?? 0);
	const finalAway = Number(game?.score_away ?? 0);
	if (awayPeak >= 2 && finalHome >= finalAway) {
		signals.push(`comeback_${awayPeak}_goal`);
	} else if (homePeak >= 2 && finalAway >= finalHome) {
		signals.push(`comeback_${homePeak}_goal`);
	}
	return signals;
}

/**
 * Derive league winners (MVP / topscorer / most-active) directly from
 * the per-player stats array. Avoids re-running the same aggregations
 * that already live in `wrapped.services.js` — when the stats are
 * already in memory, a JS sort is cheaper than a round-trip per
 * winner.
 *
 * @param {Array<{username:string, games:number, wins:number, goals:number}>} stats
 * @returns {{
 *   mvp: { name: string, wins: number, games: number } | null,
 *   topscorer: { name: string, goals: number } | null,
 *   most_active: { name: string, games: number } | null
 * }}
 */
export function deriveWinners(stats) {
	if (!Array.isArray(stats) || stats.length === 0) {
		return { mvp: null, topscorer: null, most_active: null };
	}
	const byWins = [...stats]
		.filter((p) => p.wins > 0)
		.sort((a, b) => b.wins - a.wins || a.username.localeCompare(b.username));
	const byGoals = [...stats]
		.filter((p) => p.goals > 0)
		.sort((a, b) => b.goals - a.goals || a.username.localeCompare(b.username));
	const byGames = [...stats].sort(
		(a, b) => b.games - a.games || a.username.localeCompare(b.username),
	);
	return {
		mvp: byWins[0]
			? {
					name: byWins[0].username,
					wins: byWins[0].wins,
					games: byWins[0].games,
				}
			: null,
		topscorer: byGoals[0]
			? { name: byGoals[0].username, goals: byGoals[0].goals }
			: null,
		most_active: byGames[0]
			? { name: byGames[0].username, games: byGames[0].games }
			: null,
	};
}

/**
 * Resolve the rosters of a single game and build a name map plus
 * grouped home/away player lists. Same lookup the match-report
 * generator uses — talk-show shares the same player roster shape so
 * the LLM context stays consistent across both features.
 *
 * @param {string} gameId
 * @returns {Promise<{
 *   nameMap: Map<string,string>,
 *   homeTeamName: string,
 *   awayTeamName: string,
 *   homePlayers: string[],
 *   awayPlayers: string[]
 * }>}
 */
async function loadGameRoster(gameId) {
	const rows = await query(
		`SELECT gp.player_id, gp.team, gp.team_name, p.username
		FROM game_players gp
		LEFT JOIN profiles p ON p.id = gp.player_id
		WHERE gp.game_id = $1`,
		[gameId],
	);
	const nameMap = new Map();
	const homePlayers = [];
	const awayPlayers = [];
	let homeTeamName = "Heim";
	let awayTeamName = "Auswärts";
	for (const r of rows) {
		if (r.username) nameMap.set(r.player_id, r.username);
		if (r.team === "home") {
			if (r.team_name) homeTeamName = r.team_name;
			if (r.username) homePlayers.push(r.username);
		} else if (r.team === "away") {
			if (r.team_name) awayTeamName = r.team_name;
			if (r.username) awayPlayers.push(r.username);
		}
	}
	return { nameMap, homeTeamName, awayTeamName, homePlayers, awayPlayers };
}

/**
 * Pre-resolve the talk-show view of the match of the week. Combines
 * `pickMatchOfTheWeek` (drama-score selection) with the roster
 * lookup, curated key events, named drama signals and the outcome
 * block that the LLM needs to phrase the result correctly.
 *
 * Returns `null` when no game in the week clears the drama threshold.
 *
 * @param {string} weekStart - ISO date.
 * @param {string} weekEnd - ISO date.
 * @returns {Promise<object|null>}
 */
export async function buildMatchOfTheWeekContext(weekStart, weekEnd) {
	const game = await pickMatchOfTheWeek(weekStart, weekEnd);
	if (!game) return null;

	const { nameMap, homeTeamName, awayTeamName, homePlayers, awayPlayers } =
		await loadGameRoster(game.id);

	const scoreHome = Number(game.score_home ?? 0);
	const scoreAway = Number(game.score_away ?? 0);
	const winnerSide = scoreHome > scoreAway ? "home" : "away";
	const loserSide = winnerSide === "home" ? "away" : "home";
	const sideName = { home: homeTeamName, away: awayTeamName };
	const sidePlayers = { home: homePlayers, away: awayPlayers };

	return {
		game_id: game.id,
		mode: game.mode,
		score: `${scoreHome}:${scoreAway}`,
		result_type: game.result_type,
		played_at: game.played_at,
		drama_score: game._drama_score,
		teams: {
			home: { name: homeTeamName, players: homePlayers, score: scoreHome },
			away: { name: awayTeamName, players: awayPlayers, score: scoreAway },
		},
		outcome: {
			winner: winnerSide,
			winner_team_name: sideName[winnerSide],
			winner_players: sidePlayers[winnerSide],
			loser_team_name: sideName[loserSide],
			loser_players: sidePlayers[loserSide],
		},
		drama_signals: buildDramaSignals(game),
		key_events: buildKeyEvents(game.score_timeline, nameMap),
	};
}

/**
 * Assemble the full talk-show LLM context for a week. Combines the
 * existing wrapped aggregations with talk-show-specific extras:
 * league summary, form trends, player spotlights, curated key events
 * for the match of the week and named drama signals.
 *
 * @param {Date} [reference] - Any date inside the target week.
 * @returns {Promise<object>}
 */
export async function buildShowContext(reference = new Date()) {
	const { weekStart, weekEnd } = getWeekRange(reference);
	const prev = previousWeekRange(weekStart);

	const [leagueSummary, thisWeekStats, lastWeekStats, matchOfTheWeek] =
		await Promise.all([
			buildLeagueSummary(weekStart, weekEnd),
			buildPlayerStatsForWeek(weekStart, weekEnd),
			buildPlayerStatsForWeek(prev.weekStart, prev.weekEnd),
			buildMatchOfTheWeekContext(weekStart, weekEnd),
		]);

	const trends = computeFormTrends(thisWeekStats, lastWeekStats);
	const spotlights = buildPlayerSpotlights(trends, thisWeekStats);
	const winners = deriveWinners(thisWeekStats);

	return {
		week_start: weekStart,
		week_end: weekEnd,
		league_summary: leagueSummary,
		winners,
		trends,
		player_spotlights: spotlights,
		match_of_the_week: matchOfTheWeek,
		this_week_stats: thisWeekStats,
		show_metadata: {
			target_duration_seconds: 240,
			target_word_count: 480,
			blocks: [
				"intro",
				"match_of_the_week",
				"table_trends",
				"spotlight",
				"outro",
			],
			block_leads: {
				intro: "marcel",
				match_of_the_week: ["marcel", "frank"],
				table_trends: "sophie",
				spotlight: ["marcel", "frank"],
				outro: "marcel",
			},
			rule_sophie_always_present:
				"Sophie ist in JEDEM Block mindestens mit einem kurzen Einwurf vertreten — auch in Blöcken, die nicht ihr Lead-Block sind.",
		},
	};
}

/**
 * Call Claude with the talk-show prompt + the week's bundled context
 * and return both the raw script text and the parsed turn list. Does
 * not persist anything — see `generateAndPersistEpisode`.
 *
 * @param {object} context - Output of `buildShowContext`.
 * @returns {Promise<{ raw_script: string, turns: Array<object>, summary: object }>}
 */
export async function generateShowScript(context) {
	const prompt = buildTalkshowPrompt();
	const { text } = await callAnthropicWithRetry({
		model: "claude-sonnet-4-6",
		max_tokens: 2048,
		messages: [
			{
				role: "user",
				content: `${prompt}\n\nWochendaten:\n${JSON.stringify(context)}`,
			},
		],
	});
	const turns = parseTalkshowScript(text);
	const summary = summariseScript(turns);
	return { raw_script: text, turns, summary };
}

/**
 * Persist a freshly generated episode for the week. Upserts on
 * `week_start` so a re-run cleanly replaces the previous attempt.
 * Audio is generated in a separate step — this only stores the
 * script payload.
 *
 * @param {string} weekStart - ISO date.
 * @param {string} weekEnd - ISO date.
 * @param {object} scriptPayload - Full payload to store under `script_json`.
 * @returns {Promise<object>} The persisted row.
 */
export async function persistEpisode(weekStart, weekEnd, scriptPayload) {
	const row = await queryOne(
		`INSERT INTO talkshow_episodes (week_start, week_end, script_json, audio_url, generated_at)
		 VALUES ($1, $2, $3::jsonb, NULL, now())
		 ON CONFLICT (week_start) DO UPDATE
			SET week_end = EXCLUDED.week_end,
			    script_json = EXCLUDED.script_json,
			    audio_url = NULL,
			    generated_at = now()
		 RETURNING week_start, week_end, script_json, audio_url, generated_at`,
		[weekStart, weekEnd, JSON.stringify(scriptPayload)],
	);
	return row;
}

/**
 * One-shot: build the week's context, generate the script with
 * Claude, persist the episode row. Returns the persisted row so the
 * caller (Scheduler endpoint) can hand it straight to the TTS step.
 *
 * @param {Date} [reference] - Any date inside the target week.
 * @returns {Promise<object>}
 */
export async function generateAndPersistEpisode(reference = new Date()) {
	const context = await buildShowContext(reference);
	const { raw_script, turns, summary } = await generateShowScript(context);

	const payload = {
		raw_script,
		turns,
		summary,
		context_used: context,
		generator: { model: "claude-sonnet-4-6", version: 1 },
	};

	return persistEpisode(context.week_start, context.week_end, payload);
}

/**
 * Read the most-recent episode, or null if none exists.
 *
 * @returns {Promise<object|null>}
 */
export async function getLatestEpisode() {
	const row = await queryOne(
		`SELECT week_start, week_end, script_json, audio_url, generated_at
		 FROM talkshow_episodes
		 ORDER BY week_start DESC
		 LIMIT 1`,
	);
	return row ?? null;
}

/**
 * Read the episode for a specific week, or null if none exists.
 *
 * @param {string} weekStart - ISO date (Monday of the target week).
 * @returns {Promise<object|null>}
 */
export async function getEpisodeByWeek(weekStart) {
	const row = await queryOne(
		`SELECT week_start, week_end, script_json, audio_url, generated_at
		 FROM talkshow_episodes WHERE week_start = $1`,
		[weekStart],
	);
	return row ?? null;
}
