/**
 * Fastify preHandler that authorizes Cloud Scheduler (or equivalent) requests via
 * a shared secret in the X-Trigger-Secret header. The expected value comes from the
 * WRAPPED_TRIGGER_SECRET env var.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export async function requireSchedulerSecret(request, reply) {
	const expected = process.env.WRAPPED_TRIGGER_SECRET;
	const provided = request.headers["x-trigger-secret"];

	if (!expected || provided !== expected) {
		return reply.status(401).send({
			code: 401,
			title: "Unauthorized",
			message: "Invalid or missing trigger secret",
			data: null,
			error: ["scheduler auth failed"],
		});
	}
}
