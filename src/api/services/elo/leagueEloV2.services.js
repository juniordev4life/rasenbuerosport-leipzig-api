/**
 * League-ELO v2 — candidate successor of the contribution-weighted engine,
 * evaluated offline (scripts/simulate-elo-v2.js) before any live switch.
 *
 * Mirrors the rulebook + simulator proposed for the league step by step:
 * side strength (α-weighted duos), handicap H for the duo side in 1v2,
 * individual expectation, goal-difference factor G, mode + repetition
 * factors, capped side bonus, capped contribution shift inside a duo,
 * shootout damping, zero-sum correction with largest-remainder rounding
 * and a minimum win of +1. A parallel duo rating is kept per pair.
 *
 * One deliberate deviation: result and goal difference come from the
 * stored final score, not from summing per-player goals. Older games have
 * incomplete per-player events, the score columns are always complete.
 *
 * No I/O here.
 */

/** Default parameters of the proposal ("Standardparameter"). */
export const LEAGUE_ELO_V2_DEFAULTS = Object.freeze({
	startRating: 1500,
	kFactor: 32,
	modeFactor: Object.freeze({ "1v1": 1, "2v2": 0.75, "1v2": 0.75 }),
	alpha: 0.6,
	handicapStart: 75,
	handicapLearningRate: 2,
	sideBonus: Object.freeze({
		assist: 1,
		penaltySaved: 1,
		redCard: 3,
		cap: 5,
	}),
	shootout: Object.freeze({ winnerScore: 0.6, damping: 0.5 }),
	contribution: Object.freeze({
		goal: 1,
		assist: 0.75,
		penaltyScored: 0.5,
		penaltyMissed: 0.5,
		penaltySaved: 1.5,
		redCard: 3,
	}),
	contributionBeta: 2,
	contributionCap: 4,
	repetitionFactor: 0.8,
	minWin: 1,
	minWinAfterShootout: true,
	duoKFactor: 32,
});

/**
 * @typedef {object} PlayerStatsV2
 * @property {number} goals - Open-play goals (penalties excluded)
 * @property {number} assists
 * @property {number} penaltiesScored - In-match penalties converted
 * @property {number} penaltiesMissed - In-match penalties the keeper saved
 * @property {number} penaltiesSaved - In-match penalties this player saved
 * @property {number} redCards
 * @property {number} shootoutScored
 * @property {number} shootoutMissed
 * @property {number} shootoutSaved
 */

/**
 * @typedef {object} SidePlayerV2
 * @property {string} playerId
 * @property {number} rating - Rating BEFORE the match
 * @property {PlayerStatsV2} stats
 */

/**
 * @typedef {object} MatchV2
 * @property {[SidePlayerV2[], SidePlayerV2[]]} sides - [home, away]
 * @property {[number, number]} score - Final score after regular/extra time
 * @property {0|1|null} shootoutWinner - Side that won the shootout, null if none
 * @property {[number, number]} [extraRedCards] - Reds known only per side (no player)
 * @property {number} [pairingGameNumber] - n-th game of this pairing in the week, 1-based
 */

/**
 * Goal-difference weight G.
 *
 * @param {number} goalDiff - Absolute goal difference
 * @returns {number}
 * @example
 * goalDiffFactor(1); // 1
 * goalDiffFactor(3); // 1.75
 */
export function goalDiffFactor(goalDiff) {
	if (goalDiff <= 1) return 1;
	if (goalDiff === 2) return 1.5;
	return (11 + goalDiff) / 8;
}

/**
 * Elo expectation of `own` against `opponent`.
 *
 * @param {number} opponent
 * @param {number} own
 * @returns {number} Between 0 and 1
 * @example
 * expectedScore(1500, 1500); // 0.5
 */
export function expectedScore(opponent, own) {
	return 1 / (1 + 10 ** ((opponent - own) / 400));
}

/**
 * Side strength: a solo player's rating, or the α-weighted duo rating.
 *
 * @param {number[]} ratings
 * @param {number} alpha - Weight of the stronger duo partner
 * @returns {number}
 * @example
 * sideStrength([1900, 1300], 0.6); // 1660
 */
export function sideStrength(ratings, alpha) {
	if (ratings.length === 1) return ratings[0];
	const max = Math.max(...ratings);
	const min = Math.min(...ratings);
	return alpha * max + (1 - alpha) * min;
}

