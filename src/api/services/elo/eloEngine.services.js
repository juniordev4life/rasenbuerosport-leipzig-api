/**
 * Match-level ELO orchestrator — the entry point for the match-save
 * flow. Takes a fully-shaped MatchInput, returns a MatchEloResult
 * with per-player deltas, the new ratings and an explainable
 * breakdown of how the numbers were arrived at.
 *
 * No I/O here. The caller loads players, builds the MatchInput,
 * calls this function, writes the result to DB. That keeps the math
 * trivially testable and lets us run the engine over historical
 * matches for backfill if needed.
 */

import { ELO_ALGORITHM_VERSION } from "../../../constants/elo.constants.js";
import {
	computeContribution,
	computeTeamShares,
} from "./contributionScore.services.js";
import { distributeTeamDelta } from "./eloDistribution.services.js";
import {
	computeExpectedScore,
	computeMarginFactor,
	computeTeamDelta,
	computeTeamRating,
	resolveKFactor,
} from "./eloMath.services.js";

/**
 * @typedef {import("./contributionScore.services.js").PlayerMatchStats} PlayerMatchStats
 */

/**
 * @typedef {object} PlayerInput
 * @property {string} playerId
 * @property {number} rating - Current ELO BEFORE the match.
 * @property {number} matchesPlayed - Match count BEFORE the match.
 * @property {PlayerMatchStats} stats
 */

/**
 * @typedef {object} TeamInput
 * @property {PlayerInput[]} players
 * @property {number} goals
 */

/**
 * @typedef {object} MatchInput
 * @property {TeamInput} teamA
 * @property {TeamInput} teamB
 * @property {number} [matchMinutes] - Default 10 (one-half matches).
 */

/**
 * @typedef {object} PlayerEloResult
 * @property {string} playerId
 * @property {number} ratingBefore
 * @property {number} ratingAfter
 * @property {number} delta
 * @property {number} contribution
 * @property {number} share
 * @property {object} breakdown
 */

/**
 * @typedef {object} MatchEloResult
 * @property {PlayerEloResult[]} teamA
 * @property {PlayerEloResult[]} teamB
 * @property {string} version
 * @property {object} matchMeta
 */

/**
 * Compute all per-player ELO changes for one match.
 *
 * @param {MatchInput} match
 * @returns {MatchEloResult}
 *
 * @example
 *   const result = computeMatchElo({
 *     teamA: {
 *       goals: 3,
 *       players: [
 *         { playerId: "marco", rating: 1500, matchesPlayed: 50,
 *           stats: { goals: 3, assists: 0, redCards: [] } },
 *         { playerId: "tobi",  rating: 1500, matchesPlayed: 50,
 *           stats: { goals: 0, assists: 0, redCards: [] } },
 *       ],
 *     },
 *     teamB: {
 *       goals: 1,
 *       players: [
 *         { playerId: "jonas", rating: 1500, matchesPlayed: 50,
 *           stats: { goals: 1, assists: 0, redCards: [] } },
 *         { playerId: "nik",   rating: 1500, matchesPlayed: 50,
 *           stats: { goals: 0, assists: 0, redCards: [] } },
 *       ],
 *     },
 *     matchMinutes: 10,
 *   });
 *   // → result.teamA[0].delta ≈ +28  (Marco — 3 goals)
 *   //   result.teamA[1].delta ≈ +7   (Tobi  — no scorer points)
 *   //   result.teamB[0].delta ≈ -7   (Jonas — at least scored)
 *   //   result.teamB[1].delta ≈ -28  (Nik   — no contribution)
 */
/**
 * Goal margin a shootout win borrows for computeMarginFactor. A shootout is
 * the narrowest possible win, so it is rated like a one-goal win — the real
 * goal difference is 0, which the margin function maps to 'no movement'.
 */
const SHOOTOUT_MARGIN_GOALS = 1;

