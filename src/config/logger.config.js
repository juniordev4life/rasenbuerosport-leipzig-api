import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/** @type {import('pino').LoggerOptions} */
export const loggerConfig = isProduction
	? {
			level: "info",
		}
	: {
			level: "debug",
			transport: {
				target: "pino-pretty",
				options: {
					colorize: true,
					translateTime: "HH:MM:ss",
					ignore: "pid,hostname",
				},
			},
		};

/**
 * Standalone logger for code that runs outside a Fastify request
 * context (background jobs, fire-and-forget hooks). Inside route
 * handlers prefer `request.log` so log entries carry the request id.
 */
export const logger = pino(loggerConfig);
