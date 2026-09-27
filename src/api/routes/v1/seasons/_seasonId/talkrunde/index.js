import {
	generateSeasonTalkrundeController,
	renderSeasonTalkrundeController,
} from "../../../../../controllers/leagueSeason.controllers.js";
import { requireSchedulerSecret } from "../../../../../middlewares/schedulerAuth.middlewares.js";

/**
 * Season special of the talk show. Two operator steps (scheduler secret):
 * POST /generate writes the script, POST /audio renders it with ElevenLabs.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function (fastify) {
	fastify.post("/generate", {
		schema: generateSeasonTalkrundeController.schema,
		preHandler: [requireSchedulerSecret],
		handler: generateSeasonTalkrundeController.handler,
	});

	fastify.post("/audio", {
		schema: renderSeasonTalkrundeController.schema,
		preHandler: [requireSchedulerSecret],
		handler: renderSeasonTalkrundeController.handler,
	});
}
