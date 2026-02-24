import { getSupabase } from "../../config/supabase.config.js";

/**
 * Fastify preHandler that verifies the Supabase JWT and attaches the user to the request
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export async function requireAuth(request, reply) {
	const authHeader = request.headers.authorization;

	if (!authHeader?.startsWith("Bearer ")) {
		return reply.status(401).send({
			code: 401,
			title: "Unauthorized",
			message: "Missing or invalid authorization header",
			data: null,
			error: ["No bearer token provided"],
		});
	}

	const token = authHeader.slice(7);
	const supabase = getSupabase();

	const {
		data: { user },
		error,
	} = await supabase.auth.getUser(token);

	if (error || !user) {
		return reply.status(401).send({
			code: 401,
			title: "Unauthorized",
			message: "Invalid or expired token",
			data: null,
			error: [error?.message || "Token verification failed"],
		});
	}

	request.user = user;
}
