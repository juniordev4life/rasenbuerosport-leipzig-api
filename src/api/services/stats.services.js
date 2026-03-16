import { query } from "../helpers/database.helpers.js";
import { getPlayerEloSummary, getPlayerFormCurve } from "./elo.services.js";

/**
 * Gets comprehensive stats for a user, optionally filtered by date range
 * @param {string} userId
 * @param {string} [from] - ISO date string for start boundary
 * @param {string} [to] - ISO date string for end boundary
 * @returns {Promise<object>}
 */
export async function getUserStats(userId, from, to) {
	// Build date-filtered query for games the user participated in
	const conditions = ["gp.player_id = $1"];
	const params = [userId];
	let idx = 2;

	if (from) {
		conditions.push(`g.played_at >= $${idx++}`);
		params.push(from);
	}
	if (to) {
		conditions.push(`g.played_at <= $${idx++}`);
		params.push(to);
	}

	const playerGames = await query(
		`SELECT gp.game_id, gp.team, gp.team_name
		 FROM game_players gp
		 JOIN games g ON g.id = gp.game_id
		 WHERE ${conditions.join(" AND ")}`,
		params,
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
	const winRate =
		totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;

	// Find favorite opponent (most games against)
	const favoriteOpponent = findTopEntry(opponentCount, "games");

	// Find top teammates (highest win rate together, min 2 games)
	const topTeammates = findTopTeammates(teammateRecord, 3);
	const bestTeammate = topTeammates.length > 0 ? topTeammates[0] : null;

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
	const maxWinStreak = getMaxWinStreak(games, userGameMap);
	const badges = computeBadges(games, userGameMap, userId, {
		total_games: totalGames,
		careerMatchStats,
		goalStats,
		wins1v1,
		wins2v2,
		maxWinStreak,
	});

	// Determine goal tier based on individual goals
	const goalTier = getGoalTier(goalStats.total);

	// Elo rating data
	const eloSummary = await getPlayerEloSummary(userId);
	const formCurve = await getPlayerFormCurve(userId, 10);

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
		top_teammates: topTeammates,
		favorite_team: favoriteTeam,
		current_streak: currentStreak,
		last_played_at: lastPlayedAt,
		career_match_stats: careerMatchStats,
		badges,
		goal_tier: goalTier,
		total_individual_goals: goalStats.total,
		current_elo: eloSummary.current_elo,
		peak_elo: eloSummary.peak_elo,
		elo_change_last_game: eloSummary.elo_change_last_game,
		form_curve: formCurve,
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
		top_teammates: [],
		favorite_team: null,
		current_streak: null,
		last_played_at: null,
		career_match_stats: null,
		badges: [],
		goal_tier: null,
		total_individual_goals: 0,
		current_elo: 1200,
		peak_elo: 1200,
		elo_change_last_game: null,
		form_curve: [],
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
				gameGoals =
					userEntry.team === "home" ? game.score_home : game.score_away;
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
		if (ms.pass_accuracy?.[side] != null)
			totalPassAccuracy += ms.pass_accuracy[side];
		if (ms.dribbling?.[side] != null) totalDribbling += ms.dribbling[side];
		if (ms.shot_accuracy?.[side] != null)
			totalShotAccuracy += ms.shot_accuracy[side];
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
		avg_xg_per_game:
			gamesWithXg > 0 ? +(totalXg / gamesWithXg).toFixed(1) : null,
		total_xg: +totalXg.toFixed(1),
		xg_efficiency: totalXg > 0 ? +(totalGoals / totalXg).toFixed(2) : null,
		avg_duels_won_rate:
			totalDuels > 0 ? Math.round((totalDuelsWon / totalDuels) * 100) : null,
	};
}

/**
 * Creates a badge object with progress data
 * @param {object} params
 * @returns {object}
 */
function makeBadge({
	type,
	emoji,
	category,
	current,
	target,
	unlocked_at = null,
	next_tier = null,
}) {
	return {
		type,
		emoji,
		unlocked: current >= target,
		category,
		progress: { current, target },
		unlocked_at,
		next_tier,
	};
}

