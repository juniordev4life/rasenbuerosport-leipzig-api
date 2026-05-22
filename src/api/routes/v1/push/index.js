import {
	listSubscriptionsController,
	subscribeController,
} from "../../../controllers/push.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.post("/subscribe", {
		schema: subscribeController.schema,
		handler: subscribeController.handler,
	});

	fastify.get("/subscriptions", {
		handler: listSubscriptionsController.handler,
	});
}
