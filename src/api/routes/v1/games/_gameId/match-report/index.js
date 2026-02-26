import { generateReportController } from "../../../../../controllers/matchReport.controllers.js";
import { requireAuth } from "../../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.post("/", {
		schema: generateReportController.schema,
		handler: generateReportController.handler,
	});
}
