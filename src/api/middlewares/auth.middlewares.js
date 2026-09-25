import { getFirebaseAuth } from "../../config/firebase.config.js";
import { ALLOWED_EMAIL_DOMAIN } from "../../constants/auth.constants.js";
import { ROLES } from "../../constants/roles.constants.js";
import { queryOne } from "../helpers/database.helpers.js";

/**
 * Sends an auth error in the standard response shape.
 * @param {import('fastify').FastifyReply} reply
 * @param {401|403} code
 * @param {string} message
 * @param {string} error - Single generic reason for the `error` array
 * @returns {import('fastify').FastifyReply}
 */
function sendAuthError(reply, code, message, error) {
	return reply.status(code).send({
		code,
		title: code === 401 ? "Unauthorized" : "Forbidden",
		message,
		data: null,
		error: [error],
	});
}

/**
 * True when a verified ID token belongs to a verified address on the allowed
 * email domain. The `@` in the suffix check rules out lookalikes such as
 * `evilredbulls.com`, `redbulls.com.evil.com` or subdomains.
 * @param {import('firebase-admin/auth').DecodedIdToken} decodedToken
 * @returns {boolean}
 */
function isAllowedAccount({ email, email_verified: emailVerified }) {
	return (
		emailVerified === true &&
		typeof email === "string" &&
		email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)
	);
}

/**
 * Logs why a token failed verification (server-side only) and answers with
 * the generic 401.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {Error & { code?: string }} error - Error thrown by verifyIdToken
 * @returns {import('fastify').FastifyReply}
 */
function rejectToken(request, reply, error) {
	// Firebase uses one code (auth/argument-error) for many causes, such as
	// a wrong project or a bad signature, so log the message too. It never
	// contains the token itself.
	request.log.info(
		{ code: error?.code, reason: error?.message },
		"ID token verification failed",
	);
	return sendAuthError(
		reply,
		401,
		"Invalid or expired token",
		"Token verification failed",
	);
}

/**
 * Logs why an account was rejected (server-side only) and answers with the
 * neutral 403 that is identical for every rejection reason.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {import('firebase-admin/auth').DecodedIdToken} decodedToken
 * @returns {import('fastify').FastifyReply}
 */
function rejectAccount(request, reply, { uid, email, email_verified }) {
	request.log.warn(
		{
			uid,
			emailDomain: email?.split("@").pop().toLowerCase(),
			emailVerified: email_verified === true,
		},
		"Account rejected: not a verified address on the allowed domain",
	);
	return sendAuthError(reply, 403, "User not authorized", "Access denied");
}

/**
 * Fastify preHandler that verifies a Firebase ID token, admits only verified
 * accounts on the allowed email domain, and attaches the user to the request.
 *
 * Rejections are deliberately generic: a 401 never says why the token failed,
 * and a 403 looks the same for a foreign domain and an unverified address.
 * The reason goes to the server log. The app signs the user out when it sees
 * the exact 403 message "User not authorized", so keep that message stable.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @example
 * fastify.get("/", { preHandler: [requireAuth], handler });
 */
export async function requireAuth(request, reply) {
	const authHeader = request.headers.authorization;

	if (!authHeader?.startsWith("Bearer ")) {
		return sendAuthError(
			reply,
			401,
			"Missing or invalid authorization header",
			"No bearer token provided",
		);
	}

	let decodedToken;
	try {
		decodedToken = await getFirebaseAuth().verifyIdToken(authHeader.slice(7));
	} catch (error) {
		return rejectToken(request, reply, error);
	}

	if (!isAllowedAccount(decodedToken)) {
		return rejectAccount(request, reply, decodedToken);
	}

	request.user = { id: decodedToken.uid, email: decodedToken.email };
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
		return sendAuthError(
			reply,
			403,
			"Admin access required",
			"Insufficient permissions",
		);
	}
}
