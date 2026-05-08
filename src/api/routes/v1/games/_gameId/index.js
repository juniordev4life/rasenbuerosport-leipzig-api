import {
	deleteGameController,
	getGameDetailController,
} from "../../../../controllers/gameDetail.controllers.js";
import {
	requireAdmin,
	requireAuth,
} from "../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/", {
		schema: getGameDetailController.schema,
		handler: getGameDetailController.handler,
	});

	fastify.delete("/", {
		schema: deleteGameController.schema,
		preHandler: [requireAdmin],
		handler: deleteGameController.handler,
	});
}