/**
 * Rounds to integers whose sum is exactly the rounded total of zero: the
 * residual goes to the values with the largest rounding error.
 *
 * @param {number[]} values - Values summing to (almost) zero
 * @returns {number[]}
 * @example
 * roundZeroSum([-20.4, 10.6, 9.8]); // [-21, 11, 10]
 */
export function roundZeroSum(values) {
	const ints = values.map((v) => Math.round(v));
	let diff = ints.reduce((s, v) => s + v, 0);
	for (let guard = 0; diff !== 0 && guard < 20; guard++) {
		const errors = ints.map((v, i) => v - values[i]);
		const pick =
			diff > 0
				? errors.indexOf(Math.max(...errors))
				: errors.indexOf(Math.min(...errors));
		ints[pick] += diff > 0 ? -1 : 1;
		diff += diff > 0 ? -1 : 1;
	}
	return ints;
}

/**
 * Personal contribution inside a duo.
 *
 * @param {PlayerStatsV2} stats
 * @param {typeof LEAGUE_ELO_V2_DEFAULTS.contribution} weights
 * @param {boolean} withShootout - Shootout kicks count with the same weights
 * @returns {number}
 * @example
 * contributionScore({ ...emptyStats, goals: 2 }, weights, false); // 2
 */
export function contributionScore(stats, weights, withShootout) {
	let score =
		weights.goal * stats.goals +
		weights.assist * stats.assists +
		weights.penaltyScored * stats.penaltiesScored -
		weights.penaltyMissed * stats.penaltiesMissed +
		weights.penaltySaved * stats.penaltiesSaved -
		weights.redCard * stats.redCards;
	if (withShootout) {
		score +=
			weights.penaltyScored * stats.shootoutScored -
			weights.penaltyMissed * stats.shootoutMissed +
			weights.penaltySaved * stats.shootoutSaved;
	}
	return score;
}

/**
 * Mode from the side sizes and the handicap each side carries.
 *
 * @param {MatchV2["sides"]} sides
 * @param {number} handicap - Current H
 * @returns {{ mode: "1v1"|"2v2"|"1v2", handicaps: [number, number] }}
 * @example
 * resolveMode([[a], [b, c]], 75); // { mode: "1v2", handicaps: [0, 75] }
 */
function resolveMode(sides, handicap) {
	const [a, b] = [sides[0].length, sides[1].length];
	if (a === b) return { mode: a === 1 ? "1v1" : "2v2", handicaps: [0, 0] };
	return { mode: "1v2", handicaps: a > b ? [handicap, 0] : [0, handicap] };
}

/**
 * Result S per side, shootout damping and who counts as the winner.
 *
 * @param {MatchV2} match
 * @param {typeof LEAGUE_ELO_V2_DEFAULTS} params
 * @returns {{ S: [number, number], goalDiff: number, shootout: boolean,
 *   damping: number, winSide: 0|1|null }}
 * @example
 * resolveResult({ score: [2, 2], shootoutWinner: 0 }, params);
 * // { S: [0.6, 0.4], goalDiff: 0, shootout: true, damping: 0.5, winSide: 0 }
 */
function resolveResult(match, params) {
	const [home, away] = match.score;
	const goalDiff = Math.abs(home - away);
	const shootout = home === away && match.shootoutWinner != null;
	if (shootout) {
		const w = params.shootout.winnerScore;
		return {
			S: match.shootoutWinner === 0 ? [w, 1 - w] : [1 - w, w],
			goalDiff,
			shootout,
			damping: params.shootout.damping,
			winSide: params.minWinAfterShootout ? match.shootoutWinner : null,
		};
	}
	const s0 = home > away ? 1 : home < away ? 0 : 0.5;
	const winSide = s0 === 1 ? 0 : s0 === 0 ? 1 : null;
	return { S: [s0, 1 - s0], goalDiff, shootout, damping: 1, winSide };
}

/**
 * Side bonus of side 0 (side 1 gets the negative), capped.
 *
 * @param {MatchV2} match
 * @param {string} mode
 * @param {typeof LEAGUE_ELO_V2_DEFAULTS.sideBonus} weights
 * @returns {number}
 * @example
 * sideBonusOfHome(match, "1v1", weights); // 3 when only the away player saw red
 */
function sideBonusOfHome(match, mode, weights) {
	const total = (side, key) =>
		match.sides[side].reduce((t, p) => t + p.stats[key], 0);
	const diff = (key) => total(0, key) - total(1, key);
	const [extraHome, extraAway] = match.extraRedCards ?? [0, 0];
	const redDiff = diff("redCards") + extraHome - extraAway;
	const assistTerm = mode === "2v2" ? weights.assist * diff("assists") : 0;
	const raw =
		assistTerm +
		weights.penaltySaved * diff("penaltiesSaved") -
		weights.redCard * redDiff;
	return Math.max(-weights.cap, Math.min(weights.cap, raw));
}

