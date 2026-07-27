import { describe, expect, it } from "vitest";
import {
	rewritePlayerInShootout,
	rewritePlayerInTimeline,
} from "../../src/api/utils/playerReferences.utils.js";

describe("rewritePlayerInTimeline", () => {
	it("returns the input untouched when there is no timeline", () => {
		expect(rewritePlayerInTimeline(null, "a", "b")).toEqual({
			timeline: null,
			changed: 0,
		});
		expect(rewritePlayerInTimeline(undefined, "a", "b")).toEqual({
			timeline: null,
			changed: 0,
		});
	});

	it("rewrites scorer and assist on goal entries", () => {
		const timeline = [
			{ event_type: "goal", home: 1, away: 0, scored_by: "hendrik" },
			{ event_type: "goal", home: 2, away: 0, assist_by: "hendrik" },
		];

		const result = rewritePlayerInTimeline(timeline, "hendrik", "alex");

		expect(result.timeline[0].scored_by).toBe("alex");
		expect(result.timeline[1].assist_by).toBe("alex");
		expect(result.changed).toBe(2);
	});

	it("rewrites player_id on both card branches", () => {
		const timeline = [
			{ event_type: "red_card", player_id: "hendrik", team: "home" },
			{ event_type: "card", card_type: "yellow", player_id: "hendrik" },
		];

		const result = rewritePlayerInTimeline(timeline, "hendrik", "alex");

		expect(result.timeline.every((e) => e.player_id === "alex")).toBe(true);
		expect(result.changed).toBe(2);
	});

	it("rewrites shooter and keeper on penalty_missed entries", () => {
		const timeline = [
			{
				event_type: "penalty_missed",
				shooter_id: "hendrik",
				keeper_id: "hendrik",
			},
		];

		const result = rewritePlayerInTimeline(timeline, "hendrik", "alex");

		expect(result.timeline[0]).toMatchObject({
			shooter_id: "alex",
			keeper_id: "alex",
		});
		expect(result.changed).toBe(2);
	});

	it("leaves other players and unknown fields alone", () => {
		const timeline = [
			{ event_type: "goal", scored_by: "jay", assist_by: "hendrik", minute: 42 },
		];

		const result = rewritePlayerInTimeline(timeline, "hendrik", "alex");

		expect(result.timeline[0]).toEqual({
			event_type: "goal",
			scored_by: "jay",
			assist_by: "alex",
			minute: 42,
		});
		expect(result.changed).toBe(1);
	});

	it("does not mutate the input", () => {
		const timeline = [{ event_type: "goal", scored_by: "hendrik" }];

		rewritePlayerInTimeline(timeline, "hendrik", "alex");

		expect(timeline[0].scored_by).toBe("hendrik");
	});
});

describe("rewritePlayerInShootout", () => {
	it("returns the input untouched when there is no shootout or no shots", () => {
		expect(rewritePlayerInShootout(null, "a", "b")).toEqual({
			shootout: null,
			changed: 0,
		});
		// Result-only shootout from the capture pipeline — no shot list.
		const resultOnly = { winner_side: "home" };
		expect(rewritePlayerInShootout(resultOnly, "a", "b")).toEqual({
			shootout: resultOnly,
			changed: 0,
		});
	});

	it("rewrites shooter, keeper and the elo_deltas key", () => {
		const shootout = {
			winner_side: "away",
			shots: [
				{
					order: 1,
					shooter_id: "hendrik",
					keeper_id: "jay",
					elo_deltas: { hendrik: -4, jay: 4 },
				},
			],
		};

		const result = rewritePlayerInShootout(shootout, "hendrik", "alex");

		expect(result.shootout.shots[0]).toMatchObject({
			shooter_id: "alex",
			keeper_id: "jay",
			elo_deltas: { alex: -4, jay: 4 },
		});
		expect(result.shootout.shots[0].elo_deltas).not.toHaveProperty("hendrik");
		expect(result.changed).toBe(2);
		expect(result.shootout.winner_side).toBe("away");
	});

	it("sums the deltas when both ids already appear on one shot", () => {
		const shootout = {
			shots: [{ order: 1, elo_deltas: { hendrik: -4, alex: -1 } }],
		};

		const result = rewritePlayerInShootout(shootout, "hendrik", "alex");

		// The shot's total must survive the merge unchanged.
		expect(result.shootout.shots[0].elo_deltas).toEqual({ alex: -5 });
	});

	it("does not mutate the input", () => {
		const shootout = {
			shots: [{ shooter_id: "hendrik", elo_deltas: { hendrik: -4 } }],
		};

		rewritePlayerInShootout(shootout, "hendrik", "alex");

		expect(shootout.shots[0].shooter_id).toBe("hendrik");
		expect(shootout.shots[0].elo_deltas).toEqual({ hendrik: -4 });
	});
});
