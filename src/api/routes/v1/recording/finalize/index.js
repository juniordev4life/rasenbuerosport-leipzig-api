import { finalizeGameController } from "../../../../controllers/recording.controllers.js";
import { requireAgentSecret } from "../../../../middlewares/agentAuth.middlewares.js";

/**
 * POST /api/v1/recording/finalize — the capture pipeline delivers the
 * timeline it extracted from the recording (events screen) for a PENDING
 * game: writes score + timeline, flips pending off, runs the deferred
 * scoring (ELO, caches, push). Machine auth via X-Agent-Secret.
 */
export default async function (fastify) {
	fastify.post("/", {
		preHandler: requireAgentSecret,
		schema: finalizeGameController.schema,
		handler: finalizeGameController.handler,
	});
}
