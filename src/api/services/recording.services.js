import { logger } from "../../config/logger.config.js";
import { query, queryOne } from "../helpers/database.helpers.js";

/**
 * A leftover "start" older than this is reported as idle. Protects against
 * the agent booting hours after a match was played (box was off, API was
 * unreachable) and kicking off a pointless recording. "stop" commands are
 * not guarded — a stale stop is a no-op on the agent side anyway.
 */
const START_COMMAND_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * Overwrites the single recording command slot the office agent polls.
 *
 * @param {"start"|"stop"|"abort"} action - Command for the agent
 * @param {string} gameId - Provisional recording id on "start", real game id on "stop"
 * @returns {Promise<object>} The stored command row
 * @example
 * await setRecordingCommand("start", "0d9f...-uuid");
 */
export async function setRecordingCommand(action, gameId) {
	return queryOne(
		`INSERT INTO recording_command (id, action, game_id, updated_at)
		VALUES (1, $1, $2, now())
		ON CONFLICT (id) DO UPDATE SET action = $1, game_id = $2, updated_at = now()
		RETURNING action, game_id, updated_at`,
		[action, gameId],
	);
}

/**
 * Returns the current command for the polling agent, or idle when no
 * command exists or a "start" has gone stale (see START_COMMAND_MAX_AGE_MS).
 *
 * @returns {Promise<{action: string, game_id: string|null}>}
 * @example
 * const cmd = await getNextRecordingCommand(); // { action: "idle", game_id: null }
 */
export async function getNextRecordingCommand() {
	const row = await queryOne(
		"SELECT action, game_id, updated_at FROM recording_command WHERE id = 1",
	);
	if (!row) {
		return { action: "idle", game_id: null };
	}

	const ageMs = Date.now() - new Date(row.updated_at).getTime();
	if (row.action === "start" && ageMs > START_COMMAND_MAX_AGE_MS) {
		return { action: "idle", game_id: null };
	}

	return { action: row.action, game_id: row.game_id };
}

/**
 * Updates the video fields the agent / highlight pipeline reports for a
 * game. `highlight_url` is only overwritten when provided, so a plain
 * status update never clears an existing link.
 *
 * `result_type` / `penalty_shootout` are only written when provided (the
 * pipeline sends them once it detects a penalty shootout from the post-match
 * screen) — COALESCE keeps the existing value otherwise.
 *
 * @param {string} gameId - UUID of the games row
 * @param {object} fields
 * @param {"recording"|"uploaded"|"ready"} fields.video_status - New status
 * @param {string} [fields.highlight_url] - Public URL of the highlight reel
 * @param {"regular"|"extra_time"|"penalty"} [fields.result_type] - How the match was decided
 * @param {object} [fields.penalty_shootout] - Result-only shootout {score_before, final_score, winner_side, source}
 * @returns {Promise<object|null>} Updated row, or null when the game does not exist
 * @example
 * await updateGameVideo(gameId, { video_status: "ready", highlight_url: "https://..." });
 * await updateGameVideo(gameId, { video_status: "ready", result_type: "penalty", penalty_shootout: {...} });
 */
export async function updateGameVideo(
	gameId,
	{ video_status, highlight_url, result_type, penalty_shootout },
) {
	const game = await queryOne(
		`UPDATE games
		SET video_status = $2,
		    highlight_url = COALESCE($3, highlight_url),
		    result_type = COALESCE($4, result_type),
		    penalty_shootout = COALESCE($5, penalty_shootout)
		WHERE id = $1
		RETURNING id, recording_id, video_status, highlight_url, pending`,
		[
			gameId,
			video_status,
			highlight_url ?? null,
			result_type ?? null,
			penalty_shootout ? JSON.stringify(penalty_shootout) : null,
		],
	);

	// This PATCH is the analysis pipeline's LAST step. Once it lands "ready"
	// (or "failed" — the game is still finalized; the reporter narrates from
	// data, not the reel video), the result, scorers and stats are all in
	// place — so this is the moment to generate the reporter text: exactly
	// once, with final data. Fire-and-forget so the agent's PATCH returns
	// immediately; the app's auto-refresh picks the text up. Skipped while
	// pending (finalize has not run yet — nothing real to narrate; that early
	// state is also why generateMatchReport refuses pending games). Lazy import
	// avoids a service<->service import cycle.
	if (
		game &&
		!game.pending &&
		(video_status === "ready" || video_status === "failed")
	) {
		import("./matchReport.services.js")
			.then(({ generateMatchReport }) => generateMatchReport(gameId))
			.catch((err) =>
				logger.warn(
					{ err: err?.message, gameId },
					"post-analysis match report generation failed",
				),
			);
	}

	return game;
}

