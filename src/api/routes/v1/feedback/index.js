import { submitFeedbackController } from "../../../controllers/feedback.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/**
 * POST /api/v1/feedback
 *
 * Accepts user-submitted feedback and dispatches it:
 *   - kind="general" → email via Resend
 *   - kind="bug"|"feature" → GitHub issue with the matching label
 *
 * Behind `requireAuth` because we want to (a) bind submissions to a
 * known user for triage and (b) keep the endpoint off public spam
 * tooling. A per-user rate limit on top of the global limiter
 * caps each user at 5 submissions per 10 minutes — easily enough
 * for legitimate feedback bursts, well below abuse territory.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function (fastify) {
	fastify.addHook("preHandler", requireAuth);

	fastify.post("/", {
		schema: submitFeedbackController.schema,
		// Fastify's default body limit is 1 MB; bug reports can include
		// a base64-encoded screenshot of up to ~5 MB, plus the JSON
		// wrapper and the data-url prefix. The route-level ceiling here
		// is the network gate; the schema's `screenshot.maxLength`
		// (~8 MB string) is the inner gate.
		bodyLimit: 10 * 1024 * 1024,
		config: {
			rateLimit: {
				max: 5,
				timeWindow: "10 minutes",
				keyGenerator: (request) => request.user?.id ?? request.ip,
			},
		},
		handler: submitFeedbackController.handler,
	});
}
