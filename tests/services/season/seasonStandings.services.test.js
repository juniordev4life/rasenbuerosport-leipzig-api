import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/api/helpers/database.helpers.js", () => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	withTransaction: vi.fn(),
}));

import {
	berlinWeekdayHour,
	berlinWeekKey,
	downsample,
	duoIdOf,
	gameOutcome,
	playerFacts,
	tablePoints,
} from "../../../src/api/services/season/seasonFacts.services.js";
import { buildSeasonRecaps } from "../../../src/api/services/season/seasonRecapBuilder.services.js";
import {
	buildLeagueTable,
	buildSeasonRating,
} from "../../../src/api/services/season/seasonStandings.services.js";

const FC26 = {
	id: "fc26",
	name: "EA FC 26",
	game_version: "FC26",
	starts_at: "2026-03-13T00:00:00Z",
	ends_at: "2026-09-22T13:00:00Z",
	recap_generated_at: null,
};
const FC27 = { ...FC26, id: "fc27", name: "EA FC 27", game_version: "FC27", starts_at: "2026-09-22T13:00:00Z", ends_at: null };

function snap(home, away) {
	const row = ([playerId, before, delta]) => ({ playerId, ratingBefore: before, ratingAfter: before + delta, delta });
	return { teamA: home.map(row), teamB: away.map(row), version: "v2.0" };
}

function g(id, playedAt, score, snapshot, extra = {}) {
	return {
		id,
		played_at: playedAt,
		score_home: score[0],
		score_away: score[1],
		score_timeline: [],
		penalty_shootout: null,
		match_stats: null,
		elo_snapshot: snapshot,
		result_type: "regular",
		...extra,
	};
}

const PROFILES = [
	{ id: "a", username: "Anna", avatar_url: null, current_rating: 1530, matches_played: 40, rating_updated_at: "2026-09-20T12:00:00Z" },
	{ id: "b", username: "Ben", avatar_url: null, current_rating: 1470, matches_played: 40, rating_updated_at: "2026-09-20T12:00:00Z" },
	{ id: "c", username: "Cleo", avatar_url: null, current_rating: 1500, matches_played: 0, rating_updated_at: null },
];

describe("seasonFacts", () => {
	it("decides a level game by the shootout and awards 2:1 points", () => {
		const game = { score_home: 2, score_away: 2, penalty_shootout: { winner_side: "away" } };
		expect(gameOutcome(game)).toEqual({ winner: "away", shootout: true });
		expect(tablePoints(game, "away")).toEqual({ points: 2, kind: "SW" });
		expect(tablePoints(game, "home")).toEqual({ points: 1, kind: "SL" });
		expect(tablePoints({ score_home: 3, score_away: 1 }, "home")).toEqual({ points: 3, kind: "W" });
		expect(tablePoints({ score_home: 1, score_away: 1 }, "home")).toEqual({ points: 1, kind: "D" });
	});

	it("does not count shootout kicks or own goals as goals", () => {
		const game = {
			score_timeline: [
				{ home: 1, away: 0, period: "regular", scored_by: "a", assist_by: "b" },
				{ home: 1, away: 1, period: "regular", scored_by: "c", is_own_goal: true },
				{ home: 2, away: 1, period: "penalty", scored_by: "a" },
				{ event_type: "card", card_type: "yellow", player_id: "b", team: "home", period: "regular" },
			],
		};
		const facts = playerFacts(game, ["a", "b", "c"]);
		expect(facts.get("a")).toMatchObject({ goals: 1 });
		expect(facts.get("b")).toMatchObject({ assists: 1, yellow: 1 });
		expect(facts.get("c").goals).toBe(0);
	});

	it("uses Berlin time for weeks, weekdays and hours", () => {
		expect(berlinWeekKey("2026-09-27T21:59:00Z")).toBe("2026-W39");
		expect(berlinWeekKey("2026-09-27T22:01:00Z")).toBe("2026-W40");
		expect(berlinWeekdayHour("2026-09-22T10:52:00Z")).toEqual({ weekday: 2, hour: 12 });
	});

	it("thins long series but keeps both ends", () => {
		const out = downsample([...Array(100).keys()], 10);
		expect(out).toHaveLength(10);
		expect(out[0]).toBe(0);
		expect(out.at(-1)).toBe(99);
		expect(duoIdOf(["b", "a"])).toBe("a_b");
	});
});

