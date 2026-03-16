import { getCompareController } from "../../../../../controllers/compare.controllers.js";
import { requireAuth } from "../../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/", {
		schema: getCompareController.schema,
		handler: getCompareController.handler,
	});
}
