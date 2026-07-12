import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Plain JSON to stdout in BOTH modes (Cloud Logging parses it in prod). In dev
 * the `dev` npm script pipes stdout through the pino-pretty CLI for humans — we
 * deliberately avoid the in-process pino-pretty transport (a worker thread),
 * because Node's `--watch` crashes its thread-stream worker on startup
 * ("this should not happen: undefined"). Piping keeps both --watch and pretty logs.
 * @type {import('pino').LoggerOptions}
 */
export const loggerConfig = { level: isProduction ? "info" : "debug" };

/**
 * Standalone logger for code that runs outside a Fastify request
 * context (background jobs, fire-and-forget hooks). Inside route
 * handlers prefer `request.log` so log entries carry the request id.
 */
export const logger = pino(loggerConfig);
