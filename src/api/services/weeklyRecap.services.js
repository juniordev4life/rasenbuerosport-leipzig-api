import {
	callAnthropicWithRetry,
	findFabricatedNames,
} from "../helpers/ai.helpers.js";
import {
	computePlayerWeekStatsPure,
	formatBerlinDate,
	getWeekRangeBerlin,
} from "../helpers/challenges.helpers.js";
import { query, queryOne } from "../helpers/database.helpers.js";
import { getActiveChallengesForPlayer } from "./challenges.services.js";

const RECAP_PROMPT = `Du bist ein persönlicher Coach für einen Spieler der Rasenbürosport Leipzig Liga (auch "Rasenbürosport Liga Leipzig" oder kurz "Bürosport Liga"). Die Liga heißt NIEMALS "FIFA-Liga" oder "FC-Liga". Geschrieben wird über Spiele in EA Sports FC / FC26 — gespielt am Controller auf der Konsole, NICHT am Tischkicker / Tischfußball. Wenn Du Gaming-Vokabular brauchst, sag ruhig "am Controller", "an der Konsole", "in der Bürosport Liga" oder "auf dem virtuellen Rasen". Vermeide das Wort "Kicker" (Verwechslungsgefahr Tischkicker).

Schreibe einen Wochenrückblick für den Spieler in der zweiten Person Singular ("Du"), auf Deutsch.

Regeln:
- 4-7 Sätze, lockerer Ton
- Beziehe konkrete Zahlen aus \`week_stats\` ein (Spiele, Siege, Tore, Vorlagen)
- Wenn \`challenges_completed_this_week\` nicht leer ist: erwähne die Challenges + Punkte
- Wenn \`top_opponent\` gesetzt ist: erwähne ihn namentlich
- Wenn \`vs_last_week\` Verbesserung/Rückschritt zeigt: einbauen ("besser als letzte Woche", "drei Spiele weniger als letzte Woche")
- Bei null Spielen: motivierend, aber kurz ("Diese Woche noch kein Match — Zeit, den Controller in die Hand zu nehmen")
- KEINE Spielernamen erfinden. Nutze nur Namen aus \`top_opponent\` oder dem aufrufenden \`player.name\`
- Kein Markdown, nur Fließtext
- Gib NUR den Rückblick zurück, keine Einleitung`;

/**
 * Counts of games / wins / losses / draws / goals / assists for one
 * player in a given Berlin week. Uses the same pure-function pipeline
 * as the challenges service so the numbers line up across endpoints.
 *
 * @param {string} playerId
 * @param {string} weekStart YYYY-MM-DD
 * @param {string} weekEnd   YYYY-MM-DD
 * @returns {Promise<{
 *   games_played: number,
 *   wins: number,
 *   losses: number,
 *   draws: number,
 *   goals_scored: number,
 *   assists: number,
 *   clean_sheets: number,
 *   hattricks: number,
 *   comeback_wins: number,
 * }>}
 */
async function getWeekStats(playerId, weekStart, weekEnd) {
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
	for (const g of games) userTeams[g.id] = g.team;
	const stats = computePlayerWeekStatsPure(games, userTeams, playerId);

	let losses = 0;
	let draws = 0;
	let assists = 0;
	for (const g of games) {
		const team = userTeams[g.id];
		const userScore = team === "home" ? g.score_home : g.score_away;
		const oppScore = team === "home" ? g.score_away : g.score_home;
		if (userScore < oppScore) losses++;
		else if (userScore === oppScore) draws++;
		const tl = Array.isArray(g.score_timeline) ? g.score_timeline : [];
		for (const e of tl) {
			if (
				(!e.event_type || e.event_type === "goal") &&
				e.assist_by === playerId
			) {
				assists++;
			}
		}
	}

	return {
		games_played: stats.games_played,
		wins: stats.wins,
		losses,
		draws,
		goals_scored: stats.goals_scored,
		assists,
		clean_sheets: stats.clean_sheets,
		hattricks: stats.hattricks,
		comeback_wins: stats.comeback_wins,
	};
}

/**
 * Most-faced opponent in the given week. Returns username + count, or
 * null if no opposing player appeared in the player's games.
 *
 * @param {string} playerId
 * @param {string} weekStart YYYY-MM-DD
 * @param {string} weekEnd   YYYY-MM-DD
 * @returns {Promise<{ name: string, games: number }|null>}
 */
async function getTopOpponent(playerId, weekStart, weekEnd) {
	const row = await queryOne(
		`SELECT p.username AS name, COUNT(*)::int AS games
		FROM games g
		JOIN game_players me ON me.game_id = g.id AND me.player_id = $1
		JOIN game_players opp ON opp.game_id = g.id AND opp.team <> me.team
		JOIN profiles p ON p.id = opp.player_id
		WHERE g.played_at >= $2::date AT TIME ZONE 'Europe/Berlin'
			AND g.played_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Berlin')
		GROUP BY p.username
		ORDER BY games DESC, p.username ASC
		LIMIT 1`,
		[playerId, weekStart, weekEnd],
	);
	return row ?? null;
}

/**
 * Sum of `reward_points` for challenges this week that the player has
 * already completed.
 *
 * @param {string} playerId
 * @returns {Promise<{ completed: Array<{ label_de: string, label_en: string, reward_points: number }>, total_points: number }>}
 */
