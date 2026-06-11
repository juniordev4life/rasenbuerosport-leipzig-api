import {
	deleteGameController,
	getGameDetailController,
} from "../../../../controllers/gameDetail.controllers.js";
import { updateGameVideoController } from "../../../../controllers/recording.controllers.js";
import { requireAgentSecret } from "../../../../middlewares/agentAuth.middlewares.js";
import {
	requireAdmin,
	requireAuth,
} from "../../../../middlewares/auth.middlewares.js";

/**
 * Auth is attached per route here (no plugin-wide hook): GET and DELETE
 * are Firebase-user routes, while PATCH is the office recording agent
 * reporting video status — machine auth via X-Agent-Secret.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function (fastify) {
	fastify.get("/", {
		schema: getGameDetailController.schema,
		preHandler: [requireAuth],
		handler: getGameDetailController.handler,
	});

	fastify.delete("/", {
		schema: deleteGameController.schema,
		preHandler: [requireAuth, requireAdmin],
		handler: deleteGameController.handler,
	});

	fastify.patch("/", {
		schema: updateGameVideoController.schema,
		preHandler: [requireAgentSecret],
		handler: updateGameVideoController.handler,
	});
}
