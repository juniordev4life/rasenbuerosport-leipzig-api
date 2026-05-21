import { query, queryOne } from "../helpers/database.helpers.js";
import { stripAudioTags } from "../utils/audioTags.utils.js";

/**
 * Fetches a single game by ID with all players and profiles. The
 * `match_report` column stores the reporter-style text with inline
 * ElevenLabs audio tags — the tags are stripped here so consumers
 * receive clean prose. The raw value remains in the DB for the TTS
 * pipeline (see `audioReport.services.js`).
 *
 * @param {string} gameId - Game UUID
 * @returns {Promise<object|null>}
 */
export async function getGameById(gameId) {
	const game = await queryOne("SELECT * FROM games WHERE id = $1", [gameId]);

	if (!game) return null;

	if (game.match_report) {
		game.match_report = stripAudioTags(game.match_report);
	}

	const players = await query(
		`SELECT gp.player_id, gp.team, gp.team_name,
			json_build_object('username', p.username, 'avatar_url', p.avatar_url) AS profiles
		FROM game_players gp
		LEFT JOIN profiles p ON p.id = gp.player_id
		WHERE gp.game_id = $1`,
		[gameId],
	);

	game.game_players = players;
	return game;
}
