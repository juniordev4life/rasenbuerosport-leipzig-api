import { getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Gets head-to-head stats between two players
 * @param {string} userId - Current user ID
 * @param {string} opponentId - Opponent user ID
 * @returns {Promise<object>}
 */
export async function getHeadToHead(userId, opponentId) {
	const supabase = getSupabaseAdmin();

	// Get opponent profile
	const { data: opponentProfile } = await supabase
		.from("profiles")
		.select("username, avatar_url")
		.eq("id", opponentId)
		.single();

	// Find all games where user participated
	const { data: userGames } = await supabase
		.from("game_players")
		.select("game_id, team")
		.eq("player_id", userId);

	if (!userGames?.length) {
		return getEmptyH2H(opponentProfile);
	}

	// Find all games where opponent participated
	const { data: opponentGames } = await supabase
		.from("game_players")
		.select("game_id, team")
		.eq("player_id", opponentId);

	if (!opponentGames?.length) {
		return getEmptyH2H(opponentProfile);
	}

	// Find common game IDs
	const userGameIds = new Set(userGames.map((g) => g.game_id));
	const commonGameIds = opponentGames
		.filter((g) => userGameIds.has(g.game_id))
		.map((g) => g.game_id);

	if (!commonGameIds.length) {
		return getEmptyH2H(opponentProfile);
	}

	// Fetch the actual games
	const { data: games, error } = await supabase
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
		.in("id", commonGameIds)
		.order("played_at", { ascending: false });

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	// Build user team map
	const userTeamMap = {};
	for (const ug of userGames) {
		userTeamMap[ug.game_id] = ug.team;
	}

	let userWins = 0;
	let opponentWins = 0;
	let draws = 0;

	for (const game of games) {
		const userTeam = userTeamMap[game.id];
		if (!userTeam) continue;

		const isHomeWin = game.score_home > game.score_away;
		const isDraw = game.score_home === game.score_away;
		const isUserWin =
			(userTeam === "home" && isHomeWin) ||
			(userTeam === "away" && !isHomeWin && !isDraw);

		if (isDraw) {
			draws++;
		} else if (isUserWin) {
			userWins++;
		} else {
			opponentWins++;
		}
	}

	return {
		opponent: {
			username: opponentProfile?.username || "Unknown",
			avatar_url: opponentProfile?.avatar_url || null,
		},
		total_games: games.length,
		user_wins: userWins,
		opponent_wins: opponentWins,
		draws,
		recent_games: games.slice(0, 5),
	};
}

/**
 * Returns empty H2H stats
 * @param {object|null} opponentProfile
 * @returns {object}
 */
function getEmptyH2H(opponentProfile) {
	return {
		opponent: {
			username: opponentProfile?.username || "Unknown",
			avatar_url: opponentProfile?.avatar_url || null,
		},
		total_games: 0,
		user_wins: 0,
		opponent_wins: 0,
		draws: 0,
		recent_games: [],
	};
}
