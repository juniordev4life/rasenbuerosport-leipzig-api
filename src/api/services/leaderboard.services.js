import { getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Calculates leaderboard: 3 points for win, 1 for draw, 0 for loss
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
export async function getLeaderboard(limit = 10) {
	const supabase = getSupabaseAdmin();

	const { data: games, error } = await supabase
		.from("games")
		.select(`
			id,
			score_home,
			score_away,
			game_players (
				player_id,
				team,
				profiles:player_id (username, avatar_url)
			)
		`);

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	const playerPoints = {};

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
				};
			}

			playerPoints[id].games += 1;

			const isWinner =
				(gp.team === "home" && isHomeWin) ||
				(gp.team === "away" && !isHomeWin && !isDraw);

			if (isDraw) {
				playerPoints[id].points += 1;
				playerPoints[id].draws += 1;
			} else if (isWinner) {
				playerPoints[id].points += 3;
				playerPoints[id].wins += 1;
			} else {
				playerPoints[id].losses += 1;
			}
		}
	}

	return Object.values(playerPoints)
		.sort((a, b) => b.points - a.points)
		.slice(0, limit);
}
