import { getPool } from "../../config/database.config.js";
import { logger } from "../../config/logger.config.js";
import { query, queryOne } from "../helpers/database.helpers.js";
import { validateScoreTimeline } from "../helpers/timeline.helpers.js";
import { stripAudioTags } from "../utils/audioTags.utils.js";
import { applyEloToMatch } from "./elo/eloPersistence.services.js";
import { invalidateProfileCache } from "./playerProfile/playerProfile.services.js";
import { notifyMatchCreated } from "./pushSender.services.js";

/**
 * Creates a new game with players
 * @param {object} params
 * @param {string} params.mode - One of '1v1', '1v2', '2v1', '2v2', '2v3', '3v2', '3v3'
 * @param {number} params.score_home
 * @param {number} params.score_away
 * @param {object[]} params.players - Array of {id, team, team_name?}
 * @param {string} [params.played_at] - ISO date string
 * @param {string} params.created_by - User UUID
 * @param {object[]} [params.score_timeline] - Array of {home, away, period}
 * @param {string} [params.result_type] - 'regular', 'extra_time', or 'penalty'
 * @param {object} [params.penalty_shootout] - Shoot-by-shoot record. Required
 *   shape (validated via JSON schema before this fn runs):
 *   `{ score_before, final_score, winner_side, shots: [...] }`.
 *   Stored verbatim in the `penalty_shootout` JSONB column.
 * @returns {Promise<object>}
 */
export async function createGame({
	mode,
	score_home,
	score_away,
	players,
	played_at,
	created_by,
	score_timeline,
	result_type,
	penalty_shootout,
}) {
	// Defense in depth: reject timelines whose events are not strictly
	// chronological within their period before opening a DB transaction. The
	// frontend MinutePicker already clamps drags, but malformed payloads from
	// other clients would otherwise persist undetected.
	validateScoreTimeline(score_timeline);

	const client = await getPool().connect();

	try {
		await client.query("BEGIN");

		const {
			rows: [game],
		} = await client.query(
			`INSERT INTO games (mode, score_home, score_away, played_at, created_by, score_timeline, result_type, penalty_shootout)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING *`,
			[
				mode,
				score_home,
				score_away,
				played_at || new Date().toISOString(),
				created_by,
				score_timeline ? JSON.stringify(score_timeline) : null,
				result_type || "regular",
				penalty_shootout ? JSON.stringify(penalty_shootout) : null,
			],
		);

		const gamePlayers = [];
		for (const player of players) {
			await client.query(
				`INSERT INTO game_players (game_id, player_id, team, team_name)
				VALUES ($1, $2, $3, $4)`,
				[game.id, player.id, player.team, player.team_name || null],
			);
			gamePlayers.push({ player_id: player.id, team: player.team });
		}

		// ELO runs inside the same transaction: either match + ELO commit
		// together or both roll back. This guarantees no row gets bumped
		// in `profiles.current_rating` without a matching `elo_snapshot`
		// on the game row.
		await applyEloToMatch({ client, game, gamePlayers });

		// Invalidate cached player profiles for everyone who appeared in
		// this match — their match history just grew by one, so the
		// cached axes/archetype/bio need to be recomputed on the next
		// profile request. Runs in the same TX as ELO so cache state
		// can never diverge from match/ELO state.
		await invalidateProfileCache({
			client,
			playerIds: gamePlayers.map((gp) => gp.player_id),
		});

		await client.query("COMMIT");

		// Re-read the game so the returned object includes the
		// just-written `elo_snapshot` column.
		const {
			rows: [updatedGame],
		} = await getPool().query("SELECT * FROM games WHERE id = $1", [game.id]);

		// Fan out a "newMatch" push to every user who wasn't involved.
		// Fire-and-forget so a flaky push service can't slow down or
		// fail the API response — push errors are swallowed inside the
		// sender, but we still want the .catch() here as a safety net
		// in case the orchestrator itself throws.
		notifyMatchCreated({
			game: updatedGame ?? game,
			players: gamePlayers,
			resolveDisplayName: async (id) => {
				const row = await queryOne(
					"SELECT username FROM profiles WHERE id = $1",
					[id],
				);
				return row?.username ?? null;
			},
		}).catch((err) => {
			logger.warn({ err: err?.message }, "notifyMatchCreated failed");
		});

		return updatedGame ?? game;
	} catch (error) {
		await client.query("ROLLBACK");
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Deletes a game.
 * Related game_players are cascade-deleted by the DB.
 * @param {string} gameId - The game UUID
 * @returns {Promise<void>}
 */
export async function deleteGame(gameId) {
	const client = await getPool().connect();

	try {
		await client.query("BEGIN");

		const { rowCount } = await client.query("DELETE FROM games WHERE id = $1", [
			gameId,
		]);

		if (rowCount === 0) {
			const error = new Error("Game not found");
			error.statusCode = 404;
			throw error;
		}

		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Gets recent games with offset pagination.
 * When `mine` is true (default), restricts to games the user was involved in.
 * When `mine` is false, returns all games regardless of involvement.
 * @param {string} userId
 * @param {number} limit
 * @param {number} offset
 * @param {string} [from]
 * @param {string} [to]
 * @param {boolean} [mine=true]
 * @returns {Promise<object[]>}
 */
export async function getUserGames(
	userId,
	limit = 10,
	offset = 0,
	from,
	to,
	mine = true,
) {
	const conditions = [];
	const params = [];
	let idx = 1;

	if (mine) {
		conditions.push(
			`EXISTS (SELECT 1 FROM game_players gpu WHERE gpu.game_id = g.id AND gpu.player_id = $${idx++})`,
		);
		params.push(userId);
	}
	if (from) {
		conditions.push(`g.played_at >= $${idx++}`);
		params.push(from);
	}
	if (to) {
		conditions.push(`g.played_at <= $${idx++}`);
		params.push(to);
	}

	const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
	params.push(limit, offset);

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
		${where}
		GROUP BY g.id
		ORDER BY g.played_at DESC
		LIMIT $${idx++} OFFSET $${idx}`,
		params,
	);

	for (const g of games) {
		if (g.match_report) g.match_report = stripAudioTags(g.match_report);
	}

	return games;
}
