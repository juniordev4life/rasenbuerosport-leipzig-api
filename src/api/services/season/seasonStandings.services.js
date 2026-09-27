/**
 * Season views for the Rangliste: the League-ELO v2 skill rating (players and
 * duos) and the league table. Both are league-wide — unlike the old
 * client-side Rangliste, which only saw the viewer's own games.
 *
 * Ratings come from what the League-ELO v2 replay stored: the per-game
 * snapshots and the season_elo_standings payload (start/end ratings).
 */

import { query, queryOne } from "../../helpers/database.helpers.js";
import { toSeasonDto } from "../leagueSeason.services.js";
import {
	berlinWeekKey,
	downsample,
	duoIdOf,
	lineupsByGame,
	playerFacts,
	sideGoals,
	sideResult,
	tablePoints,
} from "./seasonFacts.services.js";
import { RECAP_MIN_GAMES } from "./seasonRecapBuilder.services.js";

const HISTORY_POINTS = 60;
const FORM_GAMES = 10;
const ROOKIE_GAMES = 5;
const DUO_MIN_GAMES = 10;
const START_RATING = 1500;

/**
 * Everything a season view needs, in three queries.
 *
 * @param {object} season - league_seasons row
 * @returns {Promise<{games: object[], gamePlayers: object[], profiles: object[], standing: object|null}>}
 * @example
 * const data = await loadSeasonData(season);
 */
export async function loadSeasonData(season) {
	const range = [season.starts_at, season.ends_at];
	const games = await query(
		`SELECT id, played_at, score_home, score_away, score_timeline,
		        penalty_shootout, match_stats, elo_snapshot, result_type,
		        highlight_url, home_team_name, away_team_name, mode
		   FROM games
		  WHERE NOT pending AND played_at >= $1
		    AND ($2::timestamptz IS NULL OR played_at < $2)
		  ORDER BY played_at, id`,
		range,
	);
	const gamePlayers = await query(
		`SELECT gp.game_id, gp.player_id, gp.team, gp.team_name
		   FROM game_players gp
		   JOIN games g ON g.id = gp.game_id
		  WHERE NOT g.pending AND g.played_at >= $1
		    AND ($2::timestamptz IS NULL OR g.played_at < $2)`,
		range,
	);
	const profiles = await query(
		`SELECT id, username, avatar_url, current_rating, matches_played,
		        rating_updated_at
		   FROM profiles`,
	);
	const row = await queryOne(
		"SELECT payload FROM season_elo_standings WHERE season_id = $1",
		[season.id],
	);
	return { games, gamePlayers, profiles, standing: row?.payload ?? null };
}

function snapshotRowsOf(game) {
	const snap = game.elo_snapshot;
	if (!snap) return [];
	return [
		...(snap.teamA ?? []).map((r) => ({ ...r, side: "home" })),
		...(snap.teamB ?? []).map((r) => ({ ...r, side: "away" })),
	];
}

function emptyPlayerSeason() {
	return {
		games: 0,
		wins: 0,
		draws: 0,
		losses: 0,
		goals: 0,
		results: [],
		ratings: [],
		deltaWeek: 0,
	};
}

function collectPlayerSeasons(data, weekKey) {
	const lineups = lineupsByGame(data.gamePlayers);
	const seasons = new Map();
	for (const game of data.games) {
		const rows = snapshotRowsOf(game);
		if (rows.length === 0) continue;
		const lineup = lineups.get(game.id);
		const facts = playerFacts(game, [
			...(lineup?.home ?? []),
			...(lineup?.away ?? []),
		]);
		const sameWeek = weekKey && berlinWeekKey(game.played_at) === weekKey;
		for (const r of rows) {
			if (!seasons.has(r.playerId))
				seasons.set(r.playerId, emptyPlayerSeason());
			const s = seasons.get(r.playerId);
			const result = sideResult(game, r.side);
			s.games += 1;
			s[{ W: "wins", D: "draws", L: "losses" }[result]] += 1;
			s.goals += facts.get(r.playerId)?.goals ?? 0;
			s.results.push(result);
			s.ratings.push({ before: r.ratingBefore, after: r.ratingAfter });
			if (sameWeek) s.deltaWeek += r.delta;
		}
	}
	return seasons;
}

