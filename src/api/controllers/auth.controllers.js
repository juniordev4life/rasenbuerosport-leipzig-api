import { ALLOWED_EMAIL_DOMAIN } from "../../constants/auth.constants.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import * as authService from "../services/auth.services.js";

export const meController = {
	handler: async (request, reply) => {
		try {
			const profile = await authService.getUserProfile(request.user.id);

			if (profile) {
				return setGeneralResponse(reply, 200, "Success", "Profile retrieved", {
					...profile,
					needsSetup: false,
				});
			}

			const emailDomain = request.user.email?.split("@")[1]?.toLowerCase();
			if (emailDomain !== ALLOWED_EMAIL_DOMAIN) {
				const error = new Error("User not authorized");
				error.statusCode = 403;
				throw error;
			}

			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Profile setup required",
				{
					id: request.user.id,
					email: request.user.email,
					username: null,
					avatar_url: null,
					needsSetup: true,
				},
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
