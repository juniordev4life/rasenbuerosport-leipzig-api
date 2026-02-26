import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { getH2HSchema } from "../schemas/h2h.schemas.js";
import { getHeadToHead } from "../services/h2h.services.js";

export const getH2HController = {
	schema: getH2HSchema,
	handler: async (request, reply) => {
		try {
			const data = await getHeadToHead(
				request.user.id,
				request.params.playerId,
			);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Head-to-head stats retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
