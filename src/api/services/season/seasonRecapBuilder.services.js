/**
 * Pure builder of the season recap ("Rückblick"): per-player stats, the
 * League-ELO v2 journey and the league-wide season awards. No I/O — the
 * caller hands in loadSeasonData() output plus the old/live ratings.
 *
 * Definitions follow seasonFacts: a shootout decides W/L, shootout kicks are
 * not goals, times are Europe/Berlin.
 */

import { dramaScore } from "../matchOfTheWeek.services.js";
import {
	berlinWeekdayHour,
	downsample,
	gameOutcome,
	lineupsByGame,
	playerFacts,
	sideGoals,
	sideResult,
} from "./seasonFacts.services.js";

/** Minimum season games for the champion title and per-game awards. */
export const RECAP_MIN_GAMES = 30;
const MIN_CLUB_GAMES = 5;
const MIN_WEEKDAY_GAMES = 5;
const MIN_PAIR_GAMES = 3;
const MIN_DUO_GAMES = 10;
const FORM_WINDOW_DAYS = 56;
const FORM_MIN_GAMES = 10;
const HISTORY_POINTS = 60;
const START_RATING = 1500;

const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : 0);
const round2 = (n) => Math.round(n * 100) / 100;

function emptyRecord() {
	return { games: 0, wins: 0, draws: 0, losses: 0 };
}

function emptyAcc() {
	return {
		...emptyRecord(),
		goals: 0,
		assists: 0,
		goalsAgainst: 0,
		cleanSheets: 0,
		hattricks: 0,
		comebackWins: 0,
		shootoutsPlayed: 0,
		shootoutsWon: 0,
		shootoutPoints: 0,
		yellow: 0,
		red: 0,
		sideYellow: 0,
		sideRed: 0,
		regularDraws: 0,
		oneGoalLosses: 0,
		lunch: 0,
		byMode: {
			"1v1": emptyRecord(),
			"2v2": emptyRecord(),
			"1v2": emptyRecord(),
		},
		results: [],
		appearances: [],
		weekdays: new Map(),
		hours: new Map(),
		clubs: new Map(),
		partners: new Map(),
		opponents: new Map(),
		scores: new Map(),
		ratings: [],
	};
}

function modeOf(lineup) {
	const [h, a] = [lineup.home.length, lineup.away.length];
	if (h === 1 && a === 1) return "1v1";
	if (h === 2 && a === 2) return "2v2";
	if ((h === 1 && a === 2) || (h === 2 && a === 1)) return "1v2";
	return null;
}

function bumpRecord(record, result) {
	record.games += 1;
	record[{ W: "wins", D: "draws", L: "losses" }[result]] += 1;
}

function bumpMap(map, key, result) {
	if (key == null) return;
	if (!map.has(key)) map.set(key, emptyRecord());
	bumpRecord(map.get(key), result);
}

function trailedAndWon(game, side, result) {
	if (result !== "W") return false;
	for (const e of game.score_timeline ?? []) {
		if (!e || (e.event_type ?? "goal") !== "goal" || e.period === "penalty")
			continue;
		const own = side === "home" ? e.home : e.away;
		const opp = side === "home" ? e.away : e.home;
		if (typeof own === "number" && typeof opp === "number" && own < opp)
			return true;
	}
	return false;
}

function shootoutPointsOf(game, playerId) {
	let points = 0;
	for (const shot of game.penalty_shootout?.shots ?? []) {
		if (shot?.shooter_id === playerId && shot.result === "goal") points += 1;
		if (shot?.keeper_id === playerId && shot.result !== "goal") points += 1;
	}
	return points;
}

function sideCards(game, side) {
	const stats = game.match_stats ?? {};
	return {
		yellow: Number(stats.yellow_cards?.[side] ?? 0) || 0,
		red: Number(stats.red_cards?.[side] ?? 0) || 0,
	};
}

