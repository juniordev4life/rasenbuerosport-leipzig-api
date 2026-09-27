/**
 * Season special of the "Bürowoche" talk show: one episode about a whole
 * closed season, released with the season recap. Two operator steps, so no
 * single request runs into Cloud Run's timeout:
 *   1. generateSeasonTalkrundeScript — context from the stored recap data,
 *      script by Claude, stored in league_seasons.talkrunde.
 *   2. renderSeasonTalkrundeAudio — ElevenLabs per turn, one mp3 upload.
 */

import { getAnthropicClient } from "../../../config/anthropic.config.js";
import { query, queryOne } from "../../helpers/database.helpers.js";
import {
	parseTalkshowScript,
	summariseScript,
} from "../../utils/talkshowParser.utils.js";
import { buildTalkshowPrompt } from "../../utils/talkshowPrompt.utils.js";
import { requireLeagueSeason } from "../leagueSeason.services.js";
import { dramaScore } from "../matchOfTheWeek.services.js";
import { renderTurnsToMp3 } from "../talkshowAudio.services.js";
import { lineupsByGame } from "./seasonFacts.services.js";
import {
	buildLeagueTable,
	buildSeasonRating,
	loadSeasonData,
} from "./seasonStandings.services.js";

const SCRIPT_MODEL = "claude-opus-5";

const berlinDate = (at) =>
	new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(
		new Date(at),
	);

const SEASON_SPECIAL_RULES = `[SONDERFOLGE — SAISONRÜCKBLICK — HAT VORRANG VOR ALLEN REGELN OBEN]
Diese Episode ist KEINE normale Wochenfolge, sondern die Sonderfolge zum Saisonende. Wo die Regeln oben etwas anderes sagen, gilt dieser Block:
- Zeitraum: die komplette Saison aus den Daten (nicht eine Woche). Sprich von "der Saison", nie von "dieser Woche".
- Erscheinungstag: Montag zum Start der neuen Saison. KEINE Tageszeit-Begrüßung ("Guten Abend"/"Guten Morgen" sind beide falsch) und kein "Freitag". Marcel eröffnet mit "Hallo und herzlich willkommen zur Sonderfolge der Bürowoche".
- Länge: 380–450 Sekunden, Zielband 850–1000 Wörter.
- Sechs Blöcke: 1. INTRO mit der Saison in Zahlen. 2. MEISTER & TABELLE (ELO-Endstand der Stammspieler und Liga-Tabelle). 3. SAISON-AWARDS (drei bis fünf Highlights, jeweils mit Gewinner und Zahl). 4. SPIEL DER SAISON. 5. DAS NEUE ELO (kurz und fair: ab jetzt rechnet die Liga mit einem neuen, faireren ELO-System, das rückwirkend auf alle Spiele angewendet wurde — keine Details erfinden, die nicht in den Daten stehen). 6. AUSBLICK auf die neue Saison und OUTRO.
- Sophie ist weiterhin in jedem Block dabei. Verwende nur Namen und Zahlen aus den Daten.`;

function playersByRank(rating, count) {
	return rating.players
		.filter((p) => p.qualified)
		.slice(0, count)
		.map((p) => ({ name: p.username, elo: p.rating, spiele: p.games }));
}

function matchOfSeason(data) {
	const lineups = lineupsByGame(data.gamePlayers);
	const names = new Map(data.profiles.map((p) => [p.id, p.username]));
	const best = [...data.games].sort((a, b) => dramaScore(b) - dramaScore(a))[0];
	if (!best) return null;
	const lineup = lineups.get(best.id);
	return {
		datum: berlinDate(best.played_at),
		heim: (lineup?.home ?? []).map((id) => names.get(id)),
		gast: (lineup?.away ?? []).map((id) => names.get(id)),
		ergebnis: `${best.score_home}:${best.score_away}`,
		entschieden: best.result_type ?? "regular",
		elfmeterschiessen: best.penalty_shootout?.final_score ?? null,
	};
}

/**
 * Talk-show context of a whole season, from the same data the recap uses.
 *
 * @param {object} season - league_seasons row with awards
 * @returns {Promise<object>}
 * @example
 * (await buildSeasonShowContext(season)).saison; // "EA FC 26"
 */
