import {
	generateWrappedController,
	getLatestWrappedController,
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

	fastify.get("/", {
		preHandler: requireAuth,
		schema: listWrappedController.schema,
		handler: listWrappedController.handler,
	});
}
