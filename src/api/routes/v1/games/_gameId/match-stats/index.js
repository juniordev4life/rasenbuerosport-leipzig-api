import {
	deleteMatchStatsController,
	uploadMatchStatsController,
} from "../../../../../controllers/matchStats.controllers.js";
import {
	requireAdmin,
	requireAuth,
} from "../../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.post("/", {
		schema: uploadMatchStatsController.schema,
		handler: uploadMatchStatsController.handler,
	});

	// Admin-only: the reported red cards are a League-ELO v2 input, so wiping
	// the stats re-rates the game.
	fastify.delete("/", {
		schema: deleteMatchStatsController.schema,
		preHandler: [requireAdmin],
		handler: deleteMatchStatsController.handler,
	});
}
