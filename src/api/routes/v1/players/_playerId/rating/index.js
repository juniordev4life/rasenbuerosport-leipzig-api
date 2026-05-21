import { getPlayerRatingController } from "../../../../../controllers/elo.controllers.js";
import { requireAuth } from "../../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/", {
		schema: getPlayerRatingController.schema,
		handler: getPlayerRatingController.handler,
	});
}
