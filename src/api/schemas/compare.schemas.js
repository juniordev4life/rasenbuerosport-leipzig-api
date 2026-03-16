export const getCompareSchema = {
	params: {
		type: "object",
		required: ["player1Id", "player2Id"],
		properties: {
			player1Id: { type: "string", minLength: 1 },
			player2Id: { type: "string", minLength: 1 },
		},
	},
	querystring: {
		type: "object",
		properties: {
			season: { type: "string" },
		},
	},
};
