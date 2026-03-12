import { query, queryOne } from "../helpers/database.helpers.js";

/**
 * Gets head-to-head stats between two players
 * @param {string} userId - Current user ID
 * @param {string} opponentId - Opponent user ID
 * @returns {Promise<object>}
 */
export async function getHeadToHead(userId, opponentId) {
	const opponentProfile = await queryOne(
		"SELECT username, avatar_url FROM profiles WHERE id = $1",
		[opponentId],
	);

	// Find all games where user participated
	const userGames = await query(
		"SELECT game_id, team FROM game_players WHERE player_id = $1",
		[userId],
	);

	if (!userGames.length) {
		return getEmptyH2H(opponentProfile);
	}

	// Find all games where opponent participated
	const opponentGames = await query(
		"SELECT game_id, team FROM game_players WHERE player_id = $1",
		[opponentId],
	);

	if (!opponentGames.length) {
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

	// Fetch the actual games with players
	const games = await query(
		`SELECT g.*,
			json_agg(
				json_build_object(
					'player_id', gp.player_id,
					'team', gp.team,
					'team_name', gp.team_name,
					'profiles', json_build_object('username', p.username, 'avatar_url', p.avatar_url)
				)
			) AS game_players
		FROM games g
		LEFT JOIN game_players gp ON gp.game_id = g.id
		LEFT JOIN profiles p ON p.id = gp.player_id
		WHERE g.id = ANY($1)
		GROUP BY g.id
		ORDER BY g.played_at DESC`,
		[commonGameIds],
	);

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
