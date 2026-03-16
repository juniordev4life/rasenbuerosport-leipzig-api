import { getSeasonDateRange } from "../../utils/season.utils.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { getRecentGamesSchema } from "../schemas/activityFeed.schemas.js";
import { getRecentGames } from "../services/activityFeed.services.js";

export const getRecentGamesController = {
	schema: getRecentGamesSchema,
	handler: async (request, reply) => {
		try {
			let { limit = 10, from, to, season } = request.query;

			if (season) {
				const range = getSeasonDateRange(season);
				from = range.from;
				to = range.to;
			}

			const games = await getRecentGames(limit, from, to);
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
