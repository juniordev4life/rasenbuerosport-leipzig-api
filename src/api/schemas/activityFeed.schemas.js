export const getRecentGamesSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
		},
	},
};
