/**
 * Pure adapters that turn a persisted game (game row + game_players
 * + timeline) into the shape `computeMatchElo` expects. No DB
 * access here — the caller hands in already-loaded rows.
 *
 * Two functions:
 *   - `extractPlayerStats(timeline, playerId)` collapses a
 *     score_timeline into the `{ goals, assists, redCards }` object
 *     the engine consumes.
 *   - `buildMatchInputFromGame({ game, gamePlayers, profilesById })`
 *     produces the full MatchInput for `computeMatchElo`.
 *
 * Keeping these pure means the DB-touching service can stay thin and
 * the adapter logic is fully unit-testable against fixture
 * timelines.
 */

import { ELO_CONSTANTS } from "../../../constants/elo.constants.js";

/**
 * Map `result_type` to the nominal match duration used as
 * `matchMinutes` for the red-card time-weighting. Penalty shootouts
 * count as 120-minute matches (the shootout happens after extra
 * time; for red-card weighting the field play ends at 120).
 *
 * @param {string|null|undefined} resultType
 * @returns {number}
 */
export function matchMinutesForResultType(resultType) {
	if (resultType === "extra_time" || resultType === "penalties") return 120;
	return 90;
}

/**
 * Collapse a game's `score_timeline` into the per-player stats the
 * ELO engine expects. Goals and assists come from `goal` events;
 * red cards come from `red_card` events or `card` events with
 * `card_type === "red"`. Own goals are NOT counted as the scorer's
 * goal (per ELO spec: future feature).
 *
 * @param {Array<object>|null|undefined} timeline - Raw score_timeline JSONB.
 * @param {string} playerId - The Firebase UID to score against.
 * @returns {{ goals: number, assists: number, redCards: Array<{minute: number}> }}
 *
 * @example
 *   extractPlayerStats(
 *     [
 *       { event_type: "goal", scored_by: "uid-marco", minute: 14 },
 *       { event_type: "goal", scored_by: "uid-marco", assist_by: "uid-tobi", minute: 31 },
 *       { event_type: "red_card", player_id: "uid-jay", minute: 7 },
 *     ],
 *     "uid-marco",
 *   );
 *   // → { goals: 2, assists: 0, redCards: [] }
 */
export function extractPlayerStats(timeline, playerId) {
	const stats = { goals: 0, assists: 0, redCards: [] };
	if (!Array.isArray(timeline) || !playerId) return stats;

	for (const entry of timeline) {
		if (!entry || typeof entry !== "object") continue;
		const type = entry.event_type ?? "goal";

		if (type === "goal") {
			// Own goals: the `scored_by` player put it into their own net,
			// so we do NOT count it as a positive contribution. Skipping
			// keeps the spec's "own goals not modelled in V1" promise.
			const goalType = entry.goal_type ?? "play";
			if (goalType === "own_goal") continue;
			if (entry.scored_by === playerId) stats.goals += 1;
			if (entry.assist_by === playerId) stats.assists += 1;
			continue;
		}

		const isRed =
			type === "red_card" || (type === "card" && entry.card_type === "red");
		if (isRed && entry.player_id === playerId) {
			const minute = Number(entry.minute);
			stats.redCards.push({
				minute: Number.isFinite(minute) ? minute : 0,
			});
		}
	}

	return stats;
}

/**
 * Assemble the full MatchInput for `computeMatchElo` from already-
 * loaded game / game_players / profiles rows.
 *
 * @param {object} args
 * @param {object} args.game - Row from the `games` table.
 * @param {Array<object>} args.gamePlayers - Rows from `game_players` (with at least player_id, team).
 * @param {Map<string,object>|Record<string,object>} args.profilesById
 *   Lookup keyed by player_id, must contain `current_rating` and
 *   `matches_played` for every player in `gamePlayers`.
 * @returns {import("./eloEngine.services.js").MatchInput}
 */
export function buildMatchInputFromGame({ game, gamePlayers, profilesById }) {
	const lookup =
		profilesById instanceof Map
			? (id) => profilesById.get(id)
			: (id) => profilesById?.[id];

	const buildTeam = (side, totalGoals) => ({
		goals: totalGoals,
		players: gamePlayers
			.filter((gp) => gp.team === side)
			.map((gp) => {
				const profile = lookup(gp.player_id) ?? {};
				return {
					playerId: gp.player_id,
					rating: Number.isFinite(profile.current_rating)
						? profile.current_rating
						: ELO_CONSTANTS.startingRating,
					matchesPlayed: Number.isFinite(profile.matches_played)
						? profile.matches_played
						: 0,
					stats: extractPlayerStats(game.score_timeline, gp.player_id),
				};
			}),
	});

	return {
		teamA: buildTeam("home", Number(game.score_home ?? 0)),
		teamB: buildTeam("away", Number(game.score_away ?? 0)),
		matchMinutes: matchMinutesForResultType(game.result_type),
	};
}
