import { getMyWeeklyRecapController } from "../../../controllers/weeklyRecap.controllers.js";
import {
	generateWrappedController,
	getLatestWrappedController,
	getWrappedByWeekStartController,
	listWrappedController,
} from "../../../controllers/wrapped.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";
import { requireSchedulerSecret } from "../../../middlewares/schedulerAuth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.post("/generate", {
		preHandler: requireSchedulerSecret,
		schema: generateWrappedController.schema,
		handler: generateWrappedController.handler,
	});

	fastify.get("/latest", {
		preHandler: requireAuth,
		schema: getLatestWrappedController.schema,
		handler: getLatestWrappedController.handler,
	});

	fastify.get("/recap/me", {
		preHandler: requireAuth,
		schema: getMyWeeklyRecapController.schema,
		handler: getMyWeeklyRecapController.handler,
	});

	fastify.get("/", {
		preHandler: requireAuth,
		schema: listWrappedController.schema,
		handler: listWrappedController.handler,
	});

	// Deep link to a specific week's wrapped — order matters: this
	// must register AFTER the static `/latest` + `/recap/me` so
	// Fastify's router prefers those for literal-path matches. The
	// `:weekStart` is regex-gated in the controller schema to only
	// accept `YYYY-MM-DD`, so a typo on the static paths returns 400
	// rather than swallowing the request here.
	fastify.get("/:weekStart", {
		preHandler: requireAuth,
		schema: getWrappedByWeekStartController.schema,
		handler: getWrappedByWeekStartController.handler,
	});
}
