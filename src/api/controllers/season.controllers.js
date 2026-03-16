import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	getSeasonArchiveSchema,
	getSeasonsListSchema,
} from "../schemas/season.schemas.js";
import {
	getSeasonArchive,
	getSeasonsList,
} from "../services/season.services.js";

export const getSeasonsListController = {
	schema: getSeasonsListSchema,
	handler: async (request, reply) => {
		try {
			const data = getSeasonsList();
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Seasons list retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const getSeasonArchiveController = {
	schema: getSeasonArchiveSchema,
	handler: async (request, reply) => {
		try {
			const data = await getSeasonArchive();
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Season archive retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