/**
 * Unrounded per-player values: Elo share, side bonus and contribution shift.
 *
 * @param {MatchV2} match
 * @param {object} ctx - Mode, handicaps, result and factors of the match
 * @param {typeof LEAGUE_ELO_V2_DEFAULTS} params
 * @returns {Array<object>} One row per player, side 0 first
 * @example
 * playerRows(match, ctx, params)[0].raw; // e.g. 11.53 for a 3:1 favourite win
 */
function playerRows(match, ctx, params) {
	const strengths = match.sides.map(
		(side, s) =>
			sideStrength(
				side.map((p) => p.rating),
				params.alpha,
			) + ctx.handicaps[s],
	);
	const k = params.kFactor * params.modeFactor[ctx.mode] * ctx.repetition;
	const rows = [];
	match.sides.forEach((side, s) => {
		const contribs = side.map((p) =>
			contributionScore(p.stats, params.contribution, ctx.shootout),
		);
		const avg = contribs.reduce((t, v) => t + v, 0) / side.length;
		side.forEach((p, i) => {
			const expected = expectedScore(
				strengths[1 - s],
				p.rating + ctx.handicaps[s],
			);
			const eloShare = ctx.damping * k * ctx.G * (ctx.S[s] - expected);
			const sideBonus = (ctx.damping * ctx.bonus[s]) / side.length;
			const rawShift = params.contributionBeta * (contribs[i] - avg);
			const cap = params.contributionCap;
			const shift =
				side.length > 1
					? ctx.damping * Math.max(-cap, Math.min(cap, rawShift))
					: 0;
			rows.push({
				playerId: p.playerId,
				side: s,
				ratingBefore: p.rating,
				expected,
				contribution: contribs[i],
				eloShare,
				sideBonus,
				contributionShift: shift,
				raw: eloShare + sideBonus + shift,
			});
		});
	});
	return { rows, strengths };
}

/**
 * Zero-sum correction, integer rounding and the minimum win for the winners.
 * Losers cover a raised win one point at a time, smallest loss first
 * (ties: higher rating first).
 *
 * @param {Array<object>} rows - From playerRows
 * @param {0|1|null} winSide
 * @param {number} minWin
 * @returns {number[]} Integer deltas in row order, summing to 0
 * @example
 * settleDeltas(rows, 0, 1); // [1, -1] for a 2200 vs 1300 1:0
 */
function settleDeltas(rows, winSide, minWin) {
	const correction = -rows.reduce((t, r) => t + r.raw, 0) / rows.length;
	const ints = roundZeroSum(rows.map((r) => r.raw + correction));
	if (winSide === null || minWin <= 0) return ints;
	let need = 0;
	rows.forEach((r, i) => {
		if (r.side === winSide && ints[i] < minWin) {
			need += minWin - ints[i];
			ints[i] = minWin;
		}
	});
	const losers = rows.map((_, i) => i).filter((i) => rows[i].side !== winSide);
	for (; need > 0; need--) {
		let pick = losers[0];
		for (const i of losers) {
			const higher = ints[i] > ints[pick];
			const tieOnRating =
				ints[i] === ints[pick] &&
				rows[i].ratingBefore > rows[pick].ratingBefore;
			if (higher || tieOnRating) pick = i;
		}
		ints[pick] -= 1;
	}
	return ints;
}

/**
 * Rates one match. Pure: the caller keeps ratings and the handicap.
 *
 * @param {MatchV2} match
 * @param {number} handicap - Current H (only used in 1v2)
 * @param {typeof LEAGUE_ELO_V2_DEFAULTS} [params]
 * @returns {object} Mode, factors, side expectation and per-player rows with `delta`
 * @example
 * computeMatchV2({ sides: [[a], [b]], score: [1, 0], shootoutWinner: null }, 75).rows;
 * // [{ playerId: "a", delta: 1, ... }, { playerId: "b", delta: -1, ... }]
 */
