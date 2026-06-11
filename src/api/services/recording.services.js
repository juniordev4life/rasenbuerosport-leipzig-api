import { queryOne } from "../helpers/database.helpers.js";

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
 * @param {"start"|"stop"} action - Command for the agent
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
