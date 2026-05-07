import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the Playmaker API.
 *
 * Coverage thresholds follow the project standard (70% lines/functions/statements,
 * 60% branches). Configuration files, the entry point, and pure framework wiring
 * are excluded — they are integration-tested implicitly via the routes that use them.
 */
export default defineConfig({
	test: {
		environment: "node",
		globals: false,
		setupFiles: ["./tests/setup.js"],
		include: ["tests/**/*.test.js", "src/**/*.test.js"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			include: ["src/**/*.js"],
			exclude: [
				"src/index.js",
				"src/server.js",
				"src/setup.js",
				"src/config/**",
				"**/*.test.js",
			],
			thresholds: {
				lines: 70,
				functions: 70,
				statements: 70,
				branches: 60,
			},
		},
	},
});
