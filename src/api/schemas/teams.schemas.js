export const getTeamsSchema = {
	querystring: {
		type: "object",
		properties: {
			league: { type: "string", description: "Filter by league name" },
			country: { type: "string", description: "Filter by ISO country code" },
			search: { type: "string", description: "Search teams by name" },
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
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							name: { type: "string" },
							short_name: { type: ["string", "null"] },
							logo_url: { type: ["string", "null"] },
							sofifa_id: { type: ["integer", "null"] },
							overall_rating: { type: ["integer", "null"] },
							star_rating: { type: ["number", "null"] },
							league_name: { type: ["string", "null"] },
							country_code: { type: ["string", "null"] },
						},
					},
				},
				error: { type: "array" },
			},
		},
	},
};
