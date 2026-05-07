import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	getActiveChallengesSchema,
	getChallengeHistorySchema,
	getChallengeLeaderboardSchema,
} from "../schemas/challenges.schemas.js";
import * as challengesService from "../services/challenges.services.js";

export const getActiveChallengesController = {
	schema: getActiveChallengesSchema,
	handler: async (request, reply) => {
		try {
			const data = await challengesService.getActiveChallengesForPlayer(
				request.user.id,
			);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Active challenges retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const getChallengeHistoryController = {
	schema: getChallengeHistorySchema,
	handler: async (request, reply) => {
		try {
			const limit = request.query?.limit ?? 12;
			const data = await challengesService.getChallengeHistory(
				request.user.id,
				limit,
			);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Challenge history retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const getChallengeLeaderboardController = {
	schema: getChallengeLeaderboardSchema,
	handler: async (request, reply) => {
		try {
			const limit = request.query?.limit ?? 20;
			const data = await challengesService.getChallengeLeaderboard(limit);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Challenge leaderboard retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
