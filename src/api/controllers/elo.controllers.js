import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	getMatchElo,
	getPlayerRating,
} from "../services/elo/eloRead.services.js";

const PLAYER_ID_PATTERN = "^[a-zA-Z0-9_-]+$";

export const getPlayerRatingController = {
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
			const rating = await getPlayerRating(playerId);
			if (!rating) {
				const err = new Error("Player not found");
				err.statusCode = 404;
				throw err;
			}
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Player rating retrieved",
				rating,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const getMatchEloController = {
	schema: {
		params: {
			type: "object",
			required: ["gameId"],
			properties: {
				gameId: { type: "string", format: "uuid" },
			},
		},
	},
	handler: async (request, reply) => {
		try {
			const { gameId } = request.params;
			const result = await getMatchElo(gameId);
			if (!result) {
				const err = new Error("Game not found");
				err.statusCode = 404;
				throw err;
			}
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Match ELO retrieved",
				result,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
