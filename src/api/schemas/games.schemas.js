export const createGameSchema = {
	body: {
		type: "object",
		required: ["mode", "score_home", "score_away", "players"],
		properties: {
			mode: { type: "string", enum: ["1v1", "2v2"] },
			score_home: { type: "integer", minimum: 0 },
			score_away: { type: "integer", minimum: 0 },
			players: {
				type: "array",
				items: {
					type: "object",
					required: ["id", "team"],
					properties: {
						id: { type: "string", format: "uuid" },
						team: { type: "string", enum: ["home", "away"] },
						team_name: { type: "string", minLength: 1 },
						rating: { type: "integer", minimum: 1, maximum: 5 },
					},
				},
				minItems: 2,
				maxItems: 4,
			},
			played_at: { type: "string", format: "date-time" },
			score_timeline: {
				type: "array",
				items: {
					type: "object",
					required: ["home", "away", "period"],
					properties: {
						home: { type: "integer", minimum: 0 },
						away: { type: "integer", minimum: 0 },
						period: {
							type: "string",
							enum: ["regular", "extra_time", "penalty"],
						},
					},
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
		},
	},
};
