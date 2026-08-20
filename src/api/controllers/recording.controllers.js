import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	finalizeGameSchema,
	getRecordingStatusSchema,
	getRecordingTimelineSchema,
	recordingStatsSchema,
	reportRecordingStatusSchema,
	setRecordingCommandSchema,
	updateGameVideoSchema,
} from "../schemas/recording.schemas.js";
import { finalizeGame } from "../services/games.services.js";
import {
	extractStatsFromImage,
	saveMatchStats,
} from "../services/matchStats.services.js";
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

export const reportRecordingStatusController = {
	schema: reportRecordingStatusSchema,
	handler: async (request, reply) => {
		try {
			const { recording_id, status } = request.body;
			const result = await recordingService.reportRecordingStatus(
				recording_id,
				status,
			);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Recording status reported",
				result,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const getRecordingStatusController = {
	schema: getRecordingStatusSchema,
	handler: async (request, reply) => {
		try {
			const status = await recordingService.getRecordingStatus(
				request.query.recording_id,
			);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Recording status retrieved",
				status,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const finalizeGameController = {
	schema: finalizeGameSchema,
	handler: async (request, reply) => {
		try {
			const { game_id, score_timeline, result_type, penalty_shootout } =
				request.body;
			const game = await finalizeGame(game_id, score_timeline, {
				result_type,
				penalty_shootout,
			});

			if (!game) {
				return setGeneralResponse(
					reply,
					404,
					"Not Found",
					"Game not found",
					null,
				);
			}

			return setGeneralResponse(reply, 200, "Success", "Game finalized", game);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const recordingStatsController = {
	schema: recordingStatsSchema,
	handler: async (request, reply) => {
		try {
			const { game_id, images } = request.body;
			const applied = [];
			let game = null;
			for (const type of ["overview", "passes", "defense"]) {
				const imageUrl = images[type];
				if (!imageUrl) {
					continue;
				}
				const stats = await extractStatsFromImage(imageUrl, type);
				game = await saveMatchStats(game_id, stats, imageUrl, type);
				applied.push(type);
			}

			if (!game) {
				return setGeneralResponse(
					reply,
					404,
					"Not Found",
					"Game not found",
					null,
				);
			}

			return setGeneralResponse(reply, 200, "Success", "Match stats applied", {
				game_id,
				applied,
			});
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const getRecordingTimelineController = {
	schema: getRecordingTimelineSchema,
	handler: async (request, reply) => {
		try {
			const timeline = await recordingService.getRecordingTimeline(
				request.query.game_id,
			);

			if (!timeline) {
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
				"Recording timeline retrieved",
				timeline,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
