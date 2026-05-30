import {
	generateEpisodeController,
	getLatestTalkshowController,
	previewTalkshowController,
	renderTalkshowAudioController,
} from "../../../controllers/talkshow.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";
import { requireSchedulerSecret } from "../../../middlewares/schedulerAuth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	// Scheduler-driven: Cloud Scheduler hits this once per week with
	// the WRAPPED_TRIGGER_SECRET header (same shared secret the wrapped
	// pipeline uses — one fewer secret to rotate). Generates the
	// drehbuch via Claude AND renders the multi-speaker mp3 via
	// ElevenLabs in one round-trip.
	fastify.post("/generate", {
		preHandler: requireSchedulerSecret,
		schema: generateEpisodeController.schema,
		handler: generateEpisodeController.handler,
	});

	fastify.get("/latest", {
		preHandler: requireAuth,
		schema: getLatestTalkshowController.schema,
		handler: getLatestTalkshowController.handler,
	});

	fastify.post("/_preview", {
		preHandler: requireAuth,
		schema: previewTalkshowController.schema,
		handler: previewTalkshowController.handler,
	});

	fastify.post("/audio", {
		preHandler: requireAuth,
		schema: renderTalkshowAudioController.schema,
		handler: renderTalkshowAudioController.handler,
	});
}
