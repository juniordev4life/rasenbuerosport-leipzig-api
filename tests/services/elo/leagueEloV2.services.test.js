import { describe, expect, it } from "vitest";
import {
	computeDuoV2,
	computeMatchV2,
	goalDiffFactor,
	nextHandicap,
	roundZeroSum,
	sideStrength,
} from "../../../src/api/services/elo/leagueEloV2.services.js";
import { emptyStatsV2 } from "../../../src/api/services/elo/leagueEloV2Input.services.js";
import { replayLeagueEloV2 } from "../../../src/api/services/elo/leagueEloV2Replay.services.js";

const player = (playerId, rating, stats = {}) => ({
	playerId,
	rating,
	stats: { ...emptyStatsV2(), ...stats },
});
const deltas = (result) =>
	Object.fromEntries(result.rows.map((r) => [r.playerId, r.delta]));

// Expected deltas were computed by hand from the rulebook formulas (and
// re-checked with plain arithmetic), not by running this engine.
describe("computeMatchV2 — rulebook examples", () => {
	it("1v1 clear favourite wins 1:0: minimum win gives +1", () => {
		const result = computeMatchV2(
			{
				sides: [[player("A", 2200, { goals: 1 })], [player("B", 1300)]],
				score: [1, 0],
				shootoutWinner: null,
			},
			75,
		);
		expect(deltas(result)).toEqual({ A: 1, B: -1 });
	});

	it("1v1 favourite wins 3:1, loser saw red: G 1.5 plus side bonus", () => {
		const result = computeMatchV2(
			{
				sides: [
					[player("A", 1600, { goals: 3 })],
					[player("B", 1400, { goals: 1, redCards: 1 })],
				],
				score: [3, 1],
				shootoutWinner: null,
			},
			75,
		);
		expect(result.G).toBe(1.5);
		expect(result.bonus).toEqual([3, -3]);
		expect(deltas(result)).toEqual({ A: 15, B: -15 });
	});

	it("1v1 shootout win: S 0.6 and everything halved", () => {
		const result = computeMatchV2(
			{
				sides: [
					[player("A", 1500, { goals: 1, penaltiesScored: 1 })],
					[player("B", 1550, { goals: 2 })],
				],
				score: [2, 2],
				shootoutWinner: 0,
			},
			75,
		);
		expect(result.S).toEqual([0.6, 0.4]);
		expect(result.damping).toBe(0.5);
		expect(deltas(result)).toEqual({ A: 3, B: -3 });
	});

	it("2v2 winner despite a red card: the minimum win lifts A from -5 to +1", () => {
		const result = computeMatchV2(
			{
				sides: [
					[player("A", 1900, { redCards: 1 }), player("B", 1300, { goals: 2 })],
					[player("C", 1500, { goals: 1 }), player("D", 1500)],
				],
				score: [2, 1],
				shootoutWinner: null,
			},
			75,
		);
		// Losers cover the raise one point at a time, smallest loss first.
		expect(deltas(result)).toEqual({ A: 1, B: 19, C: -10, D: -10 });
	});

	it("2v2 contribution shift: whoever scores, saves and assists counts", () => {
		const result = computeMatchV2(
			{
				sides: [
					[
						player("A", 1700, { goals: 1, penaltiesMissed: 1 }),
						player("B", 1500, { assists: 1 }),
					],
					[
						player("C", 1400, { goals: 1, penaltiesScored: 1 }),
						player("D", 1400, { assists: 1, penaltiesSaved: 1 }),
					],
				],
				score: [1, 2],
				shootoutWinner: null,
			},
			75,
		);
		expect(deltas(result)).toEqual({ A: -22, B: -16, C: 18, D: 20 });
	});

	it("1v2 duo beats the favoured solo player: handicap on the duo side", () => {
		const match = {
			sides: [
				[player("S", 1650, { goals: 1 })],
				[player("C", 1500, { goals: 2 }), player("D", 1450, { assists: 1 })],
			],
			score: [1, 2],
			shootoutWinner: null,
		};
		const result = computeMatchV2(match, 75);
		expect(result.mode).toBe("1v2");
		expect(result.handicaps).toEqual([0, 75]);
		// Assists feed the duo's contribution shift, never the side bonus in 1v2.
		expect(result.bonus.map(Math.abs)).toEqual([0, 0]);
		expect(deltas(result)).toEqual({ S: -21, C: 11, D: 10 });
		expect(nextHandicap(75, result, match.sides)).toBe(76.3);
	});
});

