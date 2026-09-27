/**
 * Adapters from persisted games to League-ELO v2 match inputs. Pure — the
 * caller hands in already-loaded rows.
 *
 * Data quirks handled here (checked against the production data):
 *  - Shootout kicks are ALSO stored in `score_timeline` (period "penalty").
 *    They are skipped there and taken from `penalty_shootout.shots`, which
 *    carries shooter AND keeper.
 *  - An in-match penalty goal is a goal event with goal_type "penalty"; a
 *    missed one is a "penalty_missed" event with shooter_id and keeper_id.
 *  - A missed kick counts as saved by the keeper. The app records no
 *    wide/post outcome, and the rulebook gives wide/post no effect anyway.
 *  - Red cards are attributed via the timeline. The post-match screenshot
 *    (`match_stats.red_cards`) may report more; that surplus is known only
 *    per side and feeds the side bonus alone.
 */

/**
 * @returns {import("./leagueEloV2.services.js").PlayerStatsV2}
 * @example
 * emptyStatsV2().goals; // 0
 */
export function emptyStatsV2() {
	return {
		goals: 0,
		assists: 0,
		penaltiesScored: 0,
		penaltiesMissed: 0,
		penaltiesSaved: 0,
		redCards: 0,
		shootoutScored: 0,
		shootoutMissed: 0,
		shootoutSaved: 0,
	};
}

function bump(statsById, playerId, key) {
	const stats = statsById.get(playerId);
	if (stats) stats[key] += 1;
}

function applyTimelineEvent(statsById, event) {
	const type = event.event_type ?? "goal";
	if (type === "goal") {
		if (event.period === "penalty") return;
		if (event.is_own_goal === true || event.goal_type === "own_goal") return;
		const key = event.goal_type === "penalty" ? "penaltiesScored" : "goals";
		bump(statsById, event.scored_by, key);
		if (event.assist_by) bump(statsById, event.assist_by, "assists");
		return;
	}
	if (type === "penalty_missed") {
		bump(statsById, event.shooter_id, "penaltiesMissed");
		bump(statsById, event.keeper_id, "penaltiesSaved");
		return;
	}
	if (type === "red_card" || (type === "card" && event.card_type === "red")) {
		bump(statsById, event.player_id, "redCards");
	}
}

function applyShootoutShot(statsById, shot) {
	if (shot.result === "goal") {
		bump(statsById, shot.shooter_id, "shootoutScored");
		return;
	}
	bump(statsById, shot.shooter_id, "shootoutMissed");
	bump(statsById, shot.keeper_id, "shootoutSaved");
}

/**
 * Per-player stats of one game. Events naming someone outside `playerIds`
 * are ignored.
 *
 * @param {object} game - `games` row (score_timeline, penalty_shootout)
 * @param {string[]} playerIds - Everyone who played in the game
 * @returns {Map<string, import("./leagueEloV2.services.js").PlayerStatsV2>}
 * @example
 * extractStatsV2(game, ["uid-a", "uid-b"]).get("uid-a").goals; // 2
 */
export function extractStatsV2(game, playerIds) {
	const statsById = new Map(playerIds.map((id) => [id, emptyStatsV2()]));
	for (const event of game.score_timeline ?? []) {
		if (event && typeof event === "object")
			applyTimelineEvent(statsById, event);
	}
	for (const shot of game.penalty_shootout?.shots ?? []) {
		if (shot && typeof shot === "object") applyShootoutShot(statsById, shot);
	}
	return statsById;
}

function surplusReds(game, team, playerIds, statsById) {
	const reported = Number(game.match_stats?.red_cards?.[team] ?? 0) || 0;
	const attributed = playerIds.reduce(
		(t, id) => t + statsById.get(id).redCards,
		0,
	);
	return Math.max(0, reported - attributed);
}

/**
 * Match input for one game, or null when a side has no players (such a game
 * cannot be rated). Players within a side are sorted by id so tie-breaks in
 * the engine are deterministic. `rating` is filled in by the replay.
 *
 * @param {object} game - `games` row
 * @param {Array<{player_id: string, team: string}>} gamePlayers
 * @returns {object|null}
 * @example
 * buildMatchV2(game, [{ player_id: "a", team: "home" }, { player_id: "b", team: "away" }]);
 * // { gameId, playedAt, sides: [[{ playerId: "a", stats }], [...]], score: [3, 1], ... }
 */
export function buildMatchV2(game, gamePlayers) {
	const ids = (team) =>
		gamePlayers
			.filter((gp) => gp.team === team)
			.map((gp) => gp.player_id)
			.sort();
	const home = ids("home");
	const away = ids("away");
	if (home.length === 0 || away.length === 0) return null;
	const statsById = extractStatsV2(game, [...home, ...away]);
	const score = [Number(game.score_home ?? 0), Number(game.score_away ?? 0)];
	const winner = game.penalty_shootout?.winner_side;
	const level = score[0] === score[1];
	return {
		gameId: game.id,
		playedAt: game.played_at,
		sides: [home, away].map((side) =>
			side.map((playerId) => ({ playerId, stats: statsById.get(playerId) })),
		),
		score,
		shootoutWinner:
			level && winner === "home" ? 0 : level && winner === "away" ? 1 : null,
		extraRedCards: [
			surplusReds(game, "home", home, statsById),
			surplusReds(game, "away", away, statsById),
		],
	};
}

/**
 * ISO week of a timestamp in league time (Europe/Berlin), e.g. "2026-W39".
 *
 * @param {string|Date} playedAt
 * @returns {string}
 * @example
 * isoWeekKey("2026-09-24T09:00:00Z"); // "2026-W39"
 */
export function isoWeekKey(playedAt) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Berlin",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(playedAt));
	const get = (type) => Number(parts.find((p) => p.type === type).value);
	const date = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
	date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
	const year = date.getUTCFullYear();
	const week = Math.ceil(((date - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
	return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Line-up key independent of home/away, e.g. "a+b vs c+d".
 *
 * @param {object} match - From buildMatchV2
 * @returns {string}
 * @example
 * pairingKey({ sides: [[{ playerId: "c" }], [{ playerId: "a" }]] }); // "a vs c"
 */
export function pairingKey(match) {
	return match.sides
		.map((side) =>
			side
				.map((p) => p.playerId)
				.sort()
				.join("+"),
		)
		.sort()
		.join(" vs ");
}

/**
 * Numbers each game within its week and exact line-up (1 = first meeting),
 * which drives the repetition factor. Expects chronological order.
 *
 * @param {object[]} matches - From buildMatchV2, oldest first
 * @returns {object[]} Copies with `pairingGameNumber`
 * @example
 * assignPairingGameNumbers([m1, m2]).map((m) => m.pairingGameNumber); // [1, 2] for a rematch
 */
export function assignPairingGameNumbers(matches) {
	const seen = new Map();
	return matches.map((match) => {
		const key = `${isoWeekKey(match.playedAt)}|${pairingKey(match)}`;
		const n = (seen.get(key) ?? 0) + 1;
		seen.set(key, n);
		return { ...match, pairingGameNumber: n };
	});
}
