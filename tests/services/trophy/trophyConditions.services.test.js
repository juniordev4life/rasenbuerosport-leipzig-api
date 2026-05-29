import { describe, expect, it } from "vitest";
import { trophyConditions } from "../../../src/api/services/trophy/trophyConditions.services.js";

const emptyStats = () => ({
	matches: 0,
	wins: 0,
	losses: 0,
	draws: 0,
	goals: 0,
	assists: 0,
	cleanSheets: 0,
	peakElo: 0,
	maxWinStreak: 0,
	maxCleanSheetStreak: 0,
	maxSameScoreStreak: 0,
	maxGoalsInMatch: 0,
	maxAssistsInMatch: 0,
	maxScorerPointsInMatch: 0,
	maxPenaltiesSavedInShootout: 0,
	hasCleanSheetWin: false,
	hasGoalDifferenceWin5Plus: false,
	hasGoalDifferenceExactWin1: false,
	hasTotalGoalsInMatchWin8Plus: false,
	hasComebackWin3Plus: false,
	hasLateWinner90: false,
	hasLateWinnerExtraTime: false,
	hasPerfectPenaltyShootout: false,
	hasPenaltyShootoutWin: false,
	hasEarlyConceded: false,
	hasRedCardWin: false,
	hasMidnightMatch: false,
	hasUnluckyShootout4: false,
	hadEndedLossStreak5Plus: false,
	winningPartners: new Set(),
	h2hWinsByOpponent: {},
	h2hMatchesByOpponent: {},
	duoWinsByPartner: {},
	duoMatchesByPartner: {},
	bestDayWins: 0,
	bestWeekMatchesNoLoss: 0,
	maxHattricksInDay: 0,
	distinctWinningPartners: 0,
});

describe("threshold-driven aggregate conditions", () => {
	it("totalWins true once stats.wins meets the threshold", () => {
		const stats = { ...emptyStats(), wins: 100 };
		expect(trophyConditions.totalWins({ stats, params: { threshold: 100 } })).toBe(true);
		expect(trophyConditions.totalWins({ stats, params: { threshold: 101 } })).toBe(false);
	});

	it("totalGoals / totalAssists / totalMatches behave the same way", () => {
		const stats = {
			...emptyStats(),
			goals: 500,
			assists: 250,
			matches: 1000,
			cleanSheets: 50,
		};
		expect(trophyConditions.totalGoals({ stats, params: { threshold: 500 } })).toBe(true);
		expect(trophyConditions.totalAssists({ stats, params: { threshold: 250 } })).toBe(true);
		expect(trophyConditions.totalMatches({ stats, params: { threshold: 1000 } })).toBe(true);
		expect(trophyConditions.totalCleanSheets({ stats, params: { threshold: 50 } })).toBe(true);
	});

	it("peakElo respects the threshold gate", () => {
		expect(
			trophyConditions.peakElo({
				stats: { ...emptyStats(), peakElo: 2100 },
				params: { threshold: 2100 },
			}),
		).toBe(true);
		expect(
			trophyConditions.peakElo({
				stats: { ...emptyStats(), peakElo: 2099 },
				params: { threshold: 2100 },
			}),
		).toBe(false);
	});
});

describe("winRate", () => {
	it("requires the minMatches floor before the rate gate engages", () => {
		const stats = { ...emptyStats(), wins: 40, matches: 49 };
		// 40/49 = ~0.82 — high rate, but matches < 50
		expect(
			trophyConditions.winRate({ stats, params: { rate: 0.7, minMatches: 50 } }),
		).toBe(false);
	});

	it("passes once both floor and rate are met", () => {
		const stats = { ...emptyStats(), wins: 70, matches: 100 };
		expect(
			trophyConditions.winRate({ stats, params: { rate: 0.7, minMatches: 50 } }),
		).toBe(true);
	});

	it("guards against division by zero on a zero-match profile", () => {
		const stats = { ...emptyStats(), wins: 0, matches: 0 };
		expect(
			trophyConditions.winRate({ stats, params: { rate: 0.7, minMatches: 0 } }),
		).toBe(false);
	});
});

