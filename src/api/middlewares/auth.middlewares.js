import { getFirebaseAuth } from "../../config/firebase.config.js";
import { queryOne } from "../helpers/database.helpers.js";
import { ROLES } from "../../constants/roles.constants.js";

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

/**
 * Fastify preHandler that checks if the authenticated user has admin role.
 * Must be used AFTER requireAuth.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export async function requireAdmin(request, reply) {
	const profile = await queryOne("SELECT role FROM profiles WHERE id = $1", [
		request.user.id,
	]);

	if (!profile || profile.role !== ROLES.ADMIN) {
		return reply.status(403).send({
			code: 403,
			title: "Forbidden",
			message: "Admin access required",
			data: null,
			error: ["Insufficient permissions"],
		});
	}
}
