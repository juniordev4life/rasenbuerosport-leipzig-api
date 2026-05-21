/**
 * Multi-speaker TTS renderer for the Friday talk show. Walks the
 * persisted turn list (produced by `generateShowScript`), runs each
 * turn through ElevenLabs with the speaker's persona voice + tuning,
 * concatenates the resulting mp3 buffers and uploads the final
 * episode mp3 to Firebase Storage.
 *
 * Naive `Buffer.concat()` works for mp3 streams because each ElevenLabs
 * response is a self-contained mp3 frame sequence — sequential frames
 * append cleanly without a remux step. Same approach as the per-match
 * audio pipeline.
 */

import { getStorageBucket } from "../../config/firebase.config.js";
import { applyPronunciation } from "../../constants/playerPronunciation.constants.js";
import { getReporter } from "../../constants/reporters.constants.js";
import { queryOne } from "../helpers/database.helpers.js";
import { stripAudioTags } from "../utils/audioTags.utils.js";
import { prepareTextForSpeech } from "../utils/germanOrdinals.utils.js";
import { synthesizeAudio } from "./elevenLabs.services.js";

const STORAGE_PREFIX = "talkshow";

/**
 * Whether to forward `[mood]` audio direction tags to ElevenLabs.
 * Mirrors the match-audio pipeline — only `eleven_v3` interprets the
 * tags; every other model reads them aloud as plain text. Default
 * `false` so episodes sound clean on a typical Starter-plan account.
 *
 * @returns {boolean}
 */
function shouldKeepAudioTags() {
	const raw = process.env.ELEVENLABS_KEEP_AUDIO_TAGS;
	return raw === "true" || raw === "1";
}

/**
 * Resolve ElevenLabs voice id and persona-specific voice settings for
 * a given speaker reporter id. Falls back to the shared
 * `ELEVENLABS_VOICE_ID` when no per-persona env var is set, so the
 * pipeline still works during early setup with a single voice.
 *
 * @param {string} reporterId - "klassiker" | "analyst" | "euphoriker"
 * @returns {{ voiceId: string|undefined, voiceSettings: object }}
 */
function resolveVoiceConfig(reporterId) {
	const reporter = getReporter(reporterId);
	const voiceId =
		process.env[reporter.voiceEnvKey] || process.env.ELEVENLABS_VOICE_ID;
	return { voiceId, voiceSettings: reporter.voiceSettings };
}

/**
 * Render the episode audio for a given week. Reads the script from
 * `talkshow_episodes`, TTS-s each turn, concatenates the mp3 chunks,
 * uploads to Firebase Storage and persists the public URL back on the
 * row.
 *
 * Idempotent on success: a second call returns the cached
 * `audio_url` without hitting ElevenLabs again. Re-renders only
 * happen after a re-generation that explicitly clears `audio_url`
 * (which `persistEpisode` does on every script upsert).
 *
 * @param {string} weekStart - ISO date (Monday of the target week).
 * @returns {Promise<string>} Public URL of the rendered episode mp3.
 *
 * @example
 *   const url = await renderEpisodeAudio("2026-05-18");
 *   // → "https://storage.googleapis.com/<bucket>/talkshow/2026-05-18.mp3"
 */
export async function renderEpisodeAudio(weekStart) {
	const row = await queryOne(
		`SELECT week_start, audio_url, script_json
		 FROM talkshow_episodes WHERE week_start = $1`,
		[weekStart],
	);
	if (!row) {
		const err = new Error(`No talkshow episode found for week ${weekStart}`);
		err.statusCode = 404;
		throw err;
	}
	if (row.audio_url) return row.audio_url;

	const turns = row.script_json?.turns ?? [];
	if (turns.length === 0) {
		const err = new Error("Talkshow script has no turns to render");
		err.statusCode = 409;
		throw err;
	}

	const keepTags = shouldKeepAudioTags();
	const buffers = [];
	for (const turn of turns) {
		const prepared = keepTags ? turn.text : stripAudioTags(turn.text);
		const pronounced = applyPronunciation(prepareTextForSpeech(prepared));
		if (!pronounced) continue;
		const { voiceId, voiceSettings } = resolveVoiceConfig(turn.reporter_id);
		const mp3 = await synthesizeAudio(pronounced, { voiceId, voiceSettings });
		buffers.push(mp3);
	}

	if (buffers.length === 0) {
		const err = new Error(
			"No audio was rendered — all turns were empty after preprocessing",
		);
		err.statusCode = 422;
		throw err;
	}

	const final = Buffer.concat(buffers);

	const bucket = getStorageBucket();
	const objectPath = `${STORAGE_PREFIX}/${weekStart}.mp3`;
	const file = bucket.file(objectPath);
	await file.save(final, {
		contentType: "audio/mpeg",
		resumable: false,
		metadata: {
			cacheControl: "public, max-age=31536000, immutable",
		},
	});
	await file.makePublic();

	const publicUrl = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;

	await queryOne(
		`UPDATE talkshow_episodes SET audio_url = $1 WHERE week_start = $2 RETURNING week_start`,
		[publicUrl, weekStart],
	);

	return publicUrl;
}
