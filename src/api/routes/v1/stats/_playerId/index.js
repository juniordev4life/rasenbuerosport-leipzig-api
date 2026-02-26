import { getH2HController } from "../../../../controllers/h2h.controllers.js";
import { requireAuth } from "../../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/", {
		schema: getH2HController.schema,
		handler: getH2HController.handler,
	});
}
