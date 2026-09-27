/**
 * League-ELO v2 persistence — the ONLY code path that writes ratings.
 *
 * Ratings are a pure function of the games: every write to a game (create,
 * finalize, shootout PATCH, stats upload, delete) is followed by a full,
 * deterministic replay of all finished games in `played_at, id` order. The
 * learned 1v2 handicap, the weekly repetition factor and the per-game
 * zero-sum all depend on that complete order, so an incremental update can
 * never be exact. The replay is idempotent and writes only rows whose value
 * changed, so a repeat is a cheap no-op.
 *
 * Transaction rules (see recomputeLeagueElo):
 *  - READ COMMITTED; the advisory lock is the FIRST statement, so the
 *    following reads see what the previous lock holder committed.
 *  - Only the transaction's own client is used — pool helpers would open a
 *    second connection that cannot see (and may wait on) our writes.
 *  - Nothing is written while app_state 'elo' is not {engine: 'v2'}; the
 *    switch is flipped by scripts/recompute-league-elo.js --apply after it
 *    took its backup.
 */

import { createHash } from "node:crypto";
import { logger } from "../../../config/logger.config.js";
import { withTransaction } from "../../helpers/database.helpers.js";
import { LEAGUE_ELO_V2_DEFAULTS } from "./leagueEloV2.services.js";
import {
	assignPairingGameNumbers,
	buildMatchV2,
} from "./leagueEloV2Input.services.js";
import { replayLeagueEloV2 } from "./leagueEloV2Replay.services.js";

/** Version stamped on every v2 snapshot. */
export const LEAGUE_ELO_VERSION = "v2.0";

/** pg_advisory_xact_lock key that serializes every rating write. */
export const LEAGUE_ELO_LOCK_KEY = 20260927;

const RATING_HISTORY_LIMIT = 30;
const MAX_PLAYERS_PER_SIDE = 2;

// ---------- canonical JSON + hashing ----------

function canonical(value) {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") {
		const out = {};
		for (const key of Object.keys(value).sort()) {
			if (value[key] !== undefined) out[key] = canonical(value[key]);
		}
		return out;
	}
	return value;
}

/**
 * JSON with sorted keys and Dates as ISO strings — equal values always give
 * equal strings, regardless of the key order Postgres returns for JSONB.
 *
 * @param {*} value
 * @returns {string}
 * @example
 * stableStringify({ b: 1, a: 2 }); // '{"a":2,"b":1}'
 */
export function stableStringify(value) {
	return JSON.stringify(canonical(value ?? null));
}

/**
 * Short SHA-256 of the canonical JSON of a value.
 *
 * @param {*} value
 * @returns {string} 16 hex chars
 * @example
 * hashOf({ a: 1 }).length; // 16
 */