/** @type {Array<{type: string, emoji: string, threshold: number}>} */
const GOAL_BADGE_TIERS = [
	{ type: "torjaeger_bronze", emoji: "\u{1F949}", threshold: 20 },
	{ type: "torjaeger_silber", emoji: "\u{1F948}", threshold: 50 },
	{ type: "torjaeger_gold", emoji: "\u{1F947}", threshold: 100 },
	{ type: "torjaeger_platin", emoji: "\u{1F4A0}", threshold: 250 },
	{ type: "torjaeger_diamant", emoji: "\u{1F48E}", threshold: 500 },
];

/**
 * Computes all profile badges with categories, progress, and unlock dates
 * @param {object[]} games - All user games (sorted DESC)
 * @param {object} userGameMap
 * @param {string} userId
 * @param {object} stats - { total_games, careerMatchStats, goalStats, wins1v1, wins2v2, maxWinStreak }
 * @returns {object[]}
 */
function computeBadges(games, userGameMap, userId, stats) {
	const ms = stats.careerMatchStats;
	const gamesWithStats = ms?.games_with_stats || 0;
	const gs = stats.goalStats;
	const chronoGames = [...games].reverse();

	const badges = [];

	// === GOAL BADGES (category: "goals") ===

	for (let i = 0; i < GOAL_BADGE_TIERS.length; i++) {
		const tier = GOAL_BADGE_TIERS[i];
		const nextTier = GOAL_BADGE_TIERS[i + 1] || null;
		badges.push(
			makeBadge({
				type: tier.type,
				emoji: tier.emoji,
				category: "goals",
				current: gs.total,
				target: tier.threshold,
				unlocked_at:
					gs.total >= tier.threshold
						? findDateWhenGoalReached(
								chronoGames,
								userGameMap,
								userId,
								tier.threshold,
							)
						: null,
				next_tier: nextTier
					? { type: nextTier.type, target: nextTier.threshold }
					: null,
			}),
		);
	}

	badges.push(
		makeBadge({
			type: "doppelpacker",
			emoji: "\u270C\uFE0F",
			category: "goals",
			current: gs.maxInOneGame >= 2 ? 1 : 0,
			target: 1,
			unlocked_at:
				gs.maxInOneGame >= 2
					? findFirstGameMatching(chronoGames, userGameMap, (game, ue) => {
							return countGameGoals(game, ue, userId) >= 2;
						})
					: null,
		}),
	);

	badges.push(
		makeBadge({
			type: "hattrick_held",
			emoji: "\u{1FA96}",
			category: "goals",
			current: gs.maxInOneGame >= 3 ? 1 : 0,
			target: 1,
			unlocked_at:
				gs.maxInOneGame >= 3
					? findFirstGameMatching(chronoGames, userGameMap, (game, ue) => {
							return countGameGoals(game, ue, userId) >= 3;
						})
					: null,
		}),
	);

	// NEW: tormaschine — 4+ individual goals in one game
	badges.push(
		makeBadge({
			type: "tormaschine",
			emoji: "\u{1F4A5}",
			category: "goals",
			current: gs.maxInOneGame >= 4 ? 1 : 0,
			target: 1,
			unlocked_at:
				gs.maxInOneGame >= 4
					? findFirstGameMatching(chronoGames, userGameMap, (game, ue) => {
							return countGameGoals(game, ue, userId) >= 4;
						})
					: null,
		}),
	);

	// === MATCH STATS BADGES (category: "match_stats") ===

	badges.push(
		makeBadge({
			type: "tiki_taka",
			emoji: "\u{1F3AF}",
			category: "match_stats",
			current: gamesWithStats >= 3 ? ms?.avg_pass_accuracy || 0 : 0,
			target: 85,
		}),
	);

	badges.push(
		makeBadge({
			type: "ball_magnet",
			emoji: "\u{1F9F2}",
			category: "match_stats",
			current: gamesWithStats >= 3 ? ms?.avg_possession || 0 : 0,
			target: 55,
		}),
	);

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
	badges.push(
		makeBadge({
			type: "konter_king",
			emoji: "\u26A1",
			category: "match_stats",
			current: hasKonterKing ? 1 : 0,
			target: 1,
			unlocked_at: hasKonterKing
				? findFirstGameMatching(chronoGames, userGameMap, (game, ue) => {
						if (!game.match_stats?.possession) return false;
						const poss = game.match_stats.possession[ue.team];
						const isWin =
							(ue.team === "home" && game.score_home > game.score_away) ||
							(ue.team === "away" && game.score_away > game.score_home);
						return isWin && poss < 40;
					})
				: null,
		}),
	);

	badges.push(
		makeBadge({
			type: "xg_killer",
			emoji: "\u{1F52B}",
			category: "match_stats",
			current: gamesWithStats >= 5 ? ms?.xg_efficiency || 0 : 0,
			target: 1.3,
		}),
	);

	badges.push(
		makeBadge({
			type: "duell_monster",
			emoji: "\u{1F4AA}",
			category: "match_stats",
			current: gamesWithStats >= 3 ? ms?.avg_duels_won_rate || 0 : 0,
			target: 60,
		}),
	);

	const hasPerfekt = games.some((game) => {
		if (!game.match_stats?.pass_accuracy) return false;
		const side = userGameMap[game.id]?.team;
		return side && game.match_stats.pass_accuracy[side] === 100;
	});
	badges.push(
		makeBadge({
			type: "perfektionist",
			emoji: "\u{1F48E}",
			category: "match_stats",
			current: hasPerfekt ? 1 : 0,
			target: 1,
			unlocked_at: hasPerfekt
				? findFirstGameMatching(chronoGames, userGameMap, (game, ue) => {
						return game.match_stats?.pass_accuracy?.[ue.team] === 100;
					})
				: null,
		}),
	);

	const hasSchuetzenfest = games.some((game) => {
		const side = userGameMap[game.id]?.team;
		if (!side) return false;
		return (side === "home" ? game.score_home : game.score_away) >= 5;
	});
	badges.push(
		makeBadge({
			type: "schuetzenfest",
			emoji: "\u{1F389}",
			category: "match_stats",
			current: hasSchuetzenfest ? 1 : 0,
			target: 1,
			unlocked_at: hasSchuetzenfest
				? findFirstGameMatching(chronoGames, userGameMap, (game, ue) => {
						return (
							(ue.team === "home" ? game.score_home : game.score_away) >= 5
						);
					})
				: null,
		}),
	);

	const hasCleanSheet = games.some((game) => {
		const side = userGameMap[game.id]?.team;
		if (!side) return false;
		const conceded = side === "home" ? game.score_away : game.score_home;
		const scored = side === "home" ? game.score_home : game.score_away;
		return conceded === 0 && scored > 0;
	});
	badges.push(
		makeBadge({
			type: "clean_sheet",
			emoji: "\u{1F6E1}\uFE0F",
			category: "match_stats",
			current: hasCleanSheet ? 1 : 0,
			target: 1,
			unlocked_at: hasCleanSheet
				? findFirstGameMatching(chronoGames, userGameMap, (game, ue) => {
						const conceded =
							ue.team === "home" ? game.score_away : game.score_home;
						const scored =
							ue.team === "home" ? game.score_home : game.score_away;
						return conceded === 0 && scored > 0;
					})
				: null,
		}),
	);

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
	badges.push(
		makeBadge({
			type: "david_vs_goliath",
			emoji: "\u{1F3F9}",
			category: "match_stats",
			current: hasDavid ? 1 : 0,
			target: 1,
			unlocked_at: hasDavid
				? findFirstGameMatching(chronoGames, userGameMap, (game, ue) => {
						if (!game.match_stats?.possession) return false;
						const poss = game.match_stats.possession[ue.team];
						const isWin =
							(ue.team === "home" && game.score_home > game.score_away) ||
							(ue.team === "away" && game.score_away > game.score_home);
						return isWin && poss < 30;
					})
				: null,
		}),
	);

	// NEW: comeback_king — Win after trailing by 2+ goals
	const hasComeback = games.some((game) => {
		const ue = userGameMap[game.id];
		if (!ue) return false;
		return checkComeback(game, ue);
	});
	badges.push(
		makeBadge({
			type: "comeback_king",
			emoji: "\u{1F504}",
			category: "match_stats",
			current: hasComeback ? 1 : 0,
			target: 1,
			unlocked_at: hasComeback
				? findFirstGameMatching(chronoGames, userGameMap, (game, ue) =>
						checkComeback(game, ue),
					)
				: null,
		}),
	);

	// NEW: fruehstarter — Scored the opening goal in a game
	const hasFruehstarter = games.some((game) => {
		const ue = userGameMap[game.id];
		if (!ue) return false;
		return checkFruehstarter(game, ue, userId);
	});
	badges.push(
		makeBadge({
			type: "fruehstarter",
			emoji: "\u{1F305}",
			category: "match_stats",
			current: hasFruehstarter ? 1 : 0,
			target: 1,
			unlocked_at: hasFruehstarter
				? findFirstGameMatching(chronoGames, userGameMap, (game, ue) =>
						checkFruehstarter(game, ue, userId),
					)
				: null,
		}),
	);

	// === GENERAL BADGES (category: "general") ===

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
	badges.push(
		makeBadge({
			type: "fair_play",
			emoji: "\u{1F91D}",
			category: "general",
			current: gamesNoYellow,
			target: 10,
		}),
	);

	badges.push(
		makeBadge({
			type: "debuetant",
			emoji: "\u{1F476}",
			category: "general",
			current: stats.total_games,
			target: 1,
			unlocked_at:
				stats.total_games >= 1 ? findNthGameDate(chronoGames, 1) : null,
		}),
	);

	badges.push(
		makeBadge({
			type: "stammspieler",
			emoji: "\u2B50",
			category: "general",
			current: stats.total_games,
			target: 25,
			unlocked_at:
				stats.total_games >= 25 ? findNthGameDate(chronoGames, 25) : null,
		}),
	);

	// NEW: marathon_spieler — 50+ games
	badges.push(
		makeBadge({
			type: "marathon_spieler",
			emoji: "\u{1F3C3}",
			category: "general",
			current: stats.total_games,
			target: 50,
			unlocked_at:
				stats.total_games >= 50 ? findNthGameDate(chronoGames, 50) : null,
		}),
	);

	badges.push(
		makeBadge({
			type: "klublegende",
			emoji: "\u{1F451}",
			category: "general",
			current: stats.total_games,
			target: 100,
			unlocked_at:
				stats.total_games >= 100 ? findNthGameDate(chronoGames, 100) : null,
		}),
	);

	badges.push(
		makeBadge({
			type: "seriensieger",
			emoji: "\u{1F525}",
			category: "general",
			current: stats.maxWinStreak,
			target: 5,
		}),
	);

	// NEW: unbesiegbar — 10-game win streak
	badges.push(
		makeBadge({
			type: "unbesiegbar",
			emoji: "\u{1F9BE}",
			category: "general",
			current: stats.maxWinStreak,
			target: 10,
		}),
	);

	// NEW: solo_warrior — 10 wins in 1v1
	badges.push(
		makeBadge({
			type: "solo_warrior",
			emoji: "\u{1F93A}",
			category: "general",
			current: stats.wins1v1,
			target: 10,
		}),
	);

	// NEW: team_player — 10 wins in 2v2
	badges.push(
		makeBadge({
			type: "team_player",
			emoji: "\u{1F91D}\u200D",
			category: "general",
			current: stats.wins2v2,
			target: 10,
		}),
	);

	return badges;
}

