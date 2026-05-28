/**
 * Controller for the in-app feedback endpoint.
 *
 * The route layer wires this up behind `requireAuth`, so we can
 * rely on `request.user.id` being present. The user-agent comes
 * from the request headers — we don't trust the client to send it
 * truthfully via the body.
 */

import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { feedbackBodySchema } from "../schemas/feedback.schemas.js";
import { submitFeedback } from "../services/feedback.services.js";

export const submitFeedbackController = {
	schema: { body: feedbackBodySchema },
	handler: async (request, reply) => {
		try {
			const result = await submitFeedback({
				user: request.user,
				kind: request.body.kind,
				title: request.body.title,
				description: request.body.description,
				route: request.body.route,
				userAgent: request.headers["user-agent"] ?? null,
			});
			return setGeneralResponse(
				reply,
				201,
				"Created",
				"Feedback submitted",
				result,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
