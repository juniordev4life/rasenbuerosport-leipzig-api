/**
 * Fastify preHandler that authenticates the office recording agent via
 * a shared secret in the X-Agent-Secret header. The expected value comes
 * from the AGENT_SECRET environment variable.
 *
 * Machine auth, same pattern as `requireSchedulerSecret` — the agent is
 * a headless box next to the console, not a Firebase user.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @example
 * fastify.get("/", { preHandler: requireAgentSecret, handler });
 */
export async function requireAgentSecret(request, reply) {
	const expected = process.env.AGENT_SECRET;
	const provided = request.headers["x-agent-secret"];

	if (!expected || provided !== expected) {
		return reply.status(401).send({
			code: 401,
			title: "Unauthorized",
			message: "Invalid or missing agent secret",
			data: null,
			error: ["agent auth failed"],
		});
	}
}