function recordAppearance(acc, game, side, lineup, facts, playerId) {
	const result = sideResult(game, side);
	const { shootout } = gameOutcome(game);
	const goals = sideGoals(game, side);
	const own = facts.get(playerId) ?? {
		goals: 0,
		assists: 0,
		yellow: 0,
		red: 0,
	};
	const other = side === "home" ? "away" : "home";
	const { weekday, hour } = berlinWeekdayHour(game.played_at);
	const cards = sideCards(game, side);

	bumpRecord(acc, result);
	const mode = modeOf(lineup);
	if (mode) bumpRecord(acc.byMode[mode], result);
	acc.results.push(result);
	acc.goals += own.goals;
	acc.assists += own.assists;
	acc.yellow += own.yellow;
	acc.red += own.red;
	acc.sideYellow += Math.max(cards.yellow, own.yellow);
	acc.sideRed += Math.max(cards.red, own.red);
	acc.goalsAgainst += goals.against;
	if (goals.against === 0) acc.cleanSheets += 1;
	if (own.goals >= 3) acc.hattricks += 1;
	if (trailedAndWon(game, side, result)) acc.comebackWins += 1;
	if (shootout) {
		acc.shootoutsPlayed += 1;
		if (result === "W") acc.shootoutsWon += 1;
	} else if (result === "D") {
		acc.regularDraws += 1;
	}
	acc.shootoutPoints += shootoutPointsOf(game, playerId);
	if (result === "L" && (shootout || goals.against - goals.for === 1))
		acc.oneGoalLosses += 1;
	if (hour === 12 || hour === 13) acc.lunch += 1;
	bumpMap(acc.weekdays, weekday, result);
	bumpMap(acc.hours, hour, result);
	const club = lineup.clubs.get(playerId) ?? game[`${side}_team_name`] ?? null;
	bumpMap(acc.clubs, club, result);
	for (const partner of lineup[side])
		if (partner !== playerId) bumpMap(acc.partners, partner, result);
	for (const opponent of lineup[other])
		bumpMap(acc.opponents, opponent, result);
	const scoreKey = `${goals.for}:${goals.against}`;
	acc.scores.set(scoreKey, (acc.scores.get(scoreKey) ?? 0) + 1);
	acc.appearances.push({
		game,
		side,
		result,
		own: goals.for,
		opp: goals.against,
		opponents: lineup[other],
	});
}

function recordRating(acc, game, playerId) {
	const snap = game.elo_snapshot;
	const row = [...(snap?.teamA ?? []), ...(snap?.teamB ?? [])].find(
		(r) => r.playerId === playerId,
	);
	if (row)
		acc.ratings.push({
			before: row.ratingBefore,
			after: row.ratingAfter,
			playedAt: game.played_at,
		});
}

/**
 * Walks the season once and accumulates every player's appearances.
 *
 * @param {object} data - From loadSeasonData
 * @returns {Map<string, object>} playerId -> accumulator
 * @example
 * accumulatePlayers(data).get(uid).games; // 219
 */
export function accumulatePlayers(data) {
	const lineups = lineupsByGame(data.gamePlayers);
	const accs = new Map();
	for (const game of data.games) {
		const lineup = lineups.get(game.id);
		if (!lineup?.home.length || !lineup?.away.length) continue;
		const facts = playerFacts(game, [...lineup.home, ...lineup.away]);
		for (const side of ["home", "away"]) {
			for (const playerId of lineup[side]) {
				if (!accs.has(playerId)) accs.set(playerId, emptyAcc());
				const acc = accs.get(playerId);
				recordAppearance(acc, game, side, lineup, facts, playerId);
				recordRating(acc, game, playerId);
			}
		}
	}
	return accs;
}

function bestBy(entries, score, minGames = 0) {
	let best = null;
	for (const [key, rec] of entries) {
		if (rec.games < minGames) continue;
		const s = score(rec);
		if (
			!best ||
			s > best.score ||
			(s === best.score && rec.games > best.rec.games)
		) {
			best = { key, rec, score: s };
		}
	}
	return best;
}

function longestWinStreak(results) {
	let best = 0;
	let run = 0;
	for (const r of results) {
		run = r === "W" ? run + 1 : 0;
		best = Math.max(best, run);
	}
	return best;
}

function gameRef(app, names) {
	return {
		game_id: app.game.id,
		score: `${app.own}:${app.opp}`,
		played_at: new Date(app.game.played_at).toISOString(),
		opponents: app.opponents.map((id) => names.get(id)?.username ?? null),
	};
}

function pickGames(acc, names) {
	const wins = acc.appearances.filter((a) => a.result === "W" && a.own > a.opp);
	const byLatest = (a, b) =>
		new Date(b.game.played_at) - new Date(a.game.played_at);
	const biggest = [...wins].sort(
		(a, b) =>
			b.own - b.opp - (a.own - a.opp) || b.own - a.own || byLatest(a, b),
	)[0];
	const highest = [...acc.appearances].sort(
		(a, b) => b.own + b.opp - (a.own + a.opp) || byLatest(a, b),
	)[0];
	const drama = [...acc.appearances].sort(
		(a, b) => dramaScore(b.game) - dramaScore(a.game) || byLatest(a, b),
	)[0];
	return {
		biggest_win: biggest ? gameRef(biggest, names) : null,
		highest_scoring_game: highest ? gameRef(highest, names) : null,
		match_of_season: drama ? matchOfSeason(drama.game, names) : null,
	};
}

