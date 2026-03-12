import { query } from "../helpers/database.helpers.js";

/**
 * Gets comprehensive stats for a user
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function getUserStats(userId) {
	// Fetch all games the user participated in
	const playerGames = await query(
		"SELECT game_id, team, team_name FROM game_players WHERE player_id = $1",
		[userId],
	);

	if (!playerGames.length) {
		return getEmptyStats();
	}

	const gameIds = playerGames.map((pg) => pg.game_id);

	const games = await query(
		`SELECT g.id, g.mode, g.score_home, g.score_away, g.played_at, g.match_stats, g.score_timeline,
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
		[gameIds],
	);

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

	// Individual goal stats (from scored_by in score_timeline)
	const goalStats = countIndividualGoals(games, userGameMap, userId);

	// Badges
	const badges = computeBadges(games, userGameMap, {
		total_games: totalGames,
		careerMatchStats,
		goalStats,
	});

	// Determine goal tier based on individual goals
	const goalTier = getGoalTier(goalStats.total);

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
		goal_tier: goalTier,
		total_individual_goals: goalStats.total,
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
		goal_tier: null,
		total_individual_goals: 0,
	};
}

/**
 * Counts individual goals scored by a user across all games.
 * Uses scored_by from score_timeline when available.
 * Falls back to team score for 1v1 games without scored_by.
 * @param {object[]} games
 * @param {object} userGameMap
 * @param {string} userId
 * @returns {{ total: number, maxInOneGame: number }}
 */
function countIndividualGoals(games, userGameMap, userId) {
	let total = 0;
	let maxInOneGame = 0;

	for (const game of games) {
		const userEntry = userGameMap[game.id];
		if (!userEntry) continue;

		const timeline = game.score_timeline;
		let gameGoals = 0;

		if (Array.isArray(timeline) && timeline.length > 0) {
			const hasScoredBy = timeline.some((e) => e.scored_by);

			if (hasScoredBy) {
				// Count individual goals from scored_by
				gameGoals = timeline.filter((e) => e.scored_by === userId).length;
			} else if (game.mode === "1v1") {
				// 1v1 fallback: player = team, credit full team score
				gameGoals = userEntry.team === "home" ? game.score_home : game.score_away;
			}
		} else if (game.mode === "1v1") {
			// No timeline at all, 1v1 fallback
			gameGoals = userEntry.team === "home" ? game.score_home : game.score_away;
		}

		total += gameGoals;
		if (gameGoals > maxInOneGame) maxInOneGame = gameGoals;
	}

	return { total, maxInOneGame };
}

/** @type {Array<{tier: string, threshold: number}>} */
const GOAL_TIERS = [
	{ tier: "diamant", threshold: 500 },
	{ tier: "platin", threshold: 250 },
	{ tier: "gold", threshold: 100 },
	{ tier: "silber", threshold: 50 },
	{ tier: "bronze", threshold: 20 },
];

/**
 * Determines goal tier based on total individual goals
 * @param {number} totalGoals
 * @returns {string|null}
 */
