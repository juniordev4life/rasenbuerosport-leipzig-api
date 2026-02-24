import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { leaderboardSchema } from "../schemas/leaderboard.schemas.js";
import * as leaderboardService from "../services/leaderboard.services.js";

export const getLeaderboardController = {
	schema: leaderboardSchema,
	handler: async (request, reply) => {
		try {
			const limit = request.query.limit || 10;
			const leaderboard = await leaderboardService.getLeaderboard(limit);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Leaderboard retrieved",
				leaderboard,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
