import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyCardEloDeltas } from "../../../src/api/services/elo/cardElo.services.js";
import { applyEloToMatch } from "../../../src/api/services/elo/eloPersistence.services.js";
import { replayGameElo } from "../../../src/api/services/elo/eloReplay.services.js";
import { applyPenaltyShotEloDeltas } from "../../../src/api/services/elo/penaltyShotElo.services.js";

/** Records the order the three ELO passes fire in. */
const callOrder = [];

vi.mock("../../../src/api/services/elo/eloPersistence.services.js", () => ({
	applyEloToMatch: vi.fn(async () => ({
		teamA: [],
		teamB: [],
		version: "test",
		matchMeta: {},
	})),
}));

vi.mock("../../../src/api/services/elo/penaltyShotElo.services.js", () => ({
	applyPenaltyShotEloDeltas: vi.fn(async () => ({ alice: -4, bob: 4 })),
}));

vi.mock("../../../src/api/services/elo/cardElo.services.js", () => ({
	computeCardEloDeltas: vi.fn(() => ({ alice: -3 })),
	applyCardEloDeltas: vi.fn(async () => undefined),
}));

const GAME_PLAYERS = [
	{ player_id: "alice", team: "home" },
	{ player_id: "bob", team: "away" },
];

/**
 * Builds a minimal persisted game row. Overrides are shallow-merged so
 * each test only states the column it cares about.
 */
function makeGame(overrides = {}) {
	return {
		id: "game-1",
		played_at: "2026-07-24T13:00:00.000Z",
		score_timeline: [],
		penalty_shootout: null,
		match_stats: null,
		...overrides,
	};
}

describe("replayGameElo", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		callOrder.length = 0;
		applyEloToMatch.mockImplementation(async () => {
			callOrder.push("engine");
			return { teamA: [], teamB: [], version: "test", matchMeta: {} };
		});
		applyPenaltyShotEloDeltas.mockImplementation(async () => {
			callOrder.push("penalty");
			return { alice: -4, bob: 4 };
		});
		applyCardEloDeltas.mockImplementation(async () => {
			callOrder.push("card");
		});
	});

	it("runs the team engine for a plain game and skips both overlays", async () => {
		const client = {};
		const game = makeGame();

		const result = await replayGameElo({
			client,
			game,
			gamePlayers: GAME_PLAYERS,
		});

		expect(applyEloToMatch).toHaveBeenCalledWith({
			client,
			game,
			gamePlayers: GAME_PLAYERS,
		});
		expect(applyPenaltyShotEloDeltas).not.toHaveBeenCalled();
		expect(applyCardEloDeltas).not.toHaveBeenCalled();
		expect(result.penaltyDeltas).toBeNull();
		expect(result.cardDeltas).toBeNull();
	});

	it("re-applies the penalty overlay when the shootout has shots", async () => {
		const game = makeGame({
			penalty_shootout: {
				shots: [{ order: 1, elo_deltas: { alice: -4, bob: 4 } }],
			},
		});

		const result = await replayGameElo({
			client: {},
			game,
			gamePlayers: GAME_PLAYERS,
		});

		expect(applyPenaltyShotEloDeltas).toHaveBeenCalledWith(
			expect.objectContaining({
				shots: game.penalty_shootout.shots,
				playedAt: game.played_at,
			}),
		);
		expect(result.penaltyDeltas).toEqual({ alice: -4, bob: 4 });
	});

	it("skips the penalty overlay for a result-only shootout with no shots", async () => {
		// The capture pipeline writes this variant: outcome, but no
		// shot-by-shot record and therefore no per-shot deltas to replay.
		const game = makeGame({
			penalty_shootout: {
				score_before: { home: 2, away: 2 },
				final_score: { home: 4, away: 3 },
				winner_side: "home",
				source: "capture",
			},
		});

		const result = await replayGameElo({
			client: {},
			game,
			gamePlayers: GAME_PLAYERS,
		});

		expect(applyPenaltyShotEloDeltas).not.toHaveBeenCalled();
		expect(result.penaltyDeltas).toBeNull();
	});

	it("re-applies the card overlay only when card_elo_applied is set", async () => {
		const game = makeGame({
			match_stats: {
				card_elo_applied: true,
				yellow_cards: { home: 3, away: 0 },
				red_cards: { home: 0, away: 0 },
			},
		});

		const result = await replayGameElo({
			client: {},
			game,
			gamePlayers: GAME_PLAYERS,
		});

		expect(applyCardEloDeltas).toHaveBeenCalledWith(
			expect.objectContaining({
				deltas: { alice: -3 },
				playedAt: game.played_at,
			}),
		);
		expect(result.cardDeltas).toEqual({ alice: -3 });
	});

	it("skips the card overlay when stats exist but the flag was never set", async () => {
		const game = makeGame({
			match_stats: { yellow_cards: { home: 3, away: 0 } },
		});

		const result = await replayGameElo({
			client: {},
			game,
			gamePlayers: GAME_PLAYERS,
		});

		expect(applyCardEloDeltas).not.toHaveBeenCalled();
		expect(result.cardDeltas).toBeNull();
	});

	it("applies the passes in live-path order: engine, penalty, card", async () => {
		const game = makeGame({
			penalty_shootout: { shots: [{ order: 1, elo_deltas: { alice: -4 } }] },
			match_stats: { card_elo_applied: true },
		});

		await replayGameElo({ client: {}, game, gamePlayers: GAME_PLAYERS });

		// Both overlays patch the LAST rating_history entry the engine
		// pushed, so they can never run before it.
		expect(callOrder).toEqual(["engine", "penalty", "card"]);
	});

	it("never writes the card_elo_applied flag — the live path owns it", async () => {
		const client = { query: vi.fn() };
		const game = makeGame({ match_stats: { card_elo_applied: true } });

		await replayGameElo({ client, game, gamePlayers: GAME_PLAYERS });

		expect(client.query).not.toHaveBeenCalled();
	});
});
