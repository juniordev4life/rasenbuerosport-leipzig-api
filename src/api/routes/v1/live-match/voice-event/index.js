import { parseLiveMatchVoiceEventController } from "../../../../controllers/liveMatchVoice.controllers.js";
import { requireAuth } from "../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.post("/", {
		schema: parseLiveMatchVoiceEventController.schema,
		handler: parseLiveMatchVoiceEventController.handler,
	});
}
