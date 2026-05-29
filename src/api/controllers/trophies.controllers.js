/**
 * `GET /api/v1/players/:playerId/trophies` — public-ish trophy room
 * for one player.
 *
 * Build pipeline:
 *   1. Confirm the player exists (404 otherwise so the frontend
 *      doesn't have to disambiguate "no player" vs "no trophies").
 *   2. Load the player's matches (chronological, normalized).
 *   3. Aggregate to the stats blob used for progress on locked
 *      trophies.
 *   4. Build the response — hidden trophies are masked until
 *      unlocked.
 *
 * Any authenticated user can view any other player's trophies; this
 * mirrors `/stats/:playerId`. Personalisation (e.g. progress for
 * *yourself only*) could be added later, but trophies are a public
 * showcase by design.
 */

import { queryOne } from "../helpers/database.helpers.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import { playerIdParamsSchema } from "../schemas/trophies.schemas.js";
import { aggregatePlayerForTrophies } from "../services/trophy/trophyAggregation.services.js";
import { buildTrophyResponse } from "../services/trophy/trophyDisplay.services.js";
import { loadPlayerMatches } from "../services/trophy/trophyMatchLoader.services.js";

export const getTrophiesController = {
	schema: {
		params: playerIdParamsSchema,
	},
	handler: async (request, reply) => {
		try {
			const { playerId } = request.params;

			const profile = await queryOne(
				"SELECT id, trophies FROM profiles WHERE id = $1",
				[playerId],
			);
			if (!profile) {
				return setGeneralResponse(
					reply,
					404,
					"Not Found",
					"Player not found",
					null,
				);
			}

			const matches = await loadPlayerMatches(playerId);
			const stats = aggregatePlayerForTrophies(playerId, matches);
			const data = buildTrophyResponse({
				playerId,
				trophiesMap: profile.trophies ?? null,
				stats,
			});

			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Trophies retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
