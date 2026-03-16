import { query } from "../helpers/database.helpers.js";

/**
 * Gets duo leaderboard — ranking of all player duos from 2v2 games
 * @param {number} limit - Max duos to return
 * @param {string} [from] - ISO date start boundary
 * @param {string} [to] - ISO date end boundary
 * @returns {Promise<Array>}
 */
export async function getDuoLeaderboard(limit = 20, from, to) {
	const conditions = ["g.mode = '2v2'"];
	const params = [];
	let idx = 1;

	if (from) {
		conditions.push(`g.played_at >= $${idx++}`);
		params.push(from);
	}
	if (to) {
		conditions.push(`g.played_at <= $${idx++}`);
		params.push(to);
	}

	const games = await query(
		`SELECT g.id, g.score_home, g.score_away, g.played_at,
			json_agg(
				json_build_object(
					'player_id', gp.player_id,
					'team', gp.team,
					'profiles', json_build_object('username', p.username, 'avatar_url', p.avatar_url)
				)
			) AS game_players
		FROM games g
		LEFT JOIN game_players gp ON gp.game_id = g.id
		LEFT JOIN profiles p ON p.id = gp.player_id
		WHERE ${conditions.join(" AND ")}
		GROUP BY g.id
		ORDER BY g.played_at DESC`,
		params,
	);

	// Aggregate stats per duo
	/** @type {Record<string, {player1: object, player2: object, games: number, wins: number, losses: number, draws: number, last_played_at: string, results: Array<{result: string}>}>} */
	const duoMap = {};

	for (const game of games) {
		const isHomeWin = game.score_home > game.score_away;
		const isDraw = game.score_home === game.score_away;

		// Group players by team
		const teams = { home: [], away: [] };
		for (const gp of game.game_players) {
			if (gp.team === "home" || gp.team === "away") {
				teams[gp.team].push(gp);
			}
		}

		// Process each team side as a duo
		for (const side of ["home", "away"]) {
			const players = teams[side];
			if (players.length !== 2) continue;

			// Canonicalize duo key (sorted IDs)
			const sorted = [...players].sort((a, b) =>
				a.player_id.localeCompare(b.player_id),
			);
			const duoId = `${sorted[0].player_id}_${sorted[1].player_id}`;

			if (!duoMap[duoId]) {
				duoMap[duoId] = {
					player1: {
						player_id: sorted[0].player_id,
						username: sorted[0].profiles?.username || "Unknown",
						avatar_url: sorted[0].profiles?.avatar_url || null,
					},
					player2: {
						player_id: sorted[1].player_id,
						username: sorted[1].profiles?.username || "Unknown",
						avatar_url: sorted[1].profiles?.avatar_url || null,
					},
					games: 0,
					wins: 0,
					losses: 0,
					draws: 0,
					last_played_at: null,
					results: [],
				};
			}

			const duo = duoMap[duoId];
			duo.games++;

			const isWin =
				(side === "home" && isHomeWin) ||
				(side === "away" && !isHomeWin && !isDraw);

			if (isDraw) {
				duo.draws++;
				duo.results.push({ result: "D" });
			} else if (isWin) {
				duo.wins++;
				duo.results.push({ result: "W" });
			} else {
				duo.losses++;
				duo.results.push({ result: "L" });
			}

			if (!duo.last_played_at || game.played_at > duo.last_played_at) {
				duo.last_played_at = game.played_at;
			}
		}
	}

	// Filter, compute streak, sort, limit
	return Object.entries(duoMap)
		.filter(([, d]) => d.games >= 3)
		.map(([duoId, d]) => ({
			duo_id: duoId,
			player1: d.player1,
			player2: d.player2,
			games: d.games,
			wins: d.wins,
			losses: d.losses,
			draws: d.draws,
			win_rate: Math.round((d.wins / d.games) * 100),
			points: d.wins * 3 + d.draws,
			current_streak: calculateStreak(d.results),
			last_played_at: d.last_played_at,
		}))
		.sort((a, b) => b.points - a.points || b.win_rate - a.win_rate)
		.slice(0, limit);
}

/**
 * Gets detailed stats for a specific duo
 * @param {string} player1Id
 * @param {string} player2Id
 * @returns {Promise<object>}
 */