describe("computeMatchV2 — invariants", () => {
	it("every match sums to zero", () => {
		const result = computeMatchV2(
			{
				sides: [
					[player("A", 1832), player("B", 1017)],
					[player("C", 1611, { redCards: 1 })],
				],
				score: [5, 2],
				shootoutWinner: null,
				extraRedCards: [0, 1],
			},
			81.4,
		);
		expect(result.rows.reduce((t, r) => t + r.delta, 0)).toBe(0);
	});

	it("caps the side bonus at ±5, including reds known only per side", () => {
		const result = computeMatchV2(
			{
				sides: [[player("A", 1500)], [player("B", 1500, { redCards: 1 })]],
				score: [2, 0],
				shootoutWinner: null,
				extraRedCards: [0, 2],
			},
			75,
		);
		expect(result.bonus).toEqual([5, -5]);
	});

	it("damps a repeated pairing in the same week by 0.8^(n-1)", () => {
		const base = {
			sides: [[player("A", 1500)], [player("B", 1500)]],
			score: [3, 0],
			shootoutWinner: null,
		};
		expect(computeMatchV2({ ...base, pairingGameNumber: 3 }, 75).repetition).toBeCloseTo(0.64);
	});

	it("treats a level score without a shootout as a draw", () => {
		const result = computeMatchV2(
			{
				sides: [[player("A", 1500)], [player("B", 1500)]],
				score: [1, 1],
				shootoutWinner: null,
			},
			75,
		);
		expect(result.S).toEqual([0.5, 0.5]);
		expect(result.winSide).toBeNull();
		expect(deltas(result)).toEqual({ A: 0, B: 0 });
	});
});

describe("helpers", () => {
	it("goalDiffFactor follows the G table", () => {
		expect([0, 1, 2, 3, 5].map(goalDiffFactor)).toEqual([1, 1, 1.5, 1.75, 2]);
	});

	it("sideStrength weights the stronger partner with α", () => {
		expect(sideStrength([1300, 1900], 0.6)).toBe(1660);
		expect(sideStrength([1450], 0.6)).toBe(1450);
	});

	it("roundZeroSum hands the residual to the largest rounding error", () => {
		expect(roundZeroSum([-20.3649, 10.6378, 9.7271])).toEqual([-21, 11, 10]);
	});
});

describe("computeDuoV2", () => {
	it("starts a new duo at its rounded side strength and keeps 2v2 zero-sum", () => {
		const sides = [
			[player("A", 1900), player("B", 1300)],
			[player("C", 1500), player("D", 1500)],
		];
		const result = computeMatchV2({ sides, score: [2, 1], shootoutWinner: null }, 75);
		const updates = computeDuoV2(result, sides, new Map(), 75);
		expect(updates.map((u) => [u.key, u.before, u.isNew])).toEqual([
			["A|B", 1660, true],
			["C|D", 1500, true],
		]);
		expect(updates[0].delta + updates[1].delta).toBe(0);
		expect(updates[0].delta).toBeGreaterThanOrEqual(1);
	});

	it("moves only the duo in a 1v2", () => {
		const sides = [[player("S", 1650)], [player("C", 1500), player("D", 1450)]];
		const result = computeMatchV2({ sides, score: [1, 2], shootoutWinner: null }, 75);
		const updates = computeDuoV2(result, sides, new Map(), 75);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({ key: "C|D", side: 1, before: 1480 });
	});
});

describe("replayLeagueEloV2", () => {
	it("carries ratings forward and learns the handicap from 1v2 games", () => {
		const unrated = (playerId, stats) => ({
			playerId,
			stats: { ...emptyStatsV2(), ...stats },
		});
		const matches = [
			{
				gameId: "g1",
				playedAt: "2026-09-21T10:00:00Z",
				sides: [[unrated("A")], [unrated("B")]],
				score: [3, 1],
				shootoutWinner: null,
			},
			{
				gameId: "g2",
				playedAt: "2026-09-22T10:00:00Z",
				sides: [[unrated("A")], [unrated("B"), unrated("C")]],
				score: [0, 1],
				shootoutWinner: null,
			},
		];
		const { players, duos, handicap, log } = replayLeagueEloV2(matches);
		const rowOfA = (entry) => entry.result.rows.find((r) => r.playerId === "A");
		expect(rowOfA(log[1]).ratingBefore).toBe(rowOfA(log[0]).ratingAfter);
		expect(players.get("A").games).toBe(2);
		expect(duos.get("B|C").games).toBe(1);
		expect(handicap).not.toBe(75);
		const total = [...players.values()].reduce((t, p) => t + p.rating, 0);
		expect(total).toBe(3 * 1500);
	});
});
