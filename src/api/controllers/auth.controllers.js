import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { registerSchema, loginSchema } from "../schemas/auth.schemas.js";
import * as authService from "../services/auth.services.js";

export const registerController = {
	schema: registerSchema,
	handler: async (request, reply) => {
		try {
			const { email, password, username } = request.body;
			const result = await authService.registerUser({
				email,
				password,
				username,
			});
			return setGeneralResponse(
				reply,
				201,
				"Created",
				"User registered successfully",
				result,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const loginController = {
	schema: loginSchema,
	handler: async (request, reply) => {
		try {
			const { email, password } = request.body;
			const result = await authService.loginUser({ email, password });
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Login successful",
				result,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

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
