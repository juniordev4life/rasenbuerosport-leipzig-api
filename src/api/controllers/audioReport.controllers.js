import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { generateAudioReport } from "../services/audioReport.services.js";

export const generateAudioReportController = {
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
			const audioUrl = await generateAudioReport(gameId);

			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Audio match report ready",
				{ match_report_audio_url: audioUrl },
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
