/**
 * Pure per-game facts shared by the season standings, the league table and
 * the season recap. One definition of "win", "goal" and "points" for all of
 * them:
 *  - A level game with a recorded shootout winner is a win for that side and
 *    a loss for the other (never a draw).
 *  - Goals come from the timeline; shootout kicks (period "penalty") and own
 *    goals are not goals of a player.
 *  - League points: win 3, draw 1, loss 0; after a shootout winner 2, loser 1.
 */

/**
 * Line-up of every game: player ids per side and the in-game club per player.
 *
 * @param {Array<{game_id: string, player_id: string, team: string, team_name?: string}>} gamePlayers
 * @returns {Map<string, {home: string[], away: string[], clubs: Map<string, string|null>}>}
 * @example
 * lineupsByGame(rows).get(gameId).home; // ["uid-a", "uid-b"]
 */
export function lineupsByGame(gamePlayers) {
	const byGame = new Map();
	for (const gp of gamePlayers) {
		if (!byGame.has(gp.game_id)) {
			byGame.set(gp.game_id, { home: [], away: [], clubs: new Map() });
		}
		const lineup = byGame.get(gp.game_id);
		if (gp.team === "home" || gp.team === "away")
			lineup[gp.team].push(gp.player_id);
		lineup.clubs.set(gp.player_id, gp.team_name ?? null);
	}
	for (const lineup of byGame.values()) {
		lineup.home.sort();
		lineup.away.sort();
	}
	return byGame;
}

/**
 * Winner of a game, honouring the shootout.
 *
 * @param {object} game - games row
 * @returns {{ winner: "home"|"away"|null, shootout: boolean }}
 * @example
 * gameOutcome({ score_home: 2, score_away: 2, penalty_shootout: { winner_side: "away" } });
 * // { winner: "away", shootout: true }
 */
export function gameOutcome(game) {
	const home = Number(game.score_home ?? 0);
	const away = Number(game.score_away ?? 0);
	if (home > away) return { winner: "home", shootout: false };
	if (away > home) return { winner: "away", shootout: false };
	const side = game.penalty_shootout?.winner_side;
	if (side === "home" || side === "away")
		return { winner: side, shootout: true };
	return { winner: null, shootout: false };
}

/**
 * Result of one side: W, D or L (a shootout decides W/L).
 *
 * @param {object} game
 * @param {"home"|"away"} side
 * @returns {"W"|"D"|"L"}
 * @example
 * sideResult(game, "home"); // "W"
 */
export function sideResult(game, side) {
	const { winner } = gameOutcome(game);
	if (winner === null) return "D";
	return winner === side ? "W" : "L";
}

/**
 * Goals of a side as stored in the score columns (regular + extra time).
 *
 * @param {object} game
 * @param {"home"|"away"} side
 * @returns {{ for: number, against: number }}
 * @example
 * sideGoals({ score_home: 3, score_away: 1 }, "away"); // { for: 1, against: 3 }
 */
export function sideGoals(game, side) {
	const home = Number(game.score_home ?? 0);
	const away = Number(game.score_away ?? 0);
	return side === "home"
		? { for: home, against: away }
		: { for: away, against: home };
}

function emptyPlayerFacts() {
	return { goals: 0, assists: 0, yellow: 0, red: 0 };
}

/**
 * Goals, assists and cards per player from the timeline. Shootout kicks
 * (period "penalty") and own goals do not count as goals.
 *
 * @param {object} game - games row with score_timeline
 * @param {string[]} playerIds - Everyone in the game
 * @returns {Map<string, {goals: number, assists: number, yellow: number, red: number}>}
 * @example
 * playerFacts(game, ["a", "b"]).get("a").goals; // 2
 */
export function playerFacts(game, playerIds) {
	const facts = new Map(playerIds.map((id) => [id, emptyPlayerFacts()]));
	const bump = (id, key) => {
		const f = facts.get(id);
		if (f) f[key] += 1;
	};
	for (const e of game.score_timeline ?? []) {
		if (!e || typeof e !== "object") continue;
		const type = e.event_type ?? "goal";
		if (type === "goal") {
			if (e.period === "penalty") continue;
			if (e.is_own_goal === true || e.goal_type === "own_goal") continue;
			bump(e.scored_by, "goals");
			if (e.assist_by) bump(e.assist_by, "assists");
		} else if (type === "card") {
			bump(e.player_id, e.card_type === "red" ? "red" : "yellow");
		} else if (type === "red_card") {
			bump(e.player_id, "red");
		}
	}
	return facts;
}

/**
 * Canonical duo id as used by the app routes (`/app/duo/{a}_{b}`): both ids
 * sorted with localeCompare, joined by "_".
 *
 * @param {string[]} playerIds - Two ids
 * @returns {string}
 * @example
 * duoIdOf(["b", "a"]); // "a_b"
 */
export function duoIdOf(playerIds) {
	return [...playerIds].sort((a, b) => a.localeCompare(b)).join("_");
}

/**
 * ISO week key in Europe/Berlin for "this week" comparisons.
 *
 * @param {Date|string} at
 * @returns {string} e.g. "2026-W39"
 * @example
 * berlinWeekKey("2026-09-27T20:00:00Z"); // "2026-W39"
 */
export function berlinWeekKey(at) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Berlin",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(at));
	const get = (type) => Number(parts.find((p) => p.type === type).value);
	const date = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
	date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
	const year = date.getUTCFullYear();
	const week = Math.ceil(((date - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
	return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Weekday (ISO 1 = Monday … 7 = Sunday) and hour in Europe/Berlin.
 *
 * @param {Date|string} at
 * @returns {{ weekday: number, hour: number }}
 * @example
 * berlinWeekdayHour("2026-09-22T10:52:00Z"); // { weekday: 2, hour: 12 }
 */
export function berlinWeekdayHour(at) {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Europe/Berlin",
		weekday: "short",
		hour: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(at));
	const names = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
	return {
		weekday: names[parts.find((p) => p.type === "weekday").value],
		hour: Number(parts.find((p) => p.type === "hour").value),
	};
}

/**
 * Evenly thins a series to at most `max` points, always keeping the first
 * and the last value.
 *
 * @param {number[]} values
 * @param {number} max
 * @returns {number[]}
 * @example
 * downsample([1, 2, 3, 4, 5], 3); // [1, 3, 5]
 */
export function downsample(values, max) {
	if (values.length <= max) return values;
	const out = [];
	const step = (values.length - 1) / (max - 1);
	for (let i = 0; i < max; i++) out.push(values[Math.round(i * step)]);
	return out;
}
