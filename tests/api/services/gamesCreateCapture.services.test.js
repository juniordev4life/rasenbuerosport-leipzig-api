import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/database.config.js", () => ({
	getPool: vi.fn(),
}));
vi.mock("../../../src/config/logger.config.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/api/helpers/database.helpers.js", () => ({
	query: vi.fn(async () => []),
	queryOne: vi.fn(async () => null),
}));
vi.mock("../../../src/api/services/elo/eloPersistence.services.js", () => ({
	applyEloToMatch: vi.fn(async () => {}),
}));
vi.mock("../../../src/api/services/elo/penaltyShotElo.services.js", () => ({
	applyPenaltyShotEloDeltas: vi.fn(async () => {}),
}));
vi.mock(
	"../../../src/api/services/playerProfile/playerProfile.services.js",
	() => ({ invalidateProfileCache: vi.fn(async () => {}) }),
);
vi.mock("../../../src/api/services/pushSender.services.js", () => ({
	notifyMatchCreated: vi.fn(async () => ({ recipients: 0 })),
}));
vi.mock("../../../src/api/services/recording.services.js", () => ({
	hasFailedCapture: vi.fn(async () => false),
}));

import { hasFailedCapture } from "../../../src/api/services/recording.services.js";
import { createGame } from "../../../src/api/services/games.services.js";
import { getPool } from "../../../src/config/database.config.js";

/** pg-client mock that records every executed statement. */
function buildClient() {
	const executed = [];
	const client = {
		query: vi.fn(async (sql, params) => {
			executed.push({ sql, params });
			if (sql.includes("INSERT INTO games")) {
				return { rows: [{ id: "game-1", pending: true }] };
			}
			return { rows: [] };
		}),
		release: vi.fn(),
	};
	return { client, executed };
}

const ARGS = {
	mode: "1v1",
	score_home: 0,
	score_away: 0,
	players: [
		{ id: "p-home", team: "home" },
		{ id: "p-away", team: "away" },
	],
	created_by: "p-home",
	pending: true,
	recording_id: "rec-123",
};

/** video_status is the last INSERT parameter (see createGame). */
function insertedVideoStatus(executed) {
	const insert = executed.find((e) => e.sql.includes("INSERT INTO games"));
	return insert.params[insert.params.length - 1];
}

describe("createGame — adopting an already failed capture", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates the game as failed when the capture already died", async () => {
		// The agent reports an instantly dying ffmpeg (full disk, blocked capture
		// device) before this row exists, so the failure has to be adopted here.
		// Leaving video_status NULL made the app block the match report forever.
		hasFailedCapture.mockResolvedValueOnce(true);
		const { client, executed } = buildClient();
		getPool.mockReturnValue({ connect: vi.fn(async () => client) });

		await createGame(ARGS);

		expect(hasFailedCapture).toHaveBeenCalledWith("rec-123");
		expect(insertedVideoStatus(executed)).toBe("failed");
	});

	it("leaves video_status empty for a healthy capture", async () => {
		hasFailedCapture.mockResolvedValueOnce(false);
		const { client, executed } = buildClient();
		getPool.mockReturnValue({ connect: vi.fn(async () => client) });

		await createGame(ARGS);

		expect(insertedVideoStatus(executed)).toBeNull();
	});

	it("does not consult the capture status for a game without a recording", async () => {
		const { client, executed } = buildClient();
		getPool.mockReturnValue({ connect: vi.fn(async () => client) });

		await createGame({ ...ARGS, recording_id: undefined });

		expect(hasFailedCapture).toHaveBeenCalledWith(undefined);
		expect(insertedVideoStatus(executed)).toBeNull();
	});
});
