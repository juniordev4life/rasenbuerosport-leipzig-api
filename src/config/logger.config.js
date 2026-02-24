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
