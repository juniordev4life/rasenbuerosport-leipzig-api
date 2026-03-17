import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { getGameDetailSchema } from "../schemas/gameDetail.schemas.js";
import { getGameById } from "../services/gameDetail.services.js";
import { deleteGame } from "../services/games.services.js";

export const getGameDetailController = {
	schema: getGameDetailSchema,
	handler: async (request, reply) => {
		try {
			const game = await getGameById(request.params.gameId);

			if (!game) {
				return setGeneralResponse(
					reply,
					404,
					"Not Found",
					"Game not found",
					null,
				);
			}

			return setGeneralResponse(reply, 200, "Success", "Game retrieved", game);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const deleteGameController = {
	schema: {
		params: {
			type: "object",
			properties: {
				gameId: { type: "string", format: "uuid" },
			},
			required: ["gameId"],
		},
	},
	handler: async (request, reply) => {
		try {
			await deleteGame(request.params.gameId);
			return setGeneralResponse(reply, 200, "Success", "Game deleted");
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
