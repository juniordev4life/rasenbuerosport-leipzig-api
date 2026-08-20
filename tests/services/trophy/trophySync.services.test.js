import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/api/helpers/database.helpers.js", () => ({
	query: vi.fn(async () => []),
	queryOne: vi.fn(async () => null),
}));

import { query } from "../../../src/api/helpers/database.helpers.js";
import {
	mergeTrophies,
	syncPlayerTrophies,
} from "../../../src/api/services/trophy/trophySync.services.js";

/** Routes the batched duo read to `rows`, everything else to []. */
const duoRows = (rows) => async (sql) =>
	sql.includes("FROM duo_trophies") ? rows : [];

const NOW = "2026-08-21T10:00:00.000Z";

/** A 2v2 win for the home side, with `me` and `mate` playing together. */
const sharedWin = (id, me, mate) => ({
	id,
	playedAt: new Date("2026-06-01"),
	mode: "2v2",
	winnerSide: "home",
	homePlayers: [me, mate],
	awayPlayers: ["opp-1", "opp-2"],
	goals: [],
	redCards: [],
	penaltyShootout: null,
	eloAfter: {},
});

describe("mergeTrophies", () => {
	it("adds a missing unlock with the given timestamp", () => {
		const { next, newCount } = mergeTrophies(
			{},
			[{ trophyId: "DU1", triggeredByMatchId: "m-1" }],
			NOW,
		);

		expect(newCount).toBe(1);
		expect(next.DU1).toEqual({
			unlocked_at: NOW,
			triggered_by_match_id: "m-1",
			backfilled: false,
		});
	});

	it("never overwrites an existing entry", () => {
		// Add-only is what keeps unlock dates stable — and what wrapped.services
		// relies on for its "trophies this week" section.
		const existing = {
			DU1: { unlocked_at: "2026-05-29T16:54:42.225Z", backfilled: true },
		};
		const { next, newCount } = mergeTrophies(
			existing,
			[{ trophyId: "DU1", triggeredByMatchId: "m-9" }],
			NOW,
		);

		expect(newCount).toBe(0);
		expect(next.DU1.unlocked_at).toBe("2026-05-29T16:54:42.225Z");
	});

	it("marks backfill runs so they stay distinguishable", () => {
		const { next } = mergeTrophies({}, [{ trophyId: "W1" }], NOW, true);
		expect(next.W1.backfilled).toBe(true);
	});

	it("tolerates a null map", () => {
		expect(mergeTrophies(null, [], NOW).next).toEqual({});
	});
});

describe("syncPlayerTrophies", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		query.mockResolvedValue([]);
	});

	it("grants and persists a trophy the player has earned but never had stored", async () => {
		// DU4 "Flexibel" — win with 5 different partners. This is the exact case
		// from the report: the progress bar read 5/5 while the badge stayed grey,
		// because nothing evaluated trophies outside the manual backfill script.
		const map = await syncPlayerTrophies({
			playerId: "me",
			matches: [],
			stats: { distinctWinningPartners: 5 },
			trophiesMap: null,
			now: NOW,
		});

		expect(map.DU4).toMatchObject({ unlocked_at: NOW, backfilled: false });
		const update = query.mock.calls.find(([sql]) =>
			sql.includes("UPDATE profiles SET trophies"),
		);
		expect(update).toBeDefined();
		expect(JSON.parse(update[1][0]).DU4).toBeDefined();
		expect(update[1][1]).toBe("me");
	});

	it("writes nothing when there is nothing new", async () => {
		await syncPlayerTrophies({
			playerId: "me",
			matches: [],
			stats: {},
			trophiesMap: {},
			now: NOW,
		});

		expect(
			query.mock.calls.some(([sql]) => sql.includes("UPDATE profiles")),
		).toBe(false);
	});

	it("surfaces a duo unlock in the player-level map", async () => {
		// duo_trophies is keyed by pair and was never read by src/ — the profile
		// reported "0 von 5 erreicht" while unlocks sat in the table since May.
		const matches = Array.from({ length: 10 }, (_, i) =>
			sharedWin(`m-${i}`, "me", "mate"),
		);

		const map = await syncPlayerTrophies({
			playerId: "me",
			matches,
			stats: {},
			trophiesMap: {},
			now: NOW,
		});

		expect(map.DU1).toMatchObject({ unlocked_at: NOW });
		const upsert = query.mock.calls.find(([sql]) =>
			sql.includes("INSERT INTO duo_trophies"),
		);
		expect(upsert).toBeDefined();
	});

	it("keys the duo row by the sorted pair, whichever player asks", async () => {
		// migrations/022 has a unique constraint on (player1_id, player2_id);
		// an unsorted key would create a second, mirrored row for the same duo.
		const matches = Array.from({ length: 10 }, (_, i) =>
			sharedWin(`m-${i}`, "zeta", "alpha"),
		);

		await syncPlayerTrophies({
			playerId: "zeta",
			matches,
			stats: {},
			trophiesMap: {},
			now: NOW,
		});

		const upsert = query.mock.calls.find(([sql]) =>
			sql.includes("INSERT INTO duo_trophies"),
		);
		expect(upsert[1].slice(0, 2)).toEqual(["alpha", "zeta"]);
	});

	it("keeps the earliest unlock when two pairs earned the same trophy", async () => {
		const earlier = "2026-05-29T16:54:42.225Z";
		query.mockImplementation(
			duoRows([
				{
					player1_id: "alpha",
					player2_id: "me",
					trophies: { DU1: { unlocked_at: earlier, backfilled: true } },
				},
			]),
		);
		const matches = [
			...Array.from({ length: 10 }, (_, i) => sharedWin(`a-${i}`, "me", "alpha")),
			...Array.from({ length: 10 }, (_, i) => sharedWin(`b-${i}`, "me", "zulu")),
		];

		const map = await syncPlayerTrophies({
			playerId: "me",
			matches,
			stats: {},
			trophiesMap: {},
			now: NOW,
		});

		expect(map.DU1.unlocked_at).toBe(earlier);
	});
});

describe("syncPlayerTrophies — Abfrage-Aufwand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		query.mockResolvedValue([]);
	});

	it("liest alle Paare des Spielers mit EINER Abfrage", async () => {
		// Ein Profilaufruf soll nicht eine Abfrage pro Partner auslösen.
		const matches = [
			sharedWin("m-1", "me", "a"),
			sharedWin("m-2", "me", "b"),
			sharedWin("m-3", "me", "c"),
		];

		await syncPlayerTrophies({
			playerId: "me",
			matches,
			stats: {},
			trophiesMap: {},
			now: NOW,
		});

		const reads = query.mock.calls.filter(([sql]) =>
			sql.includes("SELECT player1_id"),
		);
		expect(reads).toHaveLength(1);
		expect(reads[0][1]).toEqual(["me"]);
	});
});