export function hashOf(value) {
	return createHash("sha256")
		.update(stableStringify(value))
		.digest("hex")
		.slice(0, 16);
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;
const iso = (d) => (d == null ? null : new Date(d).toISOString());

// ---------- loading ----------

/**
 * Loads everything the replay reads and everything it may overwrite.
 *
 * @param {import("pg").PoolClient} client - Client inside a transaction
 * @returns {Promise<{games: object[], gamePlayers: object[], profiles: object[],
 *   seasons: object[], standings: object[]}>}
 * @example
 * const inputs = await loadEloInputs(client);
 */
export async function loadEloInputs(client) {
	const { rows: games } = await client.query(
		`SELECT id, played_at, pending, score_home, score_away, score_timeline,
		        penalty_shootout, match_stats, elo_snapshot
		   FROM games
		  ORDER BY played_at, id`,
	);
	const { rows: gamePlayers } = await client.query(
		"SELECT game_id, player_id, team FROM game_players ORDER BY game_id, player_id",
	);
	const { rows: profiles } = await client.query(
		`SELECT id, current_rating, matches_played, rating_history,
		        peak_elo_value, peak_elo_at, rating_updated_at
		   FROM profiles
		  ORDER BY id`,
	);
	const { rows: seasons } = await client.query(
		"SELECT id, starts_at, ends_at FROM league_seasons ORDER BY starts_at",
	);
	const { rows: standings } = await client.query(
		"SELECT season_id, payload FROM season_elo_standings",
	);
	return { games, gamePlayers, profiles, seasons, standings };
}

/**
 * Hash of exactly the data the replay depends on (not its outputs), used to
 * prove a dry run and an apply saw the same database.
 *
 * @param {object} inputs - From loadEloInputs
 * @returns {string}
 * @example
 * inputHash(inputs); // "3f9a…"
 */
export function inputHash(inputs) {
	return hashOf({
		games: inputs.games.map((g) => ({
			id: g.id,
			played_at: iso(g.played_at),
			pending: g.pending,
			score: [g.score_home, g.score_away],
			timeline: g.score_timeline ?? null,
			shootout: g.penalty_shootout ?? null,
			red_cards: g.match_stats?.red_cards ?? null,
		})),
		gamePlayers: inputs.gamePlayers,
		profiles: inputs.profiles.map((p) => p.id),
		seasons: inputs.seasons.map((s) => ({
			id: s.id,
			starts_at: iso(s.starts_at),
			ends_at: iso(s.ends_at),
		})),
	});
}

// ---------- planning (pure) ----------

function groupPlayersByGame(gamePlayers) {
	const byGame = new Map();
	for (const gp of gamePlayers) {
		if (!byGame.has(gp.game_id)) byGame.set(gp.game_id, []);
		byGame.get(gp.game_id).push(gp);
	}
	return byGame;
}

function isRateableLineup(gps) {
	const home = gps.filter((gp) => gp.team === "home").length;
	const away = gps.filter((gp) => gp.team === "away").length;
	return home <= MAX_PLAYERS_PER_SIDE && away <= MAX_PLAYERS_PER_SIDE;
}

/**
 * Match inputs for every rateable game plus the ids of the games that get no
 * rating (pending, an empty side, or more than two players on a side).
 *
 * @param {object[]} games - Oldest first
 * @param {object[]} gamePlayers
 * @returns {{ matches: object[], unratedIds: string[] }}
 * @example
 * buildRatedMatches(games, gamePlayers).matches.length; // 400
 */
export function buildRatedMatches(games, gamePlayers) {
	const byGame = groupPlayersByGame(gamePlayers);
	const matches = [];
	const unratedIds = [];
	for (const game of games) {
		const gps = byGame.get(game.id) ?? [];
		const match =
			!game.pending && isRateableLineup(gps) ? buildMatchV2(game, gps) : null;
		if (match) matches.push(match);
		else unratedIds.push(game.id);
	}
	return { matches: assignPairingGameNumbers(matches), unratedIds };
}

function statsOf(match, playerId) {
	for (const side of match.sides) {
		const player = side.find((p) => p.playerId === playerId);
		if (player) return player.stats;
	}
	return null;
}

function snapshotRow(match, r) {
	return {
		playerId: r.playerId,
		ratingBefore: r.ratingBefore,
		ratingAfter: r.ratingAfter,
		delta: r.delta,
		// Consumers (profile consistency axis) expect a positive participation
		// value like v1's baseline-of-1 contribution.
		contribution: round4(1 + r.contribution),
		share: null,
		breakdown: {
			expected: round4(r.expected),
			eloShare: round4(r.eloShare),
			sideBonus: round4(r.sideBonus),
			contributionShift: round4(r.contributionShift),
			raw: round4(r.raw),
			stats: statsOf(match, r.playerId),
		},
	};
}

/**
 * Snapshot in the shape every existing reader knows (teamA = home,
 * teamB = away) with the v2 details attached.
 *
 * @param {object} entry - One replay log entry
 * @param {number} handicapAfter
 * @returns {object}
 * @example
 * toSnapshot(entry, 75.4).teamA[0].delta; // 12
 */
export function toSnapshot(entry, handicapAfter) {
	const { match, result, handicapBefore } = entry;
	const side = (s) =>
		result.rows.filter((r) => r.side === s).map((r) => snapshotRow(match, r));
	return {
		teamA: side(0),
		teamB: side(1),
		version: LEAGUE_ELO_VERSION,
		matchMeta: {
			mode: result.mode,
			G: round4(result.G),
			S: result.S.map(round4),
			damping: result.damping,
			repetition: round4(result.repetition),
			pairingGameNumber: match.pairingGameNumber,
			handicapBefore,
			handicapAfter,
			winSide: result.winSide,
			decidedByShootout: result.shootout,
			sideExpected: result.sideExpected.map(round4),
		},
	};
}

function trackPlayers(log) {
	const tracks = new Map();
	for (const { match, result } of log) {
		for (const r of result.rows) {
			if (!tracks.has(r.playerId)) tracks.set(r.playerId, []);
			tracks.get(r.playerId).push({
				before: r.ratingBefore,
				after: r.ratingAfter,
				delta: r.delta,
				playedAt: iso(match.playedAt),
				gameId: match.gameId,
			});
		}
	}
	return tracks;
}

function trackDuos(log) {
	const tracks = new Map();
	for (const { match, duoUpdates } of log) {
		for (const u of duoUpdates) {
			if (!tracks.has(u.key)) {
				tracks.set(u.key, {
					playerIds: match.sides[u.side].map((p) => p.playerId).sort(),
					entries: [],
				});
			}
			tracks.get(u.key).entries.push({
				before: u.before,
				after: u.before + u.delta,
				side: u.side,
				playedAt: iso(match.playedAt),
				gameId: match.gameId,
			});
		}
	}
	return tracks;
}

function profilePlan(profileId, track, startRating) {
	if (!track || track.length === 0) {
		return {
			id: profileId,
			current_rating: startRating,
			matches_played: 0,
			rating_history: [],
			peak_elo_value: startRating,
			peak_elo_at: null,
			rating_updated_at: null,
		};
	}
	let peakValue = startRating;
	let peakAt = null;
	for (const t of track) {
		if (t.after > peakValue) {
			peakValue = t.after;
			peakAt = t.playedAt;
		}
	}
	const last = track[track.length - 1];
	return {
		id: profileId,
		current_rating: last.after,
		matches_played: track.length,
		rating_history: track.slice(-RATING_HISTORY_LIMIT).map((t) => t.after),
		peak_elo_value: peakValue,
		peak_elo_at: peakAt,
		rating_updated_at: last.playedAt,
	};
}

const before = (entries, at) =>
	at == null ? entries : entries.filter((e) => e.playedAt < at);
const within = (entries, from, to) =>
	entries.filter((e) => e.playedAt >= from && (to == null || e.playedAt < to));

function seasonPlayers(tracks, from, to, startRating) {
	const players = [];
	for (const [playerId, track] of tracks) {
		const upToEnd = before(track, to);
		if (upToEnd.length === 0) continue;
		const prior = before(track, from);
		const inSeason = within(track, from, to);
		const ratingStart = prior.length
			? prior[prior.length - 1].after
			: startRating;
		const peak = inSeason.reduce((m, e) => Math.max(m, e.after), ratingStart);
		players.push({
			player_id: playerId,
			rating_start: ratingStart,
			rating_end: upToEnd[upToEnd.length - 1].after,
			peak,
			games: inSeason.length,
		});
	}
	return players.sort((a, b) => a.player_id.localeCompare(b.player_id));
}

function seasonDuos(tracks, from, to) {
	const duos = [];
	for (const [key, track] of tracks) {
		const upToEnd = before(track.entries, to);
		if (upToEnd.length === 0) continue;
		const prior = before(track.entries, from);
		const inSeason = within(track.entries, from, to);
		const ratingStart = prior.length
			? prior[prior.length - 1].after
			: (inSeason[0]?.before ?? upToEnd[0].before);
		duos.push({
			key,
			player_ids: track.playerIds,
			rating_start: ratingStart,
			rating_end: upToEnd[upToEnd.length - 1].after,
			games: inSeason.length,
			games_total: upToEnd.length,
		});
	}
	return duos.sort((a, b) => a.key.localeCompare(b.key));
}

function handicapAt(log, at, fallback) {
	if (at == null) return fallback;
	const next = log.find((e) => iso(e.match.playedAt) >= at);
	return next ? next.handicapBefore : fallback;
}

function standingsPlan(seasons, log, replay, params) {
	const playerTracks = trackPlayers(log);
	const duoTracks = trackDuos(log);
	return seasons.map((season) => {
		const from = iso(season.starts_at);
		const to = iso(season.ends_at);
		return {
			season_id: season.id,
			payload: {
				season_id: season.id,
				players: seasonPlayers(playerTracks, from, to, params.startRating),
				duos: seasonDuos(duoTracks, from, to),
				handicap_start: handicapAt(log, from, replay.handicap),
				handicap_end: handicapAt(log, to, replay.handicap),
				rated_games: within(
					log.map((e) => ({ playedAt: iso(e.match.playedAt) })),
					from,
					to,
				).length,
			},
		};
	});
}

function collectViolations(log, profiles, params) {
	const violations = [];
	for (const { match, result } of log) {
		const sum = result.rows.reduce((t, r) => t + r.delta, 0);
		if (sum !== 0)
			violations.push(`game ${match.gameId}: deltas sum to ${sum}`);
		if (result.winSide !== null && params.minWin > 0) {
			for (const r of result.rows) {
				if (r.side === result.winSide && r.delta < params.minWin) {
					violations.push(
						`game ${match.gameId}: winner ${r.playerId} got ${r.delta}`,
					);
				}
			}
		}
	}
	const rated = profiles.filter((p) => p.matches_played > 0);
	const total = rated.reduce((t, p) => t + p.current_rating, 0);
	if (total !== params.startRating * rated.length) {
		violations.push(
			`rating sum ${total} != ${params.startRating} x ${rated.length} rated players`,
		);
	}
	return violations;
}

/**
 * Pure: the complete target state for the given inputs.
 *
 * @param {object} inputs - From loadEloInputs
 * @param {typeof LEAGUE_ELO_V2_DEFAULTS} [params]
 * @returns {{ snapshots: Map<string, object|null>, profiles: object[],
 *   standings: object[], violations: string[], stats: object, hash: string }}
 * @example
 * const plan = computePlan(inputs);
 * plan.violations; // []
 */
export function computePlan(inputs, params = LEAGUE_ELO_V2_DEFAULTS) {
	const { matches, unratedIds } = buildRatedMatches(
		inputs.games,
		inputs.gamePlayers,
	);
	const replay = replayLeagueEloV2(matches, params);
	const snapshots = new Map(unratedIds.map((id) => [id, null]));
	replay.log.forEach((entry, i) => {
		const handicapAfter =
			i + 1 < replay.log.length
				? replay.log[i + 1].handicapBefore
				: replay.handicap;
		snapshots.set(entry.match.gameId, toSnapshot(entry, handicapAfter));
	});
	const tracks = trackPlayers(replay.log);
	const profiles = inputs.profiles.map((p) =>
		profilePlan(p.id, tracks.get(p.id), params.startRating),
	);
	const standings = standingsPlan(inputs.seasons, replay.log, replay, params);
	const violations = collectViolations(replay.log, profiles, params);
	const plan = {
		snapshots,
		profiles,
		standings,
		violations,
		handicap: replay.handicap,
		duos: replay.duos,
		stats: {
			rated: matches.length,
			unrated: unratedIds.length,
			handicap: replay.handicap,
		},
	};
	plan.hash = hashOf({
		snapshots: [...snapshots].sort(([a], [b]) => a.localeCompare(b)),
		profiles,
		standings,
	});
	return plan;
}

// ---------- diff + write ----------

function profileState(p) {
	return {
		id: p.id,
		current_rating: p.current_rating,
		matches_played: p.matches_played,
		rating_history: Array.isArray(p.rating_history) ? p.rating_history : [],
		peak_elo_value: p.peak_elo_value,
		peak_elo_at: iso(p.peak_elo_at),
		rating_updated_at: iso(p.rating_updated_at),
	};
}

/**
 * Rows whose stored value differs from the plan.
 *
 * @param {object} plan - From computePlan
 * @param {object} inputs - From loadEloInputs (the current stored state)
 * @returns {{ games: object[], profiles: object[], standings: object[] }}
 * @example
 * diffPlan(plan, inputs).games.length; // 1 after a new game
 */
export function diffPlan(plan, inputs) {
	const games = [];
	for (const game of inputs.games) {
		const target = plan.snapshots.has(game.id)
			? plan.snapshots.get(game.id)
			: null;
		if (stableStringify(game.elo_snapshot) !== stableStringify(target)) {
			games.push({ id: game.id, snapshot: target });
		}
	}
	const storedProfiles = new Map(inputs.profiles.map((p) => [p.id, p]));
	const profiles = plan.profiles.filter(
		(p) =>
			stableStringify(profileState(storedProfiles.get(p.id))) !==
			stableStringify(p),
	);
	const storedStandings = new Map(
		inputs.standings.map((s) => [s.season_id, s.payload]),
	);
	const standings = plan.standings.filter(
		(s) =>
			stableStringify(storedStandings.get(s.season_id)) !==
			stableStringify(s.payload),
	);
	return { games, profiles, standings };
}

/**
 * Writes a diff in three batched statements.
 *
 * @param {import("pg").PoolClient} client - Client inside a transaction
 * @param {ReturnType<typeof diffPlan>} changes
 * @returns {Promise<void>}
 * @example
 * await writePlanChanges(client, diffPlan(plan, inputs));
 */
export async function writePlanChanges(client, changes) {
	if (changes.games.length) {
		await client.query(
			`UPDATE games AS g
			    SET elo_snapshot = v.snapshot
			   FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, snapshot jsonb)
			  WHERE g.id = v.id`,
			[JSON.stringify(changes.games)],
		);
	}
	if (changes.profiles.length) {
		await client.query(
			`UPDATE profiles AS p
			    SET current_rating = v.current_rating,
			        matches_played = v.matches_played,
			        rating_history = v.rating_history,
			        peak_elo_value = v.peak_elo_value,
			        peak_elo_at = v.peak_elo_at,
			        rating_updated_at = v.rating_updated_at,
			        profile_cache = NULL
			   FROM jsonb_to_recordset($1::jsonb) AS v(
			        id text, current_rating int, matches_played int,
			        rating_history jsonb, peak_elo_value int,
			        peak_elo_at timestamptz, rating_updated_at timestamptz)
			  WHERE p.id = v.id`,
			[JSON.stringify(changes.profiles)],
		);
	}
	if (changes.standings.length) {
		await client.query(
			`INSERT INTO season_elo_standings (season_id, payload, computed_at)
			 SELECT v.season_id, v.payload, now()
			   FROM jsonb_to_recordset($1::jsonb) AS v(season_id text, payload jsonb)
			 ON CONFLICT (season_id)
			 DO UPDATE SET payload = EXCLUDED.payload, computed_at = now()`,
			[JSON.stringify(changes.standings)],
		);
	}
}

/**
 * Re-checks the invariants on what is actually stored: every v2 game sums
 * to zero and the ratings of all rated players sum to 1500 x players.
 *
 * @param {import("pg").PoolClient} client
 * @param {number} [startRating]
 * @returns {Promise<string[]>} Violations, empty when fine
 * @example
 * await checkStoredInvariants(client); // []
 */
export async function checkStoredInvariants(
	client,
	startRating = LEAGUE_ELO_V2_DEFAULTS.startRating,
) {
	const violations = [];
	const {
		rows: [sums],
	} = await client.query(
		`SELECT count(*)::int AS n, coalesce(sum(current_rating), 0)::int AS total
		   FROM profiles WHERE matches_played > 0`,
	);
	if (sums.total !== startRating * sums.n) {
		violations.push(
			`stored rating sum ${sums.total} != ${startRating} x ${sums.n}`,
		);
	}
	const {
		rows: [bad],
	} = await client.query(
		`SELECT count(*)::int AS n
		   FROM games g,
		        LATERAL (SELECT sum((r->>'delta')::int) AS s
		                   FROM jsonb_array_elements(
		                        coalesce(g.elo_snapshot->'teamA', '[]'::jsonb) ||
		                        coalesce(g.elo_snapshot->'teamB', '[]'::jsonb)) r) x
		  WHERE g.elo_snapshot IS NOT NULL AND x.s <> 0`,
	);
	if (bad.n > 0) violations.push(`${bad.n} stored games do not sum to zero`);
	const {
		rows: [stale],
	} = await client.query(
		`SELECT count(*)::int AS n FROM games
		  WHERE elo_snapshot IS NOT NULL
		    AND elo_snapshot->>'version' IS DISTINCT FROM $1`,
		[LEAGUE_ELO_VERSION],
	);
	if (stale.n > 0)
		violations.push(`${stale.n} games still carry a non-v2 snapshot`);
	return violations;
}

/**
 * Current engine switch from app_state.
 *
 * @param {import("pg").PoolClient} client
 * @returns {Promise<object|null>} e.g. { engine: "v2", activated_at: "…" }
 * @example
 * (await getEloEngineState(client))?.engine; // "v2"
 */
export async function getEloEngineState(client) {
	const { rows } = await client.query(
		"SELECT value FROM app_state WHERE key = 'elo'",
	);
	return rows[0]?.value ?? null;
}

function invariantError(violations) {
	const err = new Error(
		`League-ELO invariants violated: ${violations.slice(0, 5).join("; ")}`,
	);
	err.violations = violations;
	return err;
}

/**
 * Plans and writes the complete rating state on an existing transaction
 * client that already holds LEAGUE_ELO_LOCK_KEY. Throws (so the caller rolls
 * back) when an invariant fails before or after writing.
 *
 * @param {import("pg").PoolClient} client
 * @returns {Promise<{ plan: object, inputs: object, changes: object }>}
 * @example
 * const { changes } = await applyLeagueEloPlan(client);
 */
export async function applyLeagueEloPlan(client) {
	const inputs = await loadEloInputs(client);
	const plan = computePlan(inputs);
	if (plan.violations.length) throw invariantError(plan.violations);
	const changes = diffPlan(plan, inputs);
	await writePlanChanges(client, changes);
	const stored = await checkStoredInvariants(client);
	if (stored.length) throw invariantError(stored);
	return { plan, inputs, changes };
}

/**
 * Full replay in its own transaction. No-op while the v2 engine is not
 * activated. Callers log the result with their own context.
 *
 * @returns {Promise<{ status: "ok"|"inactive", changed?: object }>}
 * @example
 * await recomputeLeagueElo();
 */
export async function recomputeLeagueElo() {
	return withTransaction(async (client) => {
		await client.query("SET LOCAL lock_timeout = '5s'");
		await client.query("SET LOCAL statement_timeout = '30s'");
		await client.query("SELECT pg_advisory_xact_lock($1)", [
			LEAGUE_ELO_LOCK_KEY,
		]);
		const state = await getEloEngineState(client);
		if (state?.engine !== "v2") return { status: "inactive" };
		const { changes } = await applyLeagueEloPlan(client);
		return {
			status: "ok",
			changed: {
				games: changes.games.length,
				profiles: changes.profiles.length,
				standings: changes.standings.length,
			},
		};
	});
}

/**
 * recomputeLeagueElo for the write paths: never throws. The triggering write
 * is already committed; a failed replay is logged and repaired by the next
 * write (ratings are a pure function of the games).
 *
 * @param {object} context - e.g. { reason: "game_finalized", gameId }
 * @returns {Promise<object>} The recompute result or { status: "error" }
 * @example
 * await recomputeLeagueEloSafely({ reason: "game_created", gameId: game.id });
 */
export async function recomputeLeagueEloSafely(context) {
	try {
		const result = await recomputeLeagueElo();
		if (result.status === "ok") {
			logger.info(
				{ ...context, changed: result.changed },
				"league elo recomputed",
			);
		}
		return result;
	} catch (error) {
		logger.error(
			{ ...context, err: error?.message, violations: error?.violations },
			"league elo recompute failed; the next write retries",
		);
		return { status: "error", error: error?.message };
	}
}
