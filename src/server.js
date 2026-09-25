import Fastify from "fastify";
import { loggerConfig } from "./config/logger.config.js";

/**
 * Creates and returns a Fastify instance
 *
 * `trustProxy: 1` trusts exactly one proxy hop: Cloud Run's Google Front End,
 * which appends the connecting client's address to X-Forwarded-For. So
 * `request.ip`, and with it the rate-limit key, is the real client. Do not use
 * `true`: it trusts every hop and picks the left-most X-Forwarded-For entry,
 * which the client writes itself, so anyone could send a fresh "IP" with each
 * request and never hit the limit. If a load balancer, Cloud Armor or a
 * Firebase Hosting rewrite is ever put in front of the service, raise the hop
 * count by one per extra proxy.
 * @returns {import('fastify').FastifyInstance}
 */
export function createServer() {
	const server = Fastify({
		logger: loggerConfig,
		trustProxy: 1,
	});

	return server;
}
