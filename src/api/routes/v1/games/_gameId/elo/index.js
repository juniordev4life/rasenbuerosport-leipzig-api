import { getGameEloController } from "../../../../../controllers/elo.controllers.js";
import { requireAuth } from "../../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	// GET /api/v1/games/:gameId/elo
	fastify.get("/", {
		schema: getGameEloController.schema,
		handler: getGameEloController.handler,
	});
}
