import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	generateWrappedSchema,
	getLatestWrappedSchema,
	listWrappedSchema,
} from "../schemas/wrapped.schemas.js";
import * as wrappedService from "../services/wrapped.services.js";

export const generateWrappedController = {
	schema: generateWrappedSchema,
	handler: async (request, reply) => {
		try {
			const row = await wrappedService.generateWrapped();
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Weekly wrapped generated",
				row,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const getLatestWrappedController = {
	schema: getLatestWrappedSchema,
	handler: async (request, reply) => {
		try {
			const row = await wrappedService.getLatestWrapped();
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Latest wrapped retrieved",
				row,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const listWrappedController = {
	schema: listWrappedSchema,
	handler: async (request, reply) => {
		try {
			const { limit = 20 } = request.query;
			const rows = await wrappedService.listWrapped(limit);
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Wrapped archive retrieved",
				rows,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
