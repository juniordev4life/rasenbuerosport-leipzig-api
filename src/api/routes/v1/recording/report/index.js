import { reportRecordingStatusController } from "../../../../controllers/recording.controllers.js";
import { requireAgentSecret } from "../../../../middlewares/agentAuth.middlewares.js";

/**
 * POST /api/v1/recording/report — the office agent reports whether capture
 * actually started (recording / failed) or ended (stopped / aborted).
 * Machine auth via X-Agent-Secret. The app reads this via GET /recording/status.
 */
export default async function (fastify) {
	fastify.post("/", {
		preHandler: requireAgentSecret,
		schema: reportRecordingStatusController.schema,
		handler: reportRecordingStatusController.handler,
	});
}
