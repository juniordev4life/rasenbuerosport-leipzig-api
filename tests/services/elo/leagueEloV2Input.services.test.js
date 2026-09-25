import { describe, expect, it } from "vitest";
import {
	assignPairingGameNumbers,
	buildMatchV2,
	extractStatsV2,
	isoWeekKey,
	pairingKey,
} from "../../../src/api/services/elo/leagueEloV2Input.services.js";

describe("extractStatsV2", () => {
	const game = {
		score_timeline: [
			{ event_type: "goal", scored_by: "a", assist_by: "b", period: "regular", goal_type: "play" },
			{ scored_by: "a", period: "regular" },
			{ event_type: "goal", scored_by: "c", period: "extra_time", goal_type: "penalty" },
			{ event_type: "penalty_missed", shooter_id: "a", keeper_id: "c", period: "regular" },
			{ event_type: "red_card", player_id: "b", card_type: "red" },
			{ event_type: "card", player_id: "c", card_type: null },
			// Shootout kicks are duplicated into the timeline — must not count here.
			{ event_type: "goal", scored_by: "a", period: "penalty", goal_type: "penalty" },
		],
		penalty_shootout: {
			shots: [
				{ shooter_id: "a", keeper_id: "c", result: "goal" },
				{ shooter_id: "c", keeper_id: "a", result: "missed" },
			],
		},
	};

	it("maps goals, assists, in-match penalties and red cards per player", () => {
		const stats = extractStatsV2(game, ["a", "b", "c"]);
		expect(stats.get("a")).toMatchObject({ goals: 2, penaltiesMissed: 1, assists: 0 });
		expect(stats.get("b")).toMatchObject({ assists: 1, redCards: 1 });
		expect(stats.get("c")).toMatchObject({ penaltiesScored: 1, penaltiesSaved: 1, redCards: 0 });
	});

	it("takes shootout kicks from the shots, a miss counting as a keeper save", () => {
		const stats = extractStatsV2(game, ["a", "b", "c"]);
		expect(stats.get("a")).toMatchObject({ shootoutScored: 1, shootoutSaved: 1 });
		expect(stats.get("c")).toMatchObject({ shootoutMissed: 1 });
	});

	it("skips own goals", () => {
		const stats = extractStatsV2(
			{ score_timeline: [{ event_type: "goal", scored_by: "a", is_own_goal: true }] },
			["a"],
		);
		expect(stats.get("a").goals).toBe(0);
	});
});

describe("buildMatchV2", () => {
	const gamePlayers = [
		{ player_id: "z", team: "home" },
		{ player_id: "a", team: "home" },
		{ player_id: "m", team: "away" },
	];

	it("builds sorted sides, the stored score and side-level surplus reds", () => {
		const match = buildMatchV2(
			{
				id: "g1",
				played_at: "2026-09-24T10:00:00Z",
				score_home: 3,
				score_away: 1,
				score_timeline: [{ event_type: "red_card", player_id: "m" }],
				match_stats: { red_cards: { home: 1, away: 1 } },
			},
			gamePlayers,
		);
		expect(match.sides.map((s) => s.map((p) => p.playerId))).toEqual([["a", "z"], ["m"]]);
		expect(match.score).toEqual([3, 1]);
		expect(match.shootoutWinner).toBeNull();
		expect(match.extraRedCards).toEqual([1, 0]);
	});

	it("reads the shootout winner only for a level score", () => {
		const base = { id: "g", played_at: "2026-09-24T10:00:00Z", penalty_shootout: { winner_side: "away" } };
		expect(buildMatchV2({ ...base, score_home: 2, score_away: 2 }, gamePlayers).shootoutWinner).toBe(1);
		expect(buildMatchV2({ ...base, score_home: 7, score_away: 4 }, gamePlayers).shootoutWinner).toBeNull();
	});

	it("returns null when a side has no players", () => {
		expect(buildMatchV2({ id: "g", score_home: 6, score_away: 2 }, [{ player_id: "a", team: "home" }])).toBeNull();
	});
});

describe("pairing numbers", () => {
	const m = (playedAt, home, away) => ({
		playedAt,
		sides: [home.map((playerId) => ({ playerId })), away.map((playerId) => ({ playerId }))],
	});

	it("uses the ISO week in Berlin time", () => {
		expect(isoWeekKey("2026-09-21T00:30:00+02:00")).toBe("2026-W39");
		// Sunday 23:30 UTC is already Monday in Berlin.
		expect(isoWeekKey("2026-09-20T23:30:00Z")).toBe("2026-W39");
		expect(isoWeekKey("2026-09-20T12:00:00Z")).toBe("2026-W38");
	});

	it("keys a line-up independent of home/away", () => {
		expect(pairingKey(m("x", ["c", "b"], ["a"]))).toBe(pairingKey(m("x", ["a"], ["b", "c"])));
	});

	it("counts rematches of the same line-up within one week only", () => {
		const numbered = assignPairingGameNumbers([
			m("2026-09-21T10:00:00Z", ["a"], ["b"]),
			m("2026-09-22T10:00:00Z", ["b"], ["a"]),
			m("2026-09-22T11:00:00Z", ["a"], ["c"]),
			m("2026-09-28T10:00:00Z", ["a"], ["b"]),
		]);
		expect(numbered.map((x) => x.pairingGameNumber)).toEqual([1, 2, 1, 1]);
	});
});
