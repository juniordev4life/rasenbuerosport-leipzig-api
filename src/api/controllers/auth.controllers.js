import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { updateProfileSchema } from "../schemas/auth.schemas.js";
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

			// requireAuth only lets verified accounts on the allowed domain
			// through, so a missing profile just means a first sign-in.
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
	schema: updateProfileSchema,
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
