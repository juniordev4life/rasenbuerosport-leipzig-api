import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/logger.config.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const txClient = { query: vi.fn() };
vi.mock("../../../src/api/helpers/database.helpers.js", () => ({
	withTransaction: vi.fn(async (fn) => fn(txClient)),
}));

import {
	buildRatedMatches,
	computePlan,
	diffPlan,
	hashOf,
	inputHash,
	LEAGUE_ELO_VERSION,
	recomputeLeagueElo,
	recomputeLeagueEloSafely,
	stableStringify,
} from "../../../src/api/services/elo/leagueEloV2Persistence.services.js";

const SEASONS = [
	{
		id: "fc26",
		starts_at: new Date("2026-03-01T00:00:00Z"),
		ends_at: new Date("2026-09-22T13:00:00Z"),
	},
	{ id: "fc27", starts_at: new Date("2026-09-22T13:00:00Z"), ends_at: null },
];

function game(id, playedAt, score, extra = {}) {
	return {
		id,
		played_at: new Date(playedAt),
		pending: false,
		score_home: score[0],
		score_away: score[1],
		score_timeline: [],
		penalty_shootout: null,
		match_stats: null,
		elo_snapshot: null,
		...extra,
	};
}

function profile(id) {
	return {
		id,
		current_rating: 1500,
		matches_played: 0,
		rating_history: [],
		peak_elo_value: 1500,
		peak_elo_at: null,
		rating_updated_at: null,
	};
}

function fixture() {
	const games = [
		game("g1", "2026-09-01T11:00:00Z", [2, 0], {
			score_timeline: [
				{ home: 1, away: 0, period: "regular", scored_by: "a" },
				{ home: 2, away: 0, period: "regular", scored_by: "a" },
			],
		}),
		game("g2", "2026-09-10T11:00:00Z", [1, 1]),
		game("g3", "2026-09-23T11:00:00Z", [0, 3]),
		game("g4", "2026-09-24T11:00:00Z", [0, 0], { pending: true }),
		game("g5", "2026-09-24T12:00:00Z", [3, 0]),
		game("g6", "2026-09-24T13:00:00Z", [1, 0]),
	];
	const gamePlayers = [
		{ game_id: "g1", player_id: "a", team: "home" },
		{ game_id: "g1", player_id: "b", team: "away" },
		{ game_id: "g2", player_id: "a", team: "home" },
		{ game_id: "g2", player_id: "c", team: "home" },
		{ game_id: "g2", player_id: "b", team: "away" },
		{ game_id: "g2", player_id: "d", team: "away" },
		{ game_id: "g3", player_id: "c", team: "home" },
		{ game_id: "g3", player_id: "a", team: "away" },
		{ game_id: "g3", player_id: "b", team: "away" },
		{ game_id: "g4", player_id: "a", team: "home" },
		{ game_id: "g4", player_id: "b", team: "away" },
		// g5: one side empty → not rated
		{ game_id: "g5", player_id: "a", team: "home" },
		// g6: three players on a side → not rated
		{ game_id: "g6", player_id: "a", team: "home" },
		{ game_id: "g6", player_id: "b", team: "home" },
		{ game_id: "g6", player_id: "c", team: "home" },
		{ game_id: "g6", player_id: "d", team: "away" },
	];
	const profiles = ["a", "b", "c", "d", "e"].map(profile);
	return { games, gamePlayers, profiles, seasons: SEASONS, standings: [] };
}

describe("buildRatedMatches", () => {
	it("rates finished games and skips pending, one-sided and 3-player sides", () => {
		const { games, gamePlayers } = fixture();

		const { matches, unratedIds } = buildRatedMatches(games, gamePlayers);

		expect(matches.map((m) => m.gameId)).toEqual(["g1", "g2", "g3"]);
		expect(unratedIds.sort()).toEqual(["g4", "g5", "g6"]);
	});
});

