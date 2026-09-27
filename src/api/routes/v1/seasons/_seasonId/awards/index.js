import { getSeasonAwardsController } from "../../../../../controllers/leagueSeason.controllers.js";
import { requireAuth } from "../../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	// GET /api/v1/seasons/:seasonId/awards
	fastify.get("/", {
		schema: getSeasonAwardsController.schema,
		preHandler: [requireAuth],
		handler: getSeasonAwardsController.handler,
	});
}
