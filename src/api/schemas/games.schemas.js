export const createGameSchema = {
	body: {
		type: "object",
		required: ["mode", "score_home", "score_away", "players_home", "players_away"],
		properties: {
			mode: { type: "string", enum: ["1v1", "2v2"] },
			score_home: { type: "integer", minimum: 0 },
			score_away: { type: "integer", minimum: 0 },
			players_home: {
				type: "array",
				items: { type: "string", format: "uuid" },
				minItems: 1,
				maxItems: 2,
			},
			players_away: {
				type: "array",
				items: { type: "string", format: "uuid" },
				minItems: 1,
				maxItems: 2,
			},
			played_at: { type: "string", format: "date-time" },
		},
	},
};

export const getGamesSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
		},
	},
};
