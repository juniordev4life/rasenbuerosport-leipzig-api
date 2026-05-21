import {
	callAnthropicWithRetry,
	findFabricatedNames,
} from "../helpers/ai.helpers.js";
import { query } from "../helpers/database.helpers.js";

const MOTW_PROMPT = `Du bist ein dramatischer Sportreporter, der das Spiel der Woche für die Rasenbürosport Leipzig Liga (auch "Rasenbürosport Liga Leipzig" oder kurz "Bürosport Liga") aufbereitet. Die Liga heißt NIEMALS "FIFA-Liga" oder "FC-Liga". Alle Spiele werden am Controller in EA Sports FC / FC26 auf der Konsole ausgetragen — NICHT am Tischkicker / Tischfußball. Vermeide das Wort "Kicker" (Verwechslungsgefahr). Wenn Du Gaming-Vokabular brauchst, nutze "am Controller", "an der Konsole", "in der Bürosport Liga" oder "auf dem virtuellen Rasen".

Schreibe einen längeren Spielbericht (8-12 Sätze) auf Deutsch. Mehr Drama, mehr Story, mehr Bilder. Aber bleib sachlich richtig.

Regeln:
- Das ist DAS Spiel der Woche — wähle einen entsprechenden Ton (epische Wende, Klassiker, Krimi etc.)
- Benutze die echten Spielernamen und Teamnamen
- \`drama_factors\` erklärt warum dieses Spiel ausgewählt wurde — webe das in die Erzählung ein, ohne es wörtlich zu zitieren
- Beziehe Karten, verschossene Elfmeter, späte Tore und Comebacks aktiv in die Story ein wenn vorhanden
- Bei Verlängerung / Elfmeterschießen: extra dramatisch
- Wenn \`storylines.newly_unlocked_badges\` oder \`completed_challenges\` etwas enthält: erwähne es als Sahnehäubchen
- Bei \`streaks\` (≥3): erwähne es wenn der Spieler in diesem Spiel auf-/abgestiegen ist

Hinweis zu \`score_timeline\`: Klarnamen sind in \`scorer\`/\`assist\`/\`offender\`/\`shooter\`/\`keeper\` schon eingebaut. NIE Spieler-IDs benutzen. Bei "Unbekannt" lieber den Namen weglassen.

- Kein Markdown, nur Fließtext
- Maximal 12 Sätze
- Gib NUR den Bericht zurück, keine Einleitung`;

/**
 * Score how dramatic a single game is. Higher = more interesting. The
 * formula is intentionally simple — every signal is observable in the
 * existing schema (no new aggregates needed) and weighted to surface
 * close, eventful matches over routine blowouts.
 *
 * Components:
 *   - base: total goals (rewards back-and-forth scoring)
 *   - close-margin bonus: 1-goal +3, 2-goal +1
 *   - card events: +2 per
 *   - missed penalties: +2 per
 *   - late goal in regulation (minute >= 85): +3
 *   - went to extra time: +2
 *   - went to penalty shootout: +4
 *   - heuristic comeback (≥2 goal swing during the game): +5
 *
 * @param {object} game
 * @returns {number}
 */
export function dramaScore(game) {
	const home = game.score_home ?? 0;
	const away = game.score_away ?? 0;
	const total = home + away;
	const margin = Math.abs(home - away);
	const tl = Array.isArray(game.score_timeline) ? game.score_timeline : [];

	let score = total;
	if (margin === 1) score += 3;
	else if (margin === 2) score += 1;

	const cards = tl.filter(
		(e) => e.event_type === "card" || e.event_type === "red_card",
	).length;
	score += cards * 2;

	const misses = tl.filter((e) => e.event_type === "penalty_missed").length;
	score += misses * 2;

	const goals = tl.filter((e) => !e.event_type || e.event_type === "goal");
	const lateGoal = goals.some(
		(e) => typeof e.minute === "number" && e.minute >= 85,
	);
	if (lateGoal) score += 3;

	if (game.result_type === "extra_time") score += 2;
	if (game.result_type === "penalty") score += 4;

	// Heuristic comeback: one side trailed by 2+ goals during the game and
	// then ultimately won.
	let peakDiff = 0;
	let troughDiff = 0;
	for (const g of goals) {
		const diff = (g.home ?? 0) - (g.away ?? 0);
		if (diff > peakDiff) peakDiff = diff;
		if (diff < troughDiff) troughDiff = diff;
	}
	const finalDiff = home - away;
	const homeComeback = troughDiff <= -2 && finalDiff > 0;
	const awayComeback = peakDiff >= 2 && finalDiff < 0;
	if (homeComeback || awayComeback) score += 5;

	return score;
}

/**
 * Pick the highest-drama game of the week. Returns `null` if no games
 * were played or none cleared a minimum threshold (a 0-0 nothing-burger
 * is not the Spiel der Woche).
 *
 * @param {string} weekStart YYYY-MM-DD
 * @param {string} weekEnd   YYYY-MM-DD
 * @returns {Promise<object|null>} The picked game row including a
 *   `_drama_score` field, or `null`.
 */
export async function pickMatchOfTheWeek(weekStart, weekEnd) {
	const games = await query(
		`SELECT g.id, g.mode, g.score_home, g.score_away, g.played_at,
			g.score_timeline, g.match_stats, g.result_type
		FROM games g
		WHERE g.played_at >= $1::date AT TIME ZONE 'Europe/Berlin'
			AND g.played_at < (($2::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Berlin')
		ORDER BY g.played_at ASC`,
		[weekStart, weekEnd],
	);
	if (games.length === 0) return null;

	let best = null;
	let bestScore = -Infinity;
	for (const g of games) {
		const s = dramaScore(g);
		if (s > bestScore) {
			best = g;
			bestScore = s;
		}
	}
	if (!best || bestScore < 3) return null;
	return { ...best, _drama_score: bestScore };
}

