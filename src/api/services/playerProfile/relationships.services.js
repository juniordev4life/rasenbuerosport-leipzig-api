/**
 * Compute the three relationship cards the profile shows:
 *   - lieblingsgegner  — highest win-rate against, min 3 matches
 *   - angstgegner      — lowest win-rate against, min 3 matches
 *   - topPartner       — highest joint win-rate as teammates, min 3 matches
 *
 * These are different from the existing `favorite_opponent`
 * exposed by `getUserStats` (which is "most-played-against"
 * regardless of outcome). The profile spec specifically wants
 * win-rate-based picks, so we compute fresh here.
 */

import { query } from "../../helpers/database.helpers.js";

const MIN_MATCHES = 3;

/**
 * @typedef {object} RelationshipCard
 * @property {string} playerId
 * @property {string} username
 * @property {string|null} avatarUrl
 * @property {number} totalMatches - Games played together (partner) or
 *   against each other (opponent).
 * @property {number} wins - Wins from the perspective of the profile
 *   owner.
 * @property {number} losses - Losses from the perspective of the
 *   profile owner.
 * @property {number} winRate - Decimal win ratio in the closed range
 *   [0, 1], rounded to two decimal places. Example: a 4-from-20
 *   record serialises as `0.20`, i.e. 20 %. The client is expected
 *   to multiply by 100 for percentage display — keeping the wire
 *   format as a probability matches the rest of the stats payload
 *   and lets aggregations stay numerically stable.
 */

/**
 * @typedef {object} ProfileRelationships
 * @property {RelationshipCard|null} lieblingsgegner
 * @property {RelationshipCard|null} angstgegner
 * @property {RelationshipCard|null} topPartner
 */

/**
 * Build the three relationship cards for a single player.
 *
 * One SQL roundtrip pulls every game the player appeared in plus
 * the other players' (id, team, username, avatar_url) — that gives
 * us enough to bucket wins/losses per opponent and per partner.
 *
 * @param {string} playerId
 * @returns {Promise<ProfileRelationships>}
 */
export async function computeRelationships(playerId) {
	const rows = await query(
		`
		SELECT g.id AS game_id,
		       g.score_home, g.score_away,
		       gp.team AS player_team,
		       (
		         SELECT json_agg(json_build_object(
		                  'player_id', other.player_id,
		                  'team', other.team,
		                  'username', p2.username,
		                  'avatar_url', p2.avatar_url
		                ))
		         FROM game_players other
		         LEFT JOIN profiles p2 ON p2.id = other.player_id
		         WHERE other.game_id = g.id AND other.player_id <> $1
		       ) AS others
		FROM game_players gp
		JOIN games g ON g.id = gp.game_id
		WHERE gp.player_id = $1
		`,
		[playerId],
	);

	const partners = new Map();
	const opponents = new Map();

	for (const row of rows) {
		const ownGoals =
			row.player_team === "home" ? row.score_home : row.score_away;
		const oppGoals =
			row.player_team === "home" ? row.score_away : row.score_home;
		const playerWon = ownGoals > oppGoals;
		const playerLost = ownGoals < oppGoals;

		const others = Array.isArray(row.others) ? row.others : [];
		for (const other of others) {
			if (!other?.player_id) continue;
			const isPartner = other.team === row.player_team;
			const bucket = isPartner ? partners : opponents;
			const existing = bucket.get(other.player_id) ?? {
				playerId: other.player_id,
				username: other.username ?? "Unbekannt",
				avatarUrl: other.avatar_url ?? null,
				totalMatches: 0,
				wins: 0,
				losses: 0,
			};
			existing.totalMatches += 1;
			if (playerWon) existing.wins += 1;
			if (playerLost) existing.losses += 1;
			bucket.set(other.player_id, existing);
		}
	}

	const eligibleOpponents = [...opponents.values()].filter(
		(o) => o.totalMatches >= MIN_MATCHES,
	);
	const eligiblePartners = [...partners.values()].filter(
		(p) => p.totalMatches >= MIN_MATCHES,
	);

	const lieblingsgegner = pickBestOpponent(eligibleOpponents);
	const angstgegner = pickWorstOpponent(eligibleOpponents);
	const topPartner = pickBestPartner(eligiblePartners);

	return {
		lieblingsgegner,
		angstgegner,
		topPartner,
	};
}

/**
 * @param {Array<object>} list
 * @returns {RelationshipCard|null}
 */
function pickBestOpponent(list) {
	if (list.length === 0) return null;
	let best = null;
	let bestRate = -1;
	for (const entry of list) {
		const rate = entry.wins / entry.totalMatches;
		if (rate > bestRate) {
			bestRate = rate;
			best = entry;
		}
	}
	if (!best) return null;
	return finaliseCard(best);
}

/**
 * @param {Array<object>} list
 * @returns {RelationshipCard|null}
 */
function pickWorstOpponent(list) {
	if (list.length === 0) return null;
	let worst = null;
	let worstRate = 2;
	for (const entry of list) {
		const rate = entry.wins / entry.totalMatches;
		if (rate < worstRate) {
			worstRate = rate;
			worst = entry;
		}
	}
	if (!worst) return null;
	return finaliseCard(worst);
}

/**
 * @param {Array<object>} list
 * @returns {RelationshipCard|null}
 */
function pickBestPartner(list) {
	if (list.length === 0) return null;
	let best = null;
	let bestRate = -1;
	for (const entry of list) {
		const rate = entry.wins / entry.totalMatches;
		if (rate > bestRate) {
			bestRate = rate;
			best = entry;
		}
	}
	if (!best) return null;
	return finaliseCard(best);
}

function finaliseCard(entry) {
	return {
		playerId: entry.playerId,
		username: entry.username,
		avatarUrl: entry.avatarUrl,
		totalMatches: entry.totalMatches,
		wins: entry.wins,
		losses: entry.losses,
		// Probability format ([0, 1]) with 2-decimal precision — see
		// the `winRate` description on `RelationshipCard` for why it
		// stays a ratio and not a percentage on the wire.
		winRate: Math.round((entry.wins / entry.totalMatches) * 100) / 100,
	};
}
