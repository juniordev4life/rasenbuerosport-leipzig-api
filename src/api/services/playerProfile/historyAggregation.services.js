/**
 * History aggregation for the player-profile axes. Loads the last
 * `rollingMatchWindow` matches per player from `games` +
 * `game_players` + the JSONB columns `score_timeline` and
 * `elo_snapshot`, then folds them into the `PlayerMatchHistory`
 * shape the axis functions expect.
 *
 * The work is split into two layers:
 *   - `aggregatePlayerHistory(rows, playerId)`  pure function over
 *     pre-loaded game rows. Easy to unit-test.
 *   - `loadPlayerHistory(playerId)` and `loadLeagueSnapshot()` do
 *     the SQL roundtrips and call the pure aggregator.
 *
 * Contribution scores per match come straight from the persisted
 * `elo_snapshot.teamA[i].contribution` / `teamB[i].contribution`
 * so the axes stay consistent with the ELO engine's view of the
 * game.
 */

import { PROFILE_CONSTANTS } from "../../../constants/profile.constants.js";
import { query } from "../../helpers/database.helpers.js";
import { matchMinutesForResultType } from "../elo/eloMatchInput.services.js";

/**
 * Reduce a list of game rows + their `game_players` info into a
 * single `PlayerMatchHistory` for one player.
 *
 * Pure function. Each `row` is expected to have:
 *   - score_home, score_away, result_type, score_timeline,
 *     elo_snapshot, game_players: [{ player_id, team }]
 *
 * @param {Array<object>} rows - Already filtered to the player's games.
 * @param {string} playerId
 * @returns {{
 *   matchCount: number,
 *   totalGoals: number,
 *   totalAssists: number,
 *   wins: number,
 *   redCards: Array<{ minute: number, matchMinutes: number }>,
 *   scoringEvents: Array<{ type: "goal"|"assist", minute: number, matchMinutes: number }>,
 *   contributionScoresPerMatch: number[],
 *   partners: Array<{ playerId: string, matchesTogether: number }>,
 * }}
 */
export function aggregatePlayerHistory(rows, playerId) {
	const result = {
		matchCount: 0,
		totalGoals: 0,
		totalAssists: 0,
		wins: 0,
		redCards: [],
		scoringEvents: [],
		contributionScoresPerMatch: [],
		partners: [],
	};
	if (!Array.isArray(rows) || rows.length === 0 || !playerId) return result;

	const partnerCounts = new Map();

	for (const row of rows) {
		const gp = (row.game_players ?? []).find((p) => p.player_id === playerId);
		if (!gp) continue;
		const team = gp.team;
		if (team !== "home" && team !== "away") continue;

		result.matchCount += 1;
		const matchMinutes = matchMinutesForResultType(row.result_type);

		// Win/loss
		const ownGoals = team === "home" ? row.score_home : row.score_away;
		const oppGoals = team === "home" ? row.score_away : row.score_home;
		if (ownGoals > oppGoals) result.wins += 1;

		// Partners
		for (const other of row.game_players ?? []) {
			if (other.player_id === playerId) continue;
			if (other.team !== team) continue;
			partnerCounts.set(
				other.player_id,
				(partnerCounts.get(other.player_id) ?? 0) + 1,
			);
		}

		// Per-event walk: goals, assists, red cards
		const timeline = Array.isArray(row.score_timeline)
			? row.score_timeline
			: [];
		for (const event of timeline) {
			if (!event || typeof event !== "object") continue;
			const type = event.event_type ?? "goal";

			if (type === "goal") {
				const goalType = event.goal_type ?? "play";
				if (goalType === "own_goal") continue;
				const minute = Number(event.minute);
				if (event.scored_by === playerId) {
					result.totalGoals += 1;
					if (Number.isFinite(minute)) {
						result.scoringEvents.push({
							type: "goal",
							minute,
							matchMinutes,
						});
					}
				}
				if (event.assist_by === playerId) {
					result.totalAssists += 1;
					if (Number.isFinite(minute)) {
						result.scoringEvents.push({
							type: "assist",
							minute,
							matchMinutes,
						});
					}
				}
				continue;
			}

			const isRed =
				type === "red_card" || (type === "card" && event.card_type === "red");
			if (isRed && event.player_id === playerId) {
				const minute = Number(event.minute);
				result.redCards.push({
					minute: Number.isFinite(minute) ? minute : 0,
					matchMinutes,
				});
			}
		}

		// Contribution score from the persisted ELO snapshot.
		const snapshot = row.elo_snapshot ?? null;
		const teamArr = snapshot
			? team === "home"
				? snapshot.teamA
				: snapshot.teamB
			: null;
		if (Array.isArray(teamArr)) {
			const entry = teamArr.find((e) => e.playerId === playerId);
			if (entry && Number.isFinite(entry.contribution)) {
				result.contributionScoresPerMatch.push(entry.contribution);
			}
		}
	}

	for (const [partnerId, count] of partnerCounts.entries()) {
		result.partners.push({ playerId: partnerId, matchesTogether: count });
	}

	return result;
}

