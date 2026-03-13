import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	getEloHistorySchema,
	getFormCurveSchema,
	getGameEloSchema,
	getMyFormCurveSchema,
} from "../schemas/elo.schemas.js";
import {
	getGameEloChanges,
	getPlayerEloHistory,
	getPlayerFormCurve,
	recalculateAllElo,
} from "../services/elo.services.js";

/**
 * GET /api/v1/elo/:playerId - Get Elo history for a player
 */
export const getEloHistoryController = {
	schema: getEloHistorySchema,
	handler: async (request, reply) => {
		try {
			const { playerId } = request.params;
			const limit = request.query.limit || 50;
			const data = await getPlayerEloHistory(playerId, limit);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Elo history retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

/**
 * GET /api/v1/elo/:playerId/form-curve - Get form curve for a player
 */
export const getFormCurveController = {
	schema: getFormCurveSchema,
	handler: async (request, reply) => {
		try {
			const { playerId } = request.params;
			const limit = request.query.limit || 10;
			const data = await getPlayerFormCurve(playerId, limit);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Form curve retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

/**
 * GET /api/v1/elo/me/form-curve - Get form curve for current user
 */
export const getMyFormCurveController = {
	schema: getMyFormCurveSchema,
	handler: async (request, reply) => {
		try {
			const limit = request.query?.limit || 10;
			const data = await getPlayerFormCurve(request.user.id, limit);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Form curve retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

/**
 * GET /api/v1/games/:gameId/elo - Get Elo changes for a specific game
 */
export const getGameEloController = {
	schema: getGameEloSchema,
	handler: async (request, reply) => {
		try {
			const { gameId } = request.params;
			const data = await getGameEloChanges(gameId);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Game Elo changes retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

/**
 * POST /api/v1/elo/recalculate - Recalculate all Elo ratings from scratch
 */
export const recalculateEloController = {
	schema: {},
	handler: async (request, reply) => {
		try {
			const result = await recalculateAllElo();
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Elo ratings recalculated",
				result,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
