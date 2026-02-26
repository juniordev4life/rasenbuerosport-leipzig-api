import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { getRecentGamesSchema } from "../schemas/activityFeed.schemas.js";
import { getRecentGames } from "../services/activityFeed.services.js";

export const getRecentGamesController = {
	schema: getRecentGamesSchema,
	handler: async (request, reply) => {
		try {
			const limit = request.query.limit || 10;
			const games = await getRecentGames(limit);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Recent games retrieved",
				games,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
