import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	setRecordingCommandSchema,
	updateGameVideoSchema,
} from "../schemas/recording.schemas.js";
import * as recordingService from "../services/recording.services.js";

export const getNextRecordingCommandController = {
	schema: {},
	handler: async (request, reply) => {
		try {
			const command = await recordingService.getNextRecordingCommand();
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Next recording command",
				command,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const setRecordingCommandController = {
	schema: setRecordingCommandSchema,
	handler: async (request, reply) => {
		try {
			const { action, game_id } = request.body;
			const command = await recordingService.setRecordingCommand(
				action,
				game_id,
			);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Recording command set",
				command,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const updateGameVideoController = {
	schema: updateGameVideoSchema,
	handler: async (request, reply) => {
		try {
			const game = await recordingService.updateGameVideo(
				request.params.gameId,
				request.body,
			);

			if (!game) {
				return setGeneralResponse(
					reply,
					404,
					"Not Found",
					"Game not found",
					null,
				);
			}

			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Game video status updated",
				game,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