/**
 * Records what the office agent reports about the current capture, into the
 * single-row status slot the app polls. Mirror of setRecordingCommand: the
 * agent writes here, the app reads via getRecordingStatus.
 *
 * @param {string} recordingId - Provisional recording id the capture belongs to
 * @param {"recording"|"failed"|"stopped"|"aborted"} status - Reported state
 * @returns {Promise<object>} The stored status row
 * @example
 * await reportRecordingStatus("0d9f...-uuid", "recording");
 */
export async function reportRecordingStatus(recordingId, status) {
	const row = await queryOne(
		`INSERT INTO recording_status (id, recording_id, status, updated_at)
		VALUES (1, $1, $2, now())
		ON CONFLICT (id) DO UPDATE SET recording_id = $1, status = $2, updated_at = now()
		RETURNING recording_id, status, updated_at`,
		[recordingId, status],
	);

	// A dead capture must also reach the games row, not just the status slot
	// the app polls during the live step. Without this, video_status stays NULL
	// and the game detail page blocks the match report forever (it reads
	// "recording_id set + no terminal status" as "pipeline still running").
	// Only fills an empty status, so a finished pipeline is never overwritten.
	if (isCaptureFailure(status)) {
		const updated = await query(
			`UPDATE games SET video_status = 'failed'
			WHERE recording_id = $1 AND video_status IS NULL
			RETURNING id`,
			[recordingId],
		);
		if (updated.length > 0) {
			logger.info(
				{ recordingId, status, gameIds: updated.map((g) => g.id) },
				"capture failure carried over to game video_status",
			);
		}
	}
	return row;
}

/**
 * Whether an agent-reported capture status means the recording is unusable.
 *
 * @param {string} status - Status reported by the office agent
 * @returns {boolean} True for a failed or aborted capture
 * @example
 * isCaptureFailure("failed");   // true
 * isCaptureFailure("recording"); // false
 */
export function isCaptureFailure(status) {
	return status === "failed" || status === "aborted";
}

/**
 * Whether the capture for this recording id has already been reported as
 * failed. Needed because the agent reports an instantly dying ffmpeg (full
 * disk, blocked capture device) BEFORE the game row exists — at that moment
 * there is nothing to update, so the game has to adopt the failure when it is
 * created. The slot holds only the most recent recording, which is exactly the
 * one a game being created now belongs to.
 *
 * @param {string} recordingId - Provisional recording id of the capture
 * @returns {Promise<boolean>} True when that capture reported failed/aborted
 * @example
 * await hasFailedCapture("0d9f...-uuid"); // true -> create the game as failed
 */
export async function hasFailedCapture(recordingId) {
	if (!recordingId) return false;
	const row = await queryOne(
		"SELECT status FROM recording_status WHERE id = 1 AND recording_id = $1",
		[recordingId],
	);
	return isCaptureFailure(row?.status);
}

/**
 * Returns the agent-reported status for a given recording id. When the slot
 * holds no entry, or one for a different (older) recording, status is null —
 * the app treats that as "still pending" and relies on its own timeout to
 * detect an offline agent.
 *
 * @param {string} recordingId - The app's provisional recording id
 * @returns {Promise<{recording_id: string, status: string|null}>}
 * @example
 * const s = await getRecordingStatus("0d9f...-uuid"); // { recording_id, status: "recording" }
 */
export async function getRecordingStatus(recordingId) {
	const row = await queryOne(
		"SELECT recording_id, status FROM recording_status WHERE id = 1",
	);
	if (!row || row.recording_id !== recordingId) {
		return { recording_id: recordingId, status: null };
	}
	return { recording_id: row.recording_id, status: row.status };
}

/**
 * Returns a game's tap timeline for the highlight pipeline's anchor mode:
 * the office agent fetches it to know WHICH goals fell (side + minute +
 * scorer); the kickoff boards in the video then provide WHERE they are.
 *
 * @param {string} gameId - UUID of the games row
 * @returns {Promise<{game_id: string, result_type: string|null, score_timeline: object[]}|null>}
 *   Timeline payload, or null when the game does not exist
 * @example
 * const t = await getRecordingTimeline(gameId); // { game_id, result_type, score_timeline: [...] }
 */
export async function getRecordingTimeline(gameId) {
	const row = await queryOne(
		"SELECT id, result_type, pending, score_timeline FROM games WHERE id = $1",
		[gameId],
	);
	if (!row) {
		return null;
	}
	// Lineup with usernames: lets the pipeline attribute goals to office
	// players when the events screen only yields the side — with exactly one
	// player per side (1v1), side == scorer.
	const players = await query(
		`SELECT gp.player_id, gp.team, p.username
		   FROM game_players gp
		   LEFT JOIN profiles p ON p.id = gp.player_id
		  WHERE gp.game_id = $1`,
		[gameId],
	);
	return {
		game_id: row.id,
		result_type: row.result_type ?? null,
		pending: Boolean(row.pending),
		score_timeline: row.score_timeline ?? [],
		players,
	};
}
