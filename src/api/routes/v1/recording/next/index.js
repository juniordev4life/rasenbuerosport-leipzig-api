import { getNextRecordingCommandController } from "../../../../controllers/recording.controllers.js";
import { requireAgentSecret } from "../../../../middlewares/agentAuth.middlewares.js";

/**
 * GET /api/v1/recording/next — polled by the office recording agent.
 * Machine auth via X-Agent-Secret, not a Firebase user.
 */
export default async function (fastify) {
	fastify.get("/", {
		preHandler: requireAgentSecret,
		schema: getNextRecordingCommandController.schema,
		handler: getNextRecordingCommandController.handler,
	});
}
