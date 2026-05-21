/**
 * Orchestrator for the `/players/:id/profile` endpoint.
 *
 * Composes pure axis calculations, the deterministic archetype
 * decision-tree, the LLM bio generator, the relationship cards and
 * the badge list into one response. Caches the assembled snapshot
 * on `profiles.profile_cache` (JSONB) and invalidates it whenever a
 * player participates in a new match (hook in createGame).
 *
 * Cache rules:
 *   - cache is invalid if missing, expired (TTL), or computed for
 *     a different match count than the player has now
 *   - on cache miss: recompute everything, write back the snapshot
 *   - the LLM bio has its own freshness check inside
 *     `generateOrLoadBio` so we do not burn Claude tokens on every
 *     cache miss
 */

import {
	PROFILE_ALGORITHM_VERSION,
	PROFILE_CONSTANTS,
} from "../../../constants/profile.constants.js";
import { ARCHETYPES } from "../../../constants/profileArchetypes.constants.js";
import { query, queryOne } from "../../helpers/database.helpers.js";
import { determineArchetype } from "./archetype.services.js";
import { computeClutchAxis } from "./axes/clutch.services.js";
import { computeConsistencyAxis } from "./axes/consistency.services.js";
import { computeDisciplineAxis } from "./axes/discipline.services.js";
import { computeFinisherAxis } from "./axes/finisher.services.js";
import { computePlaymakerAxis } from "./axes/playmaker.services.js";
import { computeWinnerAxis } from "./axes/winner.services.js";
import {
	loadAllPlayerHistories,
	loadLeagueSnapshot,
	loadPlayerHistory,
} from "./historyAggregation.services.js";
import { generateOrLoadBio } from "./profileBio.services.js";
import { computeRelationships } from "./relationships.services.js";

/**
 * Map match count to the profile state. Bounds come from
 * `PROFILE_CONSTANTS`.
 *
 * @param {number} matchCount
 * @returns {"frischling"|"im_aufbau"|"vollwertig"}
 */
export function determineProfileState(matchCount) {
	if (!Number.isFinite(matchCount) || matchCount <= 0) return "frischling";
	if (matchCount <= PROFILE_CONSTANTS.freshmanMaxMatches) return "frischling";
	if (matchCount <= PROFILE_CONSTANTS.developingMaxMatches) return "im_aufbau";
	return "vollwertig";
}

/**
 * Is the cached snapshot fresh enough to serve directly?
 *
 * @param {object|null} cache
 * @param {number} currentMatchCount
 * @returns {boolean}
 */
export function isCacheValid(cache, currentMatchCount) {
	if (!cache?.computedAt) return false;
	if (cache.version !== PROFILE_ALGORITHM_VERSION) return false;
	if (cache.computedFromMatchCount !== currentMatchCount) return false;
	const ts = Date.parse(cache.computedAt);
	if (!Number.isFinite(ts)) return false;
	const ageSeconds = (Date.now() - ts) / 1000;
	return ageSeconds < PROFILE_CONSTANTS.profileCacheTtlSeconds;
}

/**
 * Compute the assembled profile payload for one player.
 *
 * @param {string} playerId
 * @returns {Promise<object>}
 */
