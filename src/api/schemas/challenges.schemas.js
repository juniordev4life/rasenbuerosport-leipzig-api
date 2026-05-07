/**
 * JSON Schemas for the weekly-challenges endpoints. Response schemas are
 * intentionally permissive (no `additionalProperties: false`) — each row
 * comes straight out of `pg` with whatever columns the SELECT projected.
 */

const challengeShape = {
	type: "object",
	required: [
		"definition_id",
		"metric",
		"target_value",
		"reward_points",
		"difficulty",
		"label_de",
		"label_en",
	],
	properties: {
		week_id: { type: "string" },
		definition_id: { type: "string" },
		metric: { type: "string" },
		target_value: { type: "integer" },
		reward_points: { type: "integer" },
		difficulty: { type: "string" },
		label_de: { type: "string" },
		label_en: { type: "string" },
		description_de: { type: ["string", "null"] },
		description_en: { type: ["string", "null"] },
		emoji: { type: ["string", "null"] },
		progress: {
			type: "object",
			required: ["current", "target", "completed"],
			properties: {
				current: { type: "integer" },
				target: { type: "integer" },
				completed: { type: "boolean" },
			},
		},
	},
};

export const getActiveChallengesSchema = {};

export const getChallengeHistorySchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 52, default: 12 },
		},
	},
};

export const getChallengeLeaderboardSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
		},
	},
};

// Re-exported in case other modules want to compose with the challenge shape.
export { challengeShape };