async function getCompletedChallengesThisWeek(playerId) {
	try {
		const active = await getActiveChallengesForPlayer(playerId);
		const completed = active.challenges
			.filter((c) => c.progress.completed)
			.map((c) => ({
				label_de: c.label_de,
				label_en: c.label_en,
				reward_points: c.reward_points,
			}));
		const total = completed.reduce((s, c) => s + c.reward_points, 0);
		return { completed, total_points: total };
	} catch {
		return { completed: [], total_points: 0 };
	}
}

/**
 * Compose the recap payload + ask the AI to narrate it. Caller is
 * expected to be authenticated; the recap is always for the current
 * Berlin week.
 *
 * @param {string} playerId
 * @returns {Promise<{
 *   week_start: string, week_end: string,
 *   stats: object, vs_last_week: object,
 *   top_opponent: object|null,
 *   challenges_completed_this_week: object[], total_bonus_points: number,
 *   text: string,
 * }>}
 */
export async function generatePersonalRecap(playerId) {
	const profile = await queryOne(
		`SELECT id, username FROM profiles WHERE id = $1`,
		[playerId],
	);
	if (!profile) {
		const err = new Error("Profile not found");
		err.statusCode = 404;
		throw err;
	}

	const now = new Date();
	const today = formatBerlinDate(now);

	// Daily cache: at most one Anthropic call per player per Berlin
	// calendar day. The cache rolls over automatically when the date
	// changes — the next request after midnight Berlin sees a stale
	// `valid_for_date` and regenerates.
	const cached = await queryOne(
		`SELECT payload FROM personal_recap_cache
		WHERE player_id = $1 AND valid_for_date = $2::date`,
		[playerId, today],
	);
	if (cached?.payload) return cached.payload;

	const { weekStart, weekEnd } = getWeekRangeBerlin(now);
	const lastWeekRef = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
	const { weekStart: lastStart, weekEnd: lastEnd } =
		getWeekRangeBerlin(lastWeekRef);

	const [stats, lastStats, topOpponent, challenges] = await Promise.all([
		getWeekStats(playerId, weekStart, weekEnd),
		getWeekStats(playerId, lastStart, lastEnd),
		getTopOpponent(playerId, weekStart, weekEnd),
		getCompletedChallengesThisWeek(playerId),
	]);

	const vsLastWeek = {
		games_delta: stats.games_played - lastStats.games_played,
		wins_delta: stats.wins - lastStats.wins,
		goals_delta: stats.goals_scored - lastStats.goals_scored,
	};

	// If there is genuinely nothing to say, return a minimal canned text
	// rather than spending a Claude call. Cache it too so we don't hit the
	// canned branch on every load when a player is inactive for a stretch.
	if (
		stats.games_played === 0 &&
		lastStats.games_played === 0 &&
		challenges.completed.length === 0
	) {
		const empty = {
			week_start: weekStart,
			week_end: weekEnd,
			stats,
			vs_last_week: vsLastWeek,
			top_opponent: null,
			challenges_completed_this_week: [],
			total_bonus_points: 0,
			text: "Diese Woche noch kein Match — Zeit, den Controller in die Hand zu nehmen.",
		};
		await persistRecapCache(playerId, today, empty);
		return empty;
	}

	const recapContext = JSON.stringify({
		player: { name: profile.username },
		week_start: weekStart,
		week_end: weekEnd,
		week_stats: stats,
		vs_last_week: vsLastWeek,
		top_opponent: topOpponent,
		challenges_completed_this_week: challenges.completed,
		total_bonus_points: challenges.total_points,
	});

	const { text } = await callAnthropicWithRetry({
		model: "claude-sonnet-4-6",
		max_tokens: 600,
		messages: [
			{
				role: "user",
				content: `${RECAP_PROMPT}\n\nDaten:\n${recapContext}`,
			},
		],
	});

	const fabricated = findFabricatedNames(
		text,
		[profile.username, topOpponent?.name].filter(Boolean),
	);
	if (fabricated.length > 0) {
		console.warn(
			`[weeklyRecap] potential fabricated names for player ${playerId}:`,
			fabricated,
		);
	}

	const result = {
		week_start: weekStart,
		week_end: weekEnd,
		stats,
		vs_last_week: vsLastWeek,
		top_opponent: topOpponent,
		challenges_completed_this_week: challenges.completed,
		total_bonus_points: challenges.total_points,
		text,
	};

	await persistRecapCache(playerId, today, result);

	return result;
}

/**
 * Idempotent upsert into `personal_recap_cache` keyed on `player_id`.
 * Replaces any prior cache entry so the latest day's recap always wins.
 *
 * @param {string} playerId
 * @param {string} validForDate YYYY-MM-DD
 * @param {object} payload
 * @returns {Promise<void>}
 */
async function persistRecapCache(playerId, validForDate, payload) {
	try {
		await query(
			`INSERT INTO personal_recap_cache (player_id, valid_for_date, payload, generated_at)
			VALUES ($1, $2::date, $3, now())
			ON CONFLICT (player_id) DO UPDATE
				SET valid_for_date = EXCLUDED.valid_for_date,
					payload = EXCLUDED.payload,
					generated_at = now()`,
			[playerId, validForDate, JSON.stringify(payload)],
		);
	} catch (err) {
		// Cache writes are best-effort — never let a cache failure shadow the
		// successful narrative we already produced.
		console.warn("[weeklyRecap] failed to persist cache:", err.message);
	}
}
