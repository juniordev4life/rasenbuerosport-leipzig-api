import { getFirebaseAuth } from "../../config/firebase.config.js";

/**
 * Fastify preHandler that verifies a Firebase ID token and attaches the user to the request
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

	try {
		const decodedToken = await getFirebaseAuth().verifyIdToken(token);
		request.user = {
			id: decodedToken.uid,
			email: decodedToken.email,
		};
	} catch (error) {
		return reply.status(401).send({
			code: 401,
			title: "Unauthorized",
			message: "Invalid or expired token",
			data: null,
			error: [error.message || "Token verification failed"],
		});
	}
}
