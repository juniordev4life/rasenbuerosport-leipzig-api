export const leaderboardSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
			from: { type: "string", format: "date" },
			to: { type: "string", format: "date" },
		},
	},
};
