import {
	getCommunityStatsController,
	getDashboardStatsController,
} from "../../../controllers/dashboardStats.controllers.js";
import {
	getMyStatsController,
	getPlayerStatsController,
} from "../../../controllers/stats.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/**
 * Stats sub-routes. The `/players/:playerId` route is registered here
 * (rather than in a nested `players/_playerId/` folder) because
 * fastify-autoload's nested-param handling does not pick up a static
 * `players/` segment when a sibling `_playerId/` already declares a
 * dynamic parameter at the same level — the colocated dynamic route
 * shadows the static branch and the nested file never gets loaded.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
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

	fastify.get("/players/:playerId", {
		schema: getPlayerStatsController.schema,
		handler: getPlayerStatsController.handler,
	});
}