function matchOfSeason(game, names) {
	const players = (side) =>
		(game._lineup?.[side] ?? []).map((id) => names.get(id)?.username ?? null);
	return {
		game_id: game.id,
		score: `${game.score_home}:${game.score_away}`,
		played_at: new Date(game.played_at).toISOString(),
		result_type: game.result_type ?? "regular",
		highlight_url: game.highlight_url ?? null,
		home_players: players("home"),
		away_players: players("away"),
	};
}

function personRef(id, names, extra) {
	const p = names.get(id);
	return {
		player_id: id,
		username: p?.username ?? null,
		avatar_url: p?.avatar_url ?? null,
		...extra,
	};
}

function relations(acc, names) {
	const partner = bestBy(
		acc.partners,
		(r) => r.wins + ratio(r.wins, r.games),
		MIN_PAIR_GAMES,
	);
	const nemesis = bestBy(
		acc.opponents,
		(r) => r.losses + ratio(r.losses, r.games),
		MIN_PAIR_GAMES,
	);
	const victim = bestBy(
		acc.opponents,
		(r) => r.wins + ratio(r.wins, r.games),
		MIN_PAIR_GAMES,
	);
	return {
		best_partner: partner
			? personRef(partner.key, names, {
					games: partner.rec.games,
					wins: partner.rec.wins,
					win_rate: ratio(partner.rec.wins, partner.rec.games),
				})
			: null,
		nemesis: nemesis?.rec.losses
			? personRef(nemesis.key, names, {
					games: nemesis.rec.games,
					losses: nemesis.rec.losses,
				})
			: null,
		favorite_victim: victim?.rec.wins
			? personRef(victim.key, names, {
					games: victim.rec.games,
					wins: victim.rec.wins,
				})
			: null,
	};
}

function timing(acc) {
	const favDay = bestBy(acc.weekdays, (r) => r.games);
	const bestDay = bestBy(
		acc.weekdays,
		(r) => ratio(r.wins, r.games),
		MIN_WEEKDAY_GAMES,
	);
	const favHour = bestBy(acc.hours, (r) => r.games);
	return {
		favorite_weekday: favDay
			? { weekday: favDay.key, games: favDay.rec.games }
			: null,
		best_weekday: bestDay
			? {
					weekday: bestDay.key,
					win_rate: ratio(bestDay.rec.wins, bestDay.rec.games),
					games: bestDay.rec.games,
				}
			: null,
		lunch_break_share: ratio(acc.lunch, acc.games),
		favorite_hour: favHour
			? { hour: favHour.key, games: favHour.rec.games }
			: null,
	};
}

function clubsAndScores(acc) {
	const favClub = bestBy(acc.clubs, (r) => r.games);
	const bestClub = bestBy(
		acc.clubs,
		(r) => ratio(r.wins, r.games),
		MIN_CLUB_GAMES,
	);
	let common = null;
	for (const [score, count] of acc.scores) {
		if (count >= 2 && (!common || count > common.count))
			common = { score, count };
	}
	return {
		favorite_club: favClub
			? { name: favClub.key, games: favClub.rec.games }
			: null,
		best_club: bestClub
			? {
					name: bestClub.key,
					win_rate: ratio(bestClub.rec.wins, bestClub.rec.games),
					games: bestClub.rec.games,
				}
			: null,
		most_common_score: common,
	};
}

function competitionRank(values, own) {
	return values.filter((v) => v > own).length + 1;
}

function ranksOf(acc, accs) {
	const all = [...accs.values()];
	const rank = (key) => ({
		rank: competitionRank(
			all.map((a) => a[key]),
			acc[key],
		),
		of: all.length,
	});
	return {
		games: rank("games"),
		goals: rank("goals"),
		wins: rank("wins"),
		assists: rank("assists"),
	};
}

/**
 * Position in the season's end standing, ordered like the Rangliste of a
 * closed season: players with RECAP_MIN_GAMES first (by rating), then the rest.
 *
 * @param {string} playerId
 * @param {Array<{id: string, rating: number, qualified: boolean}>} table
 * @returns {number} 1-based
 * @example
 * standingRank("a", [{ id: "a", rating: 1600, qualified: true }]); // 1
 */
