import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { computePlayerProfile } from "../services/playerProfile/playerProfile.services.js";

const PLAYER_ID_PATTERN = "^[a-zA-Z0-9_-]+$";

export const getPlayerProfileController = {
	schema: {
		params: {
			type: "object",
			required: ["playerId"],
			properties: {
				playerId: { type: "string", pattern: PLAYER_ID_PATTERN },
			},
		},
	},
	handler: async (request, reply) => {
		try {
			const { playerId } = request.params;
			const profile = await computePlayerProfile(playerId);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Player profile retrieved",
				profile,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