/**
 * Counts individual goals for a player in a single game
 * @param {object} game
 * @param {object} userEntry - { team }
 * @param {string} userId
 * @returns {number}
 */
function countGameGoals(game, userEntry, userId) {
	const timeline = game.score_timeline;
	if (Array.isArray(timeline) && timeline.length > 0) {
		const hasScoredBy = timeline.some((e) => e.scored_by);
		if (hasScoredBy)
			return timeline.filter((e) => e.scored_by === userId).length;
		if (game.mode === "1v1")
			return userEntry.team === "home" ? game.score_home : game.score_away;
	} else if (game.mode === "1v1") {
		return userEntry.team === "home" ? game.score_home : game.score_away;
	}
	return 0;
}

/**
 * Checks if a game was a comeback win (trailing by 2+ goals then winning)
 * @param {object} game
 * @param {object} userEntry - { team }
 * @returns {boolean}
 */
function checkComeback(game, userEntry) {
	const timeline = game.score_timeline;
	if (!Array.isArray(timeline) || timeline.length < 3) return false;
	const side = userEntry.team;
	const isWin =
		(side === "home" && game.score_home > game.score_away) ||
		(side === "away" && game.score_away > game.score_home);
	if (!isWin) return false;
	let userScore = 0;
	let oppScore = 0;
	for (const entry of timeline) {
		if (entry.team === side) userScore++;
		else oppScore++;
		if (oppScore - userScore >= 2) return true;
	}
	return false;
}

