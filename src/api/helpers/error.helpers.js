import { setGeneralResponse } from "./response.helpers.js";

/**
 * Handles error responses in a standardized way
 * @param {import('fastify').FastifyReply} reply
 * @param {Error} error
 * @param {import('fastify').FastifyRequest} request
 * @returns {import('fastify').FastifyReply}
 */
export function handleErrorResponse(reply, error, request) {
	request.log.error(error, error.message);

	const statusCode = error.statusCode || 500;
	const title = statusCode >= 500 ? "Internal Server Error" : "Request Error";
	const message =
		statusCode >= 500
			? "An unexpected error occurred"
			: error.message || "Bad request";

	return setGeneralResponse(reply, statusCode, title, message);
}