export function standingRank(playerId, table) {
	const sorted = [...table].sort(
		(a, b) => Number(b.qualified) - Number(a.qualified) || b.rating - a.rating,
	);
	return sorted.findIndex((row) => row.id === playerId) + 1;
}

function eloJourney(playerId, acc, standingById, ctx) {
	const standing = standingById.get(playerId);
	const start = standing?.rating_start ?? START_RATING;
	const end = standing?.rating_end ?? start;
	let peak = { value: start, played_at: null };
	for (const r of acc.ratings) {
		if (r.after > peak.value)
			peak = { value: r.after, played_at: new Date(r.playedAt).toISOString() };
	}
	return {
		start,
		end,
		rank: standingRank(playerId, ctx.seasonTable),
		of: ctx.seasonTable.length,
		qualified: acc.games >= RECAP_MIN_GAMES,
		peak,
		history: downsample(
			[start, ...acc.ratings.map((r) => r.after)],
			HISTORY_POINTS,
		),
		old_rating: ctx.oldRatings?.get(playerId) ?? null,
		new_rating: ctx.liveRatings?.get(playerId) ?? end,
		drivers: {
			yellow_cards: acc.sideYellow,
			one_vs_two_games: acc.byMode["1v2"].games,
			draws: acc.regularDraws,
			shootouts: acc.shootoutsPlayed,
		},
	};
}

function playerStats(acc, accs, names) {
	return {
		games: acc.games,
		wins: acc.wins,
		draws: acc.draws,
		losses: acc.losses,
		win_rate: ratio(acc.wins, acc.games),
		goals: acc.goals,
		assists: acc.assists,
		goals_per_game: round2(acc.games ? acc.goals / acc.games : 0),
		goals_against: acc.goalsAgainst,
		clean_sheets: acc.cleanSheets,
		hattricks: acc.hattricks,
		comeback_wins: acc.comebackWins,
		shootouts: { played: acc.shootoutsPlayed, won: acc.shootoutsWon },
		cards: { yellow: acc.sideYellow, red: acc.sideRed },
		by_mode: acc.byMode,
		longest_win_streak: longestWinStreak(acc.results),
		...pickGames(acc, names),
		...timing(acc),
		...clubsAndScores(acc),
		...relations(acc, names),
		ranks: ranksOf(acc, accs),
	};
}

// ---------- awards ----------

function awardOf(key, unit, candidates, pick, names) {
	if (candidates.length === 0) return null;
	const best = pick(candidates.map((c) => c.value));
	const winners = candidates.filter((c) => c.value === best);
	if (winners.length === 0) return null;
	const ids = winners.flatMap((w) => w.ids);
	return {
		key,
		unit,
		value: best,
		player_ids: ids,
		players: ids.map((id) => personRef(id, names)),
	};
}

const maxOf = (values) => Math.max(...values);
const minOf = (values) => Math.min(...values);

function formGain(acc, season) {
	if (!season.ends_at) return null;
	const windowStart =
		new Date(season.ends_at).getTime() - FORM_WINDOW_DAYS * 86400000;
	const inWindow = acc.ratings.filter(
		(r) => new Date(r.playedAt).getTime() >= windowStart,
	);
	if (inWindow.length < FORM_MIN_GAMES) return null;
	return inWindow[inWindow.length - 1].after - inWindow[0].before;
}

/**
 * League-wide season awards. Rate-based awards and the champion need at
 * least RECAP_MIN_GAMES season games; ties share an award.
 *
 * @param {Map<string, object>} accs - From accumulatePlayers
 * @param {object} data - From loadSeasonData (standing payload)
 * @param {object} season - league_seasons row
 * @param {Map<string, object>} names - playerId -> profile
 * @returns {object[]} Award objects in a fixed order
 * @example
 * buildSeasonAwards(accs, data, season, names)[0].key; // "champion"
 */
