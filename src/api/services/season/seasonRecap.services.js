/**
 * Season recap ("Rückblick") lifecycle: generate once per closed season
 * (stats, League-ELO v2 journey, awards, optional AI summary), read the
 * viewer's own recap, list the awards, and push "Dein Rückblick ist fertig".
 *
 * Generation is idempotent — rerunning rewrites every row from the same data.
 */

import { logger } from "../../../config/logger.config.js";
import { AI_LIGHT } from "../../../constants/ai.constants.js";
import { callAnthropicWithRetry } from "../../helpers/ai.helpers.js";
import {
	query,
	queryOne,
	withTransaction,
} from "../../helpers/database.helpers.js";
import { requireLeagueSeason, toSeasonDto } from "../leagueSeason.services.js";
import { sendPushNotification } from "../pushSender.services.js";
import { getSubscriptionsExcludingUsers } from "../pushSubscriptions.services.js";
import { buildSeasonRecaps } from "./seasonRecapBuilder.services.js";
import { loadSeasonData } from "./seasonStandings.services.js";

const BACKUP_SUFFIX_PATTERN = /^\d{8}_\d{6}$/;
const PERSONAS = ["klassiker", "analyst", "euphoriker"];

/** German award names, identical to the app's season_awards.*.label. */
const AWARD_NAMES_DE = {
	champion: "Meister",
	top_scorer: "Torschützenkönig",
	top_assister: "Vorlagenkönig",
	dream_duo: "Dream-Duo",
	penalty_king: "Elfmeterkönig",
	fair_play: "Fairplay-Preis",
	wall: "Die Mauer",
	marathon: "Dauerbrenner",
	form_of_the_year: "Form der Saison",
	lunch_king: "Mittagspausen-König",
	comeback_king: "Comeback-König",
	unlucky: "Pechvogel",
};

const PERSONA_STYLE = {
	klassiker:
		"ein erfahrener Sportreporter alter Schule: sachlich, trocken, mit einem Augenzwinkern",
	analyst:
		"ein datenverliebter Taktik-Analyst: präzise, nennt eine konkrete Zahl, nüchtern",
	euphoriker:
		"ein euphorischer Stadionsprecher: begeistert, laut, mit viel Emotion",
};

function badRequest(message, statusCode = 409) {
	const err = new Error(message);
	err.statusCode = statusCode;
	return err;
}

/**
 * Ratings under the old engine right before the switch, from the backup
 * tables the League-ELO v2 apply created. Empty map when there is none.
 *
 * @returns {Promise<Map<string, number>>}
 * @example
 * (await loadPreSwitchRatings()).get(uid); // 1327
 */
export async function loadPreSwitchRatings() {
	const state = await queryOne(
		"SELECT value FROM app_state WHERE key = 'elo'",
	).catch(() => null);
	const suffix = state?.value?.backup;
	if (!BACKUP_SUFFIX_PATTERN.test(suffix ?? "")) return new Map();
	const rows = await query(
		`SELECT id, current_rating FROM elo_backup_${suffix}_profiles`,
	).catch(() => []);
	return new Map(rows.map((r) => [r.id, r.current_rating]));
}

