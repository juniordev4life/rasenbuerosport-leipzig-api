/**
 * Card-penalty ELO overlay — applied once, when the FC26 defense
 * screenshot reveals the yellow/red card counts for a match.
 *
 * Why this exists: the live action-row used to have a yellow-card
 * button, but the volume was too high to track manually so it was
 * dropped. That left yellows invisible to the ELO engine, which in
 * turn made tactical fouling consequence-free. Pulling the counts
 * from the post-match screenshot and applying a small malus per
 * card brings the consequence back — the team that fouled more
 * pays for it.
 *
 * Red cards stay trackable live with player attribution. The
 * screenshot is the source of truth for "how many reds happened" —
 * any reds NOT attributed to a specific player (because the user
 * didn't tap the live red button) split the malus across the team.
 *
 * Idempotency: the caller sets a `card_elo_applied: true` flag on
 * `match_stats` after the first application so subsequent re-uploads
 * never double-charge.
 *
 * Architecture: same overlay pattern as `penaltyShotElo.services.js`.
 * Patches `profiles.current_rating`, replaces the LAST entry of
 * `rating_history` (one match → one history point) and lifts
 * `peak_elo_*` if the new value tops it. Does NOT touch the game's
 * `elo_snapshot` — consistent with the penalty overlay, the snapshot
 * stays at the team-result and the current_rating reflects the
 * cumulative effect.
 */

/**
 * ELO deltas applied per card. Tuned to "Medium" — yellow stings,
 * reds hurt. Tweak in one place if the league agrees the malus
 * should be softer / harder.
 */
export const CARD_ELO_DELTAS = Object.freeze({
	YELLOW_PER_CARD: -2,
	RED_ATTRIBUTED: -8,
	RED_UNATTRIBUTED_PER_CARD: -5,
});

/**
 * Counts red-card events attributed to a specific player in the
 * score timeline. Tolerant of both branches in the polymorphic
 * schema: the legacy `event_type: "red_card"` row and the modern
 * `event_type: "card"` + `card_type: "red"` row.
 *
 * @param {Array<object>} timeline
 * @param {string} playerId
 * @returns {number}
 * @example
 *   countAttributedReds(
 *     [{ event_type: "red_card", player_id: "alice", team: "home" }],
 *     "alice",
 *   ); // → 1
 */
function countAttributedReds(timeline, playerId) {
	if (!Array.isArray(timeline) || !playerId) return 0;
	let count = 0;
	for (const e of timeline) {
		if (!e || e.player_id !== playerId) continue;
		if (e.event_type === "red_card") count += 1;
		else if (e.event_type === "card" && e.card_type === "red") count += 1;
	}
	return count;
}

/**
 * Pure function — given the match stats, the score timeline and the
 * game_players list, returns the ELO deltas keyed by player id.
 *
 * Split rules:
 *   - Yellow cards: every yellow on a team distributes
 *     `YELLOW_PER_CARD` across the team's players. Per-player share
 *     is `Math.floor`'d so an odd team total rounds AWAY from zero —
 *     the team gets at least the full malus, never less.
 *   - Red cards (attributed): each red attributed in the timeline
 *     hits the named player with `RED_ATTRIBUTED` (full, no split).
 *   - Red cards (unattributed): screenshot count minus attributed
 *     count, then `RED_UNATTRIBUTED_PER_CARD` distributed across the
 *     full team — same shared-blame mechanic as yellows.
 *
 * @param {object} args
 * @param {object} args.matchStats - Reads `yellow_cards.{home,away}` and `red_cards.{home,away}`.
 * @param {Array<object>} args.timeline - score_timeline entries
 * @param {Array<{ player_id: string, team: 'home' | 'away' }>} args.gamePlayers
 * @returns {Record<string, number>} playerId → delta (always integer)
 * @example
 *   computeCardEloDeltas({
 *     matchStats: {
 *       yellow_cards: { home: 3, away: 0 },
 *       red_cards: { home: 1, away: 0 },
 *     },
 *     timeline: [],
 *     gamePlayers: [
 *       { player_id: "a", team: "home" },
 *       { player_id: "b", team: "home" },
 *     ],
 *   });
 *   // → { a: -6, b: -6 }  (yellow: 3*-2/2 = -3 each, red unattr: 1*-5/2 = -3 each)
 */
