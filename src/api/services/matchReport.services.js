import { getAnthropicClient } from "../../config/anthropic.config.js";
import { query, queryOne } from "../helpers/database.helpers.js";
import { getUserStats } from "./stats.services.js";

const MATCH_REPORT_PROMPT = `Du bist ein unterhaltsamer, knapper Sportreporter für Büro-Kicker-Spiele (gespielt in EA Sports FC / FC26).

Schreibe einen kurzen Spielbericht (3-5 Sätze) auf Deutsch.

Regeln:
- Kurz und knackig, wie ein TV-Kommentar nach dem Spiel
- Benutze die echten Spielernamen und Teamnamen
- Hebe besondere Auffälligkeiten hervor, z.B.:
  - Underdog-Siege (wenig Ballbesitz aber gewonnen)
  - xG Over-/Underperformance (mehr/weniger Tore als erwartet)
  - Dominanter Ballbesitz der trotzdem verliert
  - Außergewöhnliche Passgenauigkeit oder Zweikampfquoten
- Wenn Karriere-Durchschnittswerte der Spieler verfügbar sind, vergleiche:
  - "Normalerweise ein Chancentod, traf heute alles"
  - "Weit unter seinem üblichen Niveau"
- Erwähne den Spielverlauf wenn dramatisch (Aufholjagden, Last-Minute-Tore)
- Bei Verlängerung: "Das Spiel ging in die Verlängerung..."
- Bei Elfmeterschießen: besonders dramatisch schreiben

Hinweis zu \`score_timeline\`:
- Jeder Eintrag ist bereits mit Klarnamen angereichert. Verlasse dich AUSSCHLIESSLICH auf diese Felder, NIE auf Spieler-IDs:
  - Tor: \`scorer\` (Torschütze) und optional \`assist\` (Vorlagengeber).
    Erwähne den Vorlagengeber wenn vorhanden ("legt für X auf", "Vorarbeit von Y").
  - Karte: \`offender\` (Spieler) und \`card_color\` ("yellow" | "red").
  - Verschossener Elfmeter: \`shooter\` (Schütze) und \`keeper\` (Torwart, kann fehlen).
- Karten und verschossene Elfmeter sind dramaturgisch erwähnenswert (Wendepunkt, Schock-Moment, Glück gehabt) — aber zähle sie NICHT als Tore.
- Wenn ein \`scorer\` / \`assist\` / \`offender\` / \`shooter\` / \`keeper\` "Unbekannt" ist, lass den Namen weg statt zu raten.

- Kein Markdown, nur Fließtext
- Maximal 5 Sätze
- Gib NUR den Spielbericht zurück, keine Einleitung oder Erklärung`;

/**
 * Resolve a Firebase UID to a human-readable username, falling back to
 * "Unbekannt" so the AI prompt can detect missing attribution explicitly.
 *
 * @param {string|null|undefined} playerId
 * @param {Map<string, string>} nameMap
 * @returns {string|null}
 */
function resolveName(playerId, nameMap) {
	if (!playerId) return null;
	return nameMap.get(playerId) ?? "Unbekannt";
}

/**
 * Build a human-readable copy of a `score_timeline` entry. Replaces opaque
 * Firebase UIDs with usernames so the model attributes goals to the right
 * player instead of guessing. Drops `home`/`away` running scores in favour
 * of a single `score_after` string for readability.
 *
 * @param {object} entry
 * @param {Map<string, string>} nameMap
 * @returns {object}
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
 * Generates an AI match report for a game
 * @param {string} gameId - Game UUID
 * @returns {Promise<string>} Generated report text
 */
export async function generateMatchReport(gameId) {
	// Fetch game with all data
	const game = await queryOne("SELECT * FROM games WHERE id = $1", [gameId]);

	if (!game) {
		const err = new Error("Game not found");
		err.statusCode = 404;
		throw err;
	}

	const players = await query(
		`SELECT gp.player_id, gp.team, gp.team_name,
			json_build_object('username', p.username, 'avatar_url', p.avatar_url) AS profiles
		FROM game_players gp
		LEFT JOIN profiles p ON p.id = gp.player_id
		WHERE gp.game_id = $1`,
		[gameId],
	);

	// Build a player_id → username map for attribution lookups inside the
	// score-timeline transformation. Also includes guests if their player_id
	// happens to map to a profile (it usually does not — guest entries are
	// created with synthetic IDs and resolve to "Unbekannt").
	const nameMap = new Map();
	for (const gp of players) {
		const name = gp.profiles?.username;
		if (gp.player_id && name) nameMap.set(gp.player_id, name);
	}

	// Build player context with career stats
	const playerContexts = [];
	for (const gp of players) {
		try {
			const stats = await getUserStats(gp.player_id);
			playerContexts.push({
				name: gp.profiles?.username || "Unknown",
				team: gp.team,
				team_name: gp.team_name,
				career: {
					total_games: stats.total_games,
					win_rate: stats.win_rate,
					avg_possession: stats.career_match_stats?.avg_possession || null,
					avg_pass_accuracy:
						stats.career_match_stats?.avg_pass_accuracy || null,
					xg_efficiency: stats.career_match_stats?.xg_efficiency || null,
					current_streak: stats.current_streak,
				},
			});
		} catch {
			playerContexts.push({
				name: gp.profiles?.username || "Unknown",
				team: gp.team,
				team_name: gp.team_name,
				career: null,
			});
		}
	}

	const timelineForAI = Array.isArray(game.score_timeline)
		? game.score_timeline.map((entry) => buildAITimelineEntry(entry, nameMap))
		: [];

	const gameContext = JSON.stringify({
		score: `${game.score_home}:${game.score_away}`,
		result_type: game.result_type,
		score_timeline: timelineForAI,
		match_stats: game.match_stats,
		players: playerContexts,
	});

	const client = getAnthropicClient();
	const response = await client.messages.create({
		model: "claude-sonnet-4-20250514",
		max_tokens: 512,
		messages: [
			{
				role: "user",
				content: `${MATCH_REPORT_PROMPT}\n\nSpieldaten:\n${gameContext}`,
			},
		],
	});

	const report = response.content[0]?.text;
	if (!report) {
		const err = new Error("No response from AI model");
		err.statusCode = 502;
		throw err;
	}

	// Save report to database
	await queryOne(
		"UPDATE games SET match_report = $1 WHERE id = $2 RETURNING id",
		[report, gameId],
	);

	return report;
}
