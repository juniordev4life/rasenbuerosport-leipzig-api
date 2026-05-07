import { describe, expect, it } from "vitest";
import {
	computePlayerWeekStatsPure,
	computeProgress,
	currentValueFor,
	getWeekRangeBerlin,
	pickChallengesForWeek,
} from "../../../src/api/helpers/challenges.helpers.js";
import {
	buildGoalEvent,
	buildMockGame,
	buildPenaltyMissedEvent,
	buildRedCardEvent,
} from "../../test-utils.js";

describe("getWeekRangeBerlin", () => {
	it("anchors a Monday afternoon onto the same week's Mon-Sun", () => {
		// Monday 2026-05-04 14:00 Berlin = 12:00 UTC (CEST)
		const range = getWeekRangeBerlin(new Date("2026-05-04T12:00:00Z"));
		expect(range).toEqual({ weekStart: "2026-05-04", weekEnd: "2026-05-10" });
	});

	it("rolls Sunday late-night Berlin into the same week (not the next)", () => {
		// Sunday 2026-05-10 23:30 Berlin = 21:30 UTC (CEST)
		const range = getWeekRangeBerlin(new Date("2026-05-10T21:30:00Z"));
		expect(range.weekStart).toBe("2026-05-04");
		expect(range.weekEnd).toBe("2026-05-10");
	});

	it("handles the spring DST transition (+01 → +02 last Sunday in March)", () => {
		// 2026 spring-forward: Sun 2026-03-29 02:00 Berlin → 03:00 Berlin
		// A reference of Mon 2026-03-30 12:00 Berlin should still round
		// to the week starting 2026-03-30 (Mon).
		const range = getWeekRangeBerlin(new Date("2026-03-30T10:00:00Z"));
		expect(range).toEqual({ weekStart: "2026-03-30", weekEnd: "2026-04-05" });
	});

	it("handles the autumn DST transition (+02 → +01 last Sunday in October)", () => {
		// 2026 fall-back: Sun 2026-10-25
		const range = getWeekRangeBerlin(new Date("2026-10-26T10:00:00Z"));
		expect(range).toEqual({ weekStart: "2026-10-26", weekEnd: "2026-11-01" });
	});

	it("returns the same range for any reference within the same Berlin week", () => {
		const monday = getWeekRangeBerlin(new Date("2026-05-04T08:00:00Z"));
		const wednesday = getWeekRangeBerlin(new Date("2026-05-06T17:00:00Z"));
		const sunday = getWeekRangeBerlin(new Date("2026-05-10T20:00:00Z"));
		expect(monday).toEqual(wednesday);
		expect(wednesday).toEqual(sunday);
	});
});

describe("computePlayerWeekStatsPure", () => {
	const userId = "u1";

	it("returns zeros for an empty games list", () => {
		const stats = computePlayerWeekStatsPure([], {}, userId);
		expect(stats).toEqual({
			goals_scored: 0,
			clean_sheets: 0,
			wins: 0,
			games_played: 0,
			hattricks: 0,
			comeback_wins: 0,
			duo_wins: 0,
		});
	});

	it("counts goals via scored_by in 2v2", () => {
		// Arrange
		const game = buildMockGame({
			id: "g1",
			mode: "2v2",
			score_home: 3,
			score_away: 1,
			score_timeline: [
				buildGoalEvent({ scored_by: userId }),
				buildGoalEvent({ scored_by: userId, minute: 30 }),
				buildGoalEvent({ scored_by: "u2", minute: 60 }),
				buildGoalEvent({
					scored_by: "u3",
					team: "away",
					minute: 80,
				}),
			],
		});

		// Act
		const stats = computePlayerWeekStatsPure(
			[game],
			{ g1: "home" },
			userId,
		);

		// Assert
		expect(stats.goals_scored).toBe(2);
		expect(stats.wins).toBe(1);
		expect(stats.games_played).toBe(1);
	});

	it("falls back to team score in legacy 1v1 with no scored_by", () => {
		// Arrange
		const game = buildMockGame({
			id: "g1",
			mode: "1v1",
			score_home: 4,
			score_away: 2,
			score_timeline: null,
		});

		// Act
		const stats = computePlayerWeekStatsPure(
			[game],
			{ g1: "home" },
			userId,
		);

		// Assert
		expect(stats.goals_scored).toBe(4);
		expect(stats.hattricks).toBe(1);
	});

	it("counts clean sheets only on wins where opponent is held to zero", () => {
		// Arrange
		const games = [
			buildMockGame({ id: "g1", mode: "1v1", score_home: 2, score_away: 0 }),
			buildMockGame({ id: "g2", mode: "1v1", score_home: 0, score_away: 0 }),
			buildMockGame({ id: "g3", mode: "1v1", score_home: 1, score_away: 1 }),
		];

		// Act
		const stats = computePlayerWeekStatsPure(
			games,
			{ g1: "home", g2: "home", g3: "home" },
			userId,
		);

		// Assert — only g1 qualifies (win + no goal conceded)
		expect(stats.clean_sheets).toBe(1);
	});

	it("counts duo wins for 2v2 mode wins only", () => {
		// Arrange
		const games = [
			buildMockGame({ id: "g1", mode: "2v2", score_home: 3, score_away: 1 }),
			buildMockGame({ id: "g2", mode: "1v1", score_home: 2, score_away: 0 }),
		];

		// Act
		const stats = computePlayerWeekStatsPure(
			games,
			{ g1: "home", g2: "home" },
			userId,
		);

		// Assert
		expect(stats.duo_wins).toBe(1);
		expect(stats.wins).toBe(2);
	});

	it("detects comebacks when the user's side trailed by 2+", () => {
		// Arrange — opponent goes 2-0, user's home side wins 3-2
		const game = buildMockGame({
			id: "g1",
			mode: "2v2",
			score_home: 3,
			score_away: 2,
			score_timeline: [
				buildGoalEvent({ team: "away", scored_by: "u2", minute: 5 }),
				buildGoalEvent({ team: "away", scored_by: "u2", minute: 20 }),
				buildGoalEvent({ team: "home", scored_by: userId, minute: 50 }),
				buildGoalEvent({ team: "home", scored_by: userId, minute: 70 }),
				buildGoalEvent({ team: "home", scored_by: userId, minute: 88 }),
			],
		});

		// Act
		const stats = computePlayerWeekStatsPure(
			[game],
			{ g1: "home" },
			userId,
		);

		// Assert
		expect(stats.comeback_wins).toBe(1);
	});

	it("ignores red-card and missed-penalty events when counting goals", () => {
		// Arrange
		const game = buildMockGame({
			id: "g1",
			mode: "2v2",
			score_home: 1,
			score_away: 0,
			score_timeline: [
				buildGoalEvent({ scored_by: userId }),
				buildRedCardEvent({ player_id: userId }),
				buildPenaltyMissedEvent({ shooter_id: userId }),
			],
		});

		// Act
		const stats = computePlayerWeekStatsPure(
			[game],
			{ g1: "home" },
			userId,
		);

		// Assert — only the goal counts toward goals_scored
		expect(stats.goals_scored).toBe(1);
	});
});

