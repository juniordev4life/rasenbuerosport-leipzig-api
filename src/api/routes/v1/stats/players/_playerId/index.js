import { getPlayerStatsController } from "../../../../../controllers/stats.controllers.js";
import { requireAuth } from "../../../../../middlewares/auth.middlewares.js";

/**
 * `/api/v1/stats/players/:playerId` — career stats for any player.
 * Separated from `/v1/stats/:playerId` which is the H2H comparison
 * route. Auth-required.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/", {
		schema: getPlayerStatsController.schema,
		handler: getPlayerStatsController.handler,
	});
}
