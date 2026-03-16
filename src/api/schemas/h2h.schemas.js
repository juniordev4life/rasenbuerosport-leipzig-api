const modeBilanzItemSchema = {
	type: "object",
	properties: {
		games: { type: "integer" },
		wins: { type: "integer" },
		draws: { type: "integer" },
		losses: { type: "integer" },
	},
};

export const getH2HSchema = {
	params: {
		type: "object",
		required: ["playerId"],
		properties: {
			playerId: { type: "string", minLength: 1 },
		},
	},
	response: {
		200: {
			type: "object",
			properties: {
				traceId: { type: "string" },
				request: { type: "string" },
				code: { type: "integer" },
				title: { type: "string" },
				message: { type: "string" },
				data: {
					type: "object",
					properties: {
						opponent: {
							type: "object",
							properties: {
								username: { type: "string" },
								avatar_url: { type: ["string", "null"] },
							},
						},
						total_games: { type: "integer" },
						user_wins: { type: "integer" },
						opponent_wins: { type: "integer" },
						draws: { type: "integer" },
						recent_games: { type: "array" },
						trend: {
							type: "array",
							items: {
								type: "object",
								properties: {
									result: { type: "string" },
									played_at: { type: "string" },
								},
							},
						},
						streak: {
							type: ["object", "null"],
							properties: {
								type: { type: "string" },
								count: { type: "integer" },
							},
						},
						mode_bilanz: {
							type: "object",
							properties: {
								"1v1": modeBilanzItemSchema,
								"2v2": modeBilanzItemSchema,
							},
						},
						goal_stats: {
							type: ["object", "null"],
							properties: {
								user_goals: { type: "integer" },
								opponent_goals: { type: "integer" },
								user_avg: { type: "number" },
								opponent_avg: { type: "number" },
								games_with_data: { type: "integer" },
							},
						},
					},
				},
				error: { type: "array" },
			},
		},
	},
};
