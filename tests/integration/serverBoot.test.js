/**
 * Server-boot smoke test.
 *
 * Catches the class of bugs where Fastify autoload trips on a
 * route file with a broken import path (e.g. missing `../`) — the
 * dev server crashes the second you run `npm run dev` and CI never
 * sees it because the existing unit tests import services
 * directly, not the route trees.
 *
 * The test:
 *   1. Stubs `pg` so route files that pull in services can resolve
 *      without opening a real connection.
 *   2. Stubs `firebase-admin/app` + `firebase-admin/auth` so any
 *      lazy auth import doesn't try to read credentials.
 *   3. Spins up the Fastify instance, runs the same `setup()` the
 *      real `src/index.js` uses, and awaits `server.ready()`.
 *   4. Asserts `/health` answers + the trophy route (the canary
 *      that triggered the regression) is in the printed route
 *      table.
 *
 * If a route file has a typo in its imports, `server.ready()`
 * rejects with `ERR_MODULE_NOT_FOUND` and this test fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub `pg` Pool — autoload only needs the module to exist; no query is run.
vi.mock("pg", () => {
	class FakePool {
		query() {
			return Promise.resolve({ rows: [] });
		}
		end() {
			return Promise.resolve();
		}
	}
	return { default: { Pool: FakePool }, Pool: FakePool };
});

// Stub Firebase Admin — never actually initialised during the smoke test.
vi.mock("firebase-admin/app", () => ({
	getApps: () => [{}],
	initializeApp: () => {},
}));
vi.mock("firebase-admin/auth", () => ({
	getAuth: () => ({
		verifyIdToken: () => Promise.resolve({ uid: "test-uid" }),
	}),
}));
vi.mock("firebase-admin/storage", () => ({
	getStorage: () => ({
		bucket: () => ({ name: "test-bucket" }),
	}),
}));

describe("server boot", () => {
	let server;

	beforeEach(async () => {
		const { createServer } = await import("../../src/server.js");
		const { setup } = await import("../../src/setup.js");
		server = createServer();
		await setup(server);
		await server.ready();
	});

	afterEach(async () => {
		await server?.close();
	});

	it("starts without unresolved imports and exposes /health", async () => {
		const response = await server.inject({ method: "GET", url: "/health" });
		expect(response.statusCode).toBe(200);
		expect(JSON.parse(response.payload)).toEqual({ status: "ok" });
	});

	it("registers the trophy room route under /api/v1/players/:playerId/trophies", () => {
		// Sanity check that autoload picked up the route file. If a route
		// has a broken import the boot itself would have failed in beforeEach;
		// this assertion documents the canary path so a future move of the
		// route doesn't silently disappear from the surface area.
		const routes = server.printRoutes({ includeHooks: false });
		expect(routes).toContain("trophies");
	});
});