export async function computePlayerProfile(playerId) {
	const profile = await queryOne(
		`SELECT id, username, avatar_url, current_rating, matches_played,
		        profile_cache,
		        (SELECT COUNT(*)::int FROM game_players gp WHERE gp.player_id = profiles.id) AS actual_match_count
		   FROM profiles WHERE id = $1`,
		[playerId],
	);
	if (!profile) {
		const err = new Error("Player not found");
		err.statusCode = 404;
		throw err;
	}

	// matchCount is derived from the live game_players count rather than
	// profiles.matches_played, because the ELO integration only started
	// incrementing matches_played from the date it was wired in. Historical
	// matches still need to count for profile-state gating (Frischling /
	// Im Aufbau / Etabliert).
	const matchCount = Number(profile.actual_match_count ?? 0);
	const profileState = determineProfileState(matchCount);

	// Recent form is always fresh — cheap LIMIT 5 query, must reflect
	// the very latest match outcomes even on a cache hit.
	const recentForm = await loadRecentMatchResults(playerId, 5);

	// Freshman: no axes, no archetype, no bio. Return early.
	if (profileState === "frischling") {
		return assembleResponse({
			profile,
			profileState,
			axes: null,
			baseArchetype: null,
			bio: null,
			relationships: emptyRelationships(),
			topBadges: [],
			totalBadges: 0,
			rank: null,
			totalPlayers: await countPlayers(),
			recentForm,
		});
	}

	// Cache hit
	if (isCacheValid(profile.profile_cache, matchCount)) {
		const cache = profile.profile_cache;
		return assembleResponse({
			profile,
			profileState: cache.profileState,
			axes: cache.axes,
			baseArchetype: cache.baseArchetype,
			bio: cache.bio,
			relationships: cache.relationships ?? emptyRelationships(),
			topBadges: cache.topBadges ?? [],
			totalBadges: cache.totalBadges ?? 0,
			rank: cache.rank ?? null,
			totalPlayers: cache.totalPlayers ?? (await countPlayers()),
			recentForm,
		});
	}

	// Cache miss — full recompute
	const { byPlayer } = await loadAllPlayerHistories();
	const playerHistory = loadPlayerHistory(byPlayer, playerId);
	const leaguePlayers = await loadLeagueSnapshot(byPlayer);

	const axes = {
		finisher: computeFinisherAxis(playerHistory, leaguePlayers),
		playmaker: computePlaymakerAxis(playerHistory, leaguePlayers),
		clutch: computeClutchAxis(playerHistory, leaguePlayers),
		consistency: computeConsistencyAxis(playerHistory, leaguePlayers),
		discipline: computeDisciplineAxis(playerHistory, leaguePlayers),
		winner: computeWinnerAxis(playerHistory, leaguePlayers),
	};
	const baseArchetype = determineArchetype(axes);

	let bio = null;
	if (profileState === "vollwertig") {
		bio = await generateOrLoadBio({
			baseArchetype,
			axes,
			matchCount,
			recentMatches: recentForm,
			cachedBio: profile.profile_cache?.bio ?? null,
		});
	}

	const relationships = await computeRelationships(playerId);
	const { topBadges, totalBadges } = await loadTopBadges(playerId);
	const { rank, totalPlayers } = await loadRankAndCount(playerId);

	const snapshot = {
		version: PROFILE_ALGORITHM_VERSION,
		profileState,
		axes,
		baseArchetype,
		bio,
		relationships,
		topBadges,
		totalBadges,
		rank,
		totalPlayers,
		computedAt: new Date().toISOString(),
		computedFromMatchCount: matchCount,
	};

	await queryOne(
		"UPDATE profiles SET profile_cache = $1::jsonb WHERE id = $2 RETURNING id",
		[JSON.stringify(snapshot), playerId],
	);

	return assembleResponse({
		profile,
		profileState,
		axes,
		baseArchetype,
		bio,
		relationships,
		topBadges,
		totalBadges,
		rank,
		totalPlayers,
		recentForm,
	});
}

/**
 * Invalidate the profile cache for every player that touched a
 * just-saved match. Called from `games.services.js → createGame`
 * right after the ELO update inside the same transaction.
 *
 * Accepts a pg client so the invalidation joins the existing
 * BEGIN/COMMIT block.
 *
 * @param {{ client: import("pg").PoolClient, playerIds: string[] }} args
 * @returns {Promise<void>}
 */
export async function invalidateProfileCache({ client, playerIds }) {
	if (!Array.isArray(playerIds) || playerIds.length === 0) return;
	await client.query(
		"UPDATE profiles SET profile_cache = NULL WHERE id = ANY($1::text[])",
		[playerIds],
	);
}

// ---------- helpers ----------

function emptyRelationships() {
	return { lieblingsgegner: null, angstgegner: null, topPartner: null };
}

async function countPlayers() {
	const row = await queryOne("SELECT COUNT(*)::int AS n FROM profiles");
	return row?.n ?? 0;
}

/**
 * Load (rank, totalPlayers) for the player based on current_rating
 * DESC. Players with zero matches are excluded from the rank so a
 * fresh sign-up doesn't sit at the top.
 *
 * @param {string} playerId
 * @returns {Promise<{ rank: number|null, totalPlayers: number }>}
 */
async function loadRankAndCount(playerId) {
	const rows = await query(
		`
		WITH ranked AS (
			SELECT p.id, RANK() OVER (ORDER BY p.current_rating DESC) AS rnk
			FROM profiles p
			WHERE EXISTS (SELECT 1 FROM game_players gp WHERE gp.player_id = p.id)
		)
		SELECT (SELECT rnk FROM ranked WHERE id = $1) AS rank,
		       (SELECT COUNT(*)::int FROM ranked) AS total
		`,
		[playerId],
	);
	const row = rows[0] ?? {};
	return {
		rank: row.rank == null ? null : Number(row.rank),
		totalPlayers: row.total ?? 0,
	};
}

