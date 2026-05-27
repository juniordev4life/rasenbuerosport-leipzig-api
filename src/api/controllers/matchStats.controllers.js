import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	deleteMatchStatsSchema,
	uploadMatchStatsSchema,
} from "../schemas/matchStats.schemas.js";
import * as matchStatsService from "../services/matchStats.services.js";

export const uploadMatchStatsController = {
	schema: uploadMatchStatsSchema,
	handler: async (request, reply) => {
		try {
			const { gameId } = request.params;
			const { imageUrl, type = "overview" } = request.body;

			const matchStats = await matchStatsService.extractStatsFromImage(
				imageUrl,
				type,
			);
			const game = await matchStatsService.saveMatchStats(
				gameId,
				matchStats,
				imageUrl,
				type,
			);

			// Screenshot is one-shot input for Claude Vision — once stats
			// land in the DB, the underlying object is dead weight. Fire
			// and forget; failure here doesn't roll back the save.
			matchStatsService
				.deleteMatchStatsImage(gameId, type)
				.catch((err) =>
					request.log.warn(
						{ err, gameId, type },
						"match-stats screenshot cleanup failed",
					),
				);

			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Match stats extracted and saved",
				{
					match_stats: game.match_stats,
					stats_image_url: game.stats_image_url,
					passes_image_url: game.passes_image_url,
					defense_image_url: game.defense_image_url,
					home_pass_network: game.home_pass_network,
					away_pass_network: game.away_pass_network,
					type,
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