export function computeMatchV2(
	match,
	handicap,
	params = LEAGUE_ELO_V2_DEFAULTS,
) {
	const { mode, handicaps } = resolveMode(match.sides, handicap);
	const result = resolveResult(match, params);
	const bonusHome = sideBonusOfHome(match, mode, params.sideBonus);
	const repetition =
		params.repetitionFactor ** Math.max(0, (match.pairingGameNumber ?? 1) - 1);
	const ctx = {
		mode,
		handicaps,
		repetition,
		G: goalDiffFactor(result.goalDiff),
		S: result.S,
		shootout: result.shootout,
		damping: result.damping,
		bonus: [bonusHome, -bonusHome],
	};
	const { rows, strengths } = playerRows(match, ctx, params);
	const deltas = settleDeltas(rows, result.winSide, params.minWin);
	rows.forEach((r, i) => {
		r.delta = deltas[i];
		r.ratingAfter = r.ratingBefore + deltas[i];
	});
	const sideExpectedHome = expectedScore(strengths[1], strengths[0]);
	return {
		...ctx,
		winSide: result.winSide,
		sideExpected: [sideExpectedHome, 1 - sideExpectedHome],
		rows,
	};
}

/**
 * Handicap after a 1v2 game: H moves by η · (S_duo − E_duo), one decimal.
 *
 * @param {number} handicap
 * @param {object} result - From computeMatchV2 (must be mode 1v2)
 * @param {[SidePlayerV2[], SidePlayerV2[]]} sides
 * @param {typeof LEAGUE_ELO_V2_DEFAULTS} [params]
 * @returns {number}
 * @example
 * nextHandicap(75, result, sides); // 76.3 after a duo win it was not favoured for
 */
export function nextHandicap(
	handicap,
	result,
	sides,
	params = LEAGUE_ELO_V2_DEFAULTS,
) {
	const duoSide = sides[0].length === 2 ? 0 : 1;
	const moved =
		handicap +
		params.handicapLearningRate *
			(result.S[duoSide] - result.sideExpected[duoSide]);
	return Math.round(moved * 10) / 10;
}

/**
 * Stable key of a duo, independent of the order of its players.
 *
 * @param {string[]} playerIds
 * @returns {string}
 * @example
 * duoKey(["b", "a"]); // "a|b"
 */
export function duoKey(playerIds) {
	return [...playerIds].sort().join("|");
}

/**
 * Duo-rating updates for a 2v2 (duo vs duo, zero-sum) or 1v2 (duo vs the
 * solo player's individual rating plus H; only the duo moves). A new duo
 * starts at its rounded side strength.
 *
 * @param {object} result - From computeMatchV2
 * @param {MatchV2["sides"]} sides - With ratings BEFORE the match
 * @param {Map<string, {rating: number}>} duos
 * @param {number} handicap
 * @param {typeof LEAGUE_ELO_V2_DEFAULTS} [params]
 * @returns {Array<{key: string, side: 0|1, before: number, delta: number, isNew: boolean}>}
 * @example
 * computeDuoV2(result, sides, new Map(), 75); // [{ key: "a|b", delta: 12, ... }, ...]
 */
export function computeDuoV2(
	result,
	sides,
	duos,
	handicap,
	params = LEAGUE_ELO_V2_DEFAULTS,
) {
	const k = params.duoKFactor * result.G * result.repetition * result.damping;
	const minWin = params.minWin;
	const rate = (side) => {
		const key = duoKey(side.map((p) => p.playerId));
		const known = duos.get(key);
		if (known) return { key, rating: known.rating, isNew: false };
		const start = sideStrength(
			side.map((p) => p.rating),
			params.alpha,
		);
		return { key, rating: Math.round(start), isNew: true };
	};
	if (result.mode === "2v2") {
		const [a, b] = [rate(sides[0]), rate(sides[1])];
		let d = Math.round(k * (result.S[0] - expectedScore(b.rating, a.rating)));
		if (result.winSide === 0 && d < minWin) d = minWin;
		if (result.winSide === 1 && d > -minWin) d = -minWin;
		return [
			{ key: a.key, side: 0, before: a.rating, delta: d, isNew: a.isNew },
			{ key: b.key, side: 1, before: b.rating, delta: -d, isNew: b.isNew },
		];
	}
	if (result.mode === "1v2") {
		const duoSide = sides[0].length === 2 ? 0 : 1;
		const duo = rate(sides[duoSide]);
		const solo = sides[1 - duoSide][0].rating;
		const expected = expectedScore(solo, duo.rating + handicap);
		let d = Math.round(k * (result.S[duoSide] - expected));
		if (result.winSide === duoSide && d < minWin) d = minWin;
		return [
			{
				key: duo.key,
				side: duoSide,
				before: duo.rating,
				delta: d,
				isNew: duo.isNew,
			},
		];
	}
	return [];
}
