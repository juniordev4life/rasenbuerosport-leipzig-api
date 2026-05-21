import { describe, expect, it } from "vitest";
import {
	buildMatchInputFromGame,
	extractPlayerStats,
	matchMinutesForResultType,
} from "../../../src/api/services/elo/eloMatchInput.services.js";

describe("matchMinutesForResultType", () => {
	it("returns 90 for regular matches", () => {
		expect(matchMinutesForResultType("regular")).toBe(90);
	});

	it("returns 120 for extra time", () => {
		expect(matchMinutesForResultType("extra_time")).toBe(120);
	});

	it("returns 120 for penalty shootouts", () => {
		expect(matchMinutesForResultType("penalties")).toBe(120);
	});

	it("defaults to 90 for missing or unknown types", () => {
		expect(matchMinutesForResultType(null)).toBe(90);
		expect(matchMinutesForResultType(undefined)).toBe(90);
		expect(matchMinutesForResultType("foo")).toBe(90);
	});
});

describe("extractPlayerStats", () => {
	const timeline = [
		{ event_type: "goal", scored_by: "marco", minute: 14 },
		{
			event_type: "goal",
			scored_by: "marco",
			assist_by: "tobi",
			minute: 31,
		},
		{ event_type: "goal", scored_by: "jay", minute: 71 },
		{ event_type: "red_card", player_id: "jay", minute: 7 },
		{ event_type: "card", card_type: "red", player_id: "tobi", minute: 60 },
		{ event_type: "card", card_type: "yellow", player_id: "tobi", minute: 10 },
		{
			event_type: "goal",
			scored_by: "marco",
			goal_type: "own_goal",
			minute: 80,
		},
	];

	it("counts goals for the scoring player", () => {
		const stats = extractPlayerStats(timeline, "marco");
		expect(stats.goals).toBe(2); // own_goal in 80' is NOT counted
	});

	it("counts assists for the assisting player", () => {
		const stats = extractPlayerStats(timeline, "tobi");
		expect(stats.assists).toBe(1);
	});

	it("records red cards (both red_card and card+red types)", () => {
		const stats = extractPlayerStats(timeline, "jay");
		expect(stats.redCards).toEqual([{ minute: 7 }]);

		const tobiStats = extractPlayerStats(timeline, "tobi");
		expect(tobiStats.redCards).toEqual([{ minute: 60 }]);
	});

	it("ignores yellow cards", () => {
		const stats = extractPlayerStats(timeline, "tobi");
		// Only the red at 60', not the yellow at 10'
		expect(stats.redCards).toHaveLength(1);
	});

	it("ignores own goals when counting goals", () => {
		const ownGoalOnly = [
			{
				event_type: "goal",
				scored_by: "marco",
				goal_type: "own_goal",
				minute: 50,
			},
		];
		expect(extractPlayerStats(ownGoalOnly, "marco").goals).toBe(0);
	});

	it("handles missing timeline gracefully", () => {
		expect(extractPlayerStats(null, "marco")).toEqual({
			goals: 0,
			assists: 0,
			redCards: [],
		});
		expect(extractPlayerStats([], "marco")).toEqual({
			goals: 0,
			assists: 0,
			redCards: [],
		});
	});

	it("returns zero stats for an unknown player", () => {
		expect(extractPlayerStats(timeline, "ghost")).toEqual({
			goals: 0,
			assists: 0,
			redCards: [],
		});
	});

	it("treats malformed entries safely", () => {
		const stats = extractPlayerStats(
			[null, "not-an-object", { event_type: "goal" }],
			"marco",
		);
		expect(stats.goals).toBe(0);
		expect(stats.assists).toBe(0);
	});
});

describe("buildMatchInputFromGame", () => {
	const game = {
		score_home: 2,
		score_away: 1,
		result_type: "regular",
		score_timeline: [
			{ event_type: "goal", scored_by: "marco", minute: 14 },
			{
				event_type: "goal",
				scored_by: "marco",
				assist_by: "tobi",
				minute: 31,
			},
			{ event_type: "goal", scored_by: "jay", minute: 71 },
		],
	};
	const gamePlayers = [
		{ player_id: "marco", team: "home" },
		{ player_id: "tobi", team: "home" },
		{ player_id: "jay", team: "away" },
		{ player_id: "nik", team: "away" },
	];

	it("builds a MatchInput with team-side allocation + stats", () => {
		const profilesById = {
			marco: { current_rating: 1600, matches_played: 40 },
			tobi: { current_rating: 1500, matches_played: 40 },
			jay: { current_rating: 1500, matches_played: 40 },
			nik: { current_rating: 1400, matches_played: 40 },
		};
		const input = buildMatchInputFromGame({ game, gamePlayers, profilesById });

		expect(input.teamA.goals).toBe(2);
		expect(input.teamB.goals).toBe(1);
		expect(input.matchMinutes).toBe(90);

		expect(input.teamA.players).toHaveLength(2);
		expect(input.teamA.players[0]).toMatchObject({
			playerId: "marco",
			rating: 1600,
			matchesPlayed: 40,
			stats: { goals: 2, assists: 0 },
		});
		expect(input.teamA.players[1]).toMatchObject({
			playerId: "tobi",
			rating: 1500,
			stats: { goals: 0, assists: 1 },
		});
		expect(input.teamB.players).toHaveLength(2);
		expect(input.teamB.players[0]).toMatchObject({
			playerId: "jay",
			stats: { goals: 1, assists: 0 },
		});
	});

	it("accepts a Map for profilesById", () => {
		const profilesById = new Map([
			["marco", { current_rating: 1700, matches_played: 50 }],
			["tobi", { current_rating: 1500, matches_played: 50 }],
			["jay", { current_rating: 1500, matches_played: 50 }],
			["nik", { current_rating: 1500, matches_played: 50 }],
		]);
		const input = buildMatchInputFromGame({ game, gamePlayers, profilesById });
		expect(input.teamA.players[0].rating).toBe(1700);
	});

	it("falls back to starting rating + 0 matches for missing profiles", () => {
		const input = buildMatchInputFromGame({
			game,
			gamePlayers,
			profilesById: {},
		});
		expect(input.teamA.players[0].rating).toBe(1500);
		expect(input.teamA.players[0].matchesPlayed).toBe(0);
	});

	it("picks up matchMinutes from result_type", () => {
		const input = buildMatchInputFromGame({
			game: { ...game, result_type: "extra_time" },
			gamePlayers,
			profilesById: {},
		});
		expect(input.matchMinutes).toBe(120);
	});
});