export async function getDuoDetail(player1Id, player2Id) {
	// Canonicalize IDs
	const [id1, id2] = [player1Id, player2Id].sort();

	// Find 2v2 games where both players are on the same team
	const commonGames = await query(
		`SELECT gp1.game_id, gp1.team
		FROM game_players gp1
		JOIN game_players gp2 ON gp2.game_id = gp1.game_id AND gp2.player_id = $2
		JOIN games g ON g.id = gp1.game_id
		WHERE gp1.player_id = $1 AND g.mode = '2v2' AND gp1.team = gp2.team`,
		[id1, id2],
	);

	// Fetch profiles
	const profiles = await query(
		"SELECT id, username, avatar_url FROM profiles WHERE id = ANY($1)",
		[[id1, id2]],
	);
	const p1 = profiles.find((p) => p.id === id1);
	const p2 = profiles.find((p) => p.id === id2);
	const player1 = {
		player_id: id1,
		username: p1?.username || "Unknown",
		avatar_url: p1?.avatar_url || null,
	};
	const player2 = {
		player_id: id2,
		username: p2?.username || "Unknown",
		avatar_url: p2?.avatar_url || null,
	};

	if (!commonGames.length) {
		return getEmptyDuoDetail(player1, player2);
	}

	const gameIds = commonGames.map((g) => g.game_id);
	const teamMap = {};
	for (const cg of commonGames) {
		teamMap[cg.game_id] = cg.team;
	}

	// Fetch full game data with all players
	const games = await query(
		`SELECT g.id, g.mode, g.score_home, g.score_away, g.played_at, g.match_stats,
			g.result_type, g.score_timeline,
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

	let wins = 0;
	let losses = 0;
	let draws = 0;
	const trend = [];

	// Match stats aggregation
	let gamesWithStats = 0;
	let totalPossession = 0;
	let totalPassAccuracy = 0;
	let totalShotAccuracy = 0;
	let totalXg = 0;
	let gamesWithXg = 0;

	// Opponent duo tracking
	/** @type {Record<string, {player1: object, player2: object, games: number, wins: number, draws: number, losses: number}>} */
	const opponentDuos = {};

	for (const game of games) {
		const duoSide = teamMap[game.id];
		if (!duoSide) continue;

		const isHomeWin = game.score_home > game.score_away;
		const isDraw = game.score_home === game.score_away;
		const isWin =
			(duoSide === "home" && isHomeWin) ||
			(duoSide === "away" && !isHomeWin && !isDraw);

		if (isDraw) draws++;
		else if (isWin) wins++;
		else losses++;

		const result = isDraw ? "D" : isWin ? "W" : "L";
		trend.push({ result, played_at: game.played_at });

		// Aggregate match stats for the duo's side
		if (game.match_stats) {
			const ms = game.match_stats;
			gamesWithStats++;
			if (ms.possession?.[duoSide] != null)
				totalPossession += ms.possession[duoSide];
			if (ms.pass_accuracy?.[duoSide] != null)
				totalPassAccuracy += ms.pass_accuracy[duoSide];
			if (ms.shot_accuracy?.[duoSide] != null)
				totalShotAccuracy += ms.shot_accuracy[duoSide];
			if (ms.xg?.[duoSide] != null) {
				totalXg += ms.xg[duoSide];
				gamesWithXg++;
			}
		}

		// Identify opponent duo
		const oppSide = duoSide === "home" ? "away" : "home";
		const oppPlayers = game.game_players
			.filter((gp) => gp.team === oppSide)
			.sort((a, b) => a.player_id.localeCompare(b.player_id));

		if (oppPlayers.length === 2) {
			const oppId = `${oppPlayers[0].player_id}_${oppPlayers[1].player_id}`;
			if (!opponentDuos[oppId]) {
				opponentDuos[oppId] = {
					player1: {
						player_id: oppPlayers[0].player_id,
						username: oppPlayers[0].profiles?.username || "Unknown",
						avatar_url: oppPlayers[0].profiles?.avatar_url || null,
					},
					player2: {
						player_id: oppPlayers[1].player_id,
						username: oppPlayers[1].profiles?.username || "Unknown",
						avatar_url: oppPlayers[1].profiles?.avatar_url || null,
					},
					games: 0,
					wins: 0,
					draws: 0,
					losses: 0,
				};
			}
			const opp = opponentDuos[oppId];
			opp.games++;
			if (isDraw) opp.draws++;
			else if (isWin) opp.wins++;
			else opp.losses++;
		}
	}

	const streak = calculateStreak(trend);
	trend.reverse();

	const totalGames = wins + losses + draws;

	const avgMatchStats =
		gamesWithStats > 0
			? {
					games_with_stats: gamesWithStats,
					avg_possession: Math.round(totalPossession / gamesWithStats),
					avg_pass_accuracy: Math.round(totalPassAccuracy / gamesWithStats),
					avg_xg_per_game:
						gamesWithXg > 0 ? +(totalXg / gamesWithXg).toFixed(1) : null,
					avg_shot_accuracy: Math.round(totalShotAccuracy / gamesWithStats),
				}
			: null;

	const sortedOpponentDuos = Object.values(opponentDuos).sort(
		(a, b) => b.games - a.games,
	);

	return {
		player1,
		player2,
		total_games: totalGames,
		wins,
		losses,
		draws,
		win_rate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
		trend,
		streak,
		avg_match_stats: avgMatchStats,
		opponent_duos: sortedOpponentDuos,
		recent_games: games.slice(0, 5),
	};
}

/**
 * Returns empty duo detail
 * @param {object} player1
 * @param {object} player2
 * @returns {object}
 */
function getEmptyDuoDetail(player1, player2) {
	return {
		player1,
		player2,
		total_games: 0,
		wins: 0,
		losses: 0,
		draws: 0,
		win_rate: 0,
		trend: [],
		streak: null,
		avg_match_stats: null,
		opponent_duos: [],
		recent_games: [],
	};
}

/**
 * Calculates current streak from results (most recent first)
 * Draws don't break win/loss streaks
 * @param {Array<{result: string}>} results
 * @returns {{ type: string, count: number }|null}
 */
function calculateStreak(results) {
	if (!results.length) return null;

	let streakType = null;
	let streakCount = 0;

	for (const { result } of results) {
		const type = result === "W" ? "win" : result === "L" ? "loss" : "draw";

		if (streakType === null && type === "draw") continue;
		if (streakType === null) {
			streakType = type;
			streakCount = 1;
		} else if (type === streakType) {
			streakCount++;
		} else if (type === "draw") {
			// Draws don't break a win/loss streak
		} else {
			break;
		}
	}

	return streakType ? { type: streakType, count: streakCount } : null;
}
