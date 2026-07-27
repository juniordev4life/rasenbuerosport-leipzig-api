/**
 * Rewrites player references inside the JSONB blobs on a `games` row.
 *
 * Correcting a lineup after the fact is not a single-row update. The
 * player id is denormalized into `score_timeline` and
 * `penalty_shootout` alongside the `game_players` row, and each blob
 * spells it differently:
 *
 *   score_timeline  goal            → scored_by, assist_by
 *                   red_card / card → player_id
 *                   penalty_missed  → shooter_id, keeper_id
 *   penalty_shootout.shots[]        → shooter_id, keeper_id,
 *                                     elo_deltas (as object KEYS)
 *
 * Miss one and the data goes quietly inconsistent: goals stay credited
 * to the wrong player, and — worse — a replay would hand the shootout
 * deltas in `elo_deltas` back to whoever the old key names, undoing
 * the correction the lineup swap was supposed to make.
 *
 * Deliberately NOT touched here, because they carry no player id:
 * `match_stats` (team-level home/away counts), `home_pass_network` /
 * `away_pass_network` (jersey numbers), `reporter_id` (AI persona).
 * `elo_snapshot` is player-keyed but a full recompute rebuilds it, so
 * the caller clears it rather than patching it.
 */

/** Timeline fields that hold a player id, across all event branches. */
const TIMELINE_PLAYER_FIELDS = Object.freeze([
	"scored_by",
	"assist_by",
	"player_id",
	"shooter_id",
	"keeper_id",
]);

/** Shot fields that hold a player id. */
const SHOT_PLAYER_FIELDS = Object.freeze(["shooter_id", "keeper_id"]);

/**
 * Replaces every player-id occurrence in a score timeline.
 *
 * Entries are copied, not mutated, so the caller can diff old against
 * new. Unknown fields survive untouched — the timeline schema accepts
 * additional properties and the reader ignores what it does not know.
 *
 * @param {Array<object>|null|undefined} timeline - `games.score_timeline`.
 * @param {string} fromId - Player id to replace.
 * @param {string} toId - Player id to write instead.
 * @returns {{ timeline: Array<object>|null, changed: number }} Rewritten
 *   timeline plus the number of individual field replacements made.
 * @example
 *   rewritePlayerInTimeline(
 *     [{ event_type: "goal", scored_by: "hendrik", assist_by: "jay" }],
 *     "hendrik",
 *     "alex",
 *   );
 *   // → { timeline: [{ event_type: "goal", scored_by: "alex", assist_by: "jay" }],
 *   //     changed: 1 }
 */
export function rewritePlayerInTimeline(timeline, fromId, toId) {
	if (!Array.isArray(timeline))
		return { timeline: timeline ?? null, changed: 0 };

	let changed = 0;
	const rewritten = timeline.map((entry) => {
		if (!entry || typeof entry !== "object") return entry;
		const next = { ...entry };
		for (const field of TIMELINE_PLAYER_FIELDS) {
			if (next[field] === fromId) {
				next[field] = toId;
				changed += 1;
			}
		}
		return next;
	});

	return { timeline: rewritten, changed };
}

/**
 * Replaces every player-id occurrence in a penalty shootout, including
 * the `elo_deltas` map where the id is an object KEY rather than a
 * value.
 *
 * If both ids somehow carry a delta on the same shot the two are
 * summed, so the shot's total stays the number it was before the swap.
 *
 * @param {object|null|undefined} shootout - `games.penalty_shootout`.
 * @param {string} fromId - Player id to replace.
 * @param {string} toId - Player id to write instead.
 * @returns {{ shootout: object|null, changed: number }} Rewritten shootout
 *   plus the number of individual replacements made (fields + delta keys).
 * @example
 *   rewritePlayerInShootout(
 *     { shots: [{ shooter_id: "hendrik", elo_deltas: { hendrik: -4, jay: 4 } }] },
 *     "hendrik",
 *     "alex",
 *   );
 *   // → { shootout: { shots: [{ shooter_id: "alex",
 *   //                           elo_deltas: { alex: -4, jay: 4 } }] },
 *   //     changed: 2 }
 */
export function rewritePlayerInShootout(shootout, fromId, toId) {
	if (
		!shootout ||
		typeof shootout !== "object" ||
		!Array.isArray(shootout.shots)
	) {
		return { shootout: shootout ?? null, changed: 0 };
	}

	let changed = 0;
	const shots = shootout.shots.map((shot) => {
		if (!shot || typeof shot !== "object") return shot;
		const next = { ...shot };

		for (const field of SHOT_PLAYER_FIELDS) {
			if (next[field] === fromId) {
				next[field] = toId;
				changed += 1;
			}
		}

		if (next.elo_deltas && typeof next.elo_deltas === "object") {
			const deltas = { ...next.elo_deltas };
			if (Object.hasOwn(deltas, fromId)) {
				const moved = deltas[fromId];
				delete deltas[fromId];
				deltas[toId] = (deltas[toId] ?? 0) + moved;
				next.elo_deltas = deltas;
				changed += 1;
			}
		}

		return next;
	});

	return { shootout: { ...shootout, shots }, changed };
}
