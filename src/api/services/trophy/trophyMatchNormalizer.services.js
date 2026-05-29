/**
 * Adapter from the raw Postgres `games` row to a normalized "match"
 * shape the trophy conditions operate on. Keeps the conditions
 * focused on game logic and away from SQL field-name quirks
 * (snake_case vs camelCase, score_timeline JSONB shape, etc.).
 *
 * Normalized shape:
 * {
 *   id: string,
 *   playedAt: Date,
 *   mode: string,
 *   scoreHome: number,
 *   scoreAway: number,
 *   resultType: 'regular' | 'extra_time' | 'penalty',
 *   winnerSide: 'home' | 'away' | null,
 *   homePlayers: string[],
 *   awayPlayers: string[],
 *   goals: Array<{ scorerId, assistId, side, minute, period, goalType }>,
 *   redCards: Array<{ playerId, side, minute, period }>,
 *   penaltyShootout: {
 *     winnerSide, scoreBefore, finalScore,
 *     shots: Array<{ shooterId, keeperId, result, team, order }>
 *   } | null,
 *   eloAfter: Record<string, number>,  // playerId -> rating after this match
 * }
 */

/**
 * Decide which side won. Penalty shootout's winner_side always wins
 * because the regular score is a draw in that branch.
 *
 * @param {object} game - Raw Postgres games row.
 * @returns {'home' | 'away' | null}
 */
function deriveWinnerSide(game) {
	if (game?.penalty_shootout?.winner_side) {
		return game.penalty_shootout.winner_side;
	}
	const h = game?.score_home ?? 0;
	const a = game?.score_away ?? 0;
	if (h > a) return "home";
	if (a > h) return "away";
	return null;
}

/**
 * Pull every goal entry out of the `score_timeline` and flatten into
 * a uniform shape. Skips cards, penalty-missed events and other
 * non-goal entries.
 *
 * @param {Array<object>} timeline
 * @param {{ homePlayers: string[], awayPlayers: string[] }} sides
 * @returns {Array<{ scorerId: string|null, assistId: string|null, side: 'home'|'away'|null, minute: number|null, period: string, goalType: string|null }>}
 */
function extractGoals(timeline, sides) {
	if (!Array.isArray(timeline)) return [];
	const goals = [];
	let prevHome = 0;
	let prevAway = 0;
	let prevPeriod = null;
	for (const entry of timeline) {
		if (!entry) continue;
		const isGoal = !entry.event_type || entry.event_type === "goal";
		if (!isGoal) continue;
		// Period change inside the timeline (e.g. penalty shootout) resets
		// the running score baseline so the side-from-delta detection works
		// across phase boundaries.
		if (prevPeriod && entry.period && entry.period !== prevPeriod) {
			prevHome = 0;
			prevAway = 0;
		}
		let side = null;
		if ((entry.home ?? prevHome) > prevHome) side = "home";
		else if ((entry.away ?? prevAway) > prevAway) side = "away";
		if (!side && entry.scored_by) {
			// Fallback: side from scorer membership.
			if (sides.homePlayers.includes(entry.scored_by)) side = "home";
			else if (sides.awayPlayers.includes(entry.scored_by)) side = "away";
		}
		goals.push({
			scorerId: entry.scored_by ?? null,
			assistId: entry.assist_by ?? null,
			side,
			minute: typeof entry.minute === "number" ? entry.minute : null,
			period: entry.period ?? "regular",
			goalType: entry.goal_type ?? null,
		});
		prevHome = entry.home ?? prevHome;
		prevAway = entry.away ?? prevAway;
		prevPeriod = entry.period ?? prevPeriod;
	}
	return goals;
}

/**
 * Pull every red card out of the timeline. Counts both the legacy
 * `event_type: "red_card"` entries and the modern
 * `event_type: "card" + card_type: "red"` form.
 *
 * @param {Array<object>} timeline
 * @returns {Array<{ playerId: string|null, side: 'home'|'away'|null, minute: number|null, period: string }>}
 */
function extractRedCards(timeline) {
	if (!Array.isArray(timeline)) return [];
	const reds = [];
	for (const entry of timeline) {
		if (!entry) continue;
		const isLegacyRed = entry.event_type === "red_card";
		const isModernRed =
			entry.event_type === "card" && entry.card_type === "red";
		if (!isLegacyRed && !isModernRed) continue;
		reds.push({
			playerId: entry.player_id ?? null,
			side: entry.team ?? null,
			minute: typeof entry.minute === "number" ? entry.minute : null,
			period: entry.period ?? "regular",
		});
	}
	return reds;
}

/**
 * Build a {playerId -> ratingAfter} map from the game's elo_snapshot.
 * Accepts both teamA/teamB and any other shape that exposes per-player
 * `playerId` + `ratingAfter` pairs.
 *
 * @param {object|null} eloSnapshot
 * @returns {Record<string, number>}
 */
function buildEloAfterMap(eloSnapshot) {
	if (!eloSnapshot || typeof eloSnapshot !== "object") return {};
	const map = {};
	const buckets = [eloSnapshot.teamA, eloSnapshot.teamB];
	for (const bucket of buckets) {
		if (!Array.isArray(bucket)) continue;
		for (const entry of bucket) {
			if (!entry?.playerId) continue;
			if (typeof entry.ratingAfter === "number") {
				map[entry.playerId] = entry.ratingAfter;
			}
		}
	}
	return map;
}

