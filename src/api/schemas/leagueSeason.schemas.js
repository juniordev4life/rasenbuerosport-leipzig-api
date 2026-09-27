import { LEAGUE_SEASON_ID_PATTERN } from "../services/leagueSeason.services.js";

/** `:seasonId` — a league season id ("fc26") or the alias "current". */
export const seasonIdParamsSchema = {
	type: "object",
	required: ["seasonId"],
	properties: {
		seasonId: { type: "string", pattern: LEAGUE_SEASON_ID_PATTERN },
	},
};

/** Query of the recap push: `only_user` restricts it to one player (test send). */
export const recapNotifyQuerySchema = {
	type: "object",
	properties: {
		only_user: { type: "string", minLength: 1, maxLength: 128 },
	},
	additionalProperties: false,
};

/** Query of the recap generation: skip the AI parts (summary, Talkrunde). */
export const recapGenerateQuerySchema = {
	type: "object",
	properties: {
		skip_ai: { type: "boolean", default: false },
	},
	additionalProperties: false,
};
