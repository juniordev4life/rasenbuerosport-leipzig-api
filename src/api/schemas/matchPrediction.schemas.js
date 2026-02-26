export const predictionSchema = {
	body: {
		type: "object",
		required: ["players", "mode"],
		properties: {
			mode: { type: "string", enum: ["1v1", "2v2"] },
			players: {
				type: "array",
				minItems: 2,
				maxItems: 4,
				items: {
					type: "object",
					required: ["id", "team"],
					properties: {
						id: { type: "string", format: "uuid" },
						team: { type: "string", enum: ["home", "away"] },
						team_name: { type: "string" },
					},
				},
			},
		},
	},
};
