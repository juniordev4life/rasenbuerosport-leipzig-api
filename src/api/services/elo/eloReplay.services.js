/**
 * Full ELO replay for a single historical game — the one place that
 * knows every pass a game went through when it was first saved.
 *
 * Why this exists: the live save path applies ELO in three passes that
 * are spread across two services and two different HTTP requests:
 *
 *   1. the team-level engine        (games.services.js, on save)
 *   2. the penalty-shootout overlay (games.services.js, on save)
 *   3. the card overlay             (matchStats.services.js, on the
 *                                    first defense-screenshot upload)
 *
 * A backfill that only re-runs pass 1 silently drops passes 2 and 3
 * for EVERY game in the league, not just the one being corrected.
 * Keeping the full sequence here means the replay and the live path
 * can only drift if someone edits this file.
 *
 * Pass order matters. Both overlays patch the LAST entry of
 * `rating_history` rather than pushing a new one (one match → one
 * history point), so they must run after the engine has pushed that
 * entry.
 */

import {
	applyCardEloDeltas,
	computeCardEloDeltas,
} from "./cardElo.services.js";
import { applyEloToMatch } from "./eloPersistence.services.js";
import { applyPenaltyShotEloDeltas } from "./penaltyShotElo.services.js";

/**
 * Replays all ELO passes for one already-persisted game on an active
 * transaction.
 *
 * The two overlays are re-applied only where the stored game row shows
 * they ran the first time round:
 *
 *   - penalty: `penalty_shootout.shots[]` carries the per-shot
 *     `elo_deltas` verbatim, so the overlay is reproducible from the
 *     row alone.
 *   - card: `match_stats.card_elo_applied` is the durable record that
 *     a defense screenshot was uploaded and charged. The flag is read,
 *     never written — the live path owns it, and leaving it untouched
 *     keeps a later re-upload correctly skipped.
 *
 * @param {object} args
 * @param {import("pg").PoolClient} args.client - Active pg client INSIDE a BEGIN block.
 * @param {object} args.game - Full `games` row (needs `penalty_shootout`,
 *   `match_stats`, `score_timeline`, `played_at`).
 * @param {Array<{ player_id: string, team: string }>} args.gamePlayers
 * @returns {Promise<{
 *   elo: import("./eloEngine.services.js").MatchEloResult,
 *   penaltyDeltas: Record<string, number> | null,
 *   cardDeltas: Record<string, number> | null,
 * }>} The engine result plus whichever overlays actually ran (`null` when skipped).
 *
 * @example
 *   await client.query("BEGIN");
 *   const { penaltyDeltas, cardDeltas } = await replayGameElo({
 *     client,
 *     game,          // SELECT * FROM games WHERE id = ...
 *     gamePlayers,   // SELECT player_id, team FROM game_players WHERE game_id = ...
 *   });
 *   await client.query("COMMIT");
 *   // penaltyDeltas → { "uid-a": -4, "uid-b": 4 } or null if the game had no shootout
 */
export async function replayGameElo({ client, game, gamePlayers }) {
	const elo = await applyEloToMatch({ client, game, gamePlayers });

	let penaltyDeltas = null;
	if (game?.penalty_shootout?.shots?.length) {
		penaltyDeltas = await applyPenaltyShotEloDeltas({
			client,
			shots: game.penalty_shootout.shots,
			playedAt: game.played_at,
		});
	}

	let cardDeltas = null;
	if (game?.match_stats?.card_elo_applied) {
		cardDeltas = computeCardEloDeltas({
			matchStats: game.match_stats,
			timeline: game.score_timeline ?? [],
			gamePlayers,
		});
		await applyCardEloDeltas({
			client,
			deltas: cardDeltas,
			playedAt: game.played_at,
		});
	}

	return { elo, penaltyDeltas, cardDeltas };
}
