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

import { getPool } from "../../../src/config/database.config.js";
import { applyEloToMatch } from "../../../src/api/services/elo/eloPersistence.services.js";
import { notifyMatchCreated } from "../../../src/api/services/pushSender.services.js";
import { finalizeGame } from "../../../src/api/services/games.services.js";

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
			if (sql.startsWith("UPDATE games")) {
				return {
					rows: [{ ...gameRow, pending: false, score_home: params[0], score_away: params[1] }],
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

describe("finalizeGame", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("finalizes a pending game: score from last entry, ELO + push run", async () => {
		const { client, executed } = buildClient({
			gameRow: { id: "game-1", pending: true, played_at: "2026-06-12" },
		});
		getPool.mockReturnValue({
			connect: async () => client,
			query: vi.fn(async () => ({
				rows: [{ id: "game-1", pending: false, score_home: 2, score_away: 1 }],
			})),
		});

		const game = await finalizeGame("game-1", TIMELINE);

		expect(game).toMatchObject({ id: "game-1", pending: false });
		const update = executed.find((e) => e.sql.startsWith("UPDATE games"));
		expect(update.params[0]).toBe(2); // score_home from last entry
		expect(update.params[1]).toBe(1); // score_away from last entry
		expect(applyEloToMatch).toHaveBeenCalledTimes(1);
		expect(notifyMatchCreated).toHaveBeenCalledTimes(1);
		expect(executed.some((e) => e.sql === "COMMIT")).toBe(true);
	});

	it("rejects a non-pending game with 409 and runs no ELO", async () => {
		const { client, executed } = buildClient({
			gameRow: { id: "game-1", pending: false },
		});
		getPool.mockReturnValue({ connect: async () => client });

		await expect(finalizeGame("game-1", TIMELINE)).rejects.toMatchObject({
			statusCode: 409,
		});
		expect(applyEloToMatch).not.toHaveBeenCalled();
		expect(executed.some((e) => e.sql === "ROLLBACK")).toBe(true);
	});

	it("returns null when the game does not exist", async () => {
		const { client } = buildClient({ gameRow: null });
		getPool.mockReturnValue({ connect: async () => client });

		const game = await finalizeGame("missing", TIMELINE);

		expect(game).toBeNull();
		expect(applyEloToMatch).not.toHaveBeenCalled();
	});

	it("rejects an empty timeline with 400 before touching the database", async () => {
		await expect(finalizeGame("game-1", [])).rejects.toMatchObject({
			statusCode: 400,
		});
		expect(getPool).not.toHaveBeenCalled();
	});
});
