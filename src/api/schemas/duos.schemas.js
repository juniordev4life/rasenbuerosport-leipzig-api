const duoPlayerSchema = {
	type: "object",
	properties: {
		player_id: { type: "string" },
		username: { type: "string" },
		avatar_url: { type: ["string", "null"] },
	},
};

export const duoLeaderboardSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
			season: { type: "string", pattern: "^\\d{4}-Q[1-4]$" },
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
					type: "array",
					items: {
						type: "object",
						properties: {
							duo_id: { type: "string" },
							player1: duoPlayerSchema,
							player2: duoPlayerSchema,
							games: { type: "integer" },
							wins: { type: "integer" },
							losses: { type: "integer" },
							draws: { type: "integer" },
							win_rate: { type: "integer" },
							points: { type: "integer" },
							current_streak: {
								type: ["object", "null"],
								properties: {
									type: { type: "string" },
									count: { type: "integer" },
								},
							},
							last_played_at: { type: ["string", "null"] },
						},
					},
				},
				error: { type: "array" },
			},
		},
	},
};

export const duoDetailSchema = {
	params: {
		type: "object",
		required: ["player1Id", "player2Id"],
		properties: {
			player1Id: { type: "string", minLength: 1 },
			player2Id: { type: "string", minLength: 1 },
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
						player1: duoPlayerSchema,
						player2: duoPlayerSchema,
						total_games: { type: "integer" },
						wins: { type: "integer" },
						losses: { type: "integer" },
						draws: { type: "integer" },
						win_rate: { type: "integer" },
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
						avg_match_stats: {
							type: ["object", "null"],
							properties: {
								games_with_stats: { type: "integer" },
								avg_possession: { type: "integer" },
								avg_pass_accuracy: { type: "integer" },
								avg_xg_per_game: { type: ["number", "null"] },
								avg_shot_accuracy: { type: "integer" },
							},
						},
						opponent_duos: {
							type: "array",
							items: {
								type: "object",
								properties: {
									player1: duoPlayerSchema,
									player2: duoPlayerSchema,
									games: { type: "integer" },
									wins: { type: "integer" },
									draws: { type: "integer" },
									losses: { type: "integer" },
								},
							},
						},
						recent_games: { type: "array" },
					},
				},
				error: { type: "array" },
			},
		},
	},
};
