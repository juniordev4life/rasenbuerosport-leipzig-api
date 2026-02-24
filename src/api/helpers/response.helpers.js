/**
 * Sets a standardized API response
 * @param {import('fastify').FastifyReply} reply
 * @param {number} code - HTTP status code
 * @param {string} title - Human-readable title
 * @param {string} message - Description
 * @param {*} data - Response payload
 * @returns {import('fastify').FastifyReply}
 */
export function setGeneralResponse(reply, code, title, message, data = null) {
	return reply.status(code).send({
		code,
		title,
		message,
		data,
		error: [],
	});
}
