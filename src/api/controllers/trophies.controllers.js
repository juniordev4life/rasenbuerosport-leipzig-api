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
import { syncPlayerTrophies } from "../services/trophy/trophySync.services.js";

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
			// Grant what the player has earned since the last sync and pull in the
			// duo unlocks from their pairs. Without this the progress bars are live
			// while the badges are frozen at the last manual backfill — the exact
			// contradiction reported as "Trophäen werden trotz Erreichen nicht
			// freigeschaltet". Add-only, so unlock dates never move.
			const trophiesMap = await syncPlayerTrophies({
				playerId,
				matches,
				stats,
				trophiesMap: profile.trophies ?? null,
			});
			const data = buildTrophyResponse({ playerId, trophiesMap, stats });

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