function personaOf(playerId) {
	let hash = 0;
	for (const ch of playerId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return PERSONAS[hash % PERSONAS.length];
}

function summaryFacts(recap, season) {
	const s = recap.stats;
	return {
		saison: season.name,
		spieler: recap.player.username,
		spiele: s.games,
		siege: s.wins,
		niederlagen: s.losses,
		siegquote_prozent: Math.round(s.win_rate * 100),
		tore: s.goals,
		vorlagen: s.assists,
		laengste_siegesserie: s.longest_win_streak,
		hoechster_sieg: s.biggest_win?.score ?? null,
		traumpartner: s.best_partner?.username ?? null,
		angstgegner: s.nemesis?.username ?? null,
		elo_start: recap.elo.start,
		elo_ende: recap.elo.end,
		elo_peak: recap.elo.peak.value,
		platz_im_elo_endstand: recap.elo.qualified
			? `${recap.elo.rank} von ${recap.elo.of}`
			: "nicht gewertet (weniger als 30 Saisonspiele)",
		awards: recap.awards_won.map((key) => AWARD_NAMES_DE[key] ?? key),
	};
}

function namesInFacts(recap) {
	const s = recap.stats;
	return [
		recap.player.username,
		s.best_partner?.username,
		s.nemesis?.username,
		s.favorite_victim?.username,
	].filter(Boolean);
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * League players the text names although they are not part of the facts.
 * German capitalises every noun, so a generic capitalised-word check would
 * reject every summary; comparing against the real usernames is exact.
 *
 * @param {string} text
 * @param {object} recap
 * @param {string[]} leagueNames - Every player's username
 * @returns {string[]}
 * @example
 * namesOutsideFacts("Marco schlägt Jay", recap, ["Marco", "Jay", "Nikinho"]); // []
 */
export function namesOutsideFacts(text, recap, leagueNames) {
	const allowed = new Set(namesInFacts(recap));
	return leagueNames.filter(
		(name) =>
			name &&
			!allowed.has(name) &&
			new RegExp(
				`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
				"u",
			).test(text),
	);
}

function plainText(raw) {
	// The app renders plain text: drop markdown emphasis and line breaks.
	const text = raw
		?.replace(/\*\*|__|(?<!\w)[*_](?!\s)|(?<!\s)[*_](?!\w)/g, "")
		.replace(/\s*\n+\s*/g, " ")
		.trim();
	return text || null;
}

/**
 * Two playful German sentences about one player's season, in the voice of
 * one of the app's reporter personas. Null when the model declines or names
 * league players who are not in the facts.
 *
 * Claude Sonnet 5 at low effort (AI_LIGHT).
 *
 * @param {object} recap - One payload from buildSeasonRecaps
 * @param {object} season - league_seasons row
 * @param {string[]} [leagueNames] - Every player's username, for the name check
 * @returns {Promise<{persona: string, text: string}|null>}
 * @example
 * await generateAiSummary(recap, season, ["Marco", "Jay"]); // { persona: "euphoriker", text: "…" }
 */
export async function generateAiSummary(recap, season, leagueNames = []) {
	const persona = personaOf(recap.player.player_id);
	let raw;
	try {
		({ text: raw } = await callAnthropicWithRetry({
			...AI_LIGHT,
			max_tokens: 2048,
			system: `Du schreibst für die Büro-Fußballliga "RasenBürosport" (EA FC an der Konsole) ein Saisonfazit für einen Spieler. Du bist ${PERSONA_STYLE[persona]}. Schreibe genau zwei kurze Sätze auf Deutsch in einem einzigen Absatz, höchstens 50 Wörter, per du, ohne Überschrift, ohne Aufzählung und ohne Markdown. Awards nennst du mit genau den deutschen Namen aus den Fakten. Nutze nur die gelieferten Fakten und nenne keine anderen Personen als die in den Fakten.`,
			messages: [
				{
					role: "user",
					content: `Fakten zur Saison:\n${JSON.stringify(summaryFacts(recap, season))}`,
				},
			],
		}));
	} catch (error) {
		logger.warn(
			{ playerId: recap.player.player_id, err: error?.message },
			"season summary failed; recap ships without it",
		);
		return null;
	}
	const text = plainText(raw);
	if (!text) return null;
	const strangers = namesOutsideFacts(text, recap, leagueNames);
	if (strangers.length > 0) {
		logger.warn(
			{ playerId: recap.player.player_id, strangers },
			"season summary named players outside its facts; dropped",
		);
		return null;
	}
	return { persona, text };
}

async function addAiSummaries(recaps, season, leagueNames) {
	let count = 0;
	for (const recap of recaps.values()) {
		try {
			recap.ai_summary = await generateAiSummary(recap, season, leagueNames);
			if (recap.ai_summary) count += 1;
		} catch (error) {
			logger.warn(
				{ playerId: recap.player.player_id, err: error?.message },
				"season summary failed; recap ships without it",
			);
		}
	}
	return count;
}

async function persistRecaps(season, recaps, league) {
	await withTransaction(async (client) => {
		await client.query("DELETE FROM season_recaps WHERE season_id = $1", [
			season.id,
		]);
		const rows = [...recaps].map(([playerId, payload]) => ({
			player_id: playerId,
			payload: { ...payload, league_facts: league },
		}));
		if (rows.length) {
			await client.query(
				`INSERT INTO season_recaps (season_id, player_id, payload, generated_at)
				 SELECT $1, v.player_id, v.payload, now()
				   FROM jsonb_to_recordset($2::jsonb) AS v(player_id text, payload jsonb)`,
				[season.id, JSON.stringify(rows)],
			);
		}
		await client.query(
			`UPDATE league_seasons
			    SET awards = $2::jsonb, recap_generated_at = now()
			  WHERE id = $1`,
			[season.id, JSON.stringify(league.awards)],
		);
	});
}

/**
 * Generates and stores the recap of every player of a closed season.
 *
 * @param {string} seasonId - e.g. "fc26"
 * @param {object} [options]
 * @param {boolean} [options.skipAi] - Skip the AI summaries
 * @returns {Promise<{season: string, players: number, awards: number, ai_summaries: number}>}
 * @example
 * await generateSeasonRecap("fc26", { skipAi: false });
 */
export async function generateSeasonRecap(seasonId, { skipAi = false } = {}) {
	const season = await requireLeagueSeason(seasonId);
	if (!season.ends_at) throw badRequest("The season is still running");
	const data = await loadSeasonData(season);
	const [oldRatings, live] = await Promise.all([
		loadPreSwitchRatings(),
		query("SELECT id, current_rating FROM profiles"),
	]);
	const liveRatings = new Map(live.map((r) => [r.id, r.current_rating]));
	const { recaps, league } = buildSeasonRecaps(data, season, {
		oldRatings,
		liveRatings,
	});
	const leagueNames = data.profiles.map((p) => p.username).filter(Boolean);
	const aiCount = skipAi
		? 0
		: await addAiSummaries(recaps, season, leagueNames);
	await persistRecaps(season, recaps, league);
	return {
		season: season.id,
		players: recaps.size,
		awards: league.awards.length,
		ai_summaries: aiCount,
	};
}

function talkrundeOf(season) {
	const t = season.talkrunde;
	if (!t?.audio_url) return null;
	return { status: "ready", audio_url: t.audio_url };
}

/**
 * The viewer's recap of a season, or null when there is none.
 *
 * @param {string} seasonId
 * @param {string} userId
 * @returns {Promise<object|null>}
 * @example
 * await getMyRecap("fc26", request.user.id);
 */
export async function getMyRecap(seasonId, userId) {
	const season = await requireLeagueSeason(seasonId);
	const row = await queryOne(
		`SELECT payload, generated_at FROM season_recaps
		  WHERE season_id = $1 AND player_id = $2`,
		[season.id, userId],
	);
	if (!row) return null;
	const { league_facts: league, ...payload } = row.payload;
	return {
		season: toSeasonDto(season),
		generated_at: new Date(row.generated_at).toISOString(),
		...payload,
		league: { ...league, talkrunde: talkrundeOf(season) },
	};
}

/**
 * Awards of a season ([] until its recap was generated).
 *
 * @param {string} seasonId
 * @returns {Promise<{season: object, awards: object[]}>}
 * @example
 * (await getSeasonAwards("fc26")).awards[0].key; // "champion"
 */
export async function getSeasonAwards(seasonId) {
	const season = await requireLeagueSeason(seasonId);
	return { season: toSeasonDto(season), awards: season.awards ?? [] };
}

function recapPushPayload(season, league) {
	return {
		title: `Dein Rückblick auf ${season.game_version} ist fertig`,
		body: `${league.games} Spiele, ${league.goals} Tore – schau dir deine Saison an ⚽`,
		url: `/app/recap/${season.id}`,
		tag: `season-recap-${season.id}`,
		type: "seasonRecap",
	};
}

/**
 * Pushes "Dein Rückblick ist fertig" to every player who has a recap. The
 * sends are awaited (Cloud Run throttles work after the response). A full
 * send happens once per season; `onlyUser` sends a test to one player and
 * does not count as the send.
 *
 * @param {string} seasonId
 * @param {object} [options]
 * @param {string} [options.onlyUser] - Firebase uid of the only recipient
 * @returns {Promise<{recipients: number, sent: number, failed: number}>}
 * @example
 * await notifySeasonRecap("fc26", { onlyUser: adminUid });
 */
export async function notifySeasonRecap(seasonId, { onlyUser } = {}) {
	const season = await requireLeagueSeason(seasonId);
	if (!season.recap_generated_at)
		throw badRequest("The recap was not generated yet");
	if (!onlyUser && season.recap_notified_at)
		throw badRequest("The recap push was already sent");
	const rows = await query(
		"SELECT player_id, payload -> 'league_facts' AS league FROM season_recaps WHERE season_id = $1",
		[season.id],
	);
	const players = new Set(rows.map((r) => r.player_id));
	if (onlyUser && !players.has(onlyUser))
		throw badRequest("That player has no recap", 404);
	const subs = (
		await getSubscriptionsExcludingUsers({
			excludeUserIds: [],
			preferenceKey: "seasonRecap",
		})
	).filter((s) => (onlyUser ? s.user_id === onlyUser : players.has(s.user_id)));
	const payload = recapPushPayload(
		season,
		rows[0]?.league ?? { games: 0, goals: 0 },
	);
	const results = await Promise.all(
		subs.map((s) => sendPushNotification(s, payload)),
	);
	if (!onlyUser) {
		await query(
			"UPDATE league_seasons SET recap_notified_at = now() WHERE id = $1",
			[season.id],
		);
	}
	const sent = results.filter((r) => r.success).length;
	return {
		recipients: new Set(subs.map((s) => s.user_id)).size,
		sent,
		failed: results.length - sent,
	};
}
