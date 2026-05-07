import {
	getActiveChallengesController,
	getChallengeHistoryController,
	getChallengeLeaderboardController,
} from "../../../controllers/challenges.controllers.js";
import { requireAuth } from "../../../middlewares/auth.middlewares.js";

/** @param {import('fastify').FastifyInstance} fastify */
export default async function (fastify) {
	fastify.get("/active", {
		preHandler: requireAuth,
		schema: getActiveChallengesController.schema,
		handler: getActiveChallengesController.handler,
	});

	fastify.get("/history", {
		preHandler: requireAuth,
		schema: getChallengeHistoryController.schema,
		handler: getChallengeHistoryController.handler,
	});

	fastify.get("/leaderboard", {
		preHandler: requireAuth,
		schema: getChallengeLeaderboardController.schema,
		handler: getChallengeLeaderboardController.handler,
	});
}