/**
 * Load the most-recent N match results from the player's
 * perspective for the LLM bio context + the form snapshot.
 *
 * @param {string} playerId
 * @param {number} limit
 * @returns {Promise<Array<{ matchId: string, result: "win"|"loss"|"draw", date: string }>>}
 */
async function loadRecentMatchResults(playerId, limit) {
	const rows = await query(
		`
		SELECT g.id, g.score_home, g.score_away, g.played_at, gp.team
		FROM games g
		JOIN game_players gp ON gp.game_id = g.id AND gp.player_id = $1
		ORDER BY g.played_at DESC
		LIMIT $2
		`,
		[playerId, limit],
	);
	return rows.map((r) => {
		const own = r.team === "home" ? r.score_home : r.score_away;
		const opp = r.team === "home" ? r.score_away : r.score_home;
		const result = own > opp ? "win" : own < opp ? "loss" : "draw";
		return {
			matchId: r.id,
			result,
			date:
				r.played_at instanceof Date
					? r.played_at.toISOString()
					: String(r.played_at),
		};
	});
}

/**
 * Load the player's top three badges. Reuses the existing
 * getUserStats badge engine — we ask for the full badge list and
 * pick the three "best" ones: gold > silver > bronze, ties broken
 * by most recent unlock.
 *
 * @param {string} playerId
 * @returns {Promise<{ topBadges: Array<object>, totalBadges: number }>}
 */
async function loadTopBadges(playerId) {
	// Lazy-loaded to avoid a hot-path import cycle (stats.services
	// itself depends on plenty of things; importing at file scope
	// would slow first response unnecessarily).
	const { getUserStats } = await import("../stats.services.js");
	try {
		const stats = await getUserStats(playerId);
		const all = Array.isArray(stats?.badges)
			? stats.badges.filter((b) => b?.unlocked)
			: [];
		const ranked = [...all].sort((a, b) => {
			const tierA = tierWeight(a);
			const tierB = tierWeight(b);
			if (tierA !== tierB) return tierB - tierA;
			const ta = Date.parse(a.unlocked_at ?? "") || 0;
			const tb = Date.parse(b.unlocked_at ?? "") || 0;
			return tb - ta;
		});
		return {
			topBadges: ranked.slice(0, 3),
			totalBadges: all.length,
		};
	} catch {
		return { topBadges: [], totalBadges: 0 };
	}
}

/**
 * Score a badge by its tier suffix (gold > silver > bronze > other).
 * Badge `type` strings follow the convention `name_tier`, e.g.
 * `torjaeger_gold`.
 *
 * @param {object} badge
 * @returns {number}
 */
function tierWeight(badge) {
	const type = String(badge?.type ?? "");
	if (/gold$/i.test(type)) return 3;
	if (/silber|silver$/i.test(type)) return 2;
	if (/bronze$/i.test(type)) return 1;
	return 0;
}

function assembleResponse({
	profile,
	profileState,
	axes,
	baseArchetype,
	bio,
	relationships,
	topBadges,
	totalBadges,
	rank,
	totalPlayers,
	recentForm = [],
}) {
	const archetypeMeta = baseArchetype ? ARCHETYPES[baseArchetype] : null;
	return {
		profileState,
		player: {
			id: profile.id,
			name: profile.username,
			avatarUrl: profile.avatar_url ?? null,
			initials: deriveInitials(profile.username),
			currentRating: Number(profile.current_rating ?? 1500),
			rank,
			totalPlayers,
			matchCount: Number(
				profile.actual_match_count ?? profile.matches_played ?? 0,
			),
		},
		archetype: archetypeMeta
			? {
					key: archetypeMeta.key,
					label: archetypeMeta.label,
					adjective: bio?.adjective ?? null,
					bio: bio?.bio ?? null,
					color: archetypeMeta.color,
					icon: archetypeMeta.icon,
				}
			: null,
		axes: axes ?? null,
		recentForm,
		relationships,
		topBadges,
		totalBadges,
	};
}

function deriveInitials(name) {
	if (typeof name !== "string" || !name) return "?";
	const parts = name.trim().split(/\s+/);
	if (parts.length === 1) return parts[0][0].toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