function currentStreak(results) {
	if (results.length === 0) return null;
	const type = results[results.length - 1];
	let count = 0;
	for (let i = results.length - 1; i >= 0 && results[i] === type; i--) count++;
	return { type, count };
}

function formDelta(ratings) {
	const last = ratings.slice(-FORM_GAMES);
	if (last.length === 0) return 0;
	return last[last.length - 1].after - last[0].before;
}

function playerRow(profile, standing, season, isCurrent) {
	const ratingStart = standing?.rating_start ?? START_RATING;
	const rating = isCurrent
		? profile.current_rating
		: (standing?.rating_end ?? ratingStart);
	return {
		player_id: profile.id,
		username: profile.username,
		avatar_url: profile.avatar_url ?? null,
		rating,
		rating_start: ratingStart,
		delta_season: rating - ratingStart,
		delta_week: isCurrent ? season.deltaWeek : 0,
		form_delta: formDelta(season.ratings),
		history: downsample(
			[ratingStart, ...season.ratings.map((r) => r.after)],
			HISTORY_POINTS,
		),
		games: season.games,
		wins: season.wins,
		draws: season.draws,
		losses: season.losses,
		goals: season.goals,
		streak: currentStreak(season.results),
		rookie: profile.matches_played < ROOKIE_GAMES,
		last_played_at: profile.rating_updated_at
			? new Date(profile.rating_updated_at).toISOString()
			: null,
	};
}

function rankRows(rows) {
	rows.sort(
		(a, b) =>
			Number(b.qualified) - Number(a.qualified) ||
			b.rating - a.rating ||
			a.username.localeCompare(b.username),
	);
	rows.forEach((row, i) => {
		row.rank = i + 1;
	});
	return rows;
}

function collectDuoSeasons(data) {
	const lineups = lineupsByGame(data.gamePlayers);
	const duos = new Map();
	for (const game of data.games) {
		if (!game.elo_snapshot) continue;
		const lineup = lineups.get(game.id);
		for (const side of ["home", "away"]) {
			const ids = lineup?.[side] ?? [];
			if (ids.length !== 2) continue;
			const key = [...ids].sort().join("|");
			if (!duos.has(key))
				duos.set(key, {
					games: 0,
					wins: 0,
					draws: 0,
					losses: 0,
					goalsFor: 0,
					goalsAgainst: 0,
				});
			const d = duos.get(key);
			const goals = sideGoals(game, side);
			d.games += 1;
			d[{ W: "wins", D: "draws", L: "losses" }[sideResult(game, side)]] += 1;
			d.goalsFor += goals.for;
			d.goalsAgainst += goals.against;
		}
	}
	return duos;
}

function duoRows(data, profilesById, isCurrent) {
	const seasonDuos = collectDuoSeasons(data);
	const rows = [];
	for (const duo of data.standing?.duos ?? []) {
		if (duo.games_total < DUO_MIN_GAMES) continue;
		if (!isCurrent && duo.games === 0) continue;
		const stats = seasonDuos.get(duo.key) ?? {
			games: 0,
			wins: 0,
			draws: 0,
			losses: 0,
			goalsFor: 0,
			goalsAgainst: 0,
		};
		const players = duo.player_ids.map((id) => ({
			player_id: id,
			username: profilesById.get(id)?.username ?? null,
			avatar_url: profilesById.get(id)?.avatar_url ?? null,
		}));
		rows.push({
			duo_id: duoIdOf(duo.player_ids),
			players,
			rating: duo.rating_end,
			rating_start: duo.rating_start,
			delta_season: duo.rating_end - duo.rating_start,
			games: stats.games,
			wins: stats.wins,
			draws: stats.draws,
			losses: stats.losses,
			games_total: duo.games_total,
			goals_for: stats.goalsFor,
			goals_against: stats.goalsAgainst,
		});
	}
	rows.sort((a, b) => b.rating - a.rating || a.duo_id.localeCompare(b.duo_id));
	rows.forEach((row, i) => {
		row.rank = i + 1;
	});
	return rows;
}

