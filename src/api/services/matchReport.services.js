import { getSupabaseAdmin } from "../../config/supabase.config.js";
import { getAnthropicClient } from "../../config/anthropic.config.js";
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
- Kein Markdown, nur Fließtext
- Maximal 5 Sätze
- Gib NUR den Spielbericht zurück, keine Einleitung oder Erklärung`;

/**
 * Generates an AI match report for a game
 * @param {string} gameId - Game UUID
 * @returns {Promise<string>} Generated report text
 */
export async function generateMatchReport(gameId) {
	const supabase = getSupabaseAdmin();

	// Fetch game with all data
	const { data: game, error } = await supabase
		.from("games")
		.select(`
			*,
			game_players (
				player_id,
				team,
				team_name,
				profiles:player_id (username, avatar_url)
			)
		`)
		.eq("id", gameId)
		.single();

	if (error || !game) {
		const err = new Error("Game not found");
		err.statusCode = 404;
		throw err;
	}

	// Build player context with career stats
	const playerContexts = [];
	for (const gp of game.game_players) {
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
					avg_pass_accuracy: stats.career_match_stats?.avg_pass_accuracy || null,
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

	const gameContext = JSON.stringify({
		score: `${game.score_home}:${game.score_away}`,
		result_type: game.result_type,
		score_timeline: game.score_timeline,
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
	const { error: updateError } = await supabase
		.from("games")
		.update({ match_report: report })
		.eq("id", gameId);

	if (updateError) {
		const err = new Error(updateError.message);
		err.statusCode = 400;
		throw err;
	}

	return report;
}
