import { describe, expect, it } from "vitest";
import { computeMatchElo } from "../../../src/api/services/elo/eloEngine.services.js";

const equalPlayer = (id, stats) => ({
	playerId: id,
	rating: 1500,
	matchesPlayed: 50,
	stats,
});

describe("computeMatchElo — Szenario A: gleichstarkes 2v2, ein Carry", () => {
	it("verteilt den Sieg asymmetrisch zugunsten des Torschützen", () => {
		// Marco macht 3 Tore, Tobi nichts; Jonas trifft einmal, Nik gar nicht.
		const result = computeMatchElo({
			teamA: {
				goals: 3,
				players: [
					equalPlayer("marco", { goals: 3, assists: 0, redCards: [] }),
					equalPlayer("tobi", { goals: 0, assists: 0, redCards: [] }),
				],
			},
			teamB: {
				goals: 1,
				players: [
					equalPlayer("jonas", { goals: 1, assists: 0, redCards: [] }),
					equalPlayer("nik", { goals: 0, assists: 0, redCards: [] }),
				],
			},
			matchMinutes: 10,
		});

		// Marco gewinnt deutlich mehr als Tobi
		expect(result.teamA[0].delta).toBeGreaterThan(result.teamA[1].delta);
		expect(result.teamA[0].delta).toBeGreaterThan(0);
		expect(result.teamA[1].delta).toBeGreaterThan(0);
		// Auf der Verliererseite verliert Nik mehr als Jonas
		expect(result.teamB[1].delta).toBeLessThan(result.teamB[0].delta);
		expect(result.teamB[0].delta).toBeLessThan(0);
		expect(result.teamB[1].delta).toBeLessThan(0);
	});
});

describe("computeMatchElo — Szenario B: Favorit gewinnt erwartet", () => {
	it("löst nur kleine ELO-Bewegung aus", () => {
		const result = computeMatchElo({
			teamA: {
				goals: 2,
				players: [
					{
						playerId: "fav1",
						rating: 1700,
						matchesPlayed: 60,
						stats: { goals: 1, assists: 1, redCards: [] },
					},
					{
						playerId: "fav2",
						rating: 1700,
						matchesPlayed: 60,
						stats: { goals: 1, assists: 0, redCards: [] },
					},
				],
			},
			teamB: {
				goals: 1,
				players: [
					{
						playerId: "und1",
						rating: 1400,
						matchesPlayed: 60,
						stats: { goals: 1, assists: 0, redCards: [] },
					},
					{
						playerId: "und2",
						rating: 1400,
						matchesPlayed: 60,
						stats: { goals: 0, assists: 0, redCards: [] },
					},
				],
			},
		});

		// Favoriten bewegen sich kaum (Sieg ist erwartet, plus Dampening)
		for (const r of result.teamA) {
			expect(r.delta).toBeGreaterThan(0);
			expect(r.delta).toBeLessThan(10);
		}
		// Underdogs verlieren wenig
		for (const r of result.teamB) {
			expect(r.delta).toBeLessThan(0);
			expect(r.delta).toBeGreaterThan(-10);
		}
	});
});

describe("computeMatchElo — Szenario C: Upset, Underdog gewinnt", () => {
	it("löst große ELO-Bewegung aus", () => {
		const result = computeMatchElo({
			teamA: {
				goals: 1,
				players: [
					{
						playerId: "fav1",
						rating: 1700,
						matchesPlayed: 60,
						stats: { goals: 1, assists: 0, redCards: [] },
					},
					{
						playerId: "fav2",
						rating: 1700,
						matchesPlayed: 60,
						stats: { goals: 0, assists: 0, redCards: [] },
					},
				],
			},
			teamB: {
				goals: 2,
				players: [
					{
						playerId: "und1",
						rating: 1400,
						matchesPlayed: 60,
						stats: { goals: 1, assists: 1, redCards: [] },
					},
					{
						playerId: "und2",
						rating: 1400,
						matchesPlayed: 60,
						stats: { goals: 1, assists: 0, redCards: [] },
					},
				],
			},
		});

		// Alle Underdogs gewinnen ELO, mindestens der Carry kräftig
		for (const r of result.teamB) {
			expect(r.delta).toBeGreaterThan(0);
		}
		const topUnderdog = Math.max(...result.teamB.map((r) => r.delta));
		expect(topUnderdog).toBeGreaterThan(15);
		// Summe der Underdog-Deltas sollte deutlich größer sein als beim
		// "Favorit gewinnt erwartet"-Szenario (das sich pro Spieler unter 10
		// bewegt — Summe maximal ~20)
		const undSum = result.teamB.reduce((acc, r) => acc + r.delta, 0);
		expect(undSum).toBeGreaterThan(30);

		// Favoriten-Verlust → spiegelbildlich große negative Bewegung
		for (const r of result.teamA) {
			expect(r.delta).toBeLessThan(0);
		}
		const favSum = result.teamA.reduce((acc, r) => acc + r.delta, 0);
		expect(favSum).toBeLessThan(-30);
	});
});