/**
 * Pure: skill-rating view of a season.
 *
 * @param {object} data - From loadSeasonData
 * @param {object} season - league_seasons row
 * @param {Date} [now] - For "this week"
 * @returns {{ season: object, players: object[], duos: object[] }}
 * @example
 * buildSeasonRating(data, season).players[0].rank; // 1
 */
export function buildSeasonRating(data, season, now = new Date()) {
	const isCurrent = season.ends_at == null;
	const seasons = collectPlayerSeasons(
		data,
		isCurrent ? berlinWeekKey(now) : null,
	);
	const standingById = new Map(
		(data.standing?.players ?? []).map((p) => [p.player_id, p]),
	);
	const profilesById = new Map(data.profiles.map((p) => [p.id, p]));
	const rows = [];
	for (const profile of data.profiles) {
		const season_ = seasons.get(profile.id) ?? emptyPlayerSeason();
		const standing = standingById.get(profile.id);
		const eligible = isCurrent ? profile.matches_played > 0 : season_.games > 0;
		if (!eligible) continue;
		const row = playerRow(profile, standing, season_, isCurrent);
		// A closed season's end standing only ranks regulars at the top, like
		// the champion award (a 15-game run must not outrank a 270-game season).
		row.qualified = isCurrent || season_.games >= RECAP_MIN_GAMES;
		rows.push(row);
	}
	return {
		season: { ...toSeasonDto(season), min_games: RECAP_MIN_GAMES },
		players: rankRows(rows),
		duos: duoRows(data, profilesById, isCurrent),
	};
}

/**
 * Pure: league table (points) of a season. Games against an empty side (CPU)
 * do not count.
 *
 * @param {object} data - From loadSeasonData
 * @param {object} season - league_seasons row
 * @returns {{ season: object, rows: object[] }}
 * @example
 * buildLeagueTable(data, season).rows[0].points; // 25
 */
export function buildLeagueTable(data, season) {
	const lineups = lineupsByGame(data.gamePlayers);
	const table = new Map();
	const row = (id) => {
		if (!table.has(id)) {
			table.set(id, {
				games: 0,
				wins: 0,
				draws: 0,
				losses: 0,
				shootout_wins: 0,
				shootout_losses: 0,
				goals_for: 0,
				goals_against: 0,
				points: 0,
			});
		}
		return table.get(id);
	};
	const kindKey = {
		W: "wins",
		D: "draws",
		L: "losses",
		SW: "shootout_wins",
		SL: "shootout_losses",
	};
	for (const game of data.games) {
		const lineup = lineups.get(game.id);
		if (!lineup?.home.length || !lineup?.away.length) continue;
		for (const side of ["home", "away"]) {
			const { points, kind } = tablePoints(game, side);
			const goals = sideGoals(game, side);
			for (const id of lineup[side]) {
				const r = row(id);
				r.games += 1;
				r[kindKey[kind]] += 1;
				r.points += points;
				r.goals_for += goals.for;
				r.goals_against += goals.against;
			}
		}
	}
	const profilesById = new Map(data.profiles.map((p) => [p.id, p]));
	const rows = [...table].map(([id, r]) => ({
		player_id: id,
		username: profilesById.get(id)?.username ?? null,
		avatar_url: profilesById.get(id)?.avatar_url ?? null,
		...r,
		goal_diff: r.goals_for - r.goals_against,
		points_per_game: Math.round((r.points / r.games) * 100) / 100,
	}));
	rows.sort(
		(a, b) =>
			b.points - a.points ||
			b.points_per_game - a.points_per_game ||
			b.goal_diff - a.goal_diff ||
			b.goals_for - a.goals_for ||
			String(a.username).localeCompare(String(b.username)),
	);
	rows.forEach((r, i) => {
		r.rank = i + 1;
	});
	return { season: toSeasonDto(season), rows };
}
