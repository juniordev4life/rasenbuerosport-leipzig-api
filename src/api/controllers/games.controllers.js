import { getSeasonDateRange } from "../../utils/season.utils.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { createGameSchema, getGamesSchema } from "../schemas/games.schemas.js";
import * as gamesService from "../services/games.services.js";

export const createGameController = {
	schema: createGameSchema,
	handler: async (request, reply) => {
		try {
			const game = await gamesService.createGame({
				...request.body,
				created_by: request.user.id,
			});
			return setGeneralResponse(
				reply,
				201,
				"Created",
				"Game created successfully",
				game,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const getGamesController = {
	schema: getGamesSchema,
	handler: async (request, reply) => {
		try {
			let { limit = 10, offset = 0, from, to, season } = request.query;

			if (season) {
				const range = getSeasonDateRange(season);
				from = range.from;
				to = range.to;
			}

			const games = await gamesService.getUserGames(
				request.user.id,
				limit,
				offset,
				from,
				to,
			);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Games retrieved",
				games,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
