import {
	deleteSubscriptionController,
	updatePreferencesController,
} from "../../../../controllers/push.controllers.js";
import { requireAuth } from "../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.delete("/", {
		schema: deleteSubscriptionController.schema,
		handler: deleteSubscriptionController.handler,
	});

	fastify.patch("/preferences", {
		schema: updatePreferencesController.schema,
		handler: updatePreferencesController.handler,
	});
}
