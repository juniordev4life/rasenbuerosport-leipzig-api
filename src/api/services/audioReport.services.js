/**
 * Audio match-report pipeline. Takes the raw reporter text from
 * `games.match_report` (still containing ElevenLabs audio direction
 * tags), runs it through the pronunciation map, calls ElevenLabs, and
 * uploads the resulting mp3 to Firebase Storage. The public URL plus
 * a timestamp are persisted on the game row so subsequent requests
 * are served from the cache without another TTS roundtrip.
 */

import { getStorageBucket } from "../../config/firebase.config.js";
import { applyPronunciation } from "../../constants/playerPronunciation.constants.js";
import { getReporter } from "../../constants/reporters.constants.js";
import { queryOne } from "../helpers/database.helpers.js";
import { stripAudioTags } from "../utils/audioTags.utils.js";
import { prepareTextForSpeech } from "../utils/germanOrdinals.utils.js";
import { synthesizeAudio } from "./elevenLabs.services.js";

const STORAGE_PREFIX = "match-reports";

/**
 * Whether to forward the `[mood]` audio direction tags to ElevenLabs.
 * Only the `eleven_v3` alpha model interprets them; every other model
 * (`multilingual_v2`, `turbo_v2_5`, `flash_v2_5`) reads them out loud
 * as plain text. Default `false` so a typical Starter-plan account
 * gets clean audio out of the box. Flip to `true` once v3 access is
 * confirmed for the workspace.
 *
 * @returns {boolean}
 */
function shouldKeepAudioTags() {
	const raw = process.env.ELEVENLABS_KEEP_AUDIO_TAGS;
	return raw === "true" || raw === "1";
}

/**
 * Look up the ElevenLabs voice id for a reporter, falling back to the
 * shared `ELEVENLABS_VOICE_ID` when no persona-specific voice is
 * configured. Lets deployments start with a single voice and add
 * persona voices later without code changes.
 *
 * @param {string|null} reporterId
 * @returns {{ voiceId: string|undefined, voiceSettings: object|undefined }}
 */
function resolveVoiceConfig(reporterId) {
	if (!reporterId) {
		return { voiceId: undefined, voiceSettings: undefined };
	}
	const reporter = getReporter(reporterId);
	const voiceId =
		process.env[reporter.voiceEnvKey] || process.env.ELEVENLABS_VOICE_ID;
	return { voiceId, voiceSettings: reporter.voiceSettings };
}

/**
 * Generate (or return the cached) audio match report for a game.
 * Returns the public URL of the rendered mp3.
 *
 * @param {string} gameId - Game UUID.
 * @returns {Promise<string>} Public URL of the mp3 file.
 *
 * @example
 *   const url = await generateAudioReport("…uuid…");
 *   // → "https://storage.googleapis.com/<bucket>/match-reports/<uuid>.mp3"
 */
export async function generateAudioReport(gameId) {
	const game = await queryOne(
		"SELECT id, match_report, match_report_audio_url, reporter_id FROM games WHERE id = $1",
		[gameId],
	);

	if (!game) {
		const err = new Error("Game not found");
		err.statusCode = 404;
		throw err;
	}

	if (game.match_report_audio_url) {
		return game.match_report_audio_url;
	}

	if (!game.match_report) {
		const err = new Error(
			"Spielbericht muss zuerst generiert werden, bevor das Audio erstellt werden kann.",
		);
		err.statusCode = 409;
		throw err;
	}

	const preparedText = shouldKeepAudioTags()
		? game.match_report
		: stripAudioTags(game.match_report);
	const ttsInput = applyPronunciation(prepareTextForSpeech(preparedText));
	const { voiceId, voiceSettings } = resolveVoiceConfig(game.reporter_id);
	const mp3 = await synthesizeAudio(ttsInput, { voiceId, voiceSettings });

	const bucket = getStorageBucket();
	const objectPath = `${STORAGE_PREFIX}/${gameId}.mp3`;
	const file = bucket.file(objectPath);
	await file.save(mp3, {
		contentType: "audio/mpeg",
		resumable: false,
		metadata: {
			cacheControl: "public, max-age=31536000, immutable",
		},
	});
	await file.makePublic();

	const publicUrl = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;

	await queryOne(
		`UPDATE games
		    SET match_report_audio_url = $1,
		        match_report_audio_generated_at = now()
		  WHERE id = $2
		RETURNING id`,
		[publicUrl, gameId],
	);

	return publicUrl;
}
