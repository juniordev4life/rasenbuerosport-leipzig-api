import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	recapGenerateQuerySchema,
	recapNotifyQuerySchema,
	seasonIdParamsSchema,
} from "../schemas/leagueSeason.schemas.js";
import {
	listLeagueSeasons,
	requireLeagueSeason,
} from "../services/leagueSeason.services.js";
import {
	generateSeasonRecap,
	getMyRecap,
	getSeasonAwards,
	notifySeasonRecap,
} from "../services/season/seasonRecap.services.js";
import {
	buildSeasonRating,
	loadSeasonData,
} from "../services/season/seasonStandings.services.js";
import {
	generateSeasonTalkrundeScript,
	renderSeasonTalkrundeAudio,
} from "../services/season/seasonTalkrunde.services.js";

/**
 * Wraps a service call in the standard envelope + error handling.
 *
 * @param {string} message - Success message
 * @param {(request: import('fastify').FastifyRequest) => Promise<*>} run
 * @returns {Function} Fastify handler
 * @example
 * handler: respond("Seasons retrieved", () => listLeagueSeasons());
 */
function respond(message, run) {
	return async (request, reply) => {
		try {
			const data = await run(request);
			return setGeneralResponse(reply, 200, "Success", message, data);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	};
}

export const listLeagueSeasonsController = {
	handler: respond("Seasons retrieved", () => listLeagueSeasons()),
};

export const getSeasonRatingController = {
	schema: { params: seasonIdParamsSchema },
	handler: respond("Season rating retrieved", async (request) => {
		const season = await requireLeagueSeason(request.params.seasonId);
		return buildSeasonRating(await loadSeasonData(season), season);
	}),
};

export const getSeasonAwardsController = {
	schema: { params: seasonIdParamsSchema },
	handler: respond("Season awards retrieved", (request) =>
		getSeasonAwards(request.params.seasonId),
	),
};

export const getMyRecapController = {
	schema: { params: seasonIdParamsSchema },
	handler: respond("Season recap retrieved", (request) =>
		getMyRecap(request.params.seasonId, request.user.id),
	),
};

export const generateSeasonRecapController = {
	schema: {
		params: seasonIdParamsSchema,
		querystring: recapGenerateQuerySchema,
	},
	handler: respond("Season recap generated", (request) =>
		generateSeasonRecap(request.params.seasonId, {
			skipAi: request.query.skip_ai,
		}),
	),
};

export const notifySeasonRecapController = {
	schema: { params: seasonIdParamsSchema, querystring: recapNotifyQuerySchema },
	handler: respond("Season recap push sent", (request) =>
		notifySeasonRecap(request.params.seasonId, {
			onlyUser: request.query.only_user,
		}),
	),
};

export const generateSeasonTalkrundeController = {
	schema: { params: seasonIdParamsSchema },
	handler: respond("Season talk show script generated", (request) =>
		generateSeasonTalkrundeScript(request.params.seasonId),
	),
};

export const renderSeasonTalkrundeController = {
	schema: { params: seasonIdParamsSchema },
	handler: respond("Season talk show audio rendered", (request) =>
		renderSeasonTalkrundeAudio(request.params.seasonId),
	),
};
