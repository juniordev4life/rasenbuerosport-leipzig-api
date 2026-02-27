export const leaderboardSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
			from: { type: "string", format: "date" },
			to: { type: "string", format: "date" },
			mode: { type: "string", enum: ["all", "1v1", "2v2"], default: "all" },
		},
	},
};
