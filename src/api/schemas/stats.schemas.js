export const getStatsSchema = {
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
						favorite_team: {
							type: ["object", "null"],
							properties: {
								name: { type: "string" },
								short_name: { type: ["string", "null"] },
								games: { type: "integer" },
							},
						},
					},
				},
				error: { type: "array" },
			},
		},
	},
};
