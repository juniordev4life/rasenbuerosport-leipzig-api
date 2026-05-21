/**
 * Thin wrapper around ElevenLabs' text-to-speech HTTP API. Used by the
 * audio match-report pipeline. Returns the raw mp3 bytes as a Buffer —
 * upload + persistence happen in `audioReport.services.js`.
 *
 * The model defaults to `eleven_v3` because the reporter prompt emits
 * inline audio direction tags (e.g. `[nachdenklich]`, `[seufzen]`) that
 * only v3 interprets natively. Voice ID and tuning values are wired
 * through environment variables so the production voice can be
 * swapped without a code change.
 */

const DEFAULT_MODEL = "eleven_v3";
const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

/**
 * Parse a numeric env var with a fallback. Returns `fallback` for
 * missing, empty, or non-finite values.
 *
 * @param {string|undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function num(raw, fallback) {
	if (raw == null || raw === "") return fallback;
	const v = Number(raw);
	return Number.isFinite(v) ? v : fallback;
}

/**
 * Synthesize an mp3 from reporter-style text via ElevenLabs.
 *
 * @param {string} text - Reporter text including audio direction tags.
 * @param {object} [options]
 * @param {string} [options.voiceId] - Override `ELEVENLABS_VOICE_ID`.
 * @param {string} [options.modelId] - Override the default model.
 * @param {{ stability?: number, similarity_boost?: number, style?: number }} [options.voiceSettings]
 *   Per-reporter voice tuning. Falls back to the env-var defaults.
 * @returns {Promise<Buffer>} mp3 audio bytes.
 *
 * @example
 *   const mp3 = await synthesizeAudio("[nachdenklich] Zwei zu vier…", {
 *     voiceId: "abc123",
 *     voiceSettings: { stability: 0.4, similarity_boost: 0.8, style: 0.7 },
 *   });
 */
export async function synthesizeAudio(text, options = {}) {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		const err = new Error("ELEVENLABS_API_KEY is not configured");
		err.statusCode = 500;
		throw err;
	}

	const voiceId = options.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
	if (!voiceId) {
		const err = new Error("ELEVENLABS_VOICE_ID is not configured");
		err.statusCode = 500;
		throw err;
	}

	const modelId =
		options.modelId ?? process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL;

	const overrides = options.voiceSettings ?? {};
	const voiceSettings = {
		stability:
			overrides.stability ?? num(process.env.ELEVENLABS_STABILITY, 0.5),
		similarity_boost:
			overrides.similarity_boost ?? num(process.env.ELEVENLABS_SIMILARITY, 0.8),
		style: overrides.style ?? num(process.env.ELEVENLABS_STYLE, 0.5),
		use_speaker_boost: true,
	};

	const response = await fetch(`${ENDPOINT}/${voiceId}`, {
		method: "POST",
		headers: {
			"xi-api-key": apiKey,
			"Content-Type": "application/json",
			Accept: "audio/mpeg",
		},
		body: JSON.stringify({
			text,
			model_id: modelId,
			voice_settings: voiceSettings,
		}),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		const err = new Error(
			`ElevenLabs TTS failed (${response.status}): ${body.slice(0, 200)}`,
		);
		err.statusCode = response.status >= 500 ? 503 : 502;
		throw err;
	}

	const arrayBuffer = await response.arrayBuffer();
	return Buffer.from(arrayBuffer);
}
