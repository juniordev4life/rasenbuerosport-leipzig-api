export const uploadMatchStatsSchema = {
	params: {
		type: "object",
		required: ["gameId"],
		properties: {
			gameId: { type: "string", format: "uuid" },
		},
	},
	body: {
		type: "object",
		required: ["imageUrl"],
		properties: {
			imageUrl: { type: "string", format: "uri" },
		},
	},
};

export const deleteMatchStatsSchema = {
	params: {
		type: "object",
		required: ["gameId"],
		properties: {
			gameId: { type: "string", format: "uuid" },
		},
	},
};
