import { getLeaderboardController } from "../../../controllers/leaderboard.controllers.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.get("/", {
		schema: getLeaderboardController.schema,
		handler: getLeaderboardController.handler,
	});
}
