/**
 * `score_timeline` entries are polymorphic. Each entry is either:
 *  - a goal (default for legacy entries that omit `event_type`),
 *  - a card — yellow or red, distinguished by `card_type` (Phase 7),
 *  - a legacy red card without the `card_type` discriminator (Phase 3),
 *  - a missed penalty (Phase 4).
 *
 * Discrimination between branches is driven by `event_type` (const per
 * branch) plus the unique required-field signature. We do **not** set
 * `additionalProperties: false` on the branches: combined with Fastify's
 * default `removeAdditional: true`, that flag causes Ajv to strip fields
 * that are unknown in *any* branch (e.g. `card_type` from a `card` entry
 * because `goalEntrySchema` does not list it) before the matching branch
 * is selected. The downside — silently accepting unknown fields — is
 * acceptable here: the timeline reader ignores anything it does not
 * recognise anyway.
 */
const goalEntrySchema = {
	type: "object",
	required: ["home", "away", "period"],
	properties: {
		event_type: { type: "string", enum: ["goal"] },
		home: { type: "integer", minimum: 0 },
		away: { type: "integer", minimum: 0 },
		period: {
			type: "string",
			enum: ["regular", "extra_time", "penalty"],
		},
		scored_by: { type: "string", minLength: 1 },
		assist_by: { type: "string", minLength: 1 },
		goal_type: {
			type: "string",
			enum: ["play", "corner", "freekick", "penalty"],
		},
		minute: { type: "integer", minimum: 1, maximum: 120 },
		stoppage: { type: "integer", minimum: 0, maximum: 5 },
	},
};

const redCardEntrySchema = {
	type: "object",
	required: ["event_type", "player_id", "team", "period"],
	properties: {
		event_type: { type: "string", const: "red_card" },
		player_id: { type: "string", minLength: 1 },
		team: { type: "string", enum: ["home", "away"] },
		period: { type: "string", enum: ["regular", "extra_time"] },
		minute: { type: "integer", minimum: 1, maximum: 120 },
		stoppage: { type: "integer", minimum: 0, maximum: 5 },
	},
};

const cardEntrySchema = {
	type: "object",
	required: ["event_type", "card_type", "player_id", "team", "period"],
	properties: {
		event_type: { type: "string", const: "card" },
		card_type: { type: "string", enum: ["yellow", "red"] },
		player_id: { type: "string", minLength: 1 },
		team: { type: "string", enum: ["home", "away"] },
		period: { type: "string", enum: ["regular", "extra_time"] },
		minute: { type: "integer", minimum: 1, maximum: 120 },
		stoppage: { type: "integer", minimum: 0, maximum: 5 },
	},
};

const penaltyMissedEntrySchema = {
	type: "object",
	required: ["event_type", "shooter_id", "team", "period"],
	properties: {
		event_type: { type: "string", const: "penalty_missed" },
		shooter_id: { type: "string", minLength: 1 },
		keeper_id: { type: "string", minLength: 1 },
		team: { type: "string", enum: ["home", "away"] },
		period: { type: "string", enum: ["regular", "extra_time"] },
		minute: { type: "integer", minimum: 1, maximum: 120 },
		stoppage: { type: "integer", minimum: 0, maximum: 5 },
	},
};

export const createGameSchema = {
	body: {
		type: "object",
		required: ["mode", "score_home", "score_away", "players"],
		properties: {
			mode: { type: "string", enum: ["1v1", "2v2", "2v1", "1v2"] },
			score_home: { type: "integer", minimum: 0 },
			score_away: { type: "integer", minimum: 0 },
			players: {
				type: "array",
				items: {
					type: "object",
					required: ["id", "team"],
					properties: {
						id: { type: "string", minLength: 1 },
						team: { type: "string", enum: ["home", "away"] },
						team_name: { type: "string", minLength: 1 },
					},
				},
				minItems: 1,
				maxItems: 4,
			},
			played_at: { type: "string", format: "date-time" },
			score_timeline: {
				type: "array",
				items: {
					oneOf: [
						goalEntrySchema,
						cardEntrySchema,
						redCardEntrySchema,
						penaltyMissedEntrySchema,
					],
				},
			},
			result_type: {
				type: "string",
				enum: ["regular", "extra_time", "penalty"],
				default: "regular",
			},
		},
	},
};

export const getGamesSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 200, default: 10 },
			offset: { type: "integer", minimum: 0, default: 0 },
			season: { type: "string", pattern: "^\\d{4}-Q[1-4]$" },
			from: { type: "string", format: "date" },
			to: { type: "string", format: "date" },
		},
	},
};
