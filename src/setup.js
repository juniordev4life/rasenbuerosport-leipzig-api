import autoload from "@fastify/autoload";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Registers all plugins, hooks, and routes
 * @param {import('fastify').FastifyInstance} server
 */
export async function setup(server) {
	await server.register(helmet);

	await server.register(cors, {
		origin: process.env.CORS_ORIGIN || "http://localhost:5173",
		credentials: true,
	});

	await server.register(rateLimit, {
		max: 250,
		timeWindow: "1 minute",
	});

	await server.register(autoload, {
		dir: path.join(__dirname, "api/routes"),
		options: { prefix: "/api" },
		routeParams: true,
	});

	server.get("/health", async () => ({ status: "ok" }));
}
