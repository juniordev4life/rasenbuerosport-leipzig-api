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
 * @param {string} gameId - UUID of the games row
 * @param {object} fields
 * @param {"recording"|"uploaded"|"ready"} fields.video_status - New status
 * @param {string} [fields.highlight_url] - Public URL of the highlight reel
 * @returns {Promise<object|null>} Updated row, or null when the game does not exist
 * @example
 * await updateGameVideo(gameId, { video_status: "ready", highlight_url: "https://..." });
 */
export async function updateGameVideo(gameId, { video_status, highlight_url }) {
	return queryOne(
		`UPDATE games
		SET video_status = $2, highlight_url = COALESCE($3, highlight_url)
		WHERE id = $1
		RETURNING id, recording_id, video_status, highlight_url`,
		[gameId, video_status, highlight_url ?? null],
	);
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
	return queryOne(
		`INSERT INTO recording_status (id, recording_id, status, updated_at)
		VALUES (1, $1, $2, now())
		ON CONFLICT (id) DO UPDATE SET recording_id = $1, status = $2, updated_at = now()
		RETURNING recording_id, status, updated_at`,
		[recordingId, status],
	);
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
