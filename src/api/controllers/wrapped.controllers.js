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

/**
 * `GET /api/v1/wrapped/:weekStart` — deep link to a specific week's
 * wrapped snapshot. `weekStart` must be the Monday of the target
 * week in `YYYY-MM-DD` format (the same value persisted on
 * `weekly_wrapped.week_start`).
 *
 * Returns the same enriched shape as `/wrapped/latest` — the
 * frontend's WrappedWeekNav uses this to navigate older weeks
 * without dragging the whole archive into memory.
 */
export const getWrappedByWeekStartController = {
	schema: {
		params: {
			type: "object",
			required: ["weekStart"],
			properties: {
				weekStart: {
					type: "string",
					pattern: "^\\d{4}-\\d{2}-\\d{2}$",
				},
			},
		},
	},
	handler: async (request, reply) => {
		try {
			const { weekStart } = request.params;
			const row = await wrappedService.getWrappedByWeekStart(weekStart);
			if (!row) {
				return setGeneralResponse(
					reply,
					404,
					"Not Found",
					"No wrapped for that week",
					null,
				);
			}
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Wrapped retrieved",
				row,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
