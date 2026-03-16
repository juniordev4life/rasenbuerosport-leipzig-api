export const getSeasonsListSchema = {
	response: {
		200: {
			type: "object",
			properties: {
				code: { type: "integer" },
				title: { type: "string" },
				message: { type: "string" },
				data: {
					type: "object",
					properties: {
						current: { type: "string" },
						seasons: {
							type: "array",
							items: {
								type: "object",
								properties: {
									key: { type: "string" },
									display_name: {
										type: "object",
										properties: {
											de: { type: "string" },
											en: { type: "string" },
										},
									},
									is_current: { type: "boolean" },
								},
							},
						},
					},
				},
				error: { type: "array" },
			},
		},
	},
};

export const getSeasonArchiveSchema = {
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
							season: { type: "string" },
							display_name: {
								type: "object",
								properties: {
									de: { type: "string" },
									en: { type: "string" },
								},
							},
							podium: {
								type: "array",
								items: {
									type: "object",
									properties: {
										rank: { type: "integer" },
										player_id: { type: "string" },
										username: { type: "string" },
										avatar_url: { type: ["string", "null"] },
										points: { type: "integer" },
										wins: { type: "integer" },
										draws: { type: "integer" },
										losses: { type: "integer" },
										games: { type: "integer" },
									},
								},
							},
						},
					},
				},
				error: { type: "array" },
			},
		},
	},
};
