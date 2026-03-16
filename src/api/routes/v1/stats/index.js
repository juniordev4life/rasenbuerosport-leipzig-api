import {
	getCommunityStatsController,
	getDashboardStatsController,
} from "../../../controllers/dashboardStats.controllers.js";
import { getMyStatsController } from "../../../controllers/stats.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/me", {
		schema: getMyStatsController.schema,
		handler: getMyStatsController.handler,
	});

	fastify.get("/dashboard", {
		schema: getDashboardStatsController.schema,
		handler: getDashboardStatsController.handler,
	});

	fastify.get("/community", {
		schema: getCommunityStatsController.schema,
		handler: getCommunityStatsController.handler,
	});
}
