import {
	createGameController,
	getGamesController,
} from "../../../controllers/games.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/", {
		schema: getGamesController.schema,
		handler: getGamesController.handler,
	});

	fastify.post("/", {
		schema: createGameController.schema,
		handler: createGameController.handler,
	});
}
