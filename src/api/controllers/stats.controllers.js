import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { getStatsSchema } from "../schemas/stats.schemas.js";
import { getUserStats } from "../services/stats.services.js";

export const getMyStatsController = {
	schema: getStatsSchema,
	handler: async (request, reply) => {
		try {
			const data = await getUserStats(request.user.id);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"User stats retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