function seasonData() {
	const games = [
		g("g1", "2026-09-01T11:00:00Z", [2, 0], snap([["a", 1500, 16]], [["b", 1500, -16]])),
		g("g2", "2026-09-02T11:00:00Z", [1, 1], snap([["a", 1516, 14]], [["b", 1484, -14]]), {
			penalty_shootout: { winner_side: "home", shots: [] },
		}),
	];
	const gamePlayers = [
		{ game_id: "g1", player_id: "a", team: "home" },
		{ game_id: "g1", player_id: "b", team: "away" },
		{ game_id: "g2", player_id: "a", team: "home" },
		{ game_id: "g2", player_id: "b", team: "away" },
	];
	const standing = {
		players: [
			{ player_id: "a", rating_start: 1500, rating_end: 1530, games: 2 },
			{ player_id: "b", rating_start: 1500, rating_end: 1470, games: 2 },
		],
		duos: [],
	};
	return { games, gamePlayers, profiles: PROFILES, standing };
}

describe("buildLeagueTable", () => {
	it("counts 3/1/0 and 2:1 after a shootout, sorted by points", () => {
		const { rows } = buildLeagueTable(seasonData(), FC26);

		expect(rows.map((r) => [r.username, r.points])).toEqual([
			["Anna", 5],
			["Ben", 1],
		]);
		expect(rows[0]).toMatchObject({ wins: 1, shootout_wins: 1, goals_for: 3, goals_against: 1, rank: 1 });
		expect(rows[1]).toMatchObject({ losses: 1, shootout_losses: 1, points_per_game: 0.5 });
	});
});

describe("buildSeasonRating", () => {
	it("ranks regulars first in a closed season and marks the others", () => {
		const data = seasonData();
		const { season, players } = buildSeasonRating(data, FC26);

		expect(season.min_games).toBe(30);
		// both have only 2 games → not qualified; order by rating
		expect(players.map((p) => [p.username, p.qualified])).toEqual([
			["Anna", false],
			["Ben", false],
		]);
		expect(players[0]).toMatchObject({ rating: 1530, rating_start: 1500, delta_season: 30, wins: 2, losses: 0, delta_week: 0 });
		expect(players[0].history).toEqual([1500, 1516, 1530]);
		expect(players[0].streak).toEqual({ type: "W", count: 2 });
	});

	it("lists every rated player in the current season with live ratings", () => {
		const data = { ...seasonData(), games: [], gamePlayers: [] };

		const { players } = buildSeasonRating(data, FC27, new Date("2026-09-27T12:00:00Z"));

		expect(players.map((p) => p.username)).toEqual(["Anna", "Ben"]);
		expect(players.every((p) => p.qualified && p.games === 0)).toBe(true);
		expect(players.find((p) => p.username === "Cleo")).toBeUndefined();
	});
});

describe("buildSeasonRecaps", () => {
	it("builds per-player stats and league awards", () => {
		const { recaps, league } = buildSeasonRecaps(seasonData(), FC26, {
			oldRatings: new Map([["a", 1700]]),
			liveRatings: new Map([["a", 1530]]),
		});

		const anna = recaps.get("a");
		expect(anna.stats).toMatchObject({ games: 2, wins: 2, losses: 0, win_rate: 1 });
		expect(anna.stats.shootouts).toEqual({ played: 1, won: 1 });
		expect(anna.elo).toMatchObject({ start: 1500, end: 1530, old_rating: 1700, new_rating: 1530, rank: 1, of: 2 });
		expect(league).toMatchObject({ games: 2, goals: 4, shootouts: 1, players: 2 });
		// nobody reaches 30 games → no champion
		expect(league.awards.find((a) => a.key === "champion")).toBeUndefined();
		expect(league.awards.find((a) => a.key === "marathon").player_ids.sort()).toEqual(["a", "b"]);
	});
});
