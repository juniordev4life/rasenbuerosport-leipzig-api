import { describe, expect, it } from "vitest";
import { countAssists } from "../../../src/api/services/stats.services.js";
import {
	buildGoalEvent,
	buildMockGame,
	buildMockGamePlayer,
} from "../../test-utils.js";

/**
 * `countAssists` consumes a games array plus a `userGameMap` keyed by game id.
 * The map only needs to record the user's team for fallback logic that other
 * counters use; for assists it is sufficient to confirm the user appeared in
 * the game.
 */
function buildUserGameMap(gameIds, team = "home") {
	return gameIds.reduce((acc, id) => {
		acc[id] = buildMockGamePlayer({ game_id: id, team });
		return acc;
	}, {});
}

describe("countAssists", () => {
	it("returns zero totals for an empty games list", () => {
		// Arrange
		const userGameMap = {};

		// Act
		const result = countAssists([], userGameMap, "user-1");

		// Assert
		expect(result).toEqual({ total: 0, maxInOneGame: 0 });
	});

	it("counts a single assist credited to the user", () => {
		// Arrange
		const game = buildMockGame({
			id: "g1",
			score_timeline: [
				buildGoalEvent({ scored_by: "user-2", assist_by: "user-1" }),
			],
		});

		// Act
		const result = countAssists([game], buildUserGameMap(["g1"]), "user-1");

		// Assert
		expect(result.total).toBe(1);
		expect(result.maxInOneGame).toBe(1);
	});

	it("ignores assists credited to other users", () => {
		// Arrange
		const game = buildMockGame({
			id: "g1",
			score_timeline: [
				buildGoalEvent({ scored_by: "user-2", assist_by: "user-3" }),
				buildGoalEvent({ scored_by: "user-2", assist_by: "user-1" }),
			],
		});

		// Act
		const result = countAssists([game], buildUserGameMap(["g1"]), "user-1");

		// Assert
		expect(result.total).toBe(1);
	});

	it("ignores entries without assist_by", () => {
		// Arrange — legacy goals before Phase 2 had no assist_by field
		const game = buildMockGame({
			id: "g1",
			score_timeline: [
				buildGoalEvent({ scored_by: "user-2" }),
				buildGoalEvent({ scored_by: "user-2", assist_by: "user-1" }),
			],
		});

		// Act
		const result = countAssists([game], buildUserGameMap(["g1"]), "user-1");

		// Assert
		expect(result.total).toBe(1);
	});

	it("aggregates across games and tracks the per-game maximum", () => {
		// Arrange
		const games = [
			buildMockGame({
				id: "g1",
				score_timeline: [
					buildGoalEvent({ assist_by: "user-1" }),
					buildGoalEvent({ assist_by: "user-1", minute: 60 }),
				],
			}),
			buildMockGame({
				id: "g2",
				score_timeline: [buildGoalEvent({ assist_by: "user-1" })],
			}),
			buildMockGame({
				id: "g3",
				score_timeline: [
					buildGoalEvent({ assist_by: "user-1" }),
					buildGoalEvent({ assist_by: "user-1", minute: 50 }),
					buildGoalEvent({ assist_by: "user-1", minute: 70 }),
				],
			}),
		];

		// Act
		const result = countAssists(
			games,
			buildUserGameMap(["g1", "g2", "g3"]),
			"user-1",
		);

		// Assert
		expect(result.total).toBe(6);
		expect(result.maxInOneGame).toBe(3);
	});

	it("skips games where the user did not participate", () => {
		// Arrange
		const games = [
			buildMockGame({
				id: "g1",
				score_timeline: [buildGoalEvent({ assist_by: "user-1" })],
			}),
			buildMockGame({
				id: "g2",
				score_timeline: [buildGoalEvent({ assist_by: "user-1" })],
			}),
		];

		// Act
		const result = countAssists(games, buildUserGameMap(["g1"]), "user-1");

		// Assert — only g1 is in userGameMap, g2 is skipped
		expect(result.total).toBe(1);
	});

	it("treats a missing or empty score_timeline as zero assists", () => {
		// Arrange
		const games = [
			buildMockGame({ id: "g1", score_timeline: null }),
			buildMockGame({ id: "g2", score_timeline: [] }),
		];

		// Act
		const result = countAssists(
			games,
			buildUserGameMap(["g1", "g2"]),
			"user-1",
		);

		// Assert
		expect(result.total).toBe(0);
		expect(result.maxInOneGame).toBe(0);
	});
});
