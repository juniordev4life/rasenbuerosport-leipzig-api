import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { parseLiveMatchVoiceEvent } from "../services/liveMatchVoice.services.js";

const bodySchema = {
	type: "object",
	required: ["transcript", "players", "currentMinute"],
	properties: {
		transcript: { type: "string", minLength: 1, maxLength: 400 },
		currentMinute: { type: "integer", minimum: 1, maximum: 120 },
		players: {
			type: "array",
			minItems: 1,
			maxItems: 8,
			items: {
				type: "object",
				required: ["id", "username", "side"],
				properties: {
					id: { type: "string", minLength: 1, maxLength: 64 },
					username: { type: "string", minLength: 1, maxLength: 64 },
					side: { type: "string", enum: ["home", "away"] },
				},
			},
		},
	},
};

export const parseLiveMatchVoiceEventController = {
	schema: { body: bodySchema },
	handler: async (request, reply) => {
		try {
			const { transcript, players, currentMinute } = request.body;
			const result = await parseLiveMatchVoiceEvent({
				transcript,
				players,
				currentMinute,
			});
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Voice event parsed",
				result,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
