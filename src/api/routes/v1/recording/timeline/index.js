import { getRecordingTimelineController } from "../../../../controllers/recording.controllers.js";
import { requireAgentSecret } from "../../../../middlewares/agentAuth.middlewares.js";

/**
 * GET /api/v1/recording/timeline?game_id=... — the office agent fetches a
 * game's tap timeline for the highlight pipeline's anchor mode (goal list =
 * WHAT fell; the kickoff boards in the video = WHERE). Machine auth via
 * X-Agent-Secret.
 */
export default async function (fastify) {
	fastify.get("/", {
		preHandler: requireAgentSecret,
		schema: getRecordingTimelineController.schema,
		handler: getRecordingTimelineController.handler,
	});
}
