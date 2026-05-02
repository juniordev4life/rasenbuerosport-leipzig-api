const playerSchema = {
	type: ["object", "null"],
	properties: {
		id: { type: "string" },
		username: { type: "string" },
		avatar_url: { type: ["string", "null"] },
	},
};

const wrappedPayloadSchema = {
	type: "object",
	properties: {
		total_games: { type: "integer" },
		total_goals: { type: "integer" },
		mvp: {
			...playerSchema,
			properties: {
				...playerSchema.properties,
				wins: { type: "integer" },
			},
		},
		topscorer: {
			...playerSchema,
			properties: {
				...playerSchema.properties,
				goals: { type: "integer" },
			},
		},
		most_active: {
			...playerSchema,
			properties: {
				...playerSchema.properties,
				games_played: { type: "integer" },
			},
		},
		top_duo: {
			type: ["object", "null"],
			properties: {
				players: { type: "array", items: playerSchema },
				games: { type: "integer" },
				wins: { type: "integer" },
				win_rate: { type: "number" },
			},
		},
	},
};

const wrappedRowSchema = {
	type: ["object", "null"],
	properties: {
		id: { type: "string" },
		week_start: { type: "string" },
		week_end: { type: "string" },
		generated_at: { type: "string" },
		payload: wrappedPayloadSchema,
	},
};

export const generateWrappedSchema = {
	response: {
		200: {
			type: "object",
			properties: {
				code: { type: "integer" },
				title: { type: "string" },
				message: { type: "string" },
				data: wrappedRowSchema,
				error: { type: "array" },
			},
		},
	},
};

export const getLatestWrappedSchema = {
	response: {
		200: {
			type: "object",
			properties: {
				code: { type: "integer" },
				title: { type: "string" },
				message: { type: "string" },
				data: wrappedRowSchema,
				error: { type: "array" },
			},
		},
	},
};

export const listWrappedSchema = {
	querystring: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
		},
	},
	response: {
		200: {
			type: "object",
			properties: {
				code: { type: "integer" },
				title: { type: "string" },
				message: { type: "string" },
				data: { type: "array", items: wrappedRowSchema },
				error: { type: "array" },
			},
		},
	},
};
