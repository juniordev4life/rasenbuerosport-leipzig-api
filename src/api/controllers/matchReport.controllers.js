import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { generateMatchReport } from "../services/matchReport.services.js";

export const generateReportController = {
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
			const report = await generateMatchReport(gameId);

			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Match report generated",
				{ match_report: report },
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
