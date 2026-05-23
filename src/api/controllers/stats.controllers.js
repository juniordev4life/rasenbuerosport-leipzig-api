import { getSeasonDateRange } from "../../utils/season.utils.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { getStatsSchema } from "../schemas/stats.schemas.js";
import { getUserStats } from "../services/stats.services.js";

export const getMyStatsController = {
	schema: getStatsSchema,
	handler: async (request, reply) => {
		try {
			let { from, to, season } = request.query;

			if (season) {
				const range = getSeasonDateRange(season);
				from = range.from;
				to = range.to;
			}

			const data = await getUserStats(request.user.id, from, to);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"User stats retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

/**
 * Career stats for any player by id. Used by the profile page to fill
 * the Karriere-Statistiken card (goals, assists, hattricks, longest
 * streak, highest win, peak ELO) without a client-side game-window
 * cap. Auth-required, anyone signed in can see anyone's aggregate.
 */
export const getPlayerStatsController = {
	schema: getStatsSchema,
	handler: async (request, reply) => {
		try {
			const { playerId } = request.params;
			let { from, to, season } = request.query;

			if (season) {
				const range = getSeasonDateRange(season);
				from = range.from;
				to = range.to;
			}

			const data = await getUserStats(playerId, from, to);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Player stats retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
