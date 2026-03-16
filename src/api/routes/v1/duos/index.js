import { getDuoLeaderboardController } from "../../../controllers/duos.controllers.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.get("/", {
		schema: getDuoLeaderboardController.schema,
		handler: getDuoLeaderboardController.handler,
	});
}
