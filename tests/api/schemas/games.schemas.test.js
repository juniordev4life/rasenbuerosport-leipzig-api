/**
 * Regression tests for the polymorphic `score_timeline` validation in
 * `createGameSchema`.
 *
 * Production incident (Phase 7): Ajv combined with Fastify's default
 * `removeAdditional: true` strips fields from a matched `oneOf` branch
 * if those fields are unknown in *any* sibling branch. With every branch
 * carrying `additionalProperties: false`, `card_type` was silently dropped
 * from valid `card` events because `goalEntrySchema` did not list it. Yellow
 * cards landed in the DB without a `card_type` and rendered as red.
 *
 * These tests ensure the schema is validated under the exact options Fastify
 * uses, so the regression cannot creep back in without a red test.
 */
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { createGameSchema } from "../../../src/api/schemas/games.schemas.js";

/**
 * Build an Ajv instance with the same options Fastify 5 uses by default.
 * Documented at https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/.
 * @returns {Ajv}
 */
function buildAjv() {
	const ajv = new Ajv({
		coerceTypes: "array",
		useDefaults: true,
		removeAdditional: true,
		allErrors: false,
		strict: true,
	});
	addFormats(ajv);
	return ajv;
}

const baseValidGame = {
	mode: "1v1",
	score_home: 1,
	score_away: 0,
	players: [
		{ id: "player-home", team: "home" },
		{ id: "player-away", team: "away" },
	],
};

describe("createGameSchema — score_timeline polymorphism", () => {
	const ajv = buildAjv();
	const validate = ajv.compile(createGameSchema.body);

	it("accepts a yellow card and preserves card_type after validation", () => {
		const payload = {
			...baseValidGame,
			score_timeline: [
				{
					event_type: "card",
					card_type: "yellow",
					player_id: "player-away",
					team: "away",
					period: "regular",
					minute: 30,
					stoppage: 0,
				},
			],
		};

		const ok = validate(payload);

		expect(ok).toBe(true);
		expect(payload.score_timeline[0].card_type).toBe("yellow");
	});

	it("accepts a red card via the unified card branch and preserves card_type", () => {
		const payload = {
			...baseValidGame,
			score_timeline: [
				{
					event_type: "card",
					card_type: "red",
					player_id: "player-home",
					team: "home",
					period: "regular",
					minute: 60,
					stoppage: 0,
				},
			],
		};

		const ok = validate(payload);

		expect(ok).toBe(true);
		expect(payload.score_timeline[0].card_type).toBe("red");
	});

	it("rejects a card entry without card_type", () => {
		const payload = {
			...baseValidGame,
			score_timeline: [
				{
					event_type: "card",
					player_id: "player-away",
					team: "away",
					period: "regular",
					minute: 30,
				},
			],
		};

		const ok = validate(payload);

		expect(ok).toBe(false);
	});

	it("accepts a goal entry and preserves scored_by + assist_by", () => {
		const payload = {
			...baseValidGame,
			score_timeline: [
				{
					event_type: "goal",
					home: 1,
					away: 0,
					period: "regular",
					scored_by: "player-home",
					assist_by: "player-away",
					goal_type: "play",
					minute: 25,
				},
			],
		};

		const ok = validate(payload);

		expect(ok).toBe(true);
		expect(payload.score_timeline[0].scored_by).toBe("player-home");
		expect(payload.score_timeline[0].assist_by).toBe("player-away");
	});

	it("accepts a legacy red_card event without card_type", () => {
		const payload = {
			...baseValidGame,
			score_timeline: [
				{
					event_type: "red_card",
					player_id: "player-home",
					team: "home",
					period: "regular",
					minute: 70,
				},
			],
		};

		const ok = validate(payload);

		expect(ok).toBe(true);
	});

	it("accepts a penalty_missed entry and preserves shooter_id + keeper_id", () => {
		const payload = {
			...baseValidGame,
			score_timeline: [
				{
					event_type: "penalty_missed",
					shooter_id: "player-away",
					keeper_id: "player-home",
					team: "away",
					period: "regular",
					minute: 80,
				},
			],
		};

		const ok = validate(payload);

		expect(ok).toBe(true);
		expect(payload.score_timeline[0].shooter_id).toBe("player-away");
		expect(payload.score_timeline[0].keeper_id).toBe("player-home");
	});
});
