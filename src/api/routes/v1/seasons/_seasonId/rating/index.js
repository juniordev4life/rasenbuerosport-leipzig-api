import { getSeasonRatingController } from "../../../../../controllers/leagueSeason.controllers.js";
import { requireAuth } from "../../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	// GET /api/v1/seasons/:seasonId/rating — League-ELO v2 players + duos
	fastify.get("/", {
		schema: getSeasonRatingController.schema,
		preHandler: [requireAuth],
		handler: getSeasonRatingController.handler,
	});
}
