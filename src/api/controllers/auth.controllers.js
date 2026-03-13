import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import * as authService from "../services/auth.services.js";

export const meController = {
	handler: async (request, reply) => {
		try {
			const profile = await authService.getUserProfile(request.user.id);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Profile retrieved",
				profile,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const updateProfileController = {
	schema: {
		body: {
			type: "object",
			properties: {
				username: { type: "string", minLength: 2, maxLength: 30 },
				avatar_url: { type: "string" },
			},
		},
	},
	handler: async (request, reply) => {
		try {
			const profile = await authService.updateUserProfile(
				request.user.id,
				request.body,
			);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Profile updated",
				profile,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
