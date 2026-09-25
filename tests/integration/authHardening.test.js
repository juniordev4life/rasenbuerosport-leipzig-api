/**
 * Integration test for the auth hardening, run through the real `setup()`
 * (Helmet, CORS, rate limiting), the real route modules, schemas, hooks,
 * controllers and services, with `server.inject`.
 *
 * `pg` and Firebase Admin are replaced by programmable mocks:
 * `verifyIdToken` maps a bearer token to a caller, and `poolQuery` records
 * every SQL statement, so a test can prove that a rejected caller never
 * reaches the database.
 *
 * @fastify/autoload is replaced by a small stand-in that registers the
 * routes under test. The real autoload is CommonJS and loads route files
 * with Node's native `import()`, which bypasses Vitest's module runner. Those
 * routes would then run with the real Firebase Admin SDK and ignore every
 * `vi.mock` in this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { poolQuery, submitFeedback, verifyIdToken } = vi.hoisted(() => ({
	poolQuery: vi.fn(),
	submitFeedback: vi.fn(),
	verifyIdToken: vi.fn(),
}));

vi.mock("pg", () => {
	class FakePool {
		query(...args) {
			return poolQuery(...args);
		}
		end() {
			return Promise.resolve();
		}
	}
	return { default: { Pool: FakePool }, Pool: FakePool };
});
vi.mock("firebase-admin/app", () => ({
	getApps: () => [{}],
	initializeApp: () => {},
}));
vi.mock("firebase-admin/auth", () => ({
	getAuth: () => ({ verifyIdToken }),
}));
vi.mock("firebase-admin/storage", () => ({
	getStorage: () => ({ bucket: () => ({ name: "test-bucket" }) }),
}));
vi.mock("../../src/api/services/feedback.services.js", () => ({
	submitFeedback,
}));
vi.mock("@fastify/autoload", () => ({
	default: async function registerRoutesUnderTest(fastify) {
		const routes = {
			"/api/v1/auth": () => import("../../src/api/routes/v1/auth/index.js"),
			"/api/v1/players": () =>
				import("../../src/api/routes/v1/players/index.js"),
			"/api/v1/feedback": () =>
				import("../../src/api/routes/v1/feedback/index.js"),
		};
		for (const [prefix, load] of Object.entries(routes)) {
			const { default: plugin } = await load();
			await fastify.register(plugin, { prefix });
		}
	},
}));
// Quiet test output: no request logging, no-op background logger.
vi.mock("../../src/config/logger.config.js", () => ({
	loggerConfig: false,
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** Bearer token → decoded Firebase ID token claims. */
const CALLERS = {
	max: { uid: "uid-max", email: "max@redbulls.com", email_verified: true },
	erika: { uid: "uid-erika", email: "erika@redbulls.com", email_verified: true },
	attacker: {
		uid: "uid-attacker",
		email: "attacker@gmail.com",
		email_verified: true,
	},
};

/**
 * Authorization header for one of the CALLERS.
 * @param {keyof typeof CALLERS} caller
 * @returns {{ authorization: string }}
 */
function authAs(caller) {
	return { authorization: `Bearer ${caller}` };
}

describe("auth hardening (integration)", () => {
	let server;

	beforeEach(async () => {
		poolQuery.mockReset();
		poolQuery.mockResolvedValue({ rows: [] });
		verifyIdToken.mockReset();
		verifyIdToken.mockImplementation(async (token) => {
			if (CALLERS[token]) return CALLERS[token];
			const error = new Error("Decoding Firebase ID token failed.");
			error.code = "auth/argument-error";
			throw error;
		});
		submitFeedback.mockReset();
		submitFeedback.mockResolvedValue({ kind: "general" });

		const { createServer } = await import("../../src/server.js");
		const { setup } = await import("../../src/setup.js");
		server = createServer();
		await setup(server);
		server.get("/__test/ip", async (request) => ({ ip: request.ip }));
		await server.ready();
	});

	afterEach(async () => {
		await server?.close();
	});

	it("rejects an off-domain account before it can create a profile", async () => {
		const response = await server.inject({
			method: "PATCH",
			url: "/api/v1/auth/profile",
			headers: authAs("attacker"),
			payload: { username: "attacker" },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json().message).toBe("User not authorized");
		expect(poolQuery).not.toHaveBeenCalled();
	});

	it("answers /me for an off-domain account with the message the app signs out on", async () => {
		const response = await server.inject({
			method: "GET",
			url: "/api/v1/auth/me",
			headers: authAs("attacker"),
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			code: 403,
			message: "User not authorized",
		});
		expect(poolQuery).not.toHaveBeenCalled();
	});

	it("blocks an off-domain account on the other protected routes", async () => {
		const response = await server.inject({
			method: "GET",
			url: "/api/v1/players",
			headers: authAs("attacker"),
		});

		expect(response.statusCode).toBe(403);
		expect(poolQuery).not.toHaveBeenCalled();
	});

	it("sends an allowed account without a profile to the setup", async () => {
		const response = await server.inject({
			method: "GET",
			url: "/api/v1/auth/me",
			headers: authAs("max"),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().data).toMatchObject({
			id: "uid-max",
			email: "max@redbulls.com",
			needsSetup: true,
		});
	});

	it("does not echo token verification details in a 401", async () => {
		const response = await server.inject({
			method: "GET",
			url: "/api/v1/auth/me",
			headers: { authorization: "Bearer forged-token" },
		});

		expect(response.statusCode).toBe(401);
		expect(response.json().error).toEqual(["Token verification failed"]);
		expect(response.payload).not.toContain("Decoding");
	});

	it.each([
		["a javascript: URL", "javascript:alert(1)"],
		["a plain http URL", "http://lh3.googleusercontent.com/a/x"],
	])("rejects %s as avatar_url in the schema", async (_label, avatarUrl) => {
		const response = await server.inject({
			method: "PATCH",
			url: "/api/v1/auth/profile",
			headers: authAs("max"),
			payload: { avatar_url: avatarUrl },
		});

		expect(response.statusCode).toBe(400);
		expect(poolQuery).not.toHaveBeenCalled();
	});

	it("rejects an https avatar_url on a foreign host", async () => {
		const response = await server.inject({
			method: "PATCH",
			url: "/api/v1/auth/profile",
			headers: authAs("max"),
			payload: { avatar_url: "https://tracker.example/pixel.png" },
		});

		expect(response.statusCode).toBe(400);
		expect(response.json().message).toBe("Invalid avatar URL");
		expect(poolQuery).not.toHaveBeenCalled();
	});

	it("takes request.ip from the X-Forwarded-For entry the front end appends", async () => {
		const response = await server.inject({
			method: "GET",
			url: "/__test/ip",
			remoteAddress: "169.254.1.1",
			headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.9" },
		});

		// 203.0.113.7 was written by the client and must not become its IP.
		expect(response.json()).toEqual({ ip: "198.51.100.9" });
	});

	it("limits feedback per user, not per shared address", async () => {
		const submit = (caller) =>
			server.inject({
				method: "POST",
				url: "/api/v1/feedback",
				headers: authAs(caller),
				payload: { kind: "general", description: "Great app" },
			});

		for (let attempt = 0; attempt < 5; attempt++) {
			expect((await submit("max")).statusCode).toBe(201);
		}
		expect((await submit("max")).statusCode).toBe(429);
		expect((await submit("erika")).statusCode).toBe(201);
	});

	it("rejects anonymous feedback before it is processed", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/api/v1/feedback",
			payload: { kind: "general", description: "Spam" },
		});

		expect(response.statusCode).toBe(401);
		expect(submitFeedback).not.toHaveBeenCalled();
	});
});
