import { getSeasonTableController } from "../../../../../controllers/leagueSeason.controllers.js";
import { requireAuth } from "../../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	// GET /api/v1/seasons/:seasonId/table — league table (points)
	fastify.get("/", {
		schema: getSeasonTableController.schema,
		preHandler: [requireAuth],
		handler: getSeasonTableController.handler,
	});
}
