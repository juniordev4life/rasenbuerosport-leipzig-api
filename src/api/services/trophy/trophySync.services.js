/**
 * Trophy sync — grants the trophies a player has actually earned but never had
 * persisted, and merges their duo unlocks into the player-level view.
 *
 * Why this exists: nothing evaluated trophies at runtime. `evaluateTrophiesForPlayer`
 * and `evaluateDuoTrophies` were called ONLY from scripts/trophy-backfill.js, so a
 * trophy earned after the last manual backfill (2026-05-29 in production) stayed
 * locked forever — while the progress bar next to it, computed live from the match
 * history on every request, happily showed 27/10. That contradiction is what got
 * reported: "Trophäen werden trotz Erreichen nicht freigeschaltet."
 *
 * Duo trophies had a second, independent problem: they live in their own
 * `duo_trophies` table, keyed by player pair, and nothing in `src/` ever read it.
 * The profile therefore reported "0 von 5 erreicht" no matter what the table said —
 * FlorAIn had two DU1 unlocks sitting there since May.
 *
 * Why unlocks are PERSISTED rather than derived live on each request: two
 * conditions are not monotonic (`winRate`, `duoWinRate` — an 80% win rate can
 * fall below the threshold again). Deriving would let an earned trophy disappear.
 * Storing is also what `wrapped.services.js` reads for its "trophies this week"
 * section, so the map has to be the durable record. Writes are add-only: an entry
 * already present is never touched, so unlock dates stay stable.
 */

import { query } from "../../helpers/database.helpers.js";
import {
	evaluateDuoTrophies,
	evaluateTrophiesForPlayer,
} from "./trophyCalculation.services.js";

/**
 * Adds unlocks that are missing from a stored trophy map. Add-only: an entry that
 * already exists keeps its original timestamp and trigger match.
 *
 * @param {object|null} existing - Stored map, keyed by trophy id
 * @param {Array<{trophyId: string, triggeredByMatchId: string|null}>} unlocks
 * @param {string} now - ISO timestamp for the new entries
 * @param {boolean} [backfilled=false] - Marks entries written by the backfill script
 * @returns {{next: object, newCount: number}}
 * @example
 * mergeTrophies({}, [{ trophyId: "DU1", triggeredByMatchId: null }], iso);
 * // { next: { DU1: { unlocked_at: iso, triggered_by_match_id: null, backfilled: false } }, newCount: 1 }
 */
export function mergeTrophies(existing, unlocks, now, backfilled = false) {
	const next = { ...(existing ?? {}) };
	let newCount = 0;
	for (const { trophyId, triggeredByMatchId } of unlocks) {
		if (next[trophyId]) continue;
		next[trophyId] = {
			unlocked_at: now,
			triggered_by_match_id: triggeredByMatchId,
			backfilled,
		};
		newCount += 1;
	}
	return { next, newCount };
}

/**
 * Which side of a match a player was on.
 *
 * @param {object} match - Normalized match (homePlayers / awayPlayers)
 * @param {string} playerId
 * @returns {"home"|"away"|null} null when the player did not play
 * @example
 * sideOf({ homePlayers: ["a"], awayPlayers: ["b"] }, "b"); // "away"
 */
function sideOf(match, playerId) {
	if (match.homePlayers?.includes(playerId)) return "home";
	if (match.awayPlayers?.includes(playerId)) return "away";
	return null;
}

/**
 * Every partner the player shared a side with, mapped to the matches they played
 * together. Derived from the matches the caller already loaded — no extra query.
 *
 * @param {string} playerId
 * @param {Array<object>} matches - Normalized matches of that player
 * @returns {Map<string, Array<object>>} partner id → shared matches
 * @example
 * partnersFromMatches("a", matches).get("b").length; // matches a+b played together
 */
function partnersFromMatches(playerId, matches) {
	const byPartner = new Map();
	for (const match of matches) {
		const side = sideOf(match, playerId);
		if (!side) continue;
		const mates = side === "home" ? match.homePlayers : match.awayPlayers;
		for (const mate of mates ?? []) {
			if (mate === playerId) continue;
			const bucket = byPartner.get(mate) ?? [];
			bucket.push(match);
			byPartner.set(mate, bucket);
		}
	}
	return byPartner;
}

