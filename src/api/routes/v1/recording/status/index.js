import { getRecordingStatusController } from "../../../../controllers/recording.controllers.js";
import { requireAuth } from "../../../../middlewares/auth.middlewares.js";

/**
 * GET /api/v1/recording/status?recording_id=... — the app polls the office
 * agent's reported status for its provisional recording id during the live
 * step, and shows an error dialog on 'failed' (or on its own offline timeout).
 */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/", {
		schema: getRecordingStatusController.schema,
		handler: getRecordingStatusController.handler,
	});
}
