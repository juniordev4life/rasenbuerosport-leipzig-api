/**
 * Chronological League-ELO v2 replay over prepared match inputs. Pure:
 * everyone starts at the configured rating, the handicap H starts at its
 * default and learns from every 1v2 game — exactly as the simulator replays
 * its stored games.
 */

import {
	computeDuoV2,
	computeMatchV2,
	LEAGUE_ELO_V2_DEFAULTS,
	nextHandicap,
} from "./leagueEloV2.services.js";

function outcome(result, side) {
	if (result.S[side] > result.S[1 - side]) return "wins";
	if (result.S[side] < result.S[1 - side]) return "losses";
	return "draws";
}

function applyPlayerRows(players, result, playedAt) {
	for (const row of result.rows) {
		const player = players.get(row.playerId) ?? {
			rating: row.ratingBefore,
			games: 0,
			wins: 0,
			draws: 0,
			losses: 0,
			lastPlayedAt: null,
		};
		player.rating = row.ratingAfter;
		player.games += 1;
		player[outcome(result, row.side)] += 1;
		player.lastPlayedAt = playedAt;
		players.set(row.playerId, player);
	}
}

function applyDuoUpdates(duos, updates, result, score, sides) {
	for (const u of updates) {
		const duo = duos.get(u.key) ?? {
			rating: u.before,
			playerIds: sides[u.side].map((p) => p.playerId).sort(),
			games: 0,
			wins: 0,
			draws: 0,
			losses: 0,
			goalsFor: 0,
			goalsAgainst: 0,
		};
		duo.rating = u.before + u.delta;
		duo.games += 1;
		duo[outcome(result, u.side)] += 1;
		duo.goalsFor += score[u.side];
		duo.goalsAgainst += score[1 - u.side];
		duos.set(u.key, duo);
	}
}

/**
 * Replays all matches oldest first.
 *
 * @param {object[]} matches - From buildMatchV2 + assignPairingGameNumbers
 * @param {typeof LEAGUE_ELO_V2_DEFAULTS} [params]
 * @returns {{ players: Map<string, object>, duos: Map<string, object>,
 *   handicap: number, log: object[] }}
 * @example
 * const { players } = replayLeagueEloV2(matches);
 * players.get("uid-a").rating; // 1612
 */
export function replayLeagueEloV2(matches, params = LEAGUE_ELO_V2_DEFAULTS) {
	const players = new Map();
	const duos = new Map();
	let handicap = params.handicapStart;
	const log = [];
	for (const match of matches) {
		const sides = match.sides.map((side) =>
			side.map((p) => ({
				...p,
				rating: players.get(p.playerId)?.rating ?? params.startRating,
			})),
		);
		const result = computeMatchV2({ ...match, sides }, handicap, params);
		const duoUpdates = computeDuoV2(result, sides, duos, handicap, params);
		applyPlayerRows(players, result, match.playedAt);
		applyDuoUpdates(duos, duoUpdates, result, match.score, sides);
		const handicapBefore = handicap;
		if (result.mode === "1v2") {
			handicap = nextHandicap(handicap, result, sides, params);
		}
		log.push({ match, result, duoUpdates, handicapBefore });
	}
	return { players, duos, handicap, log };
}