export function computeMatchElo(match) {
	const matchMinutes = match.matchMinutes ?? 10;
	const teamA = match.teamA;
	const teamB = match.teamB;

	const ratingA = computeTeamRating(teamA.players.map((p) => p.rating));
	const ratingB = computeTeamRating(teamB.players.map((p) => p.rating));

	const expectedA = computeExpectedScore(ratingA, ratingB);
	const expectedB = 1 - expectedA;

	// The league plays extra time and penalties — there are no draws. A
	// shootout therefore DECIDES the match, even though regular time ended
	// level, so it must not be rated as a draw. Both halves of that matter:
	// actualScore alone is not enough, because computeMarginFactor(0, …) is 0
	// and would multiply the whole delta away. A shootout win is the narrowest
	// win there is, so it borrows the margin of a one-goal win.
	const decidedByShootout =
		(match.penaltyWinner === "A" || match.penaltyWinner === "B") &&
		teamA.goals === teamB.goals;

	const actualA = decidedByShootout
		? match.penaltyWinner === "A"
			? 1
			: 0
		: scoreFromGoals(teamA.goals, teamB.goals);
	const actualB = 1 - actualA;

	const goalDiff = decidedByShootout
		? SHOOTOUT_MARGIN_GOALS
		: Math.abs(teamA.goals - teamB.goals);
	const marginA = computeMarginFactor(goalDiff, ratingA - ratingB);
	const marginB = computeMarginFactor(goalDiff, ratingB - ratingA);

	// K-factor is averaged across each team's players so a newbie
	// playing alongside a veteran still gets some of the newbie
	// bonus reflected in the team movement.
	const kFactorA = averageKFactor(teamA.players);
	const kFactorB = averageKFactor(teamB.players);

	const teamDeltaA = computeTeamDelta({
		kFactor: kFactorA,
		marginFactor: marginA,
		actualScore: actualA,
		expectedScore: expectedA,
	});
	const teamDeltaB = computeTeamDelta({
		kFactor: kFactorB,
		marginFactor: marginB,
		actualScore: actualB,
		expectedScore: expectedB,
	});

	const playerResultsA = distributeToPlayers(teamA, teamDeltaA, matchMinutes);
	const playerResultsB = distributeToPlayers(teamB, teamDeltaB, matchMinutes);

	return {
		teamA: playerResultsA,
		teamB: playerResultsB,
		version: ELO_ALGORITHM_VERSION,
		matchMeta: {
			ratingA: round1(ratingA),
			ratingB: round1(ratingB),
			expectedA: round3(expectedA),
			expectedB: round3(expectedB),
			teamDeltaA: round1(teamDeltaA),
			teamDeltaB: round1(teamDeltaB),
			marginA: round3(marginA),
			marginB: round3(marginB),
			kFactorA,
			kFactorB,
			actualA,
			actualB,
			decidedByShootout,
		},
	};
}

/**
 * Map goal counts to the ELO actualScore axis.
 *
 * @param {number} goalsA
 * @param {number} goalsB
 * @returns {number} 1 | 0.5 | 0
 */
function scoreFromGoals(goalsA, goalsB) {
	if (goalsA > goalsB) return 1;
	if (goalsA < goalsB) return 0;
	return 0.5;
}

/**
 * Average K-factor across a team's players. Per-player K is resolved
 * via `resolveKFactor(matchesPlayed)`.
 *
 * @param {PlayerInput[]} players
 * @returns {number}
 */
function averageKFactor(players) {
	const sum = players.reduce(
		(acc, p) => acc + resolveKFactor(p.matchesPlayed),
		0,
	);
	return sum / players.length;
}

/**
 * Combine contribution scoring + distribution into per-player
 * results, with rounded values for downstream storage.
 *
 * @param {TeamInput} team
 * @param {number} teamDelta
 * @param {number} matchMinutes
 * @returns {PlayerEloResult[]}
 */
function distributeToPlayers(team, teamDelta, matchMinutes) {
	const contributions = team.players.map((p) =>
		computeContribution(p.stats, matchMinutes),
	);
	const shares = computeTeamShares(contributions);
	const deltas = distributeTeamDelta({ teamDelta, shares });

	return team.players.map((p, i) => ({
		playerId: p.playerId,
		ratingBefore: p.rating,
		ratingAfter: Math.round(p.rating + deltas[i]),
		delta: round1(deltas[i]),
		contribution: round2(contributions[i]),
		share: round3(shares[i]),
		breakdown: {
			stats: p.stats,
			teamDelta: round1(teamDelta),
			matchMinutes,
		},
	}));
}

function round1(n) {
	return Math.round(n * 10) / 10;
}
function round2(n) {
	return Math.round(n * 100) / 100;
}
function round3(n) {
	return Math.round(n * 1000) / 1000;
}
