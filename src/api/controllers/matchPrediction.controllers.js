import { setGeneralResponse } from "../helpers/response.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { predictionSchema } from "../schemas/matchPrediction.schemas.js";
import { generatePrediction } from "../services/matchPrediction.services.js";

export const getPredictionController = {
	schema: predictionSchema,
	handler: async (request, reply) => {
		try {
			const { players, mode } = request.body;
			const prediction = await generatePrediction(players, mode);

			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Prediction generated",
				{ prediction },
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
