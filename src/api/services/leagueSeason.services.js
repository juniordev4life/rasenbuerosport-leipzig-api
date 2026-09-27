/**
 * League seasons — EA FC editions (FC26, FC27, …) stored in `league_seasons`.
 * Not to be confused with the calendar-quarter "seasons" of
 * src/utils/season.utils.js, which stay in use for the stats page.
 *
 * A game belongs to the season whose half-open range [starts_at, ends_at)
 * contains its played_at. Exactly one season is open (ends_at IS NULL).
 */

import { query, queryOne } from "../helpers/database.helpers.js";

/** Alias accepted wherever a season id is expected. */
export const CURRENT_SEASON_ALIAS = "current";

/** Id pattern used by schemas: a season id like "fc27" or the alias. */
export const LEAGUE_SEASON_ID_PATTERN = "^(current|fc\\d{2})$";

const SEASON_COLUMNS = `id, name, game_version, starts_at, ends_at,
	awards, talkrunde, recap_generated_at, recap_notified_at`;

/**
 * Public shape of a season row.
 *
 * @param {object} row - league_seasons row
 * @returns {object}
 * @example
 * toSeasonDto(row); // { id: "fc27", name: "EA FC 27", is_current: true, … }
 */
export function toSeasonDto(row) {
	return {
		id: row.id,
		name: row.name,
		game_version: row.game_version,
		starts_at: new Date(row.starts_at).toISOString(),
		ends_at: row.ends_at ? new Date(row.ends_at).toISOString() : null,
		is_current: row.ends_at == null,
		has_recap: row.recap_generated_at != null,
		// Season special of the talk show, once its audio is rendered.
		talkrunde: row.talkrunde?.audio_url
			? { status: "ready", audio_url: row.talkrunde.audio_url }
			: null,
	};
}

/**
 * All league seasons, newest first.
 *
 * @returns {Promise<object[]>} Season DTOs
 * @example
 * (await listLeagueSeasons())[0].id; // "fc27"
 */
export async function listLeagueSeasons() {
	const rows = await query(
		`SELECT ${SEASON_COLUMNS} FROM league_seasons ORDER BY starts_at DESC`,
	);
	return rows.map(toSeasonDto);
}

/**
 * One season row by id, or the open season for the alias "current".
 *
 * @param {string} seasonId - e.g. "fc26" or "current"
 * @returns {Promise<object|null>} The raw row (with awards/talkrunde), or null
 * @example
 * (await getLeagueSeasonRow("current")).id; // "fc27"
 */
export async function getLeagueSeasonRow(seasonId) {
	if (seasonId === CURRENT_SEASON_ALIAS) return getCurrentLeagueSeasonRow();
	return queryOne(
		`SELECT ${SEASON_COLUMNS} FROM league_seasons WHERE id = $1`,
		[seasonId],
	);
}

/**
 * The open season row, or null when none exists (only before migration 027).
 *
 * @returns {Promise<object|null>}
 * @example
 * (await getCurrentLeagueSeasonRow())?.game_version; // "FC27"
 */
export async function getCurrentLeagueSeasonRow() {
	return queryOne(
		`SELECT ${SEASON_COLUMNS} FROM league_seasons
		  WHERE ends_at IS NULL ORDER BY starts_at DESC LIMIT 1`,
	);
}

/**
 * Loads a season or throws a 404, for controllers.
 *
 * @param {string} seasonId
 * @returns {Promise<object>} The raw row
 * @example
 * const season = await requireLeagueSeason(request.params.seasonId);
 */
export async function requireLeagueSeason(seasonId) {
	const season = await getLeagueSeasonRow(seasonId);
	if (!season) {
		const err = new Error("Season not found");
		err.statusCode = 404;
		throw err;
	}
	return season;
}

/**
 * EA FC edition that was current at a moment, for AI prompts ("FC27").
 * Falls back to the open season, then to "FC26".
 *
 * @param {string|Date} [at] - Defaults to now
 * @returns {Promise<string>}
 * @example
 * await getGameVersionAt("2026-09-01T12:00:00Z"); // "FC26"
 */
export async function getGameVersionAt(at = new Date()) {
	const row = await queryOne(
		`SELECT game_version FROM league_seasons
		  WHERE starts_at <= $1 AND (ends_at IS NULL OR ends_at > $1)
		  ORDER BY starts_at DESC LIMIT 1`,
		[new Date(at).toISOString()],
	).catch(() => null);
	if (row?.game_version) return row.game_version;
	const current = await getCurrentLeagueSeasonRow().catch(() => null);
	return current?.game_version ?? "FC26";
}

/**
 * Rejects a client-supplied played_at that lies before the open season: a
 * backdated game would silently re-rate a closed season.
 *
 * @param {string|undefined} playedAt - ISO timestamp from the request, if any
 * @returns {Promise<void>}
 * @example
 * await assertPlayedAtInOpenSeason(body.played_at);
 */
export async function assertPlayedAtInOpenSeason(playedAt) {
	if (!playedAt) return;
	const current = await getCurrentLeagueSeasonRow();
	if (current && new Date(playedAt) < new Date(current.starts_at)) {
		const err = new Error("played_at lies before the current season");
		err.statusCode = 400;
		throw err;
	}
}
