import { describe, expect, it } from "vitest";
import {
	countAssists,
	countGameAssists,
	countMissedPenalties,
	userHadRedCardInGame,
	userHadYellowCardInGame,
} from "../../../src/api/services/stats.services.js";
import {
	buildCardEvent,
	buildGoalEvent,
	buildMockGame,
	buildMockGamePlayer,
	buildPenaltyMissedEvent,
	buildRedCardEvent,
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

describe("countMissedPenalties", () => {
	it("returns zero totals for an empty games list", () => {
		// Arrange & Act
		const result = countMissedPenalties([], {}, "user-1", "shooter");

		// Assert
		expect(result).toEqual({ total: 0, maxInOneGame: 0 });
	});

	it("counts shoots taken by the user (shooter role)", () => {
		// Arrange
		const game = buildMockGame({
			id: "g1",
			score_timeline: [
				buildPenaltyMissedEvent({ shooter_id: "user-1", keeper_id: "user-2" }),
				buildPenaltyMissedEvent({ shooter_id: "user-2", keeper_id: "user-1" }),
			],
		});

		// Act
		const result = countMissedPenalties(
			[game],
			buildUserGameMap(["g1"]),
			"user-1",
			"shooter",
		);

		// Assert
		expect(result.total).toBe(1);
	});

	it("counts saves credited to the user (keeper role)", () => {
		// Arrange — three opponents missed against user-1's keeper across two games
		const games = [
			buildMockGame({
				id: "g1",
				score_timeline: [
					buildPenaltyMissedEvent({
						shooter_id: "user-2",
						keeper_id: "user-1",
					}),
					buildPenaltyMissedEvent({
						shooter_id: "user-3",
						keeper_id: "user-1",
					}),
				],
			}),
			buildMockGame({
				id: "g2",
				score_timeline: [
					buildPenaltyMissedEvent({
						shooter_id: "user-4",
						keeper_id: "user-1",
					}),
				],
			}),
		];

		// Act
		const result = countMissedPenalties(
			games,
			buildUserGameMap(["g1", "g2"]),
			"user-1",
			"keeper",
		);

		// Assert
		expect(result.total).toBe(3);
		expect(result.maxInOneGame).toBe(2);
	});

	it("ignores entries without the relevant role field", () => {
		// Arrange — a shot with no keeper_id still counts for shooter role,
		// not for keeper role
		const game = buildMockGame({
			id: "g1",
			score_timeline: [
				buildPenaltyMissedEvent({ shooter_id: "user-1", keeper_id: undefined }),
			],
		});

		// Act
		const asShooter = countMissedPenalties(
			[game],
			buildUserGameMap(["g1"]),
			"user-1",
			"shooter",
		);
		const asKeeper = countMissedPenalties(
			[game],
			buildUserGameMap(["g1"]),
			"user-1",
			"keeper",
		);

		// Assert
		expect(asShooter.total).toBe(1);
		expect(asKeeper.total).toBe(0);
	});

	it("ignores non-penalty events", () => {
		// Arrange
		const game = buildMockGame({
			id: "g1",
			score_timeline: [
				buildGoalEvent({ scored_by: "user-1" }),
				buildRedCardEvent({ player_id: "user-1" }),
				buildPenaltyMissedEvent({ shooter_id: "user-1" }),
			],
		});

		// Act
		const result = countMissedPenalties(
			[game],
			buildUserGameMap(["g1"]),
			"user-1",
			"shooter",
		);

		// Assert
		expect(result.total).toBe(1);
	});

	it("skips games where the user did not participate", () => {
		// Arrange
		const game = buildMockGame({
			id: "g1",
			score_timeline: [
				buildPenaltyMissedEvent({ shooter_id: "user-1", keeper_id: "user-2" }),
			],
		});

		// Act — empty userGameMap
		const result = countMissedPenalties([game], {}, "user-1", "shooter");

		// Assert
		expect(result.total).toBe(0);
	});

	it("tracks the per-game maximum", () => {
		// Arrange
		const games = [
			buildMockGame({
				id: "g1",
				score_timeline: [
					buildPenaltyMissedEvent({ shooter_id: "user-1" }),
					buildPenaltyMissedEvent({ shooter_id: "user-1" }),
					buildPenaltyMissedEvent({ shooter_id: "user-1" }),
				],
			}),
			buildMockGame({
				id: "g2",
				score_timeline: [buildPenaltyMissedEvent({ shooter_id: "user-1" })],
			}),
		];

		// Act
		const result = countMissedPenalties(
			games,
			buildUserGameMap(["g1", "g2"]),
			"user-1",
			"shooter",
		);

		// Assert
		expect(result.total).toBe(4);
		expect(result.maxInOneGame).toBe(3);
	});
});

describe("countGameAssists", () => {
	it("returns 0 for a missing or empty timeline", () => {
		expect(countGameAssists(buildMockGame({ score_timeline: null }), "u1")).toBe(
			0,
		);
		expect(countGameAssists(buildMockGame({ score_timeline: [] }), "u1")).toBe(
			0,
		);
	});

	it("counts only goals (red cards / missed penalties cannot carry an assist)", () => {
		// Arrange
		const game = buildMockGame({
			score_timeline: [
				buildGoalEvent({ scored_by: "u2", assist_by: "u1" }),
				buildRedCardEvent({ player_id: "u1" }),
				buildPenaltyMissedEvent({ shooter_id: "u1" }),
			],
		});

		// Act
		const result = countGameAssists(game, "u1");

		// Assert
		expect(result).toBe(1);
	});

	it("ignores assists credited to other users", () => {
		// Arrange
		const game = buildMockGame({
			score_timeline: [
				buildGoalEvent({ scored_by: "u2", assist_by: "u3" }),
				buildGoalEvent({ scored_by: "u2", assist_by: "u1" }),
			],
		});

		// Act
		const result = countGameAssists(game, "u1");

		// Assert
		expect(result).toBe(1);
	});
});

describe("userHadRedCardInGame", () => {
	it("returns false for a game without a red card event", () => {
		// Arrange
		const game = buildMockGame({
			score_timeline: [buildGoalEvent({ scored_by: "u1" })],
		});

		// Act & Assert
		expect(userHadRedCardInGame(game, "u1")).toBe(false);
	});

	it("returns true when the user is the offender", () => {
		// Arrange
		const game = buildMockGame({
			score_timeline: [buildRedCardEvent({ player_id: "u1" })],
		});

		// Act & Assert
		expect(userHadRedCardInGame(game, "u1")).toBe(true);
	});

	it("returns false when a teammate gets the red card", () => {
		// Arrange
		const game = buildMockGame({
			score_timeline: [buildRedCardEvent({ player_id: "u2" })],
		});

		// Act & Assert
		expect(userHadRedCardInGame(game, "u1")).toBe(false);
	});

	it("treats a null or missing timeline as no red card", () => {
		expect(
			userHadRedCardInGame(buildMockGame({ score_timeline: null }), "u1"),
		).toBe(false);
	});

	it("recognises a unified card event with card_type 'red' as a red card", () => {
		const game = buildMockGame({
			score_timeline: [buildCardEvent({ player_id: "u1", card_type: "red" })],
		});
		expect(userHadRedCardInGame(game, "u1")).toBe(true);
	});

	it("does not classify a yellow card as a red card", () => {
		const game = buildMockGame({
			score_timeline: [buildCardEvent({ player_id: "u1", card_type: "yellow" })],
		});
		expect(userHadRedCardInGame(game, "u1")).toBe(false);
	});
});

describe("userHadYellowCardInGame", () => {
	it("returns true when the user picked up a yellow card", () => {
		const game = buildMockGame({
			score_timeline: [buildCardEvent({ player_id: "u1", card_type: "yellow" })],
		});
		expect(userHadYellowCardInGame(game, "u1")).toBe(true);
	});

	it("returns false when no card events are present", () => {
		const game = buildMockGame({
			score_timeline: [buildGoalEvent({ scored_by: "u1" })],
		});
		expect(userHadYellowCardInGame(game, "u1")).toBe(false);
	});

	it("returns false when the user only got a red card", () => {
		const game = buildMockGame({
			score_timeline: [buildCardEvent({ player_id: "u1", card_type: "red" })],
		});
		expect(userHadYellowCardInGame(game, "u1")).toBe(false);
	});

	it("returns false when a teammate got the yellow card", () => {
		const game = buildMockGame({
			score_timeline: [buildCardEvent({ player_id: "u2", card_type: "yellow" })],
		});
		expect(userHadYellowCardInGame(game, "u1")).toBe(false);
	});

	it("treats legacy red_card events as red, not yellow", () => {
		const game = buildMockGame({
			score_timeline: [buildRedCardEvent({ player_id: "u1" })],
		});
		expect(userHadYellowCardInGame(game, "u1")).toBe(false);
	});
});
