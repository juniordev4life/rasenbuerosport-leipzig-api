import { getMyStatsController } from "../../../controllers/stats.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/me", {
		schema: getMyStatsController.schema,
		handler: getMyStatsController.handler,
	});
}