describe("currentValueFor", () => {
	it("reads the metric out of the stats object", () => {
		const stats = {
			goals_scored: 3,
			clean_sheets: 1,
			wins: 2,
			games_played: 4,
			hattricks: 0,
			comeback_wins: 0,
			duo_wins: 1,
		};
		expect(currentValueFor("goals_scored", stats)).toBe(3);
		expect(currentValueFor("clean_sheets", stats)).toBe(1);
		expect(currentValueFor("duo_wins", stats)).toBe(1);
	});

	it("returns 0 for unknown metrics", () => {
		expect(currentValueFor("unknown_metric", { goals_scored: 5 })).toBe(0);
	});
});

describe("computeProgress", () => {
	it("marks completed when current >= target", () => {
		const stats = computePlayerWeekStatsPure([], {}, "u1");
		stats.goals_scored = 7;
		expect(
			computeProgress({ metric: "goals_scored", target_value: 5 }, stats),
		).toEqual({ current: 7, target: 5, completed: true });
	});

	it("marks not-completed when below target", () => {
		const stats = computePlayerWeekStatsPure([], {}, "u1");
		stats.wins = 1;
		expect(computeProgress({ metric: "wins", target_value: 3 }, stats)).toEqual(
			{ current: 1, target: 3, completed: false },
		);
	});
});

describe("pickChallengesForWeek", () => {
	const definitions = [
		{ id: "e1", difficulty: "easy" },
		{ id: "e2", difficulty: "easy" },
		{ id: "e3", difficulty: "easy" },
		{ id: "m1", difficulty: "medium" },
		{ id: "m2", difficulty: "medium" },
		{ id: "h1", difficulty: "hard" },
		{ id: "h2", difficulty: "hard" },
	];

	it("returns 3 picks by default", () => {
		const picks = pickChallengesForWeek(definitions, "2026-05-04");
		expect(picks).toHaveLength(3);
	});

	it("is deterministic for the same weekStart", () => {
		const a = pickChallengesForWeek(definitions, "2026-05-04");
		const b = pickChallengesForWeek(definitions, "2026-05-04");
		expect(a.map((d) => d.id)).toEqual(b.map((d) => d.id));
	});

	it("returns different picks for different weeks", () => {
		const a = pickChallengesForWeek(definitions, "2026-05-04");
		const b = pickChallengesForWeek(definitions, "2026-05-11");
		expect(a.map((d) => d.id)).not.toEqual(b.map((d) => d.id));
	});

	it("favours one easy / one medium / one hard when all buckets have entries", () => {
		const picks = pickChallengesForWeek(definitions, "2026-05-04");
		const difficulties = picks.map((p) => p.difficulty).sort();
		expect(difficulties).toEqual(["easy", "hard", "medium"]);
	});

	it("falls back gracefully when a bucket is empty", () => {
		const onlyEasy = [
			{ id: "e1", difficulty: "easy" },
			{ id: "e2", difficulty: "easy" },
		];
		const picks = pickChallengesForWeek(onlyEasy, "2026-05-04", 3);
		expect(picks).toHaveLength(2);
		expect(picks.every((p) => p.difficulty === "easy")).toBe(true);
	});

	it("returns an empty array for an empty definition list", () => {
		expect(pickChallengesForWeek([], "2026-05-04")).toEqual([]);
	});
});