/**
 * Normalize a raw Postgres game row + its game_players rows into the
 * shape the trophy conditions consume.
 *
 * @param {object} game - Raw row from `SELECT * FROM games WHERE id = $1`.
 * @param {Array<{ player_id: string, team: 'home' | 'away' }>} gamePlayers
 * @returns {object} Normalized match.
 * @example
 *   const match = normalizeMatch(gameRow, gamePlayerRows);
 *   match.winnerSide; // "home"
 *   match.goals[0].scorerId; // "alice"
 */
export function normalizeMatch(game, gamePlayers) {
	const homePlayers = gamePlayers
		.filter((p) => p.team === "home")
		.map((p) => p.player_id);
	const awayPlayers = gamePlayers
		.filter((p) => p.team === "away")
		.map((p) => p.player_id);

	const goals = extractGoals(game.score_timeline, { homePlayers, awayPlayers });
	const redCards = extractRedCards(game.score_timeline);

	let penaltyShootout = null;
	if (game.penalty_shootout) {
		const shots = Array.isArray(game.penalty_shootout.shots)
			? game.penalty_shootout.shots.map((s) => ({
					order: s.order,
					team: s.team,
					shooterId: s.shooter_id ?? null,
					keeperId: s.keeper_id ?? null,
					result: s.result,
				}))
			: [];
		penaltyShootout = {
			winnerSide: game.penalty_shootout.winner_side ?? null,
			scoreBefore: game.penalty_shootout.score_before ?? null,
			finalScore: game.penalty_shootout.final_score ?? null,
			shots,
		};
	}

	return {
		id: game.id,
		playedAt: game.played_at ? new Date(game.played_at) : null,
		mode: game.mode,
		scoreHome: game.score_home ?? 0,
		scoreAway: game.score_away ?? 0,
		resultType: game.result_type ?? "regular",
		winnerSide: deriveWinnerSide(game),
		homePlayers,
		awayPlayers,
		goals,
		redCards,
		penaltyShootout,
		eloAfter: buildEloAfterMap(game.elo_snapshot),
	};
}

/**
 * Side ('home'/'away'/null) for a given player in a normalized match.
 *
 * @param {string} playerId
 * @param {object} match
 * @returns {'home' | 'away' | null}
 */
export function getPlayerSide(playerId, match) {
	if (match.homePlayers?.includes(playerId)) return "home";
	if (match.awayPlayers?.includes(playerId)) return "away";
	return null;
}

/**
 * Did the focal player's side win this match? Uses the match's
 * authoritative `winnerSide` (which already factors in shootouts).
 *
 * @param {string} playerId
 * @param {object} match
 * @returns {boolean}
 */
export function didPlayerWin(playerId, match) {
	const side = getPlayerSide(playerId, match);
	return side !== null && side === match.winnerSide;
}

/**
 * Goals the focal player scored in this match.
 *
 * @param {string} playerId
 * @param {object} match
 * @returns {number}
 */
export function getPlayerGoalsInMatch(playerId, match) {
	if (!match?.goals) return 0;
	return match.goals.filter((g) => g.scorerId === playerId).length;
}

/**
 * Assists the focal player provided in this match.
 *
 * @param {string} playerId
 * @param {object} match
 * @returns {number}
 */
export function getPlayerAssistsInMatch(playerId, match) {
	if (!match?.goals) return 0;
	return match.goals.filter((g) => g.assistId === playerId).length;
}

/**
 * Goals against the focal player's side in this match (regular time —
 * shootout goals are excluded).
 *
 * @param {string} playerId
 * @param {object} match
 * @returns {number}
 */
export function getPlayerGoalsAgainstInMatch(playerId, match) {
	const side = getPlayerSide(playerId, match);
	if (!side) return 0;
	return side === "home" ? match.scoreAway : match.scoreHome;
}

/**
 * Signed goal difference for the focal player's side
 * (positive = ahead, negative = behind).
 *
 * @param {string} playerId
 * @param {object} match
 * @returns {number}
 */
export function getPlayerGoalDifferenceInMatch(playerId, match) {
	const side = getPlayerSide(playerId, match);
	if (!side) return 0;
	return side === "home"
		? match.scoreHome - match.scoreAway
		: match.scoreAway - match.scoreHome;
}

/**
 * Partner ID — the OTHER player on the focal player's side in a
 * 2-player team. Returns null in 1v1 or when there is no partner.
 *
 * @param {string} playerId
 * @param {object} match
 * @returns {string | null}
 */
export function getPartnerId(playerId, match) {
	const side = getPlayerSide(playerId, match);
	if (!side) return null;
	const team = side === "home" ? match.homePlayers : match.awayPlayers;
	const others = team.filter((id) => id !== playerId);
	return others.length === 1 ? others[0] : null;
}

/**
 * Opponents — every player on the OTHER side.
 *
 * @param {string} playerId
 * @param {object} match
 * @returns {string[]}
 */
export function getOpponents(playerId, match) {
	const side = getPlayerSide(playerId, match);
	if (!side) return [];
	return side === "home" ? match.awayPlayers : match.homePlayers;
}
