import { getAllTeams } from "../services/teams.services.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { getTeamsSchema } from "../schemas/teams.schemas.js";

export const getTeamsController = {
	schema: getTeamsSchema,
	handler: async (request, reply) => {
		try {
			const data = await getAllTeams();
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Teams retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
