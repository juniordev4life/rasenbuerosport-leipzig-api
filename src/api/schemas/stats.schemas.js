export const getStatsSchema = {
	querystring: {
		type: "object",
		properties: {
			season: { type: "string", pattern: "^\\d{4}-Q[1-4]$" },
			from: { type: "string", format: "date" },
			to: { type: "string", format: "date" },
		},
	},
	response: {
		200: {
			type: "object",
			properties: {
				code: { type: "integer" },
				title: { type: "string" },
				message: { type: "string" },
				data: {
					type: "object",
					properties: {
						total_games: { type: "integer" },
						wins: { type: "integer" },
						losses: { type: "integer" },
						draws: { type: "integer" },
						win_rate: { type: "integer" },
						bilanz_1v1: {
							type: "object",
							properties: {
								wins: { type: "integer" },
								losses: { type: "integer" },
							},
						},
						bilanz_2v2: {
							type: "object",
							properties: {
								wins: { type: "integer" },
								losses: { type: "integer" },
							},
						},
						favorite_opponent: {
							type: ["object", "null"],
							properties: {
								username: { type: "string" },
								avatar_url: { type: ["string", "null"] },
								games: { type: "integer" },
							},
						},
						best_teammate: {
							type: ["object", "null"],
							properties: {
								username: { type: "string" },
								avatar_url: { type: ["string", "null"] },
								games: { type: "integer" },
							},
						},
						top_teammates: {
							type: "array",
							items: {
								type: "object",
								properties: {
									player_id: { type: "string" },
									username: { type: "string" },
									avatar_url: { type: ["string", "null"] },
									games: { type: "integer" },
									wins: { type: "integer" },
									win_rate: { type: "integer" },
								},
							},
						},
						favorite_team: {
							type: ["object", "null"],
							properties: {
								name: { type: "string" },
								short_name: { type: ["string", "null"] },
								games: { type: "integer" },
							},
						},
						current_streak: {
							type: ["object", "null"],
							properties: {
								type: { type: "string" },
								count: { type: "integer" },
							},
						},
						last_played_at: { type: ["string", "null"] },
						career_match_stats: {
							type: ["object", "null"],
							properties: {
								games_with_stats: { type: "integer" },
								avg_possession: { type: "integer" },
								avg_pass_accuracy: { type: "integer" },
								avg_dribbling: { type: "integer" },
								avg_shot_accuracy: { type: "integer" },
								avg_xg_per_game: { type: ["number", "null"] },
								total_xg: { type: "number" },
								xg_efficiency: { type: ["number", "null"] },
								avg_duels_won_rate: { type: ["integer", "null"] },
							},
						},
						badges: {
							type: "array",
							items: {
								type: "object",
								properties: {
									type: { type: "string" },
									emoji: { type: "string" },
									unlocked: { type: "boolean" },
									category: { type: "string" },
									progress: {
										type: "object",
										properties: {
											current: { type: "number" },
											target: { type: "number" },
										},
									},
									unlocked_at: { type: ["string", "null"] },
									next_tier: {
										type: ["object", "null"],
										properties: {
											type: { type: "string" },
											target: { type: "number" },
										},
									},
								},
							},
						},
						goal_tier: { type: ["string", "null"] },
						total_individual_goals: { type: "integer" },
						total_assists: { type: "integer" },
						assists_per_game: { type: "number" },
						goals_per_game: { type: "number" },
						hattricks: { type: "integer" },
						longest_win_streak: { type: "integer" },
						highest_win: {
							type: ["object", "null"],
							properties: {
								score: { type: "string" },
								goal_diff: { type: "integer" },
								opponent_name: { type: ["string", "null"] },
								played_at: { type: "string" },
							},
						},
						peak_elo: {
							type: ["object", "null"],
							properties: {
								value: { type: "number" },
								played_at: { type: ["string", "null"] },
							},
						},
					},
				},
				error: { type: "array" },
			},
		},
	},
};