/**
 * Checks if the user scored the opening goal in a game
 * @param {object} game
 * @param {object} userEntry - { team }
 * @param {string} userId
 * @returns {boolean}
 */
function checkFruehstarter(game, userEntry, userId) {
	const timeline = game.score_timeline;
	if (!Array.isArray(timeline) || timeline.length === 0) return false;
	const firstGoal = timeline[0];
	if (firstGoal.scored_by) return firstGoal.scored_by === userId;
	if (game.mode === "1v1") return firstGoal.team === userEntry.team;
	return false;
}

/**
 * Gets the maximum win streak length from game history
 * @param {object[]} games - Sorted by played_at DESC
 * @param {object} userGameMap
 * @returns {number}
 */
function getMaxWinStreak(games, userGameMap) {
	const sorted = [...games].reverse();
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
	}

	return maxStreak;
}

/**
 * Finds the approximate date when a cumulative goal threshold was first reached
 * @param {object[]} chronoGames - Games in chronological order
 * @param {object} userGameMap
 * @param {string} userId
 * @param {number} threshold
 * @returns {string|null}
 */
function findDateWhenGoalReached(chronoGames, userGameMap, userId, threshold) {
	let cumulative = 0;
	for (const game of chronoGames) {
		const ue = userGameMap[game.id];
		if (!ue) continue;
		cumulative += countGameGoals(game, ue, userId);
		if (cumulative >= threshold) return game.played_at;
	}
	return null;
}

