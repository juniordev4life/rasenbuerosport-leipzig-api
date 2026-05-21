import { generateAudioReportController } from "../../../../../../controllers/audioReport.controllers.js";
import { requireAuth } from "../../../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.post("/", {
		schema: generateAudioReportController.schema,
		handler: generateAudioReportController.handler,
	});
}