describe("match-shape conditions resolved from aggregate maxima", () => {
	it("goalsInMatch passes once any past match hit the threshold", () => {
		const stats = { ...emptyStats(), maxGoalsInMatch: 7 };
		expect(trophyConditions.goalsInMatch({ stats, params: { threshold: 5 } })).toBe(true);
		expect(trophyConditions.goalsInMatch({ stats, params: { threshold: 8 } })).toBe(false);
	});

	it("scorerPointsInMatch combines goals + assists via the max", () => {
		const stats = { ...emptyStats(), maxScorerPointsInMatch: 10 };
		expect(
			trophyConditions.scorerPointsInMatch({ stats, params: { threshold: 10 } }),
		).toBe(true);
	});
});

describe("flag-driven match shapes", () => {
	it("cleanSheetWin tracks the pre-computed boolean", () => {
		const stats = { ...emptyStats(), hasCleanSheetWin: true };
		expect(trophyConditions.cleanSheetWin({ stats, params: {} })).toBe(true);
	});

	it("lateWinner returns the right branch per minute range", () => {
		const stats = {
			...emptyStats(),
			hasLateWinner90: true,
			hasLateWinnerExtraTime: false,
		};
		expect(
			trophyConditions.lateWinner({
				stats,
				params: { minMinute: 90, maxMinute: 90 },
			}),
		).toBe(true);
		expect(
			trophyConditions.lateWinner({
				stats,
				params: { minMinute: 91, maxMinute: 120 },
			}),
		).toBe(false);
	});
});

describe("H2H comparator-driven conditions", () => {
	it("h2hWins compares against the max wins-vs-single-opponent", () => {
		const stats = {
			...emptyStats(),
			h2hWinsByOpponent: { alice: 12, bob: 25, carol: 9 },
		};
		expect(trophyConditions.h2hWins({ stats, params: { threshold: 25 } })).toBe(true);
		expect(trophyConditions.h2hWins({ stats, params: { threshold: 26 } })).toBe(false);
	});

	it("h2hMatches compares against the max total-matches-vs-opponent", () => {
		const stats = {
			...emptyStats(),
			h2hMatchesByOpponent: { alice: 40, bob: 50 },
		};
		expect(trophyConditions.h2hMatches({ stats, params: { threshold: 50 } })).toBe(true);
	});

	it("h2hWins returns false for an empty map without throwing on Math.max([])", () => {
		expect(
			trophyConditions.h2hWins({
				stats: { ...emptyStats(), h2hWinsByOpponent: {} },
				params: { threshold: 1 },
			}),
		).toBe(false);
	});
});

describe("duo aggregates", () => {
	it("duoWins reads the best partner's win count", () => {
		const stats = {
			...emptyStats(),
			duoWinsByPartner: { jay: 25, florAln: 12 },
		};
		expect(trophyConditions.duoWins({ stats, params: { threshold: 25 } })).toBe(true);
	});

	it("duoWinRate gates on both minMatches and rate", () => {
		const stats = {
			...emptyStats(),
			duoMatchesByPartner: { jay: 20, florAln: 5 },
			duoWinsByPartner: { jay: 16, florAln: 5 },
		};
		// jay: 16/20 = 0.8 + 20 ≥ 20 → pass
		expect(
			trophyConditions.duoWinRate({
				stats,
				params: { rate: 0.8, minMatches: 20 },
			}),
		).toBe(true);
	});

	it("duoWinRate rejects when no partner crosses the floor", () => {
		const stats = {
			...emptyStats(),
			duoMatchesByPartner: { jay: 10, florAln: 5 },
			duoWinsByPartner: { jay: 10, florAln: 5 },
		};
		expect(
			trophyConditions.duoWinRate({
				stats,
				params: { rate: 0.8, minMatches: 20 },
			}),
		).toBe(false);
	});
});