function getGoalTier(totalGoals) {
	for (const { tier, threshold } of GOAL_TIERS) {
		if (totalGoals >= threshold) return tier;
	}
	return null;
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
 * Computes all profile badges with categories
 * @param {object[]} games - All user games (sorted DESC)
 * @param {object} userGameMap
 * @param {object} stats - { total_games, careerMatchStats, goalStats }
 * @returns {object[]}
 */
function computeBadges(games, userGameMap, stats) {
	const ms = stats.careerMatchStats;
	const gamesWithStats = ms?.games_with_stats || 0;
	const gs = stats.goalStats;

	const badges = [];

	// === GOAL BADGES (category: "goals") ===

	// Tiered career goal badges
	badges.push({
		type: "torjaeger_bronze",
		emoji: "\u{1F949}",
		unlocked: gs.total >= 20,
		category: "goals",
	});
	badges.push({
		type: "torjaeger_silber",
		emoji: "\u{1F948}",
		unlocked: gs.total >= 50,
		category: "goals",
	});
	badges.push({
		type: "torjaeger_gold",
		emoji: "\u{1F947}",
		unlocked: gs.total >= 100,
		category: "goals",
	});
	badges.push({
		type: "torjaeger_platin",
		emoji: "\u{1F4A0}",
		unlocked: gs.total >= 250,
		category: "goals",
	});
	badges.push({
		type: "torjaeger_diamant",
		emoji: "\u{1F48E}",
		unlocked: gs.total >= 500,
		category: "goals",
	});

	// Per-game goal badges
	badges.push({
		type: "doppelpacker",
		emoji: "\u270C\uFE0F",
		unlocked: gs.maxInOneGame >= 2,
		category: "goals",
	});
	badges.push({
		type: "hattrick_held",
		emoji: "\u{1FA96}",
		unlocked: gs.maxInOneGame >= 3,
		category: "goals",
	});

	// === MATCH STATS BADGES (category: "match_stats") ===

	// tiki_taka — Avg pass accuracy > 85% (min 3 games)
	badges.push({
		type: "tiki_taka",
		emoji: "\u{1F3AF}",
		unlocked: gamesWithStats >= 3 && (ms?.avg_pass_accuracy || 0) > 85,
		category: "match_stats",
	});

	// ball_magnet — Avg possession > 55% (min 3 games)
	badges.push({
		type: "ball_magnet",
		emoji: "\u{1F9F2}",
		unlocked: gamesWithStats >= 3 && (ms?.avg_possession || 0) > 55,
		category: "match_stats",
	});

	// konter_king — Won a game with < 40% possession
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
	badges.push({ type: "konter_king", emoji: "\u26A1", unlocked: hasKonterKing, category: "match_stats" });

	// xg_killer — xG efficiency > 1.3 (min 5 games with stats)
	badges.push({
		type: "xg_killer",
		emoji: "\u{1F52B}",
		unlocked: gamesWithStats >= 5 && (ms?.xg_efficiency || 0) > 1.3,
		category: "match_stats",
	});

	// duell_monster — Avg duel win rate > 60% (min 3 games)
	badges.push({
		type: "duell_monster",
		emoji: "\u{1F4AA}",
		unlocked: gamesWithStats >= 3 && (ms?.avg_duels_won_rate || 0) > 60,
		category: "match_stats",
	});

	// perfektionist — 100% pass accuracy in any game
	const hasPerfekt = games.some((game) => {
		if (!game.match_stats?.pass_accuracy) return false;
		const side = userGameMap[game.id]?.team;
		return side && game.match_stats.pass_accuracy[side] === 100;
	});
	badges.push({ type: "perfektionist", emoji: "\u{1F48E}", unlocked: hasPerfekt, category: "match_stats" });

	// schuetzenfest — 5+ team goals in a single game
	const hasSchuetzenfest = games.some((game) => {
		const side = userGameMap[game.id]?.team;
		if (!side) return false;
		const goals = side === "home" ? game.score_home : game.score_away;
		return goals >= 5;
	});
	badges.push({ type: "schuetzenfest", emoji: "\u{1F389}", unlocked: hasSchuetzenfest, category: "match_stats" });

	// clean_sheet — Won without conceding
	const hasCleanSheet = games.some((game) => {
		const side = userGameMap[game.id]?.team;
		if (!side) return false;
		const conceded = side === "home" ? game.score_away : game.score_home;
		const scored = side === "home" ? game.score_home : game.score_away;
		return conceded === 0 && scored > 0;
	});
	badges.push({ type: "clean_sheet", emoji: "\u{1F6E1}\uFE0F", unlocked: hasCleanSheet, category: "match_stats" });

	// david_vs_goliath — Won with < 30% possession
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
	badges.push({ type: "david_vs_goliath", emoji: "\u{1F3F9}", unlocked: hasDavid, category: "match_stats" });

	// === GENERAL BADGES (category: "general") ===

	// fair_play — 10+ games without yellow card
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
	badges.push({ type: "fair_play", emoji: "\u{1F91D}", unlocked: gamesNoYellow >= 10, category: "general" });

	// debuetant — First game
	badges.push({ type: "debuetant", emoji: "\u{1F476}", unlocked: stats.total_games >= 1, category: "general" });

	// stammspieler — 25+ games
	badges.push({ type: "stammspieler", emoji: "\u2B50", unlocked: stats.total_games >= 25, category: "general" });

	// klublegende — 100+ games
	badges.push({ type: "klublegende", emoji: "\u{1F451}", unlocked: stats.total_games >= 100, category: "general" });

	// seriensieger — 5+ win streak at any point in history
	const hasSeriensieger = checkHistoricWinStreak(games, userGameMap, 5);
	badges.push({ type: "seriensieger", emoji: "\u{1F525}", unlocked: hasSeriensieger, category: "general" });

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
