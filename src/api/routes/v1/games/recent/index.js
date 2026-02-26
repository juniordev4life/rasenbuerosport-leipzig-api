import { getRecentGamesController } from "../../../../controllers/activityFeed.controllers.js";
import { requireAuth } from "../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/", {
		schema: getRecentGamesController.schema,
		handler: getRecentGamesController.handler,
	});
}
