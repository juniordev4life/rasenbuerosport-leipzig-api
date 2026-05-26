export const predictionSchema = {
	body: {
		type: "object",
		required: ["players", "mode"],
		properties: {
			mode: {
				type: "string",
				enum: ["1v1", "1v2", "2v1", "2v2", "2v3", "3v2", "3v3"],
			},
			players: {
				type: "array",
				minItems: 2,
				maxItems: 6,
				items: {
					type: "object",
					required: ["id", "team"],
					properties: {
						id: { type: "string", minLength: 1 },
						team: { type: "string", enum: ["home", "away"] },
						team_name: { type: "string" },
					},
				},
			},
		},
	},
};
