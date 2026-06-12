import { recordingStatsController } from "../../../../controllers/recording.controllers.js";
import { requireAgentSecret } from "../../../../middlewares/agentAuth.middlewares.js";

/**
 * POST /api/v1/recording/stats — the capture pipeline submits the public
 * URLs of the stats screens it pulled from the recording (overview, passes,
 * defense). Reuses the existing Claude-Vision extraction + merge, exactly
 * like the manual screenshot upload. Machine auth via X-Agent-Secret.
 */
export default async function (fastify) {
	fastify.post("/", {
		preHandler: requireAgentSecret,
		schema: recordingStatsController.schema,
		handler: recordingStatsController.handler,
	});
}
