import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { getTeamsSchema } from "../schemas/teams.schemas.js";
import { getAllTeams } from "../services/teams.services.js";

export const getTeamsController = {
	schema: getTeamsSchema,
	handler: async (request, reply) => {
		try {
			const data = await getAllTeams(request.query);
			return setGeneralResponse(reply, 200, "Success", "Teams retrieved", data);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
