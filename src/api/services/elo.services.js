import { getPool } from "../../config/database.config.js";
import { query, queryOne } from "../helpers/database.helpers.js";

/** Default starting Elo for new players */
const DEFAULT_ELO = 1200;

/** K-factor: how much a single game can shift ratings */
const K_FACTOR = 32;

/**
 * Calculates the expected score for player A against player B
 * @param {number} ratingA - Player A's Elo rating
 * @param {number} ratingB - Player B's Elo rating
 * @returns {number} Expected score between 0 and 1
 */
export function calculateExpectedScore(ratingA, ratingB) {
	return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * Calculates the new Elo rating after a game
 * @param {number} currentRating - Current Elo rating
 * @param {number} expectedScore - Expected score (0-1)
 * @param {number} actualScore - Actual score (1=win, 0.5=draw, 0=loss)
 * @returns {number} New Elo rating (rounded)
 */
export function calculateNewRating(currentRating, expectedScore, actualScore) {
	return Math.round(currentRating + K_FACTOR * (actualScore - expectedScore));
}

/**
 * Gets a player's current Elo rating, creating a default entry if none exists
 * @param {string} playerId
 * @returns {Promise<number>}
 */
export async function getPlayerElo(playerId) {
	const row = await queryOne(
		"SELECT elo FROM player_ratings WHERE player_id = $1",
		[playerId],
	);
	return row?.elo ?? DEFAULT_ELO;
}

/**
 * Processes Elo changes for a completed game.
 * Handles both 1v1 and 2v2 modes.
 * @param {object} params
 * @param {string} params.gameId - The game UUID
 * @param {number} params.scoreHome - Home team score
 * @param {number} params.scoreAway - Away team score
 * @param {Array<{id: string, team: string}>} params.players - Player list
 * @returns {Promise<Array<{player_id: string, elo_before: number, elo_after: number, elo_change: number}>>}
 */
export async function processGameElo({
	gameId,
	scoreHome,
	scoreAway,
	players,
}) {
	const homePlayers = players.filter((p) => p.team === "home");
	const awayPlayers = players.filter((p) => p.team === "away");

	// Fetch current ratings for all players
	const ratings = {};
	for (const p of players) {
		ratings[p.id] = await getPlayerElo(p.id);
	}

	// Calculate average team Elo
	const homeAvgElo =
		homePlayers.reduce((sum, p) => sum + ratings[p.id], 0) / homePlayers.length;
	const awayAvgElo =
		awayPlayers.reduce((sum, p) => sum + ratings[p.id], 0) / awayPlayers.length;

	// Determine actual scores
	let homeActual;
	let awayActual;
	if (scoreHome > scoreAway) {
		homeActual = 1.0;
		awayActual = 0.0;
	} else if (scoreHome < scoreAway) {
		homeActual = 0.0;
		awayActual = 1.0;
	} else {
		homeActual = 0.5;
		awayActual = 0.5;
	}

	// Calculate expected scores based on team averages
	const homeExpected = calculateExpectedScore(homeAvgElo, awayAvgElo);
	const awayExpected = calculateExpectedScore(awayAvgElo, homeAvgElo);

	const results = [];
	const client = await getPool().connect();

	try {
		await client.query("BEGIN");

		for (const p of players) {
			const isHome = p.team === "home";
			const eloBefore = ratings[p.id];
			const expected = isHome ? homeExpected : awayExpected;
			const actual = isHome ? homeActual : awayActual;
			const eloAfter = calculateNewRating(eloBefore, expected, actual);
			const eloChange = eloAfter - eloBefore;

			// Upsert player_ratings
			await client.query(
				`INSERT INTO player_ratings (player_id, elo, peak_elo, updated_at)
				 VALUES ($1, $2, GREATEST($2, $3), now())
				 ON CONFLICT (player_id)
				 DO UPDATE SET
				   elo = $2,
				   peak_elo = GREATEST(player_ratings.peak_elo, $2),
				   updated_at = now()`,
				[p.id, eloAfter, DEFAULT_ELO],
			);

			// Insert elo_history
			await client.query(
				`INSERT INTO elo_history (player_id, game_id, elo_before, elo_after, elo_change)
				 VALUES ($1, $2, $3, $4, $5)
				 ON CONFLICT (game_id, player_id) DO NOTHING`,
				[p.id, gameId, eloBefore, eloAfter, eloChange],
			);

			results.push({
				player_id: p.id,
				elo_before: eloBefore,
				elo_after: eloAfter,
				elo_change: eloChange,
			});
		}

		await client.query("COMMIT");
		return results;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Gets Elo history for a player (most recent first)
 * @param {string} playerId
 * @param {number} [limit=50]
 * @returns {Promise<object[]>}
 */
export async function getPlayerEloHistory(playerId, limit = 50) {
	return query(
		`SELECT eh.game_id, eh.elo_before, eh.elo_after, eh.elo_change, eh.created_at,
		        g.score_home, g.score_away, g.mode,
		        gp.team
		 FROM elo_history eh
		 JOIN games g ON g.id = eh.game_id
		 JOIN game_players gp ON gp.game_id = eh.game_id AND gp.player_id = eh.player_id
		 WHERE eh.player_id = $1
		 ORDER BY eh.created_at DESC
		 LIMIT $2`,
		[playerId, limit],
	);
}

/**
 * Gets the last N games with result and Elo for a player (for form curve)
 * @param {string} playerId
 * @param {number} [limit=10]
 * @returns {Promise<Array<{game_id: string, result: string, elo_after: number, elo_change: number, played_at: string}>>}
 */
export async function getPlayerFormCurve(playerId, limit = 10) {
	const rows = await query(
		`SELECT eh.game_id, eh.elo_after, eh.elo_change, g.played_at,
		        g.score_home, g.score_away, gp.team
		 FROM elo_history eh
		 JOIN games g ON g.id = eh.game_id
		 JOIN game_players gp ON gp.game_id = eh.game_id AND gp.player_id = eh.player_id
		 WHERE eh.player_id = $1
		 ORDER BY g.played_at DESC
		 LIMIT $2`,
		[playerId, limit],
	);

	return rows.map((row) => {
		const isHome = row.team === "home";
		const isDraw = row.score_home === row.score_away;
		const isWin = isHome
			? row.score_home > row.score_away
			: row.score_away > row.score_home;

		return {
			game_id: row.game_id,
			result: isDraw ? "D" : isWin ? "W" : "L",
			elo_after: row.elo_after,
			elo_change: row.elo_change,
			played_at: row.played_at,
		};
	});
}

/**
 * Gets the Elo rating summary for a player
 * @param {string} playerId
 * @returns {Promise<{current_elo: number, peak_elo: number, elo_change_last_game: number|null}>}
 */
export async function getPlayerEloSummary(playerId) {
	const rating = await queryOne(
		"SELECT elo, peak_elo FROM player_ratings WHERE player_id = $1",
		[playerId],
	);

	const lastChange = await queryOne(
		`SELECT elo_change FROM elo_history
		 WHERE player_id = $1
		 ORDER BY created_at DESC LIMIT 1`,
		[playerId],
	);

	return {
		current_elo: rating?.elo ?? DEFAULT_ELO,
		peak_elo: rating?.peak_elo ?? DEFAULT_ELO,
		elo_change_last_game: lastChange?.elo_change ?? null,
	};
}

/**
 * Gets Elo changes for a specific game (all players)
 * @param {string} gameId
 * @returns {Promise<Array<{player_id: string, elo_before: number, elo_after: number, elo_change: number}>>}
 */
export async function getGameEloChanges(gameId) {
	return query(
		`SELECT eh.player_id, eh.elo_before, eh.elo_after, eh.elo_change
		 FROM elo_history eh
		 WHERE eh.game_id = $1`,
		[gameId],
	);
}

/**
 * Recalculates all Elo ratings from scratch by replaying all games in chronological order.
 * This is a destructive operation - it wipes all existing Elo data and rebuilds.
 * @returns {Promise<{games_processed: number, players_updated: number}>}
 */
export async function recalculateAllElo() {
	const client = await getPool().connect();

	try {
		await client.query("BEGIN");

		// Wipe existing data
		await client.query("DELETE FROM elo_history");
		await client.query("DELETE FROM player_ratings");

		// Fetch all games in chronological order with their players
		const { rows: games } = await client.query(
			`SELECT g.id, g.score_home, g.score_away, g.played_at,
			        json_agg(
			          json_build_object('player_id', gp.player_id, 'team', gp.team)
			        ) AS players
			 FROM games g
			 JOIN game_players gp ON gp.game_id = g.id
			 GROUP BY g.id
			 ORDER BY g.played_at ASC`,
		);

		// In-memory rating tracker
		const currentRatings = {};
		const peakRatings = {};
		const playersUpdated = new Set();

		for (const game of games) {
			const homePlayers = game.players.filter((p) => p.team === "home");
			const awayPlayers = game.players.filter((p) => p.team === "away");

			// Ensure all players have a starting rating
			for (const p of game.players) {
				if (currentRatings[p.player_id] === undefined) {
					currentRatings[p.player_id] = DEFAULT_ELO;
					peakRatings[p.player_id] = DEFAULT_ELO;
				}
				playersUpdated.add(p.player_id);
			}

			// Calculate average team Elo
			const homeAvg =
				homePlayers.reduce((sum, p) => sum + currentRatings[p.player_id], 0) /
				homePlayers.length;
			const awayAvg =
				awayPlayers.reduce((sum, p) => sum + currentRatings[p.player_id], 0) /
				awayPlayers.length;

			// Determine actual scores
			let homeActual;
			let awayActual;
			if (game.score_home > game.score_away) {
				homeActual = 1.0;
				awayActual = 0.0;
			} else if (game.score_home < game.score_away) {
				homeActual = 0.0;
				awayActual = 1.0;
			} else {
				homeActual = 0.5;
				awayActual = 0.5;
			}

			const homeExpected = calculateExpectedScore(homeAvg, awayAvg);
			const awayExpected = calculateExpectedScore(awayAvg, homeAvg);

			// Process each player
			for (const p of game.players) {
				const isHome = p.team === "home";
				const eloBefore = currentRatings[p.player_id];
				const expected = isHome ? homeExpected : awayExpected;
				const actual = isHome ? homeActual : awayActual;
				const eloAfter = calculateNewRating(eloBefore, expected, actual);
				const eloChange = eloAfter - eloBefore;

				// Insert history
				await client.query(
					`INSERT INTO elo_history (player_id, game_id, elo_before, elo_after, elo_change, created_at)
					 VALUES ($1, $2, $3, $4, $5, $6)`,
					[
						p.player_id,
						game.id,
						eloBefore,
						eloAfter,
						eloChange,
						game.played_at,
					],
				);

				// Update in-memory state
				currentRatings[p.player_id] = eloAfter;
				if (eloAfter > peakRatings[p.player_id]) {
					peakRatings[p.player_id] = eloAfter;
				}
			}
		}

		// Write final ratings to player_ratings
		for (const playerId of playersUpdated) {
			await client.query(
				`INSERT INTO player_ratings (player_id, elo, peak_elo, updated_at)
				 VALUES ($1, $2, $3, now())`,
				[playerId, currentRatings[playerId], peakRatings[playerId]],
			);
		}

		await client.query("COMMIT");

		return {
			games_processed: games.length,
			players_updated: playersUpdated.size,
		};
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