describe("day / week clusters", () => {
	it("perfectDay reads the best loss-free day", () => {
		const stats = { ...emptyStats(), bestDayWins: 5 };
		expect(trophyConditions.perfectDay({ stats, params: { minWins: 5 } })).toBe(true);
		expect(trophyConditions.perfectDay({ stats, params: { minWins: 6 } })).toBe(false);
	});

	it("perfectWeek reads the best loss-free week match count", () => {
		const stats = { ...emptyStats(), bestWeekMatchesNoLoss: 10 };
		expect(
			trophyConditions.perfectWeek({ stats, params: { minMatches: 10 } }),
		).toBe(true);
	});
});

describe("rollercoaster — uses chronological replay", () => {
	const playerId = "alice";

	const homeGoal = (extras = {}) => ({
		scorerId: extras.scorerId ?? "carol",
		side: "home",
		minute: extras.minute ?? 30,
		period: "regular",
	});
	const awayGoal = (extras = {}) => ({
		scorerId: extras.scorerId ?? "alice",
		side: "away",
		minute: extras.minute ?? 30,
		period: "regular",
	});

	it("returns true when a match swung 3+ both ways for the player", () => {
		// Home leads 3:0, alice's away team turns it into 3:6.
		const goals = [
			homeGoal({ minute: 10 }),
			homeGoal({ minute: 20 }),
			homeGoal({ minute: 30 }),
			awayGoal({ minute: 50 }),
			awayGoal({ minute: 60 }),
			awayGoal({ minute: 70 }),
			awayGoal({ minute: 80 }),
			awayGoal({ minute: 85 }),
			awayGoal({ minute: 89 }),
		];
		const matches = [
			{
				id: "m1",
				homePlayers: ["carol", "dan"],
				awayPlayers: ["alice", "bob"],
				winnerSide: "away",
				scoreHome: 3,
				scoreAway: 6,
				goals,
			},
		];
		expect(
			trophyConditions.rollercoaster({
				matches,
				playerId,
				params: { swing: 3 },
			}),
		).toBe(true);
	});

	it("returns false when only one swing direction reached the threshold", () => {
		// Alice's side wins 3:0 — they led, but never trailed.
		const goals = [
			awayGoal({ minute: 10 }),
			awayGoal({ minute: 20 }),
			awayGoal({ minute: 30 }),
		];
		const matches = [
			{
				id: "m2",
				homePlayers: ["carol"],
				awayPlayers: ["alice"],
				winnerSide: "away",
				scoreHome: 0,
				scoreAway: 3,
				goals,
			},
		];
		expect(
			trophyConditions.rollercoaster({
				matches,
				playerId,
				params: { swing: 3 },
			}),
		).toBe(false);
	});
});

describe("h2hComeback — chronological saldo replay", () => {
	it("detects when a saldo flipped from <= -5 to > 0 against the same opponent", () => {
		const matches = [];
		// alice loses 5 straight to bob
		for (let i = 0; i < 5; i += 1) {
			matches.push({
				id: `loss-${i}`,
				homePlayers: ["bob"],
				awayPlayers: ["alice"],
				winnerSide: "home",
				scoreHome: 1,
				scoreAway: 0,
				goals: [],
			});
		}
		// then alice wins 6 in a row
		for (let i = 0; i < 6; i += 1) {
			matches.push({
				id: `win-${i}`,
				homePlayers: ["bob"],
				awayPlayers: ["alice"],
				winnerSide: "away",
				scoreHome: 0,
				scoreAway: 1,
				goals: [],
			});
		}
		expect(
			trophyConditions.h2hComeback({
				matches,
				playerId: "alice",
				params: { minDeficit: 5 },
			}),
		).toBe(true);
	});

	it("returns false when the saldo never crossed back to positive", () => {
		const matches = [
			{
				id: "m1",
				homePlayers: ["bob"],
				awayPlayers: ["alice"],
				winnerSide: "home",
				scoreHome: 1,
				scoreAway: 0,
				goals: [],
			},
		];
		expect(
			trophyConditions.h2hComeback({
				matches,
				playerId: "alice",
				params: { minDeficit: 5 },
			}),
		).toBe(false);
	});
});
