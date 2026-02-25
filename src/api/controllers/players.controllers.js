import { getAllPlayers } from "../services/players.services.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { getPlayersSchema } from "../schemas/players.schemas.js";

export const getPlayersController = {
	schema: getPlayersSchema,
	handler: async (request, reply) => {
		try {
			const data = await getAllPlayers();
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Players retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
