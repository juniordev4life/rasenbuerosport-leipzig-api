import {
	previewTalkshowController,
	renderTalkshowAudioController,
} from "../../../controllers/talkshow.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
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
