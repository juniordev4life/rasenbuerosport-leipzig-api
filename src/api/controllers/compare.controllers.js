import { getSeasonDateRange } from "../../utils/season.utils.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { getCompareSchema } from "../schemas/compare.schemas.js";
import { getPlayerComparison } from "../services/compare.services.js";

export const getCompareController = {
	schema: getCompareSchema,
	handler: async (request, reply) => {
		try {
			let { from, to, season } = request.query;

			if (season) {
				const range = getSeasonDateRange(season);
				from = range.from;
				to = range.to;
			}

			const data = await getPlayerComparison(
				request.params.player1Id,
				request.params.player2Id,
				from,
				to,
			);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Player comparison retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
