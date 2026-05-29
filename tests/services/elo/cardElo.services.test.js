import { describe, expect, it } from "vitest";
import {
	CARD_ELO_DELTAS,
	computeCardEloDeltas,
} from "../../../src/api/services/elo/cardElo.services.js";

const players2v2 = [
	{ player_id: "alice", team: "home" },
	{ player_id: "bob", team: "home" },
	{ player_id: "carol", team: "away" },
	{ player_id: "dan", team: "away" },
];

describe("computeCardEloDeltas", () => {
	it("returns empty deltas when match_stats are missing", () => {
		expect(
			computeCardEloDeltas({
				matchStats: null,
				timeline: [],
				gamePlayers: players2v2,
			}),
		).toEqual({});
	});

	it("returns empty deltas when no cards anywhere", () => {
		expect(
			computeCardEloDeltas({
				matchStats: {
					yellow_cards: { home: 0, away: 0 },
					red_cards: { home: 0, away: 0 },
				},
				timeline: [],
				gamePlayers: players2v2,
			}),
		).toEqual({});
	});

	it("splits yellow malus across the carded team in 2v2", () => {
		// 3 yellows on home, 1 on away
		const result = computeCardEloDeltas({
			matchStats: {
				yellow_cards: { home: 3, away: 1 },
				red_cards: { home: 0, away: 0 },
			},
			timeline: [],
			gamePlayers: players2v2,
		});
		// home: 3 * -2 = -6 total, /2 players = -3 each
		// away: 1 * -2 = -2 total, /2 players = -1 each
		expect(result).toEqual({
			alice: -3,
			bob: -3,
			carol: -1,
			dan: -1,
		});
	});

	it("applies the full red-card malus to a player attributed in the timeline", () => {
		const result = computeCardEloDeltas({
			matchStats: {
				yellow_cards: { home: 0, away: 0 },
				red_cards: { home: 1, away: 0 },
			},
			timeline: [
				{ event_type: "red_card", player_id: "alice", team: "home" },
			],
			gamePlayers: players2v2,
		});
		expect(result).toEqual({ alice: CARD_ELO_DELTAS.RED_ATTRIBUTED });
	});

	it("counts the modern card event_type with card_type=red as attributed", () => {
		const result = computeCardEloDeltas({
			matchStats: {
				yellow_cards: { home: 0, away: 0 },
				red_cards: { home: 1, away: 0 },
			},
			timeline: [
				{
					event_type: "card",
					card_type: "red",
					player_id: "alice",
					team: "home",
				},
			],
			gamePlayers: players2v2,
		});
		expect(result).toEqual({ alice: CARD_ELO_DELTAS.RED_ATTRIBUTED });
	});

	it("distributes unattributed red malus across the carded team", () => {
		// Screenshot says home has 1 red, timeline has none → 1 unattributed
		const result = computeCardEloDeltas({
			matchStats: {
				yellow_cards: { home: 0, away: 0 },
				red_cards: { home: 1, away: 0 },
			},
			timeline: [],
			gamePlayers: players2v2,
		});
		// 1 * -5 = -5 total, /2 players = -3 each (rounded)
		expect(result).toEqual({ alice: -3, bob: -3 });
	});

	it("combines attributed + unattributed reds on the same team", () => {
		// Screenshot says 2 reds, timeline only has 1 attributed
		const result = computeCardEloDeltas({
			matchStats: {
				yellow_cards: { home: 0, away: 0 },
				red_cards: { home: 2, away: 0 },
			},
			timeline: [
				{ event_type: "red_card", player_id: "alice", team: "home" },
			],
			gamePlayers: players2v2,
		});
		// alice: -8 (attributed) + -3 (unattributed share, 1*-5/2 rounded) = -11
		// bob:   -3 (unattributed share only)
		expect(result).toEqual({ alice: -11, bob: -3 });
	});

	it("ignores leftover when timeline already covers the screenshot red count", () => {
		const result = computeCardEloDeltas({
			matchStats: {
				yellow_cards: { home: 0, away: 0 },
				red_cards: { home: 1, away: 0 },
			},
			timeline: [
				{ event_type: "red_card", player_id: "alice", team: "home" },
				{ event_type: "red_card", player_id: "bob", team: "home" },
			],
			gamePlayers: players2v2,
		});
		// 2 attributed > 1 in screenshot → no unattributed leftover
		expect(result).toEqual({
			alice: CARD_ELO_DELTAS.RED_ATTRIBUTED,
			bob: CARD_ELO_DELTAS.RED_ATTRIBUTED,
		});
	});

	it("combines yellow + red on the same player correctly", () => {
		const result = computeCardEloDeltas({
			matchStats: {
				yellow_cards: { home: 2, away: 0 },
				red_cards: { home: 1, away: 0 },
			},
			timeline: [
				{ event_type: "red_card", player_id: "alice", team: "home" },
			],
			gamePlayers: players2v2,
		});
		// yellow: 2 * -2 = -4 total, /2 = -2 each
		// red: alice full -8, no unattributed
		// alice: -8 + -2 = -10
		// bob: -2
		expect(result).toEqual({ alice: -10, bob: -2 });
	});

	it("handles 1v1 by applying yellow malus to the single team member", () => {
		const players1v1 = [
			{ player_id: "alice", team: "home" },
			{ player_id: "carol", team: "away" },
		];
		const result = computeCardEloDeltas({
			matchStats: {
				yellow_cards: { home: 2, away: 0 },
				red_cards: { home: 0, away: 0 },
			},
			timeline: [],
			gamePlayers: players1v1,
		});
		// 2 * -2 = -4 total, /1 player = -4
		expect(result).toEqual({ alice: -4 });
	});

	it("does not assign yellows in the timeline to specific players", () => {
		// Yellow events live in match_stats only — timeline yellows
		// (legacy data from before the button was dropped) are ignored
		// to keep the math from double-counting.
		const result = computeCardEloDeltas({
			matchStats: {
				yellow_cards: { home: 1, away: 0 },
				red_cards: { home: 0, away: 0 },
			},
			timeline: [
				{
					event_type: "card",
					card_type: "yellow",
					player_id: "alice",
					team: "home",
				},
			],
			gamePlayers: players2v2,
		});
		// alice + bob each take half the team malus, alice is NOT singled out
		// 1 * -2 = -2 total, /2 = -1 each
		expect(result).toEqual({ alice: -1, bob: -1 });
	});
});