export function computeCardEloDeltas({ matchStats, timeline, gamePlayers }) {
	/** @type {Record<string, number>} */
	const deltas = {};
	if (!matchStats || !Array.isArray(gamePlayers) || gamePlayers.length === 0) {
		return deltas;
	}

	const yellowCounts = {
		home: Math.max(0, Number(matchStats?.yellow_cards?.home ?? 0) || 0),
		away: Math.max(0, Number(matchStats?.yellow_cards?.away ?? 0) || 0),
	};
	const redCounts = {
		home: Math.max(0, Number(matchStats?.red_cards?.home ?? 0) || 0),
		away: Math.max(0, Number(matchStats?.red_cards?.away ?? 0) || 0),
	};

	for (const team of /** @type {const} */ (["home", "away"])) {
		const teamPlayers = gamePlayers.filter((p) => p.team === team);
		if (teamPlayers.length === 0) continue;

		// YELLOW: total team malus, split equally
		const yellowTeamMalus =
			yellowCounts[team] * CARD_ELO_DELTAS.YELLOW_PER_CARD;
		const yellowPerPlayer = Math.floor(yellowTeamMalus / teamPlayers.length);

		// RED attributed: full personal malus per attributed event
		let attributedRedsThisTeam = 0;
		for (const p of teamPlayers) {
			const playerReds = countAttributedReds(timeline, p.player_id);
			attributedRedsThisTeam += playerReds;
			if (playerReds > 0) {
				const personal = playerReds * CARD_ELO_DELTAS.RED_ATTRIBUTED;
				deltas[p.player_id] = (deltas[p.player_id] ?? 0) + personal;
			}
		}

		// RED unattributed: screenshot count minus what live-tracking
		// captured. Negative or zero leftover means the live data already
		// covers (or over-covers) the screenshot — no extra malus.
		const unattributedReds = Math.max(
			0,
			redCounts[team] - attributedRedsThisTeam,
		);
		const unattributedTeamMalus =
			unattributedReds * CARD_ELO_DELTAS.RED_UNATTRIBUTED_PER_CARD;
		const unattributedPerPlayer = Math.floor(
			unattributedTeamMalus / teamPlayers.length,
		);

		const sharedPerPlayer = yellowPerPlayer + unattributedPerPlayer;
		if (sharedPerPlayer !== 0) {
			for (const p of teamPlayers) {
				deltas[p.player_id] = (deltas[p.player_id] ?? 0) + sharedPerPlayer;
			}
		}
	}

	return deltas;
}

/**
 * Persists per-player ELO deltas inside an existing transaction.
 * Same SQL pattern as `applyPenaltyShotEloDeltas`: in-place update
 * of current_rating, replace the LAST history entry, lift peak.
 *
 * @param {object} args
 * @param {import("pg").PoolClient} args.client - Active pg client inside BEGIN.
 * @param {Record<string, number>} args.deltas
 * @param {string} args.playedAt - ISO timestamp for the peak-ELO marker.
 * @returns {Promise<void>}
 */
export async function applyCardEloDeltas({ client, deltas, playedAt }) {
	const playerIds = Object.keys(deltas ?? {});
	if (playerIds.length === 0) return;

	for (const playerId of playerIds) {
		const delta = deltas[playerId];
		if (!Number.isFinite(delta) || delta === 0) continue;

		await client.query(
			`UPDATE profiles
			    SET current_rating = current_rating + $1,
			        rating_history = CASE
			            WHEN jsonb_typeof(rating_history) = 'array'
			              AND jsonb_array_length(rating_history) > 0
			            THEN jsonb_set(
			                rating_history,
			                ARRAY[(jsonb_array_length(rating_history) - 1)::text],
			                to_jsonb(current_rating + $1)
			            )
			            ELSE to_jsonb(ARRAY[current_rating + $1])
			        END,
			        rating_updated_at = now(),
			        peak_elo_value = GREATEST(peak_elo_value, current_rating + $1),
			        peak_elo_at = CASE
			            WHEN current_rating + $1 > peak_elo_value THEN $3::timestamptz
			            ELSE peak_elo_at
			        END
			  WHERE id = $2`,
			[delta, playerId, playedAt],
		);
	}
}
