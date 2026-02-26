import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import {
	uploadMatchStatsSchema,
	deleteMatchStatsSchema,
} from "../schemas/matchStats.schemas.js";
import * as matchStatsService from "../services/matchStats.services.js";

export const uploadMatchStatsController = {
	schema: uploadMatchStatsSchema,
	handler: async (request, reply) => {
		try {
			const { gameId } = request.params;
			const { imageUrl } = request.body;

			const matchStats =
				await matchStatsService.extractStatsFromImage(imageUrl);
			const game = await matchStatsService.saveMatchStats(
				gameId,
				matchStats,
				imageUrl,
			);

			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Match stats extracted and saved",
				{
					match_stats: game.match_stats,
					stats_image_url: game.stats_image_url,
				},
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const deleteMatchStatsController = {
	schema: deleteMatchStatsSchema,
	handler: async (request, reply) => {
		try {
			const { gameId } = request.params;
			await matchStatsService.deleteMatchStats(gameId);

			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Match stats removed",
				null,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
