import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { generatePersonalRecap } from "../services/weeklyRecap.services.js";

export const getMyWeeklyRecapController = {
	schema: {},
	handler: async (request, reply) => {
		try {
			const data = await generatePersonalRecap(request.user.id);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Weekly recap generated",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
