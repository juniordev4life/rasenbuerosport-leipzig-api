/**
 * Integration test for the admin gate on the talkshow operator routes
 * (`POST /_preview`, `POST /audio`), run through the real `setup()`, the
 * real route module, `requireAuth` + `requireAdmin` and the controllers,
 * with `server.inject`.
 *
 * Firebase Admin and `pg` are programmable mocks: `verifyIdToken` maps a
 * bearer token to a caller, and `poolQuery` answers the `profiles.role`
 * lookup in `requireAdmin`. The talkshow services are mocked too, so a test
 * can prove that a rejected caller never starts a Claude generation or an
 * ElevenLabs render.
 *
 * @fastify/autoload is replaced by a stand-in that registers only the
 * talkshow routes. The real autoload loads route files with Node's native
 * `import()`, which bypasses Vitest's module runner and every `vi.mock`
 * below.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	buildShowContext,
	generateAndPersistEpisode,
	generateShowScript,
	getLatestEpisode,
	poolQuery,
	renderEpisodeAudio,
	verifyIdToken,
} = vi.hoisted(() => ({
	buildShowContext: vi.fn(),
	generateAndPersistEpisode: vi.fn(),
	generateShowScript: vi.fn(),
	getLatestEpisode: vi.fn(),
	poolQuery: vi.fn(),
	renderEpisodeAudio: vi.fn(),
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
vi.mock("../../src/api/services/talkshow.services.js", () => ({
	buildShowContext,
	generateAndPersistEpisode,
	generateShowScript,
	getLatestEpisode,
}));
vi.mock("../../src/api/services/talkshowAudio.services.js", () => ({
	renderEpisodeAudio,
}));
vi.mock("@fastify/autoload", () => ({
	default: async function registerTalkshowRoutes(fastify) {
		const { default: plugin } = await import(
			"../../src/api/routes/v1/talkshow/index.js"
		);
		await fastify.register(plugin, { prefix: "/api/v1/talkshow" });
	},
}));
// Quiet test output: no request logging, no-op background logger.
vi.mock("../../src/config/logger.config.js", () => ({
	loggerConfig: false,
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** Bearer token → decoded Firebase ID token claims. */
const CALLERS = {
	admin: { uid: "uid-admin", email: "admin@redbulls.com", email_verified: true },
	player: {
		uid: "uid-player",
		email: "player@redbulls.com",
		email_verified: true,
	},
};

/** Firebase uid → `profiles.role`, as `requireAdmin` reads it. */
const ROLE_BY_UID = { "uid-admin": "admin", "uid-player": "user" };

const WEEK_START = "2026-09-21";

const OPERATOR_ROUTES = [
	{ url: "/api/v1/talkshow/_preview", payload: {} },
	{ url: "/api/v1/talkshow/audio", payload: { week_start: WEEK_START } },
];

/**
 * Authorization header for one of the CALLERS.
 * @param {keyof typeof CALLERS} caller
 * @returns {{ authorization: string }}
 */
function authAs(caller) {
	return { authorization: `Bearer ${caller}` };
}

/** Stubs the talkshow services with a successful generation and render. */
function stubTalkshowServices() {
	const week = { week_start: WEEK_START, week_end: "2026-09-27" };
	generateAndPersistEpisode.mockResolvedValue({
		...week,
		generated_at: "2026-09-25T20:01:00.000Z",
		script_json: { turns: [], summary: null },
	});
	buildShowContext.mockResolvedValue(week);
	generateShowScript.mockResolvedValue({
		raw_script: "MARCEL: Servus!",
		turns: [],
		summary: null,
	});
	getLatestEpisode.mockResolvedValue(null);
	renderEpisodeAudio.mockResolvedValue(
		`https://storage.googleapis.com/test-bucket/talkshow/${WEEK_START}.mp3`,
	);
}

/** Asserts that no Claude generation and no ElevenLabs render started. */
function expectNoCreditsSpent() {
	expect(generateAndPersistEpisode).not.toHaveBeenCalled();
	expect(generateShowScript).not.toHaveBeenCalled();
	expect(renderEpisodeAudio).not.toHaveBeenCalled();
}

describe("talkshow operator routes (integration)", () => {
	let server;

	beforeEach(async () => {
		vi.resetAllMocks();
		verifyIdToken.mockImplementation(async (token) => {
			if (CALLERS[token]) return CALLERS[token];
			const error = new Error("Decoding Firebase ID token failed.");
			error.code = "auth/argument-error";
			throw error;
		});
		// With the services mocked, the only SQL left is requireAdmin's
		// `SELECT role FROM profiles WHERE id = $1`.
		poolQuery.mockImplementation(async (_sql, [uid] = []) => ({
			rows: ROLE_BY_UID[uid] ? [{ role: ROLE_BY_UID[uid] }] : [],
		}));
		stubTalkshowServices();

		const { createServer } = await import("../../src/server.js");
		const { setup } = await import("../../src/setup.js");
		server = createServer();
		await setup(server);
		await server.ready();
	});

	afterEach(async () => {
		await server?.close();
	});

	it.each(OPERATOR_ROUTES)("rejects $url without a bearer token", async ({
		url,
		payload,
	}) => {
		const response = await server.inject({ method: "POST", url, payload });

		expect(response.statusCode).toBe(401);
		expectNoCreditsSpent();
	});

	it.each(OPERATOR_ROUTES)("rejects a signed-in non-admin on $url before any credits are spent", async ({
		url,
		payload,
	}) => {
		const response = await server.inject({
			method: "POST",
			url,
			headers: authAs("player"),
			payload,
		});

		expect(response.statusCode).toBe(403);
		expect(response.json().message).toBe("Admin access required");
		expectNoCreditsSpent();
	});

	it("lets an admin generate and persist a preview episode", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/api/v1/talkshow/_preview",
			headers: authAs("admin"),
			payload: {},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().message).toBe(
			"Talkshow episode generated and persisted",
		);
		expect(generateAndPersistEpisode).toHaveBeenCalledTimes(1);
		expect(generateAndPersistEpisode).toHaveBeenCalledWith(expect.any(Date));
	});

	it("lets an admin dry-run a preview without writing the episode", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/api/v1/talkshow/_preview",
			headers: authAs("admin"),
			payload: { persist: false },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().message).toBe(
			"Talkshow script generated (not persisted)",
		);
		expect(generateShowScript).toHaveBeenCalledTimes(1);
		expect(generateAndPersistEpisode).not.toHaveBeenCalled();
	});

	it("lets an admin render the episode audio", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/api/v1/talkshow/audio",
			headers: authAs("admin"),
			payload: { week_start: WEEK_START },
		});

		expect(response.statusCode).toBe(200);
		expect(renderEpisodeAudio).toHaveBeenCalledWith(WEEK_START);
		expect(response.json().data.audio_url).toContain(`${WEEK_START}.mp3`);
	});

	it("keeps the dashboard read open to every signed-in user", async () => {
		const response = await server.inject({
			method: "GET",
			url: "/api/v1/talkshow/latest",
			headers: authAs("player"),
		});

		expect(response.statusCode).toBe(200);
		expect(getLatestEpisode).toHaveBeenCalledTimes(1);
	});
});
