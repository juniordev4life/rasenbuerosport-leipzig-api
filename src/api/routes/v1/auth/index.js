import {
	registerController,
	loginController,
	meController,
} from "../../../controllers/auth.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.post("/register", {
		schema: registerController.schema,
		handler: registerController.handler,
	});

	fastify.post("/login", {
		schema: loginController.schema,
		handler: loginController.handler,
	});

	fastify.get("/me", {
		preHandler: [requireAuth],
		handler: meController.handler,
	});
}
