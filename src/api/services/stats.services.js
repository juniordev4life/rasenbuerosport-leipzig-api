import { getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Gets comprehensive stats for a user
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function getUserStats(userId) {
	const supabase = getSupabaseAdmin();

	// Fetch all games the user participated in
	const { data: playerGames } = await supabase
		.from("game_players")
		.select("game_id, team, team_name")
		.eq("player_id", userId);

	if (!playerGames?.length) {
		return getEmptyStats();
	}

	const gameIds = playerGames.map((pg) => pg.game_id);

	const { data: games, error } = await supabase
		.from("games")
		.select(`
			id,
			mode,
			score_home,
			score_away,
			game_players (
				player_id,
				team,
				team_name,
				profiles:player_id (username, avatar_url)
			)
		`)
		.in("id", gameIds);

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	// Build user's game map for quick lookups
	const userGameMap = {};
	for (const pg of playerGames) {
		userGameMap[pg.game_id] = { team: pg.team, team_name: pg.team_name };
	}

	let totalWins = 0;
	let totalLosses = 0;
	let totalDraws = 0;
	let wins1v1 = 0;
	let losses1v1 = 0;
	let wins2v2 = 0;
	let losses2v2 = 0;

	const opponentCount = {};
	const teammateRecord = {};
	const teamCount = {};

	for (const game of games) {
		const userEntry = userGameMap[game.id];
		if (!userEntry) continue;

		const userTeam = userEntry.team;
		const isHomeWin = game.score_home > game.score_away;
		const isDraw = game.score_home === game.score_away;
		const isUserWin =
			(userTeam === "home" && isHomeWin) ||
			(userTeam === "away" && !isHomeWin && !isDraw);

		// Overall stats
		if (isDraw) {
			totalDraws++;
		} else if (isUserWin) {
			totalWins++;
		} else {
			totalLosses++;
		}

		// Mode-specific stats
		if (game.mode === "1v1") {
			if (!isDraw) {
				if (isUserWin) wins1v1++;
				else losses1v1++;
			}
		} else {
			if (!isDraw) {
				if (isUserWin) wins2v2++;
				else losses2v2++;
			}
		}

		// Track opponents and teammates
		for (const gp of game.game_players) {
			if (gp.player_id === userId) continue;

			const name = gp.profiles?.username || "Unknown";
			const avatarUrl = gp.profiles?.avatar_url || null;

			if (gp.team !== userTeam) {
				// Opponent
				if (!opponentCount[gp.player_id]) {
					opponentCount[gp.player_id] = {
						username: name,
						avatar_url: avatarUrl,
						games: 0,
					};
				}
				opponentCount[gp.player_id].games++;
			} else {
				// Teammate (only in 2v2)
				if (!teammateRecord[gp.player_id]) {
					teammateRecord[gp.player_id] = {
						username: name,
						avatar_url: avatarUrl,
						wins: 0,
						games: 0,
					};
				}
				teammateRecord[gp.player_id].games++;
				if (isUserWin) teammateRecord[gp.player_id].wins++;
			}
		}

		// Track team usage
		if (userEntry.team_name) {
			if (!teamCount[userEntry.team_name]) {
				teamCount[userEntry.team_name] = 0;
			}
			teamCount[userEntry.team_name]++;
		}
	}

	const totalGames = totalWins + totalLosses + totalDraws;
	const winRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;

	// Find favorite opponent (most games against)
	const favoriteOpponent = findTopEntry(opponentCount, "games");

	// Find best teammate (highest win rate together, min 2 games)
	const bestTeammate = findBestTeammate(teammateRecord);

	// Find favorite team
	const favoriteTeam = await findFavoriteTeam(supabase, teamCount);

	return {
		total_games: totalGames,
		wins: totalWins,
		losses: totalLosses,
		draws: totalDraws,
		win_rate: winRate,
		bilanz_1v1: { wins: wins1v1, losses: losses1v1 },
		bilanz_2v2: { wins: wins2v2, losses: losses2v2 },
		favorite_opponent: favoriteOpponent,
		best_teammate: bestTeammate,
		favorite_team: favoriteTeam,
	};
}

/**
 * Returns empty stats object
 * @returns {object}
 */
function getEmptyStats() {
	return {
		total_games: 0,
		wins: 0,
		losses: 0,
		draws: 0,
		win_rate: 0,
		bilanz_1v1: { wins: 0, losses: 0 },
		bilanz_2v2: { wins: 0, losses: 0 },
		favorite_opponent: null,
		best_teammate: null,
		favorite_team: null,
	};
}

/**
 * Finds the entry with the highest value for a given key
 * @param {object} entries
 * @param {string} key
 * @returns {object|null}
 */
function findTopEntry(entries, key) {
	const sorted = Object.entries(entries).sort(
		(a, b) => b[1][key] - a[1][key],
	);
	if (!sorted.length) return null;
	const [, data] = sorted[0];
	return {
		username: data.username,
		avatar_url: data.avatar_url,
		games: data.games,
	};
}

/**
 * Finds the best teammate by win rate (min 2 games together)
 * @param {object} teammateRecord
 * @returns {object|null}
 */
function findBestTeammate(teammateRecord) {
	const eligible = Object.entries(teammateRecord).filter(
		([, data]) => data.games >= 2,
	);

	if (!eligible.length) {
		// Fallback: take most played teammate
		const all = Object.entries(teammateRecord).sort(
			(a, b) => b[1].games - a[1].games,
		);
		if (!all.length) return null;
		const [, data] = all[0];
		return {
			username: data.username,
			avatar_url: data.avatar_url,
			games: data.games,
		};
	}

	eligible.sort((a, b) => {
		const rateA = b[1].wins / b[1].games;
		const rateB = a[1].wins / a[1].games;
		return rateA - rateB;
	});

	const [, data] = eligible[0];
	return {
		username: data.username,
		avatar_url: data.avatar_url,
		games: data.games,
	};
}

/**
 * Finds favorite team by looking up team name from ID
 * @param {object} supabase
 * @param {object} teamCount - { teamId: count }
 * @returns {Promise<object|null>}
 */
async function findFavoriteTeam(supabase, teamCount) {
	const entries = Object.entries(teamCount);
	if (!entries.length) return null;

	entries.sort((a, b) => b[1] - a[1]);
	const [teamId, count] = entries[0];

	const { data: team } = await supabase
		.from("teams")
		.select("name, short_name")
		.eq("id", teamId)
		.single();

	return {
		name: team?.name || "Unknown",
		short_name: team?.short_name || null,
		games: count,
	};
}