export function buildSeasonAwards(accs, data, season, names) {
	const standingById = new Map(
		(data.standing?.players ?? []).map((p) => [p.player_id, p]),
	);
	const list = (fn, filter = () => true) =>
		[...accs]
			.filter(([, acc]) => filter(acc))
			.map(([id, acc]) => ({ ids: [id], value: fn(id, acc) }))
			.filter((c) => c.value != null);
	const regular = (acc) => acc.games >= RECAP_MIN_GAMES;
	const duos = (data.standing?.duos ?? [])
		.filter((d) => d.games >= MIN_DUO_GAMES)
		.map((d) => ({ ids: d.player_ids, value: d.rating_end }));
	return [
		awardOf(
			"champion",
			"elo",
			list((id) => standingById.get(id)?.rating_end ?? null, regular),
			maxOf,
			names,
		),
		awardOf(
			"top_scorer",
			"goals",
			list(
				(_, a) => a.goals,
				(a) => a.goals > 0,
			),
			maxOf,
			names,
		),
		awardOf(
			"top_assister",
			"assists",
			list(
				(_, a) => a.assists,
				(a) => a.assists > 0,
			),
			maxOf,
			names,
		),
		awardOf("dream_duo", "elo", duos, maxOf, names),
		awardOf(
			"penalty_king",
			"points",
			list(
				(_, a) => a.shootoutPoints,
				(a) => a.shootoutPoints > 0,
			),
			maxOf,
			names,
		),
		awardOf(
			"fair_play",
			"cards_per_game",
			list((_, a) => round2((a.sideYellow + 3 * a.sideRed) / a.games), regular),
			minOf,
			names,
		),
		awardOf(
			"wall",
			"goals_per_game",
			list((_, a) => round2(a.goalsAgainst / a.games), regular),
			minOf,
			names,
		),
		awardOf(
			"marathon",
			"games",
			list((_, a) => a.games),
			maxOf,
			names,
		),
		awardOf(
			"form_of_the_year",
			"elo",
			list((_, a) => formGain(a, season)),
			maxOf,
			names,
		),
		awardOf(
			"lunch_king",
			"games",
			list(
				(_, a) => a.lunch,
				(a) => a.lunch > 0,
			),
			maxOf,
			names,
		),
		awardOf(
			"comeback_king",
			"games",
			list(
				(_, a) => a.comebackWins,
				(a) => a.comebackWins > 0,
			),
			maxOf,
			names,
		),
		awardOf(
			"unlucky",
			"games",
			list(
				(_, a) => a.oneGoalLosses,
				(a) => a.oneGoalLosses > 0,
			),
			maxOf,
			names,
		),
	].filter(Boolean);
}

function leagueFacts(data, accs) {
	const lineups = lineupsByGame(data.gamePlayers);
	const played = data.games.filter(
		(g) => lineups.get(g.id)?.home.length || lineups.get(g.id)?.away.length,
	);
	return {
		games: played.length,
		goals: played.reduce(
			(t, g) => t + Number(g.score_home ?? 0) + Number(g.score_away ?? 0),
			0,
		),
		shootouts: played.filter((g) => gameOutcome(g).shootout).length,
		players: accs.size,
	};
}

/**
 * Pure: every player's recap payload plus the league block.
 *
 * @param {object} data - From loadSeasonData
 * @param {object} season - league_seasons row (closed)
 * @param {object} ctx - { oldRatings?: Map, liveRatings?: Map, generatedAt?: string }
 * @returns {{ recaps: Map<string, object>, league: object }}
 * @example
 * const { recaps, league } = buildSeasonRecaps(data, season, { liveRatings });
 */
export function buildSeasonRecaps(data, season, ctx = {}) {
	const lineups = lineupsByGame(data.gamePlayers);
	for (const game of data.games) game._lineup = lineups.get(game.id);
	const names = new Map(data.profiles.map((p) => [p.id, p]));
	const accs = accumulatePlayers(data);
	const standingById = new Map(
		(data.standing?.players ?? []).map((p) => [p.player_id, p]),
	);
	const seasonTable = [...accs].map(([id, acc]) => ({
		id,
		rating: standingById.get(id)?.rating_end ?? START_RATING,
		qualified: acc.games >= RECAP_MIN_GAMES,
	}));
	const awards = buildSeasonAwards(accs, data, season, names);
	const league = { ...leagueFacts(data, accs), awards };
	const recaps = new Map();
	for (const [playerId, acc] of accs) {
		recaps.set(playerId, {
			player: personRef(playerId, names),
			stats: playerStats(acc, accs, names),
			elo: eloJourney(playerId, acc, standingById, { ...ctx, seasonTable }),
			awards_won: awards
				.filter((a) => a.player_ids.includes(playerId))
				.map((a) => a.key),
			ai_summary: null,
		});
	}
	for (const game of data.games) delete game._lineup;
	return { recaps, league };
}
