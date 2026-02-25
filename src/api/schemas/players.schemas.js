export const getPlayersSchema = {
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
							username: { type: "string" },
							avatar_url: { type: ["string", "null"] },
						},
					},
				},
				error: { type: "array" },
			},
		},
	},
};
