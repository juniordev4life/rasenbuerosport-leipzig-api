import { getPool } from "../../config/database.config.js";
import { logger } from "../../config/logger.config.js";
import { query, queryOne } from "../helpers/database.helpers.js";
import { validateScoreTimeline } from "../helpers/timeline.helpers.js";
import { stripAudioTags } from "../utils/audioTags.utils.js";
import { applyEloToMatch } from "./elo/eloPersistence.services.js";
import { applyPenaltyShotEloDeltas } from "./elo/penaltyShotElo.services.js";
import { invalidateProfileCache } from "./playerProfile/playerProfile.services.js";
import { notifyMatchCreated } from "./pushSender.services.js";
import { hasFailedCapture } from "./recording.services.js";

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
 * @param {string} [params.recording_id] - Provisional capture id from the
 *   office recording agent flow; links the recorded video to this game.
 * @param {boolean} [params.pending] - Zero-tracking flow: game is saved with
 *   0:0 and an empty timeline; the capture pipeline backfills score +
 *   timeline via finalizeGame. Skips ELO, profile-cache invalidation and the
 *   match push — those run at finalize time, once the real result exists.
 * @param {string} [params.home_team_name] - In-game team picked in the poster
 *   step. Fallback carrier for sides without players (CPU opponents) —
 *   game_players.team_name stays the primary source for sides with players.
 * @param {string} [params.away_team_name] - See home_team_name.
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
	recording_id,
	pending,
	home_team_name,
	away_team_name,
}) {
	// Defense in depth: reject timelines whose events are not strictly
	// chronological within their period before opening a DB transaction. The
	// frontend MinutePicker already clamps drags, but malformed payloads from
	// other clients would otherwise persist undetected.
	validateScoreTimeline(score_timeline);

	// A capture that died instantly (full disk, capture device blocked) reported
	// "failed" on the provisional recording channel BEFORE this row existed, so
	// there was nothing to mark at the time. Adopt it now: leaving video_status
	// NULL makes the game detail page block the match report indefinitely,
	// because it reads "recording_id set + no terminal status" as "pipeline
	// still running" — an eternal "preparing" spinner.
	const captureAlreadyFailed = await hasFailedCapture(recording_id);
	if (captureAlreadyFailed) {
		logger.info(
			{ recording_id },
			"capture already reported failed — creating game with video_status=failed",
		);
	}

	const client = await getPool().connect();

	try {
		await client.query("BEGIN");

		const {
			rows: [game],
		} = await client.query(
			`INSERT INTO games (mode, score_home, score_away, played_at, created_by, score_timeline, result_type, penalty_shootout, recording_id, pending, home_team_name, away_team_name, video_status)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
				recording_id || null,
				Boolean(pending),
				home_team_name || null,
				away_team_name || null,
				captureAlreadyFailed ? "failed" : null,
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

		// Zero-tracking: the result does not exist yet. Persist game + players
		// only; ELO, profile caches and the match push run in finalizeGame once
		// the capture pipeline delivers the real timeline.
		if (pending) {
			await client.query("COMMIT");
			return game;
		}

		// ELO runs inside the same transaction: either match + ELO commit
		// together or both roll back. This guarantees no row gets bumped
		// in `profiles.current_rating` without a matching `elo_snapshot`
		// on the game row.
		await applyEloToMatch({ client, game, gamePlayers });

		// Penalty-shootout overlay: applied AFTER the team-level engine
		// so a missed penalty at 2:2 doesn't get lost in the zero-sum.
		// Patches the last history entry instead of pushing a new one,
		// keeping the rule "one match → one rating point".
		if (penalty_shootout?.shots?.length) {
			await applyPenaltyShotEloDeltas({
				client,
				shots: penalty_shootout.shots,
				playedAt: game.played_at,
			});
		}

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
 * Finalizes a PENDING game with the timeline the capture pipeline extracted
 * from the recording (zero-tracking flow). Writes score + timeline, flips
 * `pending` off, and runs the scoring tail that createGame skipped: ELO and
 * profile-cache invalidation inside the same transaction, match push after
 * commit. Refuses non-pending games so a double finalize can never apply
 * ELO twice.
 *
 * @param {string} gameId - The game UUID
 * @param {object[]} scoreTimeline - Goal entries in app format; the last
 *   entry's running score becomes the final score
 * @returns {Promise<object|null>} The finalized game, or null when the game
 *   does not exist
 * @example
 * await finalizeGame(gameId, [{ home: 1, away: 0, team: "home", minute: 12, ... }]);
 */
export async function finalizeGame(gameId, scoreTimeline, decision = {}) {
	if (!Array.isArray(scoreTimeline) || scoreTimeline.length === 0) {
		const err = new Error("score_timeline must contain at least one goal");
		err.statusCode = 400;
		throw err;
	}
	validateScoreTimeline(scoreTimeline);

	const last = scoreTimeline[scoreTimeline.length - 1];
	const scoreHome = last.home;
	const scoreAway = last.away;

	const client = await getPool().connect();
	try {
		await client.query("BEGIN");

		const {
			rows: [existing],
		} = await client.query("SELECT * FROM games WHERE id = $1 FOR UPDATE", [
			gameId,
		]);
		if (!existing) {
			await client.query("ROLLBACK");
			return null;
		}
		if (!existing.pending) {
			await client.query("ROLLBACK");
			const err = new Error("Game is not pending — already finalized");
			err.statusCode = 409;
			throw err;
		}

		// How the match was decided is written in the SAME statement, so the row
		// handed to applyEloToMatch below already carries it. A shootout is rated
		// as a win, not a draw — arriving later (on the video-status PATCH) it
		// would miss ELO entirely and the win would score zero. COALESCE keeps a
		// value the game already had when the caller reports nothing.
		const {
			rows: [game],
		} = await client.query(
			`UPDATE games
			    SET score_home = $1, score_away = $2, score_timeline = $3,
			        pending = false,
			        result_type = COALESCE($5, result_type),
			        penalty_shootout = COALESCE($6::jsonb, penalty_shootout)
			  WHERE id = $4
			RETURNING *`,
			[
				scoreHome,
				scoreAway,
				JSON.stringify(scoreTimeline),
				gameId,
				decision.result_type ?? null,
				decision.penalty_shootout
					? JSON.stringify(decision.penalty_shootout)
					: null,
			],
		);

		const { rows: gamePlayers } = await client.query(
			"SELECT player_id, team FROM game_players WHERE game_id = $1",
			[gameId],
		);

		await applyEloToMatch({ client, game, gamePlayers });
		await invalidateProfileCache({
			client,
			playerIds: gamePlayers.map((gp) => gp.player_id),
		});

		await client.query("COMMIT");

		const {
			rows: [updatedGame],
		} = await getPool().query("SELECT * FROM games WHERE id = $1", [gameId]);

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
		if (!error.statusCode) {
			await client.query("ROLLBACK").catch(() => {});
			const err = new Error(error.message);
			err.statusCode = 400;
			throw err;
		}
		throw error;
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
