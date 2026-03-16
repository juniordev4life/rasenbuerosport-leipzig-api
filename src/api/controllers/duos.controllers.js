import { getSeasonDateRange } from "../../utils/season.utils.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	duoDetailSchema,
	duoLeaderboardSchema,
} from "../schemas/duos.schemas.js";
import { getDuoDetail, getDuoLeaderboard } from "../services/duos.services.js";

export const getDuoLeaderboardController = {
	schema: duoLeaderboardSchema,
	handler: async (request, reply) => {
		try {
			let { limit = 20, from, to, season } = request.query;

			if (season) {
				const range = getSeasonDateRange(season);
				from = range.from;
				to = range.to;
			}

			const data = await getDuoLeaderboard(limit, from, to);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Duo leaderboard retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const getDuoDetailController = {
	schema: duoDetailSchema,
	handler: async (request, reply) => {
		try {
			const data = await getDuoDetail(
				request.params.player1Id,
				request.params.player2Id,
			);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Duo detail retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
