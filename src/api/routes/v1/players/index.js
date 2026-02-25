import { getPlayersController } from "../../../controllers/players.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/", {
		schema: getPlayersController.schema,
		handler: getPlayersController.handler,
	});
}
