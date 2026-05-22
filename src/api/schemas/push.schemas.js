/**
 * JSON-Schema definitions for the push-subscription endpoints.
 */

export const subscribeBodySchema = {
	type: "object",
	required: ["endpoint", "keys"],
	properties: {
		endpoint: { type: "string", format: "uri", maxLength: 1024 },
		keys: {
			type: "object",
			required: ["p256dh", "auth"],
			properties: {
				p256dh: { type: "string", minLength: 8, maxLength: 256 },
				auth: { type: "string", minLength: 8, maxLength: 64 },
			},
			additionalProperties: false,
		},
		userAgent: { type: "string", maxLength: 512 },
	},
	additionalProperties: false,
};

export const subscriptionIdParamsSchema = {
	type: "object",
	required: ["id"],
	properties: {
		id: { type: "string", format: "uuid" },
	},
};

export const preferencesBodySchema = {
	type: "object",
	properties: {
		preferences: {
			type: "object",
			additionalProperties: { type: "boolean" },
		},
	},
	required: ["preferences"],
	additionalProperties: false,
};
