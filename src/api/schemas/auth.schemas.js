export const updateProfileSchema = {
	body: {
		type: "object",
		properties: {
			username: { type: "string", minLength: 2, maxLength: 30 },
			avatar_url: { type: "string" },
		},
	},
};
