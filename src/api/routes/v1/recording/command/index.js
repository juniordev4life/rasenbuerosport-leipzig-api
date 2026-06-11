import { setRecordingCommandController } from "../../../../controllers/recording.controllers.js";
import { requireAuth } from "../../../../middlewares/auth.middlewares.js";

/**
 * POST /api/v1/recording/command — the app sets the next command for the
 * office agent: "start" on kickoff (provisional recording id), "stop"
 * after the game is saved (real game id).
 */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.post("/", {
		schema: setRecordingCommandController.schema,
		handler: setRecordingCommandController.handler,
	});
}
