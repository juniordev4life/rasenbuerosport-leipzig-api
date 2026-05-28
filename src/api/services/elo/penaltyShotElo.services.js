/**
 * Penalty-shootout ELO deltas — applied INSIDE the same transaction
 * as `applyEloToMatch`, immediately after it. The regular ELO engine
 * still settles the team-level win / draw on the score before the
 * shootout (2:2 stays a draw for ELO purposes); these per-shot deltas
 * are a thin overlay on top so a single missed penalty doesn't get
 * lost in the team-level zero-sum.
 *
 * Why a separate pass instead of folding into the engine:
 *   - the engine is shared with regular games and 2v2 contribution
 *     scoring; we keep it untouched so the existing tests stay green;
 *   - per-shot deltas are tiny, additive numbers — they don't need
 *     the K-factor / rating-vs-opponent math the engine does;
 *   - if we ever drop this overlay the change is one `if` away.
 *
 * The function patches `profiles.current_rating`, replaces the LAST
 * entry of `rating_history` (the entry `applyEloToMatch` just pushed)
 * with the adjusted rating, and bumps `peak_elo_*` if the new value
 * tops it. No new history entry — one match = one history point.
 */

/**
 * Aggregates a shot list's `elo_deltas` into a single delta per
 * player so we can write each profile in one UPDATE.
 *
 * @param {Array<{ elo_deltas?: Record<string, number> }>} shots
 * @returns {Record<string, number>}
 * @example
 *   aggregateDeltas([
 *     { elo_deltas: { alice: -5, bob: 5 } },
 *     { elo_deltas: { alice: 3 } },
 *   ]); // { alice: -2, bob: 5 }
 */
export function aggregateDeltas(shots) {
	const totals = {};
	for (const shot of shots ?? []) {
		const deltas = shot?.elo_deltas;
		if (!deltas || typeof deltas !== "object") continue;
		for (const [playerId, delta] of Object.entries(deltas)) {
			if (typeof delta !== "number" || !Number.isFinite(delta)) continue;
			totals[playerId] = (totals[playerId] ?? 0) + delta;
		}
	}
	return totals;
}

/**
 * Applies aggregated per-shot deltas to the `profiles` table inside
 * an active transaction. Runs after the regular ELO pass, so the
 * last `rating_history` entry already reflects the team-level
 * outcome — we replace that entry with `current_rating + delta`
 * rather than push a new one.
 *
 * @param {object} args
 * @param {import("pg").PoolClient} args.client - Active pg client inside BEGIN.
 * @param {Array<{ elo_deltas?: Record<string, number> }>} args.shots - shootout shots
 * @param {string} args.playedAt - ISO timestamp used for the peak-ELO timestamp.
 * @returns {Promise<Record<string, number>>} The aggregated deltas that were applied,
 *   keyed by player id (useful for logging / debugging).
 */
export async function applyPenaltyShotEloDeltas({ client, shots, playedAt }) {
	const deltas = aggregateDeltas(shots);
	const playerIds = Object.keys(deltas);
	if (playerIds.length === 0) return deltas;

	for (const playerId of playerIds) {
		const delta = deltas[playerId];
		if (delta === 0) continue;

		// Single UPDATE per player so each row patches: rating += delta,
		// replace last history entry, lift peak if exceeded. We read the
		// current rating from the same row to keep the math atomic with
		// the write — no read-then-update race inside the TX.
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

	return deltas;
}
