import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	buildShowContext,
	generateAndPersistEpisode,
	generateShowScript,
	getLatestEpisode,
} from "../services/talkshow.services.js";
import { renderEpisodeAudio } from "../services/talkshowAudio.services.js";

/**
 * Debug-only endpoint that triggers a fresh talk-show script
 * generation for the current week (or the week containing the
 * optional `reference` date) and returns both the parsed turn list
 * and the raw script. Useful for quality-checking the drehbuch
 * before wiring TTS — runs the expensive Claude call, but does not
 * yet render audio.
 *
 * Persists the episode row by default so subsequent reads see the
 * latest preview. Pass `persist: false` in the body to skip the DB
 * write (useful when iterating on the prompt).
 */
export const previewTalkshowController = {
	schema: {
		body: {
			type: "object",
			additionalProperties: false,
			properties: {
				reference: { type: "string", format: "date" },
				persist: { type: "boolean", default: true },
			},
		},
	},
	handler: async (request, reply) => {
		try {
			const { reference, persist = true } = request.body ?? {};
			const refDate = reference ? new Date(reference) : new Date();

			if (persist) {
				const row = await generateAndPersistEpisode(refDate);
				return setGeneralResponse(
					reply,
					200,
					"Success",
					"Talkshow episode generated and persisted",
					{
						week_start: row.week_start,
						week_end: row.week_end,
						generated_at: row.generated_at,
						script: row.script_json,
					},
				);
			}

			const context = await buildShowContext(refDate);
			const result = await generateShowScript(context);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Talkshow script generated (not persisted)",
				{
					week_start: context.week_start,
					week_end: context.week_end,
					script: {
						raw_script: result.raw_script,
						turns: result.turns,
						summary: result.summary,
						context_used: context,
					},
				},
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

/**
 * Render (or return the cached) audio for a persisted talk-show
 * episode. Body accepts `week_start` (ISO date, Monday of the target
 * week); if omitted, the most recent episode is used.
 *
 * Triggers the multi-speaker ElevenLabs pipeline + Firebase Storage
 * upload. Subsequent calls return the cached `audio_url` without
 * re-spending TTS credits.
 */
export const renderTalkshowAudioController = {
	schema: {
		body: {
			type: "object",
			additionalProperties: false,
			properties: {
				week_start: { type: "string", format: "date" },
			},
		},
	},
	handler: async (request, reply) => {
		try {
			let weekStart = request.body?.week_start;
			if (!weekStart) {
				const latest = await getLatestEpisode();
				if (!latest) {
					const err = new Error(
						"Es existiert noch keine Talkshow-Episode. Erst per /_preview generieren.",
					);
					err.statusCode = 409;
					throw err;
				}
				weekStart =
					typeof latest.week_start === "string"
						? latest.week_start
						: latest.week_start.toISOString().slice(0, 10);
			}

			const audioUrl = await renderEpisodeAudio(weekStart);

			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Talkshow audio rendered",
				{ week_start: weekStart, audio_url: audioUrl },
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