export async function buildSeasonShowContext(season) {
	const data = await loadSeasonData(season);
	const rating = buildSeasonRating(data, season);
	const table = buildLeagueTable(data, season);
	const facts = await queryOne(
		"SELECT payload -> 'league_facts' AS league FROM season_recaps WHERE season_id = $1 LIMIT 1",
		[season.id],
	);
	const league = facts?.league ?? {};
	return {
		saison: season.name,
		von: berlinDate(season.starts_at),
		bis: berlinDate(season.ends_at),
		spiele: league.games,
		tore: league.goals,
		elfmeterschiessen: league.shootouts,
		spieler: league.players,
		elo_endstand_top5: playersByRank(rating, 5),
		mindestspiele_fuer_wertung: rating.season.min_games,
		liga_tabelle_top5: table.rows.slice(0, 5).map((r) => ({
			name: r.username,
			punkte: r.points,
			spiele: r.games,
		})),
		awards: (season.awards ?? []).map((a) => ({
			award: a.key,
			gewinner: a.players.map((p) => p.username),
			wert: a.value,
			einheit: a.unit,
		})),
		spiel_der_saison: matchOfSeason(data),
	};
}

function scriptTextOf(response) {
	if (response.stop_reason === "refusal") return null;
	return response.content?.find((b) => b.type === "text")?.text ?? null;
}

/**
 * Step 1: writes the season special's script (Claude) and stores it.
 * Needs the season recap to be generated first (awards, league facts).
 *
 * @param {string} seasonId
 * @returns {Promise<{season: string, turns: number, words: number}>}
 * @example
 * await generateSeasonTalkrundeScript("fc26");
 */
export async function generateSeasonTalkrundeScript(seasonId) {
	const season = await requireLeagueSeason(seasonId);
	if (!season.ends_at || !season.recap_generated_at) {
		const err = new Error("Generate the season recap first");
		err.statusCode = 409;
		throw err;
	}
	const context = await buildSeasonShowContext(season);
	const response = await getAnthropicClient().beta.messages.create({
		model: SCRIPT_MODEL,
		max_tokens: 16000,
		betas: ["server-side-fallback-2026-07-01"],
		fallbacks: "default",
		output_config: { effort: "medium" },
		messages: [
			{
				role: "user",
				content: `${buildTalkshowPrompt()}\n\n${SEASON_SPECIAL_RULES}\n\nSaisondaten:\n${JSON.stringify(context)}`,
			},
		],
	});
	const text = scriptTextOf(response);
	const turns = text ? parseTalkshowScript(text) : [];
	if (turns.length === 0) {
		const err = new Error("The model returned no usable script");
		err.statusCode = 502;
		throw err;
	}
	const summary = summariseScript(turns);
	const talkrunde = {
		status: "script",
		generated_at: new Date().toISOString(),
		model: response.model ?? SCRIPT_MODEL,
		script: { raw_script: text, turns, summary },
		context_used: context,
		audio_url: null,
	};
	await query("UPDATE league_seasons SET talkrunde = $2::jsonb WHERE id = $1", [
		season.id,
		JSON.stringify(talkrunde),
	]);
	return { season: season.id, turns: turns.length, words: summary.total_words };
}

/**
 * Step 2: renders the stored script to one mp3 (ElevenLabs) and publishes it.
 * Every render gets a fresh object path (immutable caching).
 *
 * @param {string} seasonId
 * @returns {Promise<{season: string, audio_url: string}>}
 * @example
 * await renderSeasonTalkrundeAudio("fc26");
 */
export async function renderSeasonTalkrundeAudio(seasonId) {
	const season = await requireLeagueSeason(seasonId);
	const turns = season.talkrunde?.script?.turns ?? [];
	if (turns.length === 0) {
		const err = new Error("No season talk show script to render");
		err.statusCode = 409;
		throw err;
	}
	const stamp = new Date()
		.toISOString()
		.replace(/[-:.TZ]/g, "")
		.slice(0, 14);
	const audioUrl = await renderTurnsToMp3(
		turns,
		`talkshow/season-${season.id}-${stamp}.mp3`,
	);
	await query(
		`UPDATE league_seasons
		    SET talkrunde = talkrunde || jsonb_build_object('status', 'ready', 'audio_url', $2::text, 'rendered_at', now())
		  WHERE id = $1`,
		[season.id, audioUrl],
	);
	return { season: season.id, audio_url: audioUrl };
}
