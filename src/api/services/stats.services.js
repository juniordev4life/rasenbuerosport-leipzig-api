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
			played_at,
			match_stats,
			game_players (
				player_id,
				team,
				team_name,
				profiles:player_id (username, avatar_url)
			)
		`)
		.in("id", gameIds)
		.order("played_at", { ascending: false });

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

	// Find favorite team (team_name is now plain text)
	const favoriteTeam = findFavoriteTeam(teamCount);

	// Calculate current streak (games already sorted by played_at DESC)
	const currentStreak = calculateStreak(games, userGameMap);

	// Last played timestamp (games are sorted DESC, first is most recent)
	const lastPlayedAt = games.length > 0 ? games[0].played_at : null;

	// Career match stats (aggregated from FC26 stats)
	const careerMatchStats = computeCareerMatchStats(games, userGameMap);

	// Badges
	const badges = computeBadges(games, userGameMap, {
		total_games: totalGames,
		careerMatchStats,
	});

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
		current_streak: currentStreak,
		last_played_at: lastPlayedAt,
		career_match_stats: careerMatchStats,
		badges,
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
		current_streak: null,
		last_played_at: null,
		career_match_stats: null,
		badges: [],
	};
}

/**
 * Computes aggregated career match stats from all games with FC26 data
 * @param {object[]} games
 * @param {object} userGameMap
 * @returns {object|null}
 */
function computeCareerMatchStats(games, userGameMap) {
	let gamesWithStats = 0;
	let totalPossession = 0;
	let totalPassAccuracy = 0;
	let totalDribbling = 0;
	let totalShotAccuracy = 0;
	let totalXg = 0;
	let totalGoals = 0;
	let totalDuels = 0;
	let totalDuelsWon = 0;
	let gamesWithXg = 0;

	for (const game of games) {
		if (!game.match_stats) continue;
		const userEntry = userGameMap[game.id];
		if (!userEntry) continue;

		const side = userEntry.team;
		const ms = game.match_stats;

		gamesWithStats++;

		if (ms.possession?.[side] != null) totalPossession += ms.possession[side];
		if (ms.pass_accuracy?.[side] != null) totalPassAccuracy += ms.pass_accuracy[side];
		if (ms.dribbling?.[side] != null) totalDribbling += ms.dribbling[side];
		if (ms.shot_accuracy?.[side] != null) totalShotAccuracy += ms.shot_accuracy[side];
		if (ms.duels?.[side] != null) totalDuels += ms.duels[side];
		if (ms.duels_won?.[side] != null) totalDuelsWon += ms.duels_won[side];
		if (ms.xg?.[side] != null) {
			totalXg += ms.xg[side];
			gamesWithXg++;
		}

		totalGoals += side === "home" ? game.score_home : game.score_away;
	}

	if (gamesWithStats === 0) return null;

	return {
		games_with_stats: gamesWithStats,
		avg_possession: Math.round(totalPossession / gamesWithStats),
		avg_pass_accuracy: Math.round(totalPassAccuracy / gamesWithStats),
		avg_dribbling: Math.round(totalDribbling / gamesWithStats),
		avg_shot_accuracy: Math.round(totalShotAccuracy / gamesWithStats),
		avg_xg_per_game: gamesWithXg > 0 ? +(totalXg / gamesWithXg).toFixed(1) : null,
		total_xg: +totalXg.toFixed(1),
		xg_efficiency: totalXg > 0 ? +(totalGoals / totalXg).toFixed(2) : null,
		avg_duels_won_rate: totalDuels > 0 ? Math.round((totalDuelsWon / totalDuels) * 100) : null,
	};
}

/**
 * Computes all 15 profile badges
 * @param {object[]} games - All user games (sorted DESC)
 * @param {object} userGameMap
 * @param {object} stats - { total_games, careerMatchStats }
 * @returns {object[]}
 */
function computeBadges(games, userGameMap, stats) {
	const ms = stats.careerMatchStats;
	const gamesWithStats = ms?.games_with_stats || 0;

	const badges = [];

	// 1. tiki_taka — Avg pass accuracy > 85% (min 3 games)
	badges.push({
		type: "tiki_taka",
		emoji: "\u{1F3AF}",
		unlocked: gamesWithStats >= 3 && (ms?.avg_pass_accuracy || 0) > 85,
	});

	// 2. ball_magnet — Avg possession > 55% (min 3 games)
	badges.push({
		type: "ball_magnet",
		emoji: "\u{1F9F2}",
		unlocked: gamesWithStats >= 3 && (ms?.avg_possession || 0) > 55,
	});

	// 3. konter_king — Won a game with < 40% possession
	const hasKonterKing = games.some((game) => {
		if (!game.match_stats?.possession) return false;
		const ue = userGameMap[game.id];
		if (!ue) return false;
		const side = ue.team;
		const poss = game.match_stats.possession[side];
		const isWin =
			(side === "home" && game.score_home > game.score_away) ||
			(side === "away" && game.score_away > game.score_home);
		return isWin && poss < 40;
	});
	badges.push({ type: "konter_king", emoji: "\u26A1", unlocked: hasKonterKing });

	// 4. xg_killer — xG efficiency > 1.3 (min 5 games with stats)
	badges.push({
		type: "xg_killer",
		emoji: "\u{1F52B}",
		unlocked: gamesWithStats >= 5 && (ms?.xg_efficiency || 0) > 1.3,
	});

	// 5. duell_monster — Avg duel win rate > 60% (min 3 games)
	badges.push({
		type: "duell_monster",
		emoji: "\u{1F4AA}",
		unlocked: gamesWithStats >= 3 && (ms?.avg_duels_won_rate || 0) > 60,
	});

	// 6. perfektionist — 100% pass accuracy in any game
	const hasPerfekt = games.some((game) => {
		if (!game.match_stats?.pass_accuracy) return false;
		const side = userGameMap[game.id]?.team;
		return side && game.match_stats.pass_accuracy[side] === 100;
	});
	badges.push({ type: "perfektionist", emoji: "\u{1F48E}", unlocked: hasPerfekt });

	// 7. schuetzenfest — 5+ goals in a single game
	const hasSchuetzenfest = games.some((game) => {
		const side = userGameMap[game.id]?.team;
		if (!side) return false;
		const goals = side === "home" ? game.score_home : game.score_away;
		return goals >= 5;
	});
	badges.push({ type: "schuetzenfest", emoji: "\u{1F389}", unlocked: hasSchuetzenfest });

	// 8. clean_sheet — Won without conceding
	const hasCleanSheet = games.some((game) => {
		const side = userGameMap[game.id]?.team;
		if (!side) return false;
		const conceded = side === "home" ? game.score_away : game.score_home;
		const scored = side === "home" ? game.score_home : game.score_away;
		return conceded === 0 && scored > 0;
	});
	badges.push({ type: "clean_sheet", emoji: "\u{1F6E1}\uFE0F", unlocked: hasCleanSheet });

	// 9. david_vs_goliath — Won with < 30% possession
	const hasDavid = games.some((game) => {
		if (!game.match_stats?.possession) return false;
		const side = userGameMap[game.id]?.team;
		if (!side) return false;
		const poss = game.match_stats.possession[side];
		const isWin =
			(side === "home" && game.score_home > game.score_away) ||
			(side === "away" && game.score_away > game.score_home);
		return isWin && poss < 30;
	});
	badges.push({ type: "david_vs_goliath", emoji: "\u{1F3F9}", unlocked: hasDavid });

	// 10. fair_play — 10+ games without yellow card
	let gamesNoYellow = 0;
	for (const game of games) {
		const side = userGameMap[game.id]?.team;
		if (!side) continue;
		if (!game.match_stats?.yellow_cards) {
			gamesNoYellow++;
			continue;
		}
		if (game.match_stats.yellow_cards[side] === 0) gamesNoYellow++;
	}
	badges.push({ type: "fair_play", emoji: "\u{1F91D}", unlocked: gamesNoYellow >= 10 });

	// 11. debuetant — First game
	badges.push({ type: "debuetant", emoji: "\u{1F476}", unlocked: stats.total_games >= 1 });

	// 12. stammspieler — 25+ games
	badges.push({ type: "stammspieler", emoji: "\u2B50", unlocked: stats.total_games >= 25 });

	// 13. klublegende — 100+ games
	badges.push({ type: "klublegende", emoji: "\u{1F451}", unlocked: stats.total_games >= 100 });

	// 14. torjaeger_50 — 50+ career goals
	let totalCareerGoals = 0;
	for (const game of games) {
		const side = userGameMap[game.id]?.team;
		if (!side) continue;
		totalCareerGoals += side === "home" ? game.score_home : game.score_away;
	}
	badges.push({ type: "torjaeger_50", emoji: "\u26BD", unlocked: totalCareerGoals >= 50 });

	// 15. seriensieger — 5+ win streak at any point in history
	const hasSeriensieger = checkHistoricWinStreak(games, userGameMap, 5);
	badges.push({ type: "seriensieger", emoji: "\u{1F525}", unlocked: hasSeriensieger });

	return badges;
}

/**
 * Checks if the user ever had a win streak of at least minStreak
 * @param {object[]} games - Sorted by played_at DESC
 * @param {object} userGameMap
 * @param {number} minStreak
 * @returns {boolean}
 */
function checkHistoricWinStreak(games, userGameMap, minStreak) {
	const sorted = [...games].reverse(); // chronological order
	let streak = 0;
	let maxStreak = 0;

	for (const game of sorted) {
		const ue = userGameMap[game.id];
		if (!ue) continue;
		const side = ue.team;
		const isDraw = game.score_home === game.score_away;
		const isWin =
			(side === "home" && game.score_home > game.score_away) ||
			(side === "away" && game.score_away > game.score_home);

		if (isWin) {
			streak++;
			if (streak > maxStreak) maxStreak = streak;
		} else if (!isDraw) {
			streak = 0;
		}
		// draws don't break streak
	}

	return maxStreak >= minStreak;
}

/**
 * Calculates the current win/loss streak from games sorted by played_at DESC
 * @param {object[]} games - Games sorted by played_at DESC
 * @param {object} userGameMap - Map of game_id -> { team, team_name }
 * @returns {{ type: string, count: number }|null}
 */
function calculateStreak(games, userGameMap) {
	if (!games.length) return null;

	let streakType = null;
	let streakCount = 0;

	for (const game of games) {
		const userEntry = userGameMap[game.id];
		if (!userEntry) continue;

		const userTeam = userEntry.team;
		const isHomeWin = game.score_home > game.score_away;
		const isDraw = game.score_home === game.score_away;
		const isUserWin =
			(userTeam === "home" && isHomeWin) ||
			(userTeam === "away" && !isHomeWin && !isDraw);

		let result;
		if (isDraw) {
			result = "draw";
		} else if (isUserWin) {
			result = "win";
		} else {
			result = "loss";
		}

		// Skip draws at the start — they don't break a streak but don't count
		if (streakType === null && result === "draw") continue;

		if (streakType === null) {
			streakType = result;
			streakCount = 1;
		} else if (result === streakType) {
			streakCount++;
		} else if (result === "draw") {
			// Draws in the middle don't break the streak
			continue;
		} else {
			break;
		}
	}

	if (!streakType || streakCount < 2) return null;
	return { type: streakType, count: streakCount };
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
 * Finds favorite team from team name counts
 * @param {object} teamCount - { teamName: count }
 * @returns {object|null}
 */
function findFavoriteTeam(teamCount) {
	const entries = Object.entries(teamCount);
	if (!entries.length) return null;

	entries.sort((a, b) => b[1] - a[1]);
	const [teamName, count] = entries[0];

	return {
		name: teamName,
		short_name: null,
		games: count,
	};
}
