import { getSupabaseAdmin } from "../../config/supabase.config.js";
import { getAnthropicClient } from "../../config/anthropic.config.js";
import { getUserStats } from "./stats.services.js";

const PREDICTION_PROMPT = `Du bist ein Kicker-Experte der vor Büro-Kicker-Spielen (EA Sports FC / FC26) eine kurze Vorhersage gibt.

Regeln:
- 2-4 Sätze auf Deutsch, unterhaltsam und locker
- Benutze die echten Spielernamen und Teamnamen
- Berücksichtige:
  - H2H-Bilanz (wer hat öfter gewonnen)
  - Aktuelle Form (Siegesserie = "in heißer Form", Pechsträhne = "im Formtief")
  - Winrate (hohe Winrate = "routiniert", niedrige = "Überraschungspotenzial")
  - xG-Effizienz (hoch = "kaltschnäuzig", niedrig = "Chancentod")
  - Wenn ein Spieler sein Lieblingsteam spielt: erwähne den "Heimvorteil"
- Gib eine Tendenz ab (wer Favorit ist) mit einem geschätzten Score
- Sei nicht zu sicher — Kicker ist unberechenbar
- Kein Markdown, nur Fließtext
- Gib NUR die Vorhersage zurück, keine Einleitung`;

/**
 * Generates an AI match prediction before a game
 * @param {object[]} players - Array of {id, team, team_name}
 * @param {string} mode - '1v1' or '2v2'
 * @returns {Promise<string>} Prediction text
 */
export async function generatePrediction(players, mode) {
	const supabase = getSupabaseAdmin();

	// Collect stats for all players
	const playerContexts = [];
	for (const p of players) {
		try {
			const stats = await getUserStats(p.id);
			playerContexts.push({
				name: stats.favorite_team ? `${p.team_name}` : p.team_name,
				username: null,
				team_side: p.team,
				team_name: p.team_name,
				career: {
					total_games: stats.total_games,
					wins: stats.wins,
					losses: stats.losses,
					win_rate: stats.win_rate,
					avg_possession: stats.career_match_stats?.avg_possession || null,
					avg_pass_accuracy: stats.career_match_stats?.avg_pass_accuracy || null,
					xg_efficiency: stats.career_match_stats?.xg_efficiency || null,
					current_streak: stats.current_streak,
					favorite_team: stats.favorite_team?.name || null,
				},
			});
		} catch {
			playerContexts.push({
				team_side: p.team,
				team_name: p.team_name,
				career: null,
			});
		}
	}

	// Fetch player profiles for usernames
	const playerIds = players.map((p) => p.id);
	const { data: profiles } = await supabase
		.from("profiles")
		.select("id, username")
		.in("id", playerIds);

	const profileMap = {};
	for (const prof of profiles || []) {
		profileMap[prof.id] = prof.username;
	}

	for (let i = 0; i < players.length; i++) {
		playerContexts[i].username = profileMap[players[i].id] || "Unknown";
	}

	// Fetch H2H data between opposing players
	const homePlayers = players.filter((p) => p.team === "home");
	const awayPlayers = players.filter((p) => p.team === "away");
	const h2hData = [];

	for (const hp of homePlayers) {
		for (const ap of awayPlayers) {
			const h2h = await getH2HSummary(hp.id, ap.id, supabase);
			if (h2h) {
				h2hData.push({
					player1: profileMap[hp.id] || "Unknown",
					player2: profileMap[ap.id] || "Unknown",
					...h2h,
				});
			}
		}
	}

	const context = JSON.stringify({
		mode,
		players: playerContexts,
		h2h: h2hData,
	});

	const client = getAnthropicClient();
	const response = await client.messages.create({
		model: "claude-sonnet-4-20250514",
		max_tokens: 512,
		messages: [
			{
				role: "user",
				content: `${PREDICTION_PROMPT}\n\nSpieler und Daten:\n${context}`,
			},
		],
	});

	const prediction = response.content[0]?.text;
	if (!prediction) {
		const err = new Error("No response from AI model");
		err.statusCode = 502;
		throw err;
	}

	return prediction;
}

/**
 * Gets a simple H2H summary between two players
 * @param {string} userId1
 * @param {string} userId2
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<object|null>}
 */
async function getH2HSummary(userId1, userId2, supabase) {
	const { data: gp1 } = await supabase
		.from("game_players")
		.select("game_id, team")
		.eq("player_id", userId1);

	const { data: gp2 } = await supabase
		.from("game_players")
		.select("game_id, team")
		.eq("player_id", userId2);

	if (!gp1?.length || !gp2?.length) return null;

	const gp1Map = {};
	for (const g of gp1) gp1Map[g.game_id] = g.team;

	// Find games where both participated on different teams
	const sharedGameIds = [];
	const teamMap = {};
	for (const g of gp2) {
		if (gp1Map[g.game_id] && gp1Map[g.game_id] !== g.team) {
			sharedGameIds.push(g.game_id);
			teamMap[g.game_id] = { p1Team: gp1Map[g.game_id], p2Team: g.team };
		}
	}

	if (!sharedGameIds.length) return null;

	const { data: games } = await supabase
		.from("games")
		.select("id, score_home, score_away")
		.in("id", sharedGameIds);

	let p1Wins = 0;
	let p2Wins = 0;
	let draws = 0;

	for (const game of games || []) {
		const tm = teamMap[game.id];
		const isDraw = game.score_home === game.score_away;
		if (isDraw) {
			draws++;
		} else {
			const homeWins = game.score_home > game.score_away;
			if ((tm.p1Team === "home" && homeWins) || (tm.p1Team === "away" && !homeWins)) {
				p1Wins++;
			} else {
				p2Wins++;
			}
		}
	}

	return { total: sharedGameIds.length, p1_wins: p1Wins, p2_wins: p2Wins, draws };
}
