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
} from "../../../src/api/services/season/seasonFacts.services.js";
import { buildSeasonRecaps } from "../../../src/api/services/season/seasonRecapBuilder.services.js";
import { buildSeasonRating } from "../../../src/api/services/season/seasonStandings.services.js";

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
	it("decides a level game by the shootout", () => {
		const game = { score_home: 2, score_away: 2, penalty_shootout: { winner_side: "away" } };
		expect(gameOutcome(game)).toEqual({ winner: "away", shootout: true });
		expect(gameOutcome({ score_home: 1, score_away: 1 })).toEqual({ winner: null, shootout: false });
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

/**
 * Five 2v2 games Anna+Ben beat Cleo+Dora, two 1v1 games Eve vs Cleo.
 * Hendrik has the best rating but no game in this season, and the duo
 * Anna+Cleo has 16 games together, none of them this season.
 */
function rankingData() {
	const games = [];
	const gamePlayers = [];
	const add = (id, day, score, home, away, homeDelta) => {
		const rows = (ids, delta) => ids.map((pid) => [pid, 1500, delta]);
		games.push(g(id, `2026-09-${day}T11:00:00Z`, score, snap(rows(home, homeDelta), rows(away, -homeDelta))));
		for (const pid of home) gamePlayers.push({ game_id: id, player_id: pid, team: "home" });
		for (const pid of away) gamePlayers.push({ game_id: id, player_id: pid, team: "away" });
	};
	for (let i = 1; i <= 5; i++) add(`d${i}`, `0${i}`, [2, 1], ["a", "b"], ["c", "d"], 5);
	add("s1", "10", [1, 0], ["e"], ["c"], 8);
	add("s2", "11", [0, 2], ["e"], ["c"], -8);
	const player = (id, end) => ({ player_id: id, rating_start: 1500, rating_end: end });
	const standing = {
		players: [player("a", 1525), player("b", 1525), player("c", 1475), player("d", 1475), player("e", 1500)],
		duos: [
			{ key: "a|b", player_ids: ["a", "b"], rating_start: 1500, rating_end: 1525, games_total: 5 },
			{ key: "c|d", player_ids: ["c", "d"], rating_start: 1500, rating_end: 1475, games_total: 5 },
			{ key: "a|c", player_ids: ["a", "c"], rating_start: 1550, rating_end: 1550, games_total: 16 },
		],
	};
	const profile = (id, username, rating, played) => ({
		id,
		username,
		avatar_url: null,
		current_rating: rating,
		matches_played: played,
		rating_updated_at: "2026-09-20T12:00:00Z",
	});
	const profiles = [
		profile("a", "Anna", 1525, 40),
		profile("b", "Ben", 1525, 40),
		profile("c", "Cleo", 1475, 30),
		profile("d", "Dora", 1475, 30),
		profile("e", "Eve", 1500, 2),
		profile("h", "Hendrik", 1623, 15),
	];
	return { games, gamePlayers, profiles, standing };
}

describe("buildSeasonRating", () => {
	it("lists only players with at least 5 games in the running season", () => {
		const { season, players } = buildSeasonRating(rankingData(), FC27, new Date("2026-09-27T12:00:00Z"));

		expect(season.ranking_min_games).toBe(5);
		// Hendrik (best rating, no game this season) and Eve (2 games) stay out
		expect(players.map((p) => [p.rank, p.username, p.games])).toEqual([
			[1, "Anna", 5],
			[2, "Ben", 5],
			[3, "Cleo", 7],
			[4, "Dora", 5],
		]);
		expect(players.every((p) => p.qualified)).toBe(true);
		expect(players[0]).not.toHaveProperty("rookie");
	});

	it("applies the same minimum to a closed season, below its 30-game qualification", () => {
		const { season, players } = buildSeasonRating(rankingData(), FC26);

		expect(season.min_games).toBe(30);
		expect(players.map((p) => [p.username, p.qualified])).toEqual([
			["Anna", false],
			["Ben", false],
			["Cleo", false],
			["Dora", false],
		]);
		expect(players[0]).toMatchObject({ rating: 1525, delta_season: 25, wins: 5, losses: 0, streak: { type: "W", count: 5 } });
	});

	it("lists only duos with at least 5 games together in the season", () => {
		const { duos } = buildSeasonRating(rankingData(), FC27, new Date("2026-09-27T12:00:00Z"));

		// Anna+Cleo have 16 games together, but none this season
		expect(duos.map((d) => [d.rank, d.duo_id, d.games, d.games_total])).toEqual([
			[1, "a_b", 5, 5],
			[2, "c_d", 5, 5],
		]);
		expect(duos[0]).toMatchObject({ wins: 5, losses: 0, delta_season: 25 });
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
