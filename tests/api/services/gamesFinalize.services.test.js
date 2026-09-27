import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/database.config.js", () => ({
	getPool: vi.fn(),
}));
vi.mock("../../../src/config/logger.config.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Keep the real withTransaction (it runs on the mocked pool below) so the
// tests cover BEGIN/COMMIT/ROLLBACK; only the pool-level helpers are stubbed.
vi.mock("../../../src/api/helpers/database.helpers.js", async (importOriginal) => ({
	...(await importOriginal()),
	query: vi.fn(async () => []),
	queryOne: vi.fn(async () => null),
}));
vi.mock("../../../src/api/services/elo/leagueEloV2Persistence.services.js", () => ({
	recomputeLeagueEloSafely: vi.fn(async () => ({ status: "ok" })),
}));
vi.mock(
	"../../../src/api/services/playerProfile/playerProfile.services.js",
	() => ({ invalidateProfileCache: vi.fn(async () => {}) }),
);
vi.mock("../../../src/api/services/pushSender.services.js", () => ({
	notifyMatchCreated: vi.fn(async () => ({ recipients: 0 })),
}));

import { recomputeLeagueEloSafely } from "../../../src/api/services/elo/leagueEloV2Persistence.services.js";
import { finalizeGame } from "../../../src/api/services/games.services.js";
import { notifyMatchCreated } from "../../../src/api/services/pushSender.services.js";
import { getPool } from "../../../src/config/database.config.js";

const TIMELINE = [
	{ home: 1, away: 0, team: "home", minute: 12, period: "regular" },
	{ home: 1, away: 1, team: "away", minute: 40, period: "regular" },
	{ home: 2, away: 1, team: "home", minute: 71, period: "regular" },
];

/**
 * Builds a pg-client mock that routes queries by SQL substring and records
 * the executed statements for assertions.
 */
function buildClient({ gameRow }) {
	const executed = [];
	const client = {
		query: vi.fn(async (sql, params) => {
			executed.push({ sql, params });
			if (sql.includes("FOR UPDATE")) {
				return { rows: gameRow ? [gameRow] : [] };
			}
			if (sql.trim().startsWith("UPDATE games")) {
				return {
					rows: [
						{
							...gameRow,
							pending: false,
							score_home: params[0],
							score_away: params[1],
						},
					],
				};
			}
			if (sql.includes("FROM game_players")) {
				return {
					rows: [
						{ player_id: "p-home", team: "home" },
						{ player_id: "p-away", team: "away" },
					],
				};
			}
			return { rows: [] };
		}),
		release: vi.fn(),
	};
	return { client, executed };
}

function mockPool(client) {
	getPool.mockReturnValue({
		connect: async () => client,
		query: vi.fn(async () => ({
			rows: [{ id: "game-1", pending: false, score_home: 2, score_away: 1 }],
		})),
	});
}

describe("finalizeGame", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("finalizes a pending game, then replays League-ELO v2 and sends the push", async () => {
		// Arrange
		const { client, executed } = buildClient({
			gameRow: { id: "game-1", pending: true, played_at: "2026-06-12" },
		});
		mockPool(client);

		// Act
		const game = await finalizeGame("game-1", TIMELINE);

		// Assert
		expect(game).toMatchObject({ id: "game-1", pending: false });
		const update = executed.find((e) => e.sql.trim().startsWith("UPDATE games"));
		expect(update.params[0]).toBe(2);
		expect(update.params[1]).toBe(1);
		expect(executed.some((e) => e.sql === "COMMIT")).toBe(true);
		expect(recomputeLeagueEloSafely).toHaveBeenCalledWith({
			reason: "game_finalized",
			gameId: "game-1",
		});
		expect(notifyMatchCreated).toHaveBeenCalledTimes(1);
		expect(client.release).toHaveBeenCalledTimes(1);
	});

	it("replays only after the finalize is committed", async () => {
		const { client, executed } = buildClient({
			gameRow: { id: "game-1", pending: true, played_at: "2026-06-12" },
		});
		mockPool(client);
		let commitsBeforeReplay = null;
		recomputeLeagueEloSafely.mockImplementationOnce(async () => {
			commitsBeforeReplay = executed.filter((e) => e.sql === "COMMIT").length;
			return { status: "ok" };
		});

		await finalizeGame("game-1", TIMELINE);

		expect(commitsBeforeReplay).toBe(1);
	});

	it("rejects a non-pending game with 409, rolls back and replays nothing", async () => {
		const { client, executed } = buildClient({
			gameRow: { id: "game-1", pending: false },
		});
		mockPool(client);

		await expect(finalizeGame("game-1", TIMELINE)).rejects.toMatchObject({
			statusCode: 409,
		});
		expect(executed.some((e) => e.sql === "ROLLBACK")).toBe(true);
		expect(executed.some((e) => e.sql === "COMMIT")).toBe(false);
		expect(recomputeLeagueEloSafely).not.toHaveBeenCalled();
		expect(client.release).toHaveBeenCalledTimes(1);
	});

	it("returns null when the game does not exist", async () => {
		const { client } = buildClient({ gameRow: null });
		mockPool(client);

		const game = await finalizeGame("missing", TIMELINE);

		expect(game).toBeNull();
		expect(recomputeLeagueEloSafely).not.toHaveBeenCalled();
	});

	it("schreibt ein erkanntes Elfmeterschießen, ohne ein vorhandenes zu überschreiben", async () => {
		const penalty_shootout = {
			score_before: { home: 2, away: 2 },
			final_score: { home: 4, away: 1 },
			winner_side: "home",
			source: "auto",
		};
		const { client, executed } = buildClient({
			gameRow: { id: "game-1", pending: true, played_at: "2026-06-12" },
		});
		mockPool(client);

		await finalizeGame("game-1", TIMELINE, {
			result_type: "penalty",
			penalty_shootout,
		});

		const update = executed.find((e) => e.sql.trim().startsWith("UPDATE games"));
		expect(update.params[4]).toBe("penalty");
		expect(JSON.parse(update.params[5])).toEqual(penalty_shootout);
		// A shootout the app recorded (with shooters and keepers) must win over
		// the agent's result-only record.
		expect(update.sql).toContain("COALESCE(penalty_shootout, $6::jsonb)");
	});

	it("lässt ein bestehendes Ergebnis unangetastet, wenn nichts gemeldet wird", async () => {
		const { client, executed } = buildClient({
			gameRow: { id: "game-1", pending: true, played_at: "2026-06-12" },
		});
		mockPool(client);

		await finalizeGame("game-1", TIMELINE);

		const update = executed.find((e) => e.sql.trim().startsWith("UPDATE games"));
		expect(update.params[4]).toBeNull();
		expect(update.params[5]).toBeNull();
	});

	it("rejects an empty timeline with 400 before touching the database", async () => {
		await expect(finalizeGame("game-1", [])).rejects.toMatchObject({
			statusCode: 400,
		});
		expect(getPool).not.toHaveBeenCalled();
	});
});