/**
 * Finds the date of the first game matching a predicate
 * @param {object[]} chronoGames - Games in chronological order
 * @param {object} userGameMap
 * @param {Function} predicate - (game, userEntry) => boolean
 * @returns {string|null}
 */
function findFirstGameMatching(chronoGames, userGameMap, predicate) {
	for (const game of chronoGames) {
		const ue = userGameMap[game.id];
		if (!ue) continue;
		if (predicate(game, ue)) return game.played_at;
	}
	return null;
}

/**
 * Gets the played_at date of the nth game (chronological)
 * @param {object[]} chronoGames - Games in chronological order
 * @param {number} n - 1-indexed
 * @returns {string|null}
 */
function findNthGameDate(chronoGames, n) {
	return chronoGames.length >= n ? chronoGames[n - 1].played_at : null;
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
	const sorted = Object.entries(entries).sort((a, b) => b[1][key] - a[1][key]);
	if (!sorted.length) return null;
	const [, data] = sorted[0];
	return {
		username: data.username,
		avatar_url: data.avatar_url,
		games: data.games,
	};
}

/**
 * Finds the top teammates by win rate (min 2 games together)
 * @param {object} teammateRecord
 * @param {number} count - Number of top teammates to return
 * @returns {Array<object>}
 */
function findTopTeammates(teammateRecord, count = 3) {
	const eligible = Object.entries(teammateRecord).filter(
		([, data]) => data.games >= 2,
	);

	if (!eligible.length) {
		// Fallback: take most played teammate
		const all = Object.entries(teammateRecord).sort(
			(a, b) => b[1].games - a[1].games,
		);
		if (!all.length) return [];
		const [id, data] = all[0];
		return [
			{
				player_id: id,
				username: data.username,
				avatar_url: data.avatar_url,
				games: data.games,
				wins: data.wins,
				win_rate:
					data.games > 0 ? Math.round((data.wins / data.games) * 100) : 0,
			},
		];
	}

	eligible.sort((a, b) => {
		const diff = b[1].wins / b[1].games - a[1].wins / a[1].games;
		return diff !== 0 ? diff : b[1].games - a[1].games;
	});

	return eligible.slice(0, count).map(([id, data]) => ({
		player_id: id,
		username: data.username,
		avatar_url: data.avatar_url,
		games: data.games,
		wins: data.wins,
		win_rate: Math.round((data.wins / data.games) * 100),
	}));
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
