import {
	getSeasonArchiveController,
	getSeasonsListController,
} from "../../../controllers/season.controllers.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	// GET /api/v1/seasons
	fastify.get("/", {
		schema: getSeasonsListController.schema,
		handler: getSeasonsListController.handler,
	});

	// GET /api/v1/seasons/archive
	fastify.get("/archive", {
		schema: getSeasonArchiveController.schema,
		handler: getSeasonArchiveController.handler,
	});
}
