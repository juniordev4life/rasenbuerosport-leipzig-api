import {
	uploadMatchStatsController,
	deleteMatchStatsController,
} from "../../../../../controllers/matchStats.controllers.js";
import { requireAuth } from "../../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.post("/", {
		schema: uploadMatchStatsController.schema,
		handler: uploadMatchStatsController.handler,
	});

	fastify.delete("/", {
		schema: deleteMatchStatsController.schema,
		handler: deleteMatchStatsController.handler,
	});
}