describe("computeMatchElo — Szenario D: frühe Rote Karte führt zur Niederlage", () => {
	it("bestraft den Spieler mit der frühen Roten am stärksten", () => {
		const result = computeMatchElo({
			teamA: {
				goals: 0,
				players: [
					equalPlayer("redPlayer", {
						goals: 0,
						assists: 0,
						redCards: [{ minute: 2 }],
					}),
					equalPlayer("partner", { goals: 0, assists: 0, redCards: [] }),
				],
			},
			teamB: {
				goals: 3,
				players: [
					equalPlayer("opp1", { goals: 2, assists: 1, redCards: [] }),
					equalPlayer("opp2", { goals: 1, assists: 1, redCards: [] }),
				],
			},
			matchMinutes: 10,
		});

		const redPlayer = result.teamA.find((r) => r.playerId === "redPlayer");
		const partner = result.teamA.find((r) => r.playerId === "partner");
		// Der Rote-Karten-Spieler verliert mehr — sein Beitrag ist negativ
		expect(redPlayer.delta).toBeLessThan(partner.delta);
		// Beide verlieren
		expect(redPlayer.delta).toBeLessThan(0);
		expect(partner.delta).toBeLessThan(0);
	});
});

describe("computeMatchElo — Szenario E: späte Rote Karte ohne Spielentscheidung", () => {
	it("bestraft den Roten-Karten-Spieler nur leicht", () => {
		// Späte Rote in einem ausgeglichenen Spiel sollte kaum auffallen
		const result = computeMatchElo({
			teamA: {
				goals: 2,
				players: [
					equalPlayer("late", {
						goals: 1,
						assists: 0,
						redCards: [{ minute: 9 }],
					}),
					equalPlayer("partner", { goals: 1, assists: 0, redCards: [] }),
				],
			},
			teamB: {
				goals: 1,
				players: [
					equalPlayer("opp1", { goals: 1, assists: 0, redCards: [] }),
					equalPlayer("opp2", { goals: 0, assists: 0, redCards: [] }),
				],
			},
			matchMinutes: 10,
		});

		const late = result.teamA.find((r) => r.playerId === "late");
		const partner = result.teamA.find((r) => r.playerId === "partner");
		// Beide gewinnen ELO trotz Rote Karte (späte Rote, Match gewonnen)
		expect(late.delta).toBeGreaterThan(0);
		expect(partner.delta).toBeGreaterThan(0);
		// Aber der Rote-Karten-Spieler verliert leicht gegenüber dem Partner
		// (Contribution wird durch späte Rote minimal gedrückt)
		expect(late.contribution).toBeLessThan(partner.contribution + 1);
	});
});

describe("computeMatchElo — Szenario F: 1v1", () => {
	it("kollabiert zu klassischem 1v1-ELO ohne Asymmetrie", () => {
		const result = computeMatchElo({
			teamA: {
				goals: 2,
				players: [
					{
						playerId: "p1",
						rating: 1500,
						matchesPlayed: 60,
						stats: { goals: 2, assists: 0, redCards: [] },
					},
				],
			},
			teamB: {
				goals: 1,
				players: [
					{
						playerId: "p2",
						rating: 1500,
						matchesPlayed: 60,
						stats: { goals: 1, assists: 0, redCards: [] },
					},
				],
			},
		});

		expect(result.teamA).toHaveLength(1);
		expect(result.teamB).toHaveLength(1);
		expect(result.teamA[0].share).toBe(1.0);
		expect(result.teamB[0].share).toBe(1.0);
		// 1v1: Spieler-Delta entspricht dem Team-Delta exakt
		expect(result.teamA[0].delta).toBeCloseTo(
			result.matchMeta.teamDeltaA,
			1,
		);
	});
});

describe("computeMatchElo — Sanity-Checks", () => {
	it("Summe der Spieler-Deltas pro Team entspricht 2 × Team-Delta", () => {
		const result = computeMatchElo({
			teamA: {
				goals: 3,
				players: [
					equalPlayer("a1", { goals: 3, assists: 0, redCards: [] }),
					equalPlayer("a2", { goals: 0, assists: 0, redCards: [] }),
				],
			},
			teamB: {
				goals: 1,
				players: [
					equalPlayer("b1", { goals: 1, assists: 0, redCards: [] }),
					equalPlayer("b2", { goals: 0, assists: 0, redCards: [] }),
				],
			},
		});

		const sumA = result.teamA.reduce((acc, r) => acc + r.delta, 0);
		const sumB = result.teamB.reduce((acc, r) => acc + r.delta, 0);
		expect(sumA).toBeCloseTo(result.matchMeta.teamDeltaA * 2, 0);
		expect(sumB).toBeCloseTo(result.matchMeta.teamDeltaB * 2, 0);
	});

	it("Ratings werden auf ganze Zahlen gerundet", () => {
		const result = computeMatchElo({
			teamA: {
				goals: 2,
				players: [
					equalPlayer("a", { goals: 2, assists: 0, redCards: [] }),
				],
			},
			teamB: {
				goals: 1,
				players: [
					equalPlayer("b", { goals: 1, assists: 0, redCards: [] }),
				],
			},
		});
		expect(Number.isInteger(result.teamA[0].ratingAfter)).toBe(true);
		expect(Number.isInteger(result.teamB[0].ratingAfter)).toBe(true);
	});

	it("Version-Stempel ist auf der Antwort", () => {
		const result = computeMatchElo({
			teamA: {
				goals: 1,
				players: [
					equalPlayer("a", { goals: 1, assists: 0, redCards: [] }),
				],
			},
			teamB: {
				goals: 0,
				players: [
					equalPlayer("b", { goals: 0, assists: 0, redCards: [] }),
				],
			},
		});
		expect(result.version).toMatch(/^v\d+\.\d+$/);
	});
});
