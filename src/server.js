import Fastify from "fastify";
import { loggerConfig } from "./config/logger.config.js";

/**
 * Creates and returns a Fastify instance
 * @returns {import('fastify').FastifyInstance}
 */
export function createServer() {
	const server = Fastify({
		logger: loggerConfig,
	});

	return server;
}