/**
 * Load the most-recent `windowSize` games for every player that has
 * at least one match. Returns rows shaped for `aggregatePlayerHistory`
 * — each row carries its `game_players` array inline so the aggregator
 * never re-queries the DB.
 *
 * The query loads `score_timeline` and `elo_snapshot` as raw JSONB
 * because we need the per-event details and the player's stored
 * contribution.
 *
 * @param {number} [windowSize]
 * @returns {Promise<{ playerIds: string[], byPlayer: Map<string, Array<object>> }>}
 */
export async function loadAllPlayerHistories(
	windowSize = PROFILE_CONSTANTS.rollingMatchWindow,
) {
	const rows = await query(
		`
		WITH all_games AS (
			SELECT g.id, g.score_home, g.score_away, g.result_type,
			       g.score_timeline, g.elo_snapshot, g.played_at
			FROM games g
		),
		all_players AS (
			SELECT gp.game_id, gp.player_id, gp.team
			FROM game_players gp
		),
		ranked AS (
			SELECT ap.player_id, ap.game_id,
			       ROW_NUMBER() OVER (
			         PARTITION BY ap.player_id
			         ORDER BY ag.played_at DESC
			       ) AS rn
			FROM all_players ap
			JOIN all_games ag ON ag.id = ap.game_id
		)
		SELECT r.player_id, g.id AS game_id, g.score_home, g.score_away,
		       g.result_type, g.score_timeline, g.elo_snapshot,
		       g.played_at,
		       (
		         SELECT json_agg(json_build_object(
		                  'player_id', gp.player_id,
		                  'team', gp.team
		                ))
		         FROM game_players gp WHERE gp.game_id = g.id
		       ) AS game_players
		FROM ranked r
		JOIN all_games g ON g.id = r.game_id
		WHERE r.rn <= $1
		ORDER BY r.player_id, g.played_at DESC
		`,
		[windowSize],
	);

	const byPlayer = new Map();
	for (const row of rows) {
		const playerId = row.player_id;
		if (!byPlayer.has(playerId)) byPlayer.set(playerId, []);
		byPlayer.get(playerId).push(row);
	}
	return { playerIds: [...byPlayer.keys()], byPlayer };
}

/**
 * Build the league snapshot used as the percentile-comparison basis
 * by every axis. Returns an array of `{ playerId, matches }` shaped
 * to match what the axis functions expect.
 *
 * One SQL call powers both this and `loadPlayerHistory` — the
 * caller usually passes the result into both rather than running
 * the query twice.
 *
 * @param {Map<string, Array<object>>} [byPlayer]
 *   Pass a pre-loaded map (from `loadAllPlayerHistories`) to avoid
 *   the SQL roundtrip; omit to load fresh.
 * @returns {Promise<Array<{ playerId: string, matches: object }>>}
 */
export async function loadLeagueSnapshot(byPlayer) {
	let source = byPlayer;
	if (!source) {
		const loaded = await loadAllPlayerHistories();
		source = loaded.byPlayer;
	}
	const snapshot = [];
	for (const [playerId, rows] of source.entries()) {
		snapshot.push({
			playerId,
			matches: aggregatePlayerHistory(rows, playerId),
		});
	}
	return snapshot;
}

/**
 * Load one player's `PlayerMatchHistory` from the same pre-loaded
 * map. Falls back to an empty history if the player has no games.
 *
 * @param {Map<string, Array<object>>} byPlayer
 * @param {string} playerId
 * @returns {object}
 */
export function loadPlayerHistory(byPlayer, playerId) {
	const rows = byPlayer.get(playerId) ?? [];
	return aggregatePlayerHistory(rows, playerId);
}
