import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { getSeasonArchiveSchema } from "../schemas/season.schemas.js";
import { getSeasonArchive } from "../services/season.services.js";

export const getSeasonArchiveController = {
	schema: getSeasonArchiveSchema,
	handler: async (request, reply) => {
		try {
			const data = await getSeasonArchive();
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Season archive retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