/**
 * Persists newly earned individual trophies and returns the updated map.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {Array<object>} args.matches - Normalized matches
 * @param {object} args.stats - Pre-computed aggregate for those matches
 * @param {object|null} args.trophiesMap - Stored `profiles.trophies`
 * @param {string} args.now - ISO timestamp for new entries
 * @returns {Promise<object>} The map including any newly granted trophies
 * @example
 * await syncIndividualTrophies({ playerId, matches, stats, trophiesMap, now });
 */
async function syncIndividualTrophies({
	playerId,
	matches,
	stats,
	trophiesMap,
	now,
}) {
	const unlocks = evaluateTrophiesForPlayer({ playerId, matches, stats });
	const { next, newCount } = mergeTrophies(trophiesMap, unlocks, now);
	if (newCount > 0) {
		await query("UPDATE profiles SET trophies = $1::jsonb WHERE id = $2", [
			JSON.stringify(next),
			playerId,
		]);
	}
	return next;
}

/**
 * Evaluates every duo the player is part of, persists new pair unlocks, and
 * returns them flattened for the player-level view. A duo trophy counts for the
 * player as soon as ANY of their pairs earned it; the earliest unlock wins, so
 * the profile shows when they first achieved it.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {Array<object>} args.matches - Normalized matches of that player
 * @param {string} args.now - ISO timestamp for new entries
 * @returns {Promise<object>} Map of duo trophy id → stored entry
 * @example
 * await syncDuoTrophies({ playerId, matches, now }); // { DU1: { unlocked_at, … } }
 */
async function syncDuoTrophies({ playerId, matches, now }) {
	const partners = partnersFromMatches(playerId, matches);
	if (partners.size === 0) return {};

	// One read for every pair this player belongs to — a profile view would
	// otherwise fire a query per partner. Only pairs that actually gained a
	// trophy are written back.
	const stored = new Map();
	const rows = await query(
		`SELECT player1_id, player2_id, trophies
		   FROM duo_trophies
		  WHERE player1_id = $1 OR player2_id = $1`,
		[playerId],
	);
	for (const row of rows) {
		stored.set(`${row.player1_id}|${row.player2_id}`, row.trophies);
	}

	const flattened = {};
	for (const [partnerId, shared] of partners) {
		// The table is keyed by a sorted pair (LEAST/GREATEST, see
		// migrations/022_duo_trophies.sql) — sorting here keeps one row per pair
		// instead of two mirrored ones.
		const pair = [playerId, partnerId].sort();
		const unlocks = evaluateDuoTrophies({ duoPlayers: pair, matches: shared });
		const { next, newCount } = mergeTrophies(
			stored.get(`${pair[0]}|${pair[1]}`),
			unlocks,
			now,
		);
		if (newCount > 0) {
			await query(
				`INSERT INTO duo_trophies (player1_id, player2_id, trophies)
				 VALUES ($1, $2, $3::jsonb)
				 ON CONFLICT (player1_id, player2_id)
				 DO UPDATE SET trophies = EXCLUDED.trophies`,
				[pair[0], pair[1], JSON.stringify(next)],
			);
		}

		for (const [trophyId, entry] of Object.entries(next)) {
			const known = flattened[trophyId];
			if (!known || (entry.unlocked_at ?? "") < (known.unlocked_at ?? "")) {
				flattened[trophyId] = entry;
			}
		}
	}
	return flattened;
}

/**
 * Brings a player's trophies up to date and returns the map the display layer
 * should render: stored individual unlocks plus everything newly earned, plus the
 * duo unlocks from every pair they belong to.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {Array<object>} args.matches - Normalized matches (already loaded)
 * @param {object} args.stats - Aggregate for those matches (already computed)
 * @param {object|null} args.trophiesMap - Stored `profiles.trophies`
 * @param {string} [args.now] - ISO timestamp for new entries; injectable for tests
 * @returns {Promise<object>} Merged map keyed by trophy id
 * @example
 * const map = await syncPlayerTrophies({ playerId, matches, stats, trophiesMap });
 * buildTrophyResponse({ playerId, trophiesMap: map, stats });
 */
export async function syncPlayerTrophies({
	playerId,
	matches,
	stats,
	trophiesMap,
	now = new Date().toISOString(),
}) {
	const individual = await syncIndividualTrophies({
		playerId,
		matches,
		stats,
		trophiesMap,
		now,
	});
	const duo = await syncDuoTrophies({ playerId, matches, now });
	// Individual entries win on a key clash: a duo-scope id can never collide
	// with an individual one, but being explicit keeps the stored map authoritative.
	return { ...duo, ...individual };
}
