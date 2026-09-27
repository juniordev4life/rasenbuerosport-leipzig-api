import { listLeagueSeasonsController } from "../../../controllers/leagueSeason.controllers.js";
import { getSeasonArchiveController } from "../../../controllers/season.controllers.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	// GET /api/v1/seasons — league seasons (EA FC editions), newest first
	fastify.get("/", {
		handler: listLeagueSeasonsController.handler,
	});

	// GET /api/v1/seasons/archive
	fastify.get("/archive", {
		schema: getSeasonArchiveController.schema,
		handler: getSeasonArchiveController.handler,
	});
}