describe("computePlan", () => {
	it("produces zero-sum snapshots in the shape existing readers expect", () => {
		const plan = computePlan(fixture());

		expect(plan.violations).toEqual([]);
		const snap = plan.snapshots.get("g1");
		expect(snap.version).toBe(LEAGUE_ELO_VERSION);
		expect(snap.teamA.map((r) => r.playerId)).toEqual(["a"]);
		expect(snap.teamB.map((r) => r.playerId)).toEqual(["b"]);
		const row = snap.teamA[0];
		expect(row).toMatchObject({ ratingBefore: 1500, share: null });
		expect(row.ratingAfter).toBe(row.ratingBefore + row.delta);
		expect(row.contribution).toBeGreaterThanOrEqual(1);
		for (const id of ["g1", "g2", "g3"]) {
			const s = plan.snapshots.get(id);
			const sum = [...s.teamA, ...s.teamB].reduce((t, r) => t + r.delta, 0);
			expect(sum).toBe(0);
		}
		expect(plan.snapshots.get("g4")).toBeNull();
		expect(plan.snapshots.get("g5")).toBeNull();
		expect(plan.snapshots.get("g6")).toBeNull();
	});

	it("keeps the rating sum at 1500 per rated player and resets players without games", () => {
		const plan = computePlan(fixture());

		const rated = plan.profiles.filter((p) => p.matches_played > 0);
		expect(rated.reduce((t, p) => t + p.current_rating, 0)).toBe(1500 * rated.length);
		const e = plan.profiles.find((p) => p.id === "e");
		expect(e).toMatchObject({ current_rating: 1500, matches_played: 0, rating_history: [] });
		const a = plan.profiles.find((p) => p.id === "a");
		expect(a.matches_played).toBe(3);
		expect(a.rating_updated_at).toBe("2026-09-23T11:00:00.000Z");
		expect(a.peak_elo_value).toBeGreaterThanOrEqual(1500);
	});

	it("splits the standings at the season cut", () => {
		const plan = computePlan(fixture());

		const fc26 = plan.standings.find((s) => s.season_id === "fc26").payload;
		const fc27 = plan.standings.find((s) => s.season_id === "fc27").payload;
		expect(fc26.rated_games).toBe(2);
		expect(fc27.rated_games).toBe(1);
		const aEnd26 = fc26.players.find((p) => p.player_id === "a").rating_end;
		const a27 = fc27.players.find((p) => p.player_id === "a");
		expect(a27.rating_start).toBe(aEnd26);
		expect(a27.games).toBe(1);
		// d only played in FC26 but still carries a rating into FC27
		expect(fc27.players.find((p) => p.player_id === "d").games).toBe(0);
	});

	it("is deterministic: same inputs, same plan hash", () => {
		expect(computePlan(fixture()).hash).toBe(computePlan(fixture()).hash);
	});
});

describe("diffPlan", () => {
	it("finds nothing to write once the stored state equals the plan", () => {
		const inputs = fixture();
		const plan = computePlan(inputs);
		for (const g of inputs.games) g.elo_snapshot = plan.snapshots.get(g.id) ?? null;
		inputs.profiles = plan.profiles.map((p) => ({ ...p }));
		inputs.standings = plan.standings.map((s) => ({ ...s }));

		const changes = diffPlan(plan, inputs);

		expect(changes).toEqual({ games: [], profiles: [], standings: [] });
	});

	it("reports only the new game after a game was added", () => {
		const inputs = fixture();
		const plan = computePlan(inputs);
		for (const g of inputs.games) g.elo_snapshot = plan.snapshots.get(g.id) ?? null;
		inputs.profiles = plan.profiles.map((p) => ({ ...p }));
		inputs.standings = plan.standings.map((s) => ({ ...s }));
		inputs.games.push(game("g7", "2026-09-25T11:00:00Z", [1, 0]));
		inputs.gamePlayers.push(
			{ game_id: "g7", player_id: "d", team: "home" },
			{ game_id: "g7", player_id: "e", team: "away" },
		);

		const changes = diffPlan(computePlan(inputs), inputs);

		expect(changes.games.map((g) => g.id)).toEqual(["g7"]);
		expect(changes.profiles.map((p) => p.id).sort()).toEqual(["d", "e"]);
	});
});

describe("hashing", () => {
	it("ignores key order and treats Dates like their ISO strings", () => {
		expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
			'{"a":{"c":3,"d":2},"b":1}',
		);
		expect(hashOf({ at: new Date("2026-09-22T13:00:00Z") })).toBe(
			hashOf({ at: "2026-09-22T13:00:00.000Z" }),
		);
	});

	it("changes the input hash when a score changes, not when a snapshot does", () => {
		const inputs = fixture();
		const before = inputHash(inputs);
		inputs.games[0].elo_snapshot = { anything: true };
		expect(inputHash(inputs)).toBe(before);
		inputs.games[0].score_home = 3;
		expect(inputHash(inputs)).not.toBe(before);
	});
});

describe("recomputeLeagueElo", () => {
	beforeEach(() => {
		txClient.query.mockReset();
	});

	it("takes the advisory lock first and writes nothing while v2 is inactive", async () => {
		txClient.query.mockImplementation(async (sql) =>
			sql.includes("FROM app_state") ? { rows: [] } : { rows: [] },
		);

		const result = await recomputeLeagueElo();

		expect(result).toEqual({ status: "inactive" });
		const statements = txClient.query.mock.calls.map(([sql]) => sql);
		const lockIndex = statements.findIndex((s) => s.includes("pg_advisory_xact_lock"));
		const firstRead = statements.findIndex((s) => s.includes("FROM app_state"));
		expect(lockIndex).toBeGreaterThanOrEqual(0);
		expect(lockIndex).toBeLessThan(firstRead);
		expect(statements.some((s) => s.includes("UPDATE games"))).toBe(false);
	});

	it("never throws from the safe wrapper", async () => {
		txClient.query.mockRejectedValue(new Error("connection lost"));

		const result = await recomputeLeagueEloSafely({ reason: "test" });

		expect(result).toMatchObject({ status: "error", error: "connection lost" });
	});
});
