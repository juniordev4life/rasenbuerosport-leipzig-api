import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
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
			const limit = request.query.limit || 10;
			const offset = request.query.offset || 0;
			const games = await gamesService.getUserGames(request.user.id, limit, offset);
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