/**
 * Build a `player_id → username` lookup for a game's roster.
 *
 * @param {Array<{ player_id: string, profiles?: { username?: string } }>} players
 * @returns {Map<string, string>}
 */
function buildNameMap(players) {
	const map = new Map();
	for (const gp of players) {
		const name = gp.profiles?.username;
		if (gp.player_id && name) map.set(gp.player_id, name);
	}
	return map;
}

/**
 * @param {string|null|undefined} id
 * @param {Map<string, string>} nameMap
 */
function resolveName(id, nameMap) {
	if (!id) return null;
	return nameMap.get(id) ?? "Unbekannt";
}

/**
 * Mirror of the matchReport timeline transformation — replaces UIDs with
 * usernames so the AI cannot misattribute.
 *
 * @param {object} entry
 * @param {Map<string, string>} nameMap
 */
function buildAITimelineEntry(entry, nameMap) {
	const eventType = entry?.event_type ?? "goal";
	const base = {
		event_type: eventType,
		period: entry?.period ?? "regular",
	};
	if (typeof entry?.minute === "number") {
		base.minute = entry.minute;
		if (entry.stoppage) base.stoppage = entry.stoppage;
	}
	if (eventType === "goal") {
		return {
			...base,
			score_after: `${entry.home}:${entry.away}`,
			goal_type: entry.goal_type ?? "play",
			scorer: resolveName(entry.scored_by, nameMap),
			assist: resolveName(entry.assist_by, nameMap),
		};
	}
	if (eventType === "card") {
		return {
			...base,
			card_color: entry.card_type,
			offender: resolveName(entry.player_id, nameMap),
			team: entry.team,
		};
	}
	if (eventType === "red_card") {
		return {
			...base,
			card_color: "red",
			offender: resolveName(entry.player_id, nameMap),
			team: entry.team,
		};
	}
	if (eventType === "penalty_missed") {
		return {
			...base,
			shooter: resolveName(entry.shooter_id, nameMap),
			keeper: resolveName(entry.keeper_id, nameMap),
			team: entry.team,
		};
	}
	return base;
}

/**
 * Return a list of human-readable drama factors for the picked game,
 * intended as bullets the AI prompt can weave into the narrative.
 *
 * @param {object} game
 * @returns {string[]}
 */
function dramaFactors(game) {
	const factors = [];
	const home = game.score_home ?? 0;
	const away = game.score_away ?? 0;
	const tl = Array.isArray(game.score_timeline) ? game.score_timeline : [];

	if (Math.abs(home - away) === 1 && home + away >= 3) {
		factors.push("knapper Krimi mit nur einem Tor Unterschied");
	}
	if (home + away >= 6) {
		factors.push("torreiches Festival");
	}
	if (game.result_type === "extra_time")
		factors.push("ging in die Verlängerung");
	if (game.result_type === "penalty")
		factors.push("entschieden im Elfmeterschießen");
	if (tl.some((e) => e.event_type === "card" || e.event_type === "red_card")) {
		factors.push("mit Kartenflut");
	}
	if (tl.some((e) => e.event_type === "penalty_missed")) {
		factors.push("verschossener Elfmeter inklusive");
	}
	if (
		tl.some(
			(e) =>
				(!e.event_type || e.event_type === "goal") &&
				typeof e.minute === "number" &&
				e.minute >= 85,
		)
	) {
		factors.push("Last-Minute-Tor");
	}
	return factors;
}

/**
 * Generate the long-form Spiel-der-Woche narrative for the picked game.
 *
 * @param {object} pickedGame - row from `pickMatchOfTheWeek`
 * @param {object} [storylines] - per-player badges/challenges/streaks for
 *   players in this game (best-effort, may be empty).
 * @returns {Promise<string>} Generated text
 */
export async function generateMatchOfTheWeekReport(
	pickedGame,
	storylines = {},
) {
	const players = await query(
		`SELECT gp.player_id, gp.team, gp.team_name,
			json_build_object('username', p.username, 'avatar_url', p.avatar_url) AS profiles
		FROM game_players gp
		LEFT JOIN profiles p ON p.id = gp.player_id
		WHERE gp.game_id = $1`,
		[pickedGame.id],
	);

	const nameMap = buildNameMap(players);

	const playerContexts = players.map((gp) => ({
		name: gp.profiles?.username || "Unknown",
		team: gp.team,
		team_name: gp.team_name,
	}));

	const timelineForAI = Array.isArray(pickedGame.score_timeline)
		? pickedGame.score_timeline.map((entry) =>
				buildAITimelineEntry(entry, nameMap),
			)
		: [];

	const gameContext = JSON.stringify({
		score: `${pickedGame.score_home}:${pickedGame.score_away}`,
		result_type: pickedGame.result_type,
		score_timeline: timelineForAI,
		match_stats: pickedGame.match_stats,
		players: playerContexts,
		drama_factors: dramaFactors(pickedGame),
		storylines,
	});

	const { text } = await callAnthropicWithRetry({
		model: "claude-sonnet-4-6",
		max_tokens: 900,
		messages: [
			{
				role: "user",
				content: `${MOTW_PROMPT}\n\nSpieldaten:\n${gameContext}`,
			},
		],
	});

	const fabricated = findFabricatedNames(
		text,
		[...nameMap.values()].filter(Boolean),
	);
	if (fabricated.length > 0) {
		console.warn(
			`[matchOfTheWeek] potential fabricated names in game ${pickedGame.id}:`,
			fabricated,
		);
	}

	return text;
}
