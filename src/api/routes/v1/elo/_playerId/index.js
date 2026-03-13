import {
	getEloHistoryController,
	getFormCurveController,
} from "../../../../controllers/elo.controllers.js";
import { requireAuth } from "../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	// GET /api/v1/elo/:playerId
	fastify.get("/", {
		schema: getEloHistoryController.schema,
		handler: getEloHistoryController.handler,
	});

	// GET /api/v1/elo/:playerId/form-curve
	fastify.get("/form-curve", {
		schema: getFormCurveController.schema,
		handler: getFormCurveController.handler,
	});
}
