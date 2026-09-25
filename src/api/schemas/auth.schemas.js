/**
 * Schema for PATCH /api/v1/auth/profile.
 *
 * `avatar_url` must be an absolute https URL. Which hosts are allowed is
 * decided by `isAllowedAvatarUrl` in auth.services.js, because the allowed
 * Storage prefix depends on the caller's uid and the configured bucket.
 * `null` means "keep the current avatar". Listing "null" in `type` also
 * keeps Fastify's type coercion from turning it into an empty string.
 */
export const updateProfileSchema = {
	body: {
		type: "object",
		properties: {
			username: { type: "string", minLength: 2, maxLength: 30 },
			avatar_url: {
				type: ["string", "null"],
				format: "uri",
				maxLength: 2048,
				pattern: "^https://",
			},
			voice_aliases: {
				type: "array",
				maxItems: 10,
				items: { type: "string", minLength: 1, maxLength: 30 },
			},
		},
	},
};
