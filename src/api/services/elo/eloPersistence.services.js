/**
 * DB-touching layer that turns a freshly-created game into ELO
 * deltas, writes the per-match snapshot to `games.elo_snapshot`
 * and updates each affected `profiles` row with the new rating,
 * incremented match count and trimmed history.
 *
 * Designed to run INSIDE an existing transaction — the caller hands
 * in the `pg` client so the match insert, game_players inserts and
 * the ELO writes commit or roll back together. If ELO throws, the
 * whole match save is undone; we never persist a match without its
 * ELO snapshot, and we never bump a profile's rating without the
 * corresponding match row.
 */

import { computeMatchElo } from "./eloEngine.services.js";
import { buildMatchInputFromGame } from "./eloMatchInput.services.js";

const RATING_HISTORY_LIMIT = 30;

/**
 * Apply ELO to a game whose row + game_players have just been
 * inserted. Reads the players' current ratings + match counts, runs
 * the pure ELO engine, then writes the snapshot to the game and the
 * new ratings to the profiles — all on the supplied transactional
 * client.
 *
 * @param {object} args
 * @param {import("pg").PoolClient} args.client - Active pg client INSIDE a BEGIN block.
 * @param {object} args.game - The just-inserted game row.
 * @param {Array<{ player_id: string, team: string }>} args.gamePlayers
 *   The rows that were inserted into `game_players` for this game.
 * @returns {Promise<import("./eloEngine.services.js").MatchEloResult>}
 *
 * @example
 *   // Inside createGame's transaction, after game + game_players inserts:
 *   const eloResult = await applyEloToMatch({ client, game, gamePlayers });
 *   // game.elo_snapshot and the four profiles rows are now updated.
 */
export async function applyEloToMatch({ client, game, gamePlayers }) {
	const playerIds = gamePlayers.map((gp) => gp.player_id);
	if (playerIds.length === 0) {
		return { teamA: [], teamB: [], version: "n/a", matchMeta: {} };
	}

	// 1. Load current ratings + match counts for every player in the game.
	//    `rating_history` has to come along: step 4 appends to it, and a
	//    missing column would silently reset every player's series to a
	//    single entry on every match.
	const { rows: profiles } = await client.query(
		`SELECT id, current_rating, matches_played, rating_history
		   FROM profiles
		  WHERE id = ANY($1::text[])`,
		[playerIds],
	);
	const profilesById = new Map(profiles.map((p) => [p.id, p]));

	// 2. Build the engine input and run the pure computation.
	const input = buildMatchInputFromGame({ game, gamePlayers, profilesById });
	const eloResult = computeMatchElo(input);

	// 3. Persist the per-match snapshot.
	await client.query(
		"UPDATE games SET elo_snapshot = $1::jsonb WHERE id = $2",
		[JSON.stringify(eloResult), game.id],
	);

	// 4. Update each profile with the new rating + history.
	for (const playerResult of [...eloResult.teamA, ...eloResult.teamB]) {
		const profile = profilesById.get(playerResult.playerId);
		const oldHistory = Array.isArray(profile?.rating_history)
			? profile.rating_history
			: [];
		const trimmedHistory = [
			...oldHistory.slice(-(RATING_HISTORY_LIMIT - 1)),
			playerResult.ratingAfter,
		];

		await client.query(
			`UPDATE profiles
			    SET current_rating = $1,
			        matches_played = matches_played + 1,
			        rating_updated_at = now(),
			        rating_history = $2::jsonb,
			        peak_elo_value = GREATEST(peak_elo_value, $1),
			        peak_elo_at = CASE
			            WHEN $1 > peak_elo_value THEN $4::timestamptz
			            ELSE peak_elo_at
			        END
			  WHERE id = $3`,
			[
				playerResult.ratingAfter,
				JSON.stringify(trimmedHistory),
				playerResult.playerId,
				game.played_at,
			],
		);
	}

	return eloResult;
}

/**
 * Re-compute ELO for an existing game whose snapshot is missing or
 * stale. Reads the game + game_players from the DB, then runs
 * `applyEloToMatch` on a fresh transaction. Intended for backfill
 * scripts and admin recomputation — NOT for the regular save flow.
 *
 * Currently unused. Two caveats before wiring it up anywhere:
 *   - It runs the team engine ONLY. The penalty-shootout and card
 *     overlays are skipped, so a game that had either would come out
 *     with a rating the live path would never have produced. Use
 *     `replayGameElo` from `eloReplay.services.js` for the full
 *     sequence.
 *   - Recomputing one game in isolation does not fix the games after
 *     it. ELO is path-dependent, so a correction to an old match has
 *     to be followed by a full replay.
 *
 * @param {object} args
 * @param {import("pg").Pool} args.pool
 * @param {string} args.gameId
 * @returns {Promise<import("./eloEngine.services.js").MatchEloResult|null>}
 */
export async function recomputeEloForGame({ pool, gameId }) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const { rows: gameRows } = await client.query(
			"SELECT * FROM games WHERE id = $1",
			[gameId],
		);
		const game = gameRows[0];
		if (!game) {
			await client.query("ROLLBACK");
			return null;
		}
		const { rows: gamePlayers } = await client.query(
			"SELECT player_id, team FROM game_players WHERE game_id = $1",
			[gameId],
		);
		const result = await applyEloToMatch({ client, game, gamePlayers });
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
