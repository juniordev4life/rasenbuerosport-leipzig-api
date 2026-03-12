import {
	meController,
	updateProfileController,
} from "../../../controllers/auth.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.get("/me", {
		preHandler: [requireAuth],
		handler: meController.handler,
	});

	fastify.patch("/profile", {
		schema: updateProfileController.schema,
		preHandler: [requireAuth],
		handler: updateProfileController.handler,
	});
}
