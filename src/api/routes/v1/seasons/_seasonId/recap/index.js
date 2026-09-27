import {
	generateSeasonRecapController,
	getMyRecapController,
	notifySeasonRecapController,
} from "../../../../../controllers/leagueSeason.controllers.js";
import { requireAuth } from "../../../../../middlewares/auth.middlewares.js";
import { requireSchedulerSecret } from "../../../../../middlewares/schedulerAuth.middlewares.js";

/**
 * GET /me is a Firebase-user route; generate and notify are operator
 * triggers protected by the shared scheduler secret (X-Trigger-Secret),
 * like POST /wrapped/generate.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function (fastify) {
	fastify.get("/me", {
		schema: getMyRecapController.schema,
		preHandler: [requireAuth],
		handler: getMyRecapController.handler,
	});

	fastify.post("/generate", {
		schema: generateSeasonRecapController.schema,
		preHandler: [requireSchedulerSecret],
		handler: generateSeasonRecapController.handler,
	});

	fastify.post("/notify", {
		schema: notifySeasonRecapController.schema,
		preHandler: [requireSchedulerSecret],
		handler: notifySeasonRecapController.handler,
	});
}
