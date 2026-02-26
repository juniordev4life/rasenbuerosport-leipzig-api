export const getH2HSchema = {
	params: {
		type: "object",
		required: ["playerId"],
		properties: {
			playerId: { type: "string", format: "uuid" },
		},
	},
};
