import {
	getMyFormCurveController,
	recalculateEloController,
} from "../../../controllers/elo.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	// GET /api/v1/elo/me/form-curve
	fastify.get("/me/form-curve", {
		schema: getMyFormCurveController.schema,
		handler: getMyFormCurveController.handler,
	});

	// POST /api/v1/elo/recalculate
	fastify.post("/recalculate", {
		schema: recalculateEloController.schema,
		handler: recalculateEloController.handler,
	});
}
