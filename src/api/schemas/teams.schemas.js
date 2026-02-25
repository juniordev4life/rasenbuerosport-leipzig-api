export const getTeamsSchema = {
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
							name: { type: "string" },
							short_name: { type: ["string", "null"] },
							logo_url: { type: ["string", "null"] },
						},
					},
				},
				error: { type: "array" },
			},
		},
	},
};
