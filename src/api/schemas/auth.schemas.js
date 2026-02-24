export const registerSchema = {
	body: {
		type: "object",
		required: ["email", "password", "username"],
		properties: {
			email: { type: "string", format: "email" },
			password: { type: "string", minLength: 6 },
			username: { type: "string", minLength: 2, maxLength: 30 },
		},
	},
};

export const loginSchema = {
	body: {
		type: "object",
		required: ["email", "password"],
		properties: {
			email: { type: "string", format: "email" },
			password: { type: "string", minLength: 1 },
		},
	},
};
