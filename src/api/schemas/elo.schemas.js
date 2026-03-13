export const getEloHistorySchema = {
	params: {
		type: "object",
		required: ["playerId"],
		properties: {
			playerId: { type: "string", minLength: 1 },
		},
	},
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
		},
	},
};

export const getFormCurveSchema = {
	params: {
		type: "object",
		required: ["playerId"],
		properties: {
			playerId: { type: "string", minLength: 1 },
		},
	},
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
		},
	},
};

export const getMyFormCurveSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
		},
	},
};

export const getGameEloSchema = {
	params: {
		type: "object",
		required: ["gameId"],
		properties: {
			gameId: { type: "string", format: "uuid" },
		},
	},
};
