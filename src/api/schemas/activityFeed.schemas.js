export const getRecentGamesSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
			season: { type: "string", pattern: "^\\d{4}-Q[1-4]$" },
			from: { type: "string", format: "date" },
			to: { type: "string", format: "date" },
		},
	},
};
