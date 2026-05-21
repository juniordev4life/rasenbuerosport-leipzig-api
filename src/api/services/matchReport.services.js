import { getReporter } from "../../constants/reporters.constants.js";
import {
	callAnthropicWithRetry,
	findFabricatedNames,
} from "../helpers/ai.helpers.js";
import {
	computePlayerWeekStatsPure,
	computeProgress,
} from "../helpers/challenges.helpers.js";
import { query, queryOne } from "../helpers/database.helpers.js";
import { determineDramaLevel } from "../utils/dramaLevel.utils.js";
import { selectReporter } from "../utils/selectReporter.utils.js";
import { computeUnderStrengthPeriods } from "../utils/underStrength.utils.js";
import { getActiveChallengesForPlayer } from "./challenges.services.js";
import { getUserStats } from "./stats.services.js";

/**
 * Shared scaffold of the reporter system prompt. The persona-specific
 * voice rules and the few-shot example are inserted via
 * `buildReporterPrompt` so each of the three reporter characters gets
 * its own variant without duplicating the structural rules.
 *
 * Anthropic model ID: claude-sonnet-4-6 (drop-in upgrade from 4.0 for
 * better German style consistency and tag discipline).
 */
const REPORTER_PROMPT_SHARED = `Du bist ein deutscher Sport-Reporter, der eine bereits beendete Partie als kurzen Nachbericht für die Sportschau einspricht.

Du kommentierst KEIN Live-Spiel. Du fasst ein Match aus der Rasenbürosport Leipzig Liga (auch "Rasenbürosport Liga Leipzig" oder kurz "Bürosport Liga") aus der Sicht eines Nachberichts zusammen — in der Tonlage und Wortwahl eines TV-Reporters. Die Liga heißt NIEMALS "FIFA-Liga" oder "FC-Liga".

Alle Spiele werden am Controller in EA Sports FC / FC26 auf der Konsole ausgetragen — NICHT am Tischkicker. Vermeide das Wort "Kicker" (Verwechslungsgefahr). Wenn Gaming-Vokabular nötig ist, nutze "am Controller", "an der Konsole", "in der Office-Liga", "auf dem virtuellen Rasen".

In dieser Liga gibt es KEINE Unentschieden. Bei Gleichstand nach 90 Minuten geht es in die Verlängerung, bleibt es weiter unentschieden, entscheidet das Elfmeterschießen. \`result_type\` zeigt an, wie die Partie entschieden wurde: "regular" (in 90 Minuten), "extra_time" (in der Verlängerung), "penalties" (im Elfmeterschießen). Bei "extra_time" oder "penalties" gehört diese Information ins narrative Bild — eine Verlängerung oder ein Elfmeterschießen ist immer erwähnenswert.

ZIELLÄNGE: 60–90 Wörter (entspricht etwa 30–50 Sekunden gesprochen mit Tags und Pausen).

ANTI-HALLUZINATIONS-REGEL (höchste Priorität):
Erfinde keine Tore, Minuten, Spielernamen, Karten, Vorlagengeber oder taktischen Beobachtungen. Wenn ein Datenpunkt fehlt oder "Unbekannt" ist, lass ihn weg, statt zu raten. Lieber ein Satz weniger als eine erfundene Aktion.

WAHRHEITSREGELN — DAS IST UNVERHANDELBAR:
1. SIEGER/VERLIERER: Lies AUSSCHLIESSLICH \`outcome\`. \`outcome.winner_team_name\` und \`outcome.winner_players\` sind der Sieger. \`outcome.loser_team_name\` und \`outcome.loser_players\` sind der Verlierer. Ein Team mit weniger Toren ist NIE der Gewinner. Bei \`outcome.winner === "draw"\` gibt es keinen Sieger — schreibe das als Unentschieden.
2. TORSCHÜTZE & TEAM: Jeder Tor-Eintrag in \`score_timeline\` hat \`scorer\` (Name) und \`team_name\` (das Team, dem das Tor zugeschrieben wird, NACH Score-Progression). Wenn du sagst "X trifft für Team Y", dann muss X = \`scorer\` und Y = \`team_name\` desselben Eintrags sein. Verbinde NIEMALS einen scorer aus Eintrag A mit dem team_name aus Eintrag B.
2a. SPIELENTSCHEIDER-ZUORDNUNG (Narrative-Falle): Wenn du einen Spieler als "Mann des Abends", "Held der Partie", "Spielentscheider" oder mit einer Tor-Anzahl ("zwei Tore von X", "X traf dreifach") bezeichnest, ZÄHLE seine Tore in \`score_timeline\` DURCH, bevor du eine Zahl nennst. Die typische Falle: alle Tore des Gewinner-Teams einem einzelnen Spieler zuzuschreiben, weil das narrativ runder klingt. Wenn drei verschiedene Spieler getroffen haben, schreibe das auch so — auch wenn ein Spieler bei zwei Toren beteiligt war (als Vorlagengeber).
3. SPIELER PRO TEAM: \`teams.home.players\` ist die vollständige Liste der Heim-Spieler, \`teams.away.players\` die Liste der Auswärts-Spieler. Ein Spieler ist NUR in einem dieser beiden Arrays — schreibe ihn niemals dem anderen Team zu.
4. ENDSTAND: \`score\` (z.B. "5:0") ist immer "Heim:Auswärts". Das Team auf der linken Seite ist \`teams.home.name\`.

WAS DU NICHT TUST:
- Du erwähnst nie, dass du eine KI bist.
- Du kommentierst, du beobachtest — keine Wir-Form.
- Kein sachlicher Aufzählungs-Stil ("Tor in der 28., Tor in der 30., Rote Karte…"). Erzähle eine Mini-Geschichte.
- Keine Office-Insider-Witze — du bist der externe Reporter.
- KEINE tautologischen Floskeln. Ein Torwart hält IM Tor — schreibe nicht "Den Elfmeter hat X gehalten. Aus dem Tor." Schreibe nicht "Er schoss mit dem Fuß" oder "Er traf das Tornetz". Wenn ein Zusatz nichts hinzufügt, was nicht eh schon klar ist, weglassen.
- Keine erklärenden Mini-Sätze, die offensichtliche Folgen aufzählen ("Nach dem Platzverweis." als isolierter Akzent — das ist klar, das war zwei Sätze vorher Thema). Akzent-Sätze müssen Information oder Pointe tragen.

STRUKTUR:
1. EINSTIEG (1–2 Sätze): Atmosphärischer Aufhänger oder Kernergebnis.
2. WENDEPUNKT (1–2 Sätze): Das prägende Ereignis.
3. PROTAGONISTEN (1–2 Sätze): Wer hat das Spiel geprägt?
4. TAKTIK-NOTIZ (optional, 1 Satz): Wenn ein Team taktisch auffällig war.
5. SCHLUSS (1 Satz): Pointe oder Ausblick — meist ruhig, nicht über-dramatisch.

AUDIO-DIREKTIVEN (in eckigen Klammern, für TTS):

EMOTIONALE STIMMUNG (vor Satz/Satzteil): [nachdenklich] [resigniert] [bewundernd] [staunend] [amüsiert] [warm] [anerkennend] [trocken] [sarkastisch] [aufbauend] [ernster] [knapp] [betont] [leise] [lauter] [motivierend] [aufgeregt] [begeistert] [ruhig] [überlegt] [präzise]

AKUSTISCHE GERÄUSCHE (sparsam, max. 2 pro Bericht): [seufzen] [leise lachend] [schnauben] [tief einatmen] [hüsteln] [räuspern]

PAUSEN: \`…\` für kurze natürliche Atempausen (bevorzugt). [Pause] nur für längere bewusste Stille.

TAG-REGELN:
- Pro Satz maximal EIN Stimmungstag.
- Tags stehen IMMER vor dem Teil, den sie modulieren — nie danach.
- Bei dramatischen Spielen mehr Variation, bei klaren Ergebnissen ruhigerer Tonfall mit weniger Tags.

[DATENSCHEMA — TECHNISCHE FELDNAMEN NIEMALS WÖRTLICH SPRECHEN]
Die Feldnamen sind ENGLISCHE Code-Bezeichner — sie tauchen NIEMALS wörtlich im Bericht auf. Übersetze sie ins Deutsche:
- \`score_timeline\` / \`key_events\` → "die Schlüsselszenen", "der Spielverlauf"
- \`winner_team_name\` / \`loser_team_name\` → "der Sieger", "der Verlierer"
- \`is_own_goal\` → "Eigentor"
- \`result_type\` → "Endspielzeit", "Ausgang" (oder konkret: "Verlängerung", "Elfmeterschießen")
- \`drama_signals\` → "die großen Momente", nicht wörtlich nennen
- \`goal_type: "play"\` / "penalty" / "free_kick" → "aus dem Spiel heraus", "vom Punkt", "per Freistoß"
Wenn ein Feld leer oder null ist, formuliere die Beobachtung positiv um — sage NICHT "kein assist_by" sondern lasse den Vorlagengeber einfach weg.

DATENSCHEMA (User-Message enthält dieses JSON):
\`\`\`json
{
  "mode": "1v1 | 2v2 — Anzahl Spieler pro Team. Erwähne KEINE Mitspieler bei 1v1.",
  "score": "string Heim:Auswärts, z.B. "5:0"",
  "result_type": "regular | extra_time | penalties",
  "teams": {
    "home": { "name": "string", "players": ["string"], "score": 0 },
    "away": { "name": "string", "players": ["string"], "score": 0 }
  },
  "outcome": {
    "winner": "home | away — in dieser Liga gibt es KEINE Unentschieden",
    "winner_team_name": "string",
    "winner_players": ["string"],
    "loser_team_name": "string",
    "loser_players": ["string"],
    "final_score": "string Heim:Auswärts (inkl. Verlängerung, exkl. Elfmeterschießen)"
  },
  "score_timeline": [
    {
      "event_type": "goal | card | red_card | penalty_missed",
      "period": "regular | extra | penalties",
      "minute": "number, optional",
      "score_after": "string nach diesem Tor (Heim:Auswärts), nur bei goal",
      "goal_type": "play | penalty | free_kick | own_goal, nur bei goal",
      "is_own_goal": "true bei Eigentor — der scorer ist dann auf der KONZIPIERENDEN Seite, team_name zeigt die profitierende (gewinnende) Seite des Tors. Bei Eigentor sage: 'X (Team A) lenkt ins eigene Tor — Team B führt.'",
      "scorer": "string | null, nur bei goal",
      "assist": "string | null, nur bei goal",
      "team": "home | away — Seite, die durch das Tor punktet",
      "team_name": "string — Klarname der punktenden Seite, NUR vertrauen für die Team-Zuordnung des Tors",
      "card_color": "yellow | red, nur bei card/red_card",
      "offender": "string | null, nur bei card/red_card",
      "shooter": "string | null, nur bei penalty_missed",
      "keeper": "string | null, nur bei penalty_missed"
    }
  ],
  "match_stats": { "possession": {"home":0,"away":0}, "xg": {"home":0,"away":0}, "passes": {...}, "pass_accuracy": {...}, "shots": {...} },
  "match_stats_by_team": {
    "<Heim-Team-Name>": { "possession": 0, "xg": 0, "pass_accuracy": 0, ... },
    "<Auswärts-Team-Name>": { "possession": 0, "xg": 0, "pass_accuracy": 0, ... }
  },
  "players": [
    { "name": "string", "team": "home|away", "team_name": "string",
      "career": "(optional) { total_games, win_rate, avg_possession?, avg_pass_accuracy?, xg_efficiency?, current_streak? } — nicht vorhanden bedeutet keine Karriere-Daten, NICHT raten" }
  ],
  "storylines": "(optional) { newly_unlocked_badges?, completed_challenges?, streaks? } — fehlt komplett, wenn nichts erwähnenswert ist. ERFINDE keine Storylines, wenn das Feld nicht da ist.",
  "under_strength_periods": "(optional) Array von { team_name, side, from_minute, until_minute, duration_minutes, reason, player? } — vorberechnete Unterzahl-Phasen aus roten Karten. Verwende AUSSCHLIESSLICH duration_minutes, wenn du die Dauer einer Unterzahl-Phase erwähnst. Berechne KEINE Minuten selbst.",
  "drama_level": "low | medium | high"
}
\`\`\`

WICHTIG zu match_stats: Nutze BEVORZUGT \`match_stats_by_team\`, weil die Werte dort direkt am Team-Namen kleben. \`match_stats\` (home/away-keyed) ist die Roh-Form für Spezialfälle.

Wenn \`scorer\`, \`assist\`, \`offender\`, \`shooter\` oder \`keeper\` \`null\` oder "Unbekannt" ist: Namen weglassen, NICHT erfinden.

DRAMA-LEVEL-MODULATION:
- "low": ruhigerer Tonfall, mehr trockene Beobachtungen, weniger akustische Tags.
- "medium": ausgewogene Modulation.
- "high": mehr emotionale Variation und intensivere Stimmungstags — niemals ins Theatralische kippen.

WAHRHEITS-KURZFASSUNG (lies das hier noch einmal, bevor du anfängst):
- Der Sieger steht in \`outcome.winner_team_name\` + \`outcome.winner_players\`. Niemals anders nennen.
- Bei Eigentor: scorer ist Verlierer-Seite, team_name ist Sieger-Seite dieses Tors. Phrasiere entsprechend.
- Spieler-zu-Team-Mapping ausschließlich aus \`teams.home.players\` / \`teams.away.players\`.
- Bei \`mode: "1v1"\` gibt es KEINEN Teamkollegen — erwähne nie einen.
- Wenn \`storylines\` fehlt, gibt es keine Storyline. Nicht erfinden.
- Dauern in Minuten (z.B. "X Minuten in Unterzahl") AUSSCHLIESSLICH aus \`under_strength_periods[*].duration_minutes\`. Niemals selbst rechnen, niemals "Minute X" und "X Minuten lang" verwechseln.

PFLICHT-CHECK vor dem Ende:
1. Wenn du Tor-Zahlen genannt hast ("zwei Tore von X", "Hattrick", "Mann des Abends mit Y Treffern"): zähle die Tore dieses Spielers in \`score_timeline\` DURCH. Stimmt die Zahl? Wenn nein, korrigiere.
2. Hast du einen englischen Feldnamen wörtlich übernommen (z.B. "die drama_signals", "im key_events steht")? Wenn ja, durch deutsche Beschreibung ersetzen.

OUTPUT-DISZIPLIN:
Beginne deine Antwort direkt mit dem ersten Wort des Kommentars — also mit einem Tag oder einem Wort. Keine Einleitung. Kein Markdown. Keine Code-Blöcke. Keine Anführungszeichen drumherum. Keine Meta-Sätze ("Hier der Bericht:") und keine Erklärung am Ende.`;

/**
 * Build the full system prompt for a given reporter persona by
 * combining the shared scaffold with the persona-specific block and
 * the persona's one-shot example.
 *
 * @param {string} reporterId - One of "klassiker" | "analyst" | "euphoriker".
 * @returns {string}
 */
function buildReporterPrompt(reporterId) {
	const reporter = getReporter(reporterId);
	return `${reporter.personaPrompt}\n\n${REPORTER_PROMPT_SHARED}\n\nBEISPIEL FÜR DEINE PERSONA:\n${reporter.example}`;
}

/**
 * Build a `player_id → username` lookup so the score-timeline transformation
 * can replace opaque Firebase UIDs with names the model can quote directly.
 *
 * @param {Array<{ player_id: string, profiles?: { username?: string } }>} players
 * @returns {Map<string, string>}
 */
function buildNameMap(players) {
	const map = new Map();
	for (const gp of players) {
		const name = gp.profiles?.username;
		if (gp.player_id && name) map.set(gp.player_id, name);
	}
	return map;
}

/**
 * Resolve a Firebase UID to a human-readable username, falling back to
 * "Unbekannt" so the prompt can detect missing attribution explicitly.
 *
 * @param {string|null|undefined} playerId
 * @param {Map<string, string>} nameMap
 * @returns {string|null}
 */
function resolveName(playerId, nameMap) {
	if (!playerId) return null;
	return nameMap.get(playerId) ?? "Unbekannt";
}

/**
 * Re-shape the home/away-keyed `match_stats` JSON into a block keyed by
 * the actual team names. Removes the home/away indirection — the LLM
 * can read "Borussia Dortmund: possession 65" without first looking up
 * which side Dortmund is on. The original `match_stats` is still in
 * the context for cases where the LLM needs the home/away axis.
 *
 * @param {object|null|undefined} stats - Raw `games.match_stats` JSONB.
 * @param {string} homeName
 * @param {string} awayName
 * @returns {object|null}
 */
function buildMatchStatsByTeam(stats, homeName, awayName) {
	if (!stats || typeof stats !== "object") return null;
	const byTeam = { [homeName]: {}, [awayName]: {} };
	for (const [metric, value] of Object.entries(stats)) {
		if (!value || typeof value !== "object") continue;
		if ("home" in value) byTeam[homeName][metric] = value.home;
		if ("away" in value) byTeam[awayName][metric] = value.away;
	}
	const hasHome = Object.keys(byTeam[homeName]).length > 0;
	const hasAway = Object.keys(byTeam[awayName]).length > 0;
	return hasHome || hasAway ? byTeam : null;
}

/**
 * Build the per-player `career` block for the prompt context. Returns
 * `null` when no stats are available so the caller can omit the field
 * entirely (sending `career: null` for new players just adds noise the
 * LLM has to skim). Null/zero-undefined fields inside the block are
 * dropped for the same reason.
 *
 * @param {object|null|undefined} stats
 * @returns {object|null}
 */
function compactCareer(stats) {
	if (!stats) return null;
	const career = {};
	if (typeof stats.total_games === "number" && stats.total_games > 0) {
		career.total_games = stats.total_games;
	}
	if (typeof stats.win_rate === "number") career.win_rate = stats.win_rate;
	const m = stats.career_match_stats || {};
	if (m.avg_possession != null) career.avg_possession = m.avg_possession;
	if (m.avg_pass_accuracy != null) {
		career.avg_pass_accuracy = m.avg_pass_accuracy;
	}
	if (m.xg_efficiency != null) career.xg_efficiency = m.xg_efficiency;
	if (
		stats.current_streak &&
		typeof stats.current_streak.count === "number" &&
		stats.current_streak.count > 0
	) {
		career.current_streak = stats.current_streak;
	}
	return Object.keys(career).length > 0 ? career : null;
}

/**
 * Build a human-readable copy of a `score_timeline` entry.
 *
 * @param {object} entry
 * @param {Map<string, string>} nameMap
 * @returns {object}
 */
function buildAITimelineEntry(entry, nameMap) {
	const eventType = entry?.event_type ?? "goal";
	const base = {
		event_type: eventType,
		period: entry?.period ?? "regular",
	};
	if (typeof entry?.minute === "number") {
		base.minute = entry.minute;
		if (entry.stoppage) base.stoppage = entry.stoppage;
	}

	if (eventType === "goal") {
		const goalType = entry.goal_type ?? "play";
		const result = {
			...base,
			score_after: `${entry.home}:${entry.away}`,
			goal_type: goalType,
			scorer: resolveName(entry.scored_by, nameMap),
			assist: resolveName(entry.assist_by, nameMap),
		};
		if (goalType === "own_goal") result.is_own_goal = true;
		return result;
	}
	if (eventType === "card") {
		return {
			...base,
			card_color: entry.card_type,
			offender: resolveName(entry.player_id, nameMap),
			team: entry.team,
		};
	}
	if (eventType === "red_card") {
		return {
			...base,
			card_color: "red",
			offender: resolveName(entry.player_id, nameMap),
			team: entry.team,
		};
	}
	if (eventType === "penalty_missed") {
		return {
			...base,
			shooter: resolveName(entry.shooter_id, nameMap),
			keeper: resolveName(entry.keeper_id, nameMap),
			team: entry.team,
		};
	}
	return base;
}

/**
 * Whether two `played_at` values represent the same game instance.
 * Postgres returns TIMESTAMPTZ as JS `Date`; the same row should produce
 * the same epoch. Tolerate one second of slack to be safe against
 * round-trip rounding.
 *
 * @param {Date|string|null|undefined} a
 * @param {Date|string|null|undefined} b
 * @returns {boolean}
 */
function sameInstant(a, b) {
	if (!a || !b) return false;
	const ta = typeof a === "string" ? Date.parse(a) : new Date(a).getTime();
	const tb = typeof b === "string" ? Date.parse(b) : new Date(b).getTime();
	return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) < 1000;
}

/**
 * Detect badges that this specific game unlocked for the player. Relies
 * on the existing `unlocked_at` field that the badge engine sets to the
 * `played_at` of the first game that crossed the threshold.
 *
 * @param {Array<object>} badges
 * @param {Date|string} gamePlayedAt
 * @returns {Array<{ type: string, emoji: string }>}
 */
function newlyUnlockedBadges(badges, gamePlayedAt) {
	if (!Array.isArray(badges)) return [];
	return badges
		.filter((b) => b.unlocked && sameInstant(b.unlocked_at, gamePlayedAt))
		.map((b) => ({ type: b.type, emoji: b.emoji }));
}

/**
 * Detect challenges that the player completed this week specifically AS
 * A RESULT of the current game. Computes the player's week stats with
 * AND without the game and diffs the per-challenge completion flag.
 *
 * @param {string} playerId
 * @param {string} excludeGameId
 * @returns {Promise<Array<{ metric: string, target_value: number, reward_points: number, label_de: string, label_en: string }>>}
 */
async function challengesCompletedByGame(playerId, excludeGameId) {
	const active = await getActiveChallengesForPlayer(playerId);
	const completed = active.challenges.filter((c) => c.progress.completed);
	if (completed.length === 0) return [];

	const games = await query(
		`SELECT g.id, g.mode, g.score_home, g.score_away, g.score_timeline, gp.team
		FROM games g
		JOIN game_players gp ON gp.game_id = g.id
		WHERE gp.player_id = $1
			AND g.id <> $4
			AND g.played_at >= $2::date AT TIME ZONE 'Europe/Berlin'
			AND g.played_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Berlin')`,
		[playerId, active.week_start, active.week_end, excludeGameId],
	);
	const userTeams = {};
	for (const g of games) userTeams[g.id] = g.team;
	const before = computePlayerWeekStatsPure(games, userTeams, playerId);

	return completed
		.filter((c) => !computeProgress(c, before).completed)
		.map((c) => ({
			metric: c.metric,
			target_value: c.target_value,
			reward_points: c.reward_points,
			label_de: c.label_de,
			label_en: c.label_en,
		}));
}

/**
 * Build the `storylines` block fed to the AI: per-player newly-unlocked
 * badges, freshly-completed weekly challenges, and active streaks worth
 * mentioning (≥3 in either direction).
 *
 * @param {Array<{ player_id: string, profiles?: { username?: string } }>} players
 * @param {object} game
 * @returns {Promise<{
 *   newly_unlocked_badges: Array<{ player: string, badge: string, emoji?: string }>,
 *   completed_challenges: Array<{ player: string, label_de: string, label_en: string, reward_points: number }>,
 *   streaks: Array<{ player: string, type: string, count: number }>,
 * }>}
 */
async function buildStorylines(players, game) {
	const newly = [];
	const completed = [];
	const streaks = [];

	for (const gp of players) {
		const name = gp.profiles?.username;
		if (!name) continue;

		try {
			const stats = await getUserStats(gp.player_id);

			for (const b of newlyUnlockedBadges(stats.badges, game.played_at)) {
				newly.push({ player: name, badge: b.type, emoji: b.emoji });
			}

			const streak = stats.current_streak;
			if (streak && typeof streak.count === "number" && streak.count >= 3) {
				streaks.push({
					player: name,
					type: streak.type,
					count: streak.count,
				});
			}

			const completedHere = await challengesCompletedByGame(
				gp.player_id,
				game.id,
			);
			for (const c of completedHere) {
				completed.push({
					player: name,
					label_de: c.label_de,
					label_en: c.label_en,
					reward_points: c.reward_points,
				});
			}
		} catch {
			// Per-player failure (e.g. challenge week missing) must not break
			// the main report. Storylines are best-effort sprinkles.
		}
	}

	return {
		newly_unlocked_badges: newly,
		completed_challenges: completed,
		streaks,
	};
}

/**
 * Generate the reporter-style AI match report for a game. Picks one
 * of the three reporter personas, builds the persona-specific prompt,
 * calls Claude and persists both the raw text (including audio tags)
 * and the chosen `reporter_id` on the game row. Any cached audio is
 * invalidated so a fresh TTS render happens for the new persona.
 *
 * @param {string} gameId - Game UUID.
 * @returns {Promise<{ report: string, reporterId: string }>}
 *
 * @example
 *   const { report, reporterId } = await generateMatchReport(gameId);
 *   // reporterId === "klassiker" | "analyst" | "euphoriker"
 */
export async function generateMatchReport(gameId) {
	const game = await queryOne("SELECT * FROM games WHERE id = $1", [gameId]);

	if (!game) {
		const err = new Error("Game not found");
		err.statusCode = 404;
		throw err;
	}

	const players = await query(
		`SELECT gp.player_id, gp.team, gp.team_name,
			json_build_object('username', p.username, 'avatar_url', p.avatar_url) AS profiles
		FROM game_players gp
		LEFT JOIN profiles p ON p.id = gp.player_id
		WHERE gp.game_id = $1`,
		[gameId],
	);

	const nameMap = buildNameMap(players);

	const playerContexts = [];
	for (const gp of players) {
		const base = {
			name: gp.profiles?.username || "Unknown",
			team: gp.team,
			team_name: gp.team_name,
		};
		try {
			const stats = await getUserStats(gp.player_id);
			const career = compactCareer(stats);
			if (career) base.career = career;
		} catch {
			// Career block stays absent on failure so the LLM does not see
			// a misleading "career: null".
		}
		playerContexts.push(base);
	}

	// Resolve canonical home/away team names so every downstream block
	// (timeline entries, teams summary, outcome) speaks the same truth.
	const homeTeamName =
		playerContexts.find((p) => p.team === "home")?.team_name || "Heim";
	const awayTeamName =
		playerContexts.find((p) => p.team === "away")?.team_name || "Auswärts";
	const teamNames = { home: homeTeamName, away: awayTeamName };

	// Walk the timeline once and derive the scoring team for each goal
	// from the score progression. We deliberately do not trust an
	// `entry.team` field on goal events because own-goals invert team
	// attribution while the score still increases for the conceding
	// side — score progression is the only reliable source.
	let prevHome = 0;
	let prevAway = 0;
	const timelineForAI = Array.isArray(game.score_timeline)
		? game.score_timeline.map((entry) => {
				const built = buildAITimelineEntry(entry, nameMap);
				if (built.event_type === "goal") {
					const h = typeof entry?.home === "number" ? entry.home : prevHome;
					const a = typeof entry?.away === "number" ? entry.away : prevAway;
					const scoringTeam = h > prevHome ? "home" : "away";
					built.team = scoringTeam;
					built.team_name = teamNames[scoringTeam];
					prevHome = h;
					prevAway = a;
				}
				return built;
			})
		: [];

	const homePlayers = playerContexts
		.filter((p) => p.team === "home")
		.map((p) => p.name);
	const awayPlayers = playerContexts
		.filter((p) => p.team === "away")
		.map((p) => p.name);

	const scoreHome = Number(game.score_home ?? 0);
	const scoreAway = Number(game.score_away ?? 0);
	let outcome;
	if (scoreHome === scoreAway) {
		outcome = {
			winner: "draw",
			home_team_name: homeTeamName,
			away_team_name: awayTeamName,
			home_players: homePlayers,
			away_players: awayPlayers,
		};
	} else {
		const winnerSide = scoreHome > scoreAway ? "home" : "away";
		const loserSide = winnerSide === "home" ? "away" : "home";
		outcome = {
			winner: winnerSide,
			winner_team_name: teamNames[winnerSide],
			winner_players: winnerSide === "home" ? homePlayers : awayPlayers,
			loser_team_name: teamNames[loserSide],
			loser_players: loserSide === "home" ? homePlayers : awayPlayers,
			final_score: `${scoreHome}:${scoreAway}`,
		};
	}

	const rawStorylines = await buildStorylines(players, game);
	const hasStorylines =
		rawStorylines.newly_unlocked_badges.length > 0 ||
		rawStorylines.completed_challenges.length > 0 ||
		rawStorylines.streaks.length > 0;
	const storylines = hasStorylines ? rawStorylines : null;

	const matchStatsByTeam = buildMatchStatsByTeam(
		game.match_stats,
		homeTeamName,
		awayTeamName,
	);

	const underStrengthPeriods = computeUnderStrengthPeriods(
		game.score_timeline,
		game.result_type,
		teamNames,
		nameMap,
	);

	const dramaLevel = determineDramaLevel(game);

	const recentReporters = (
		await query(
			`SELECT reporter_id FROM games
			 WHERE reporter_id IS NOT NULL AND id <> $1
			 ORDER BY played_at DESC
			 LIMIT 2`,
			[gameId],
		)
	).map((r) => r.reporter_id);

	const reporterId = selectReporter(game, { recentReporters });

	const context = {
		mode: game.mode,
		score: `${scoreHome}:${scoreAway}`,
		result_type: game.result_type,
		teams: {
			home: {
				name: homeTeamName,
				players: homePlayers,
				score: scoreHome,
			},
			away: {
				name: awayTeamName,
				players: awayPlayers,
				score: scoreAway,
			},
		},
		outcome,
		score_timeline: timelineForAI,
		match_stats: game.match_stats,
		players: playerContexts,
		drama_level: dramaLevel,
	};
	if (matchStatsByTeam) context.match_stats_by_team = matchStatsByTeam;
	if (storylines) context.storylines = storylines;
	if (underStrengthPeriods.length > 0) {
		context.under_strength_periods = underStrengthPeriods;
	}
	const gameContext = JSON.stringify(context);

	const { text: report } = await callAnthropicWithRetry({
		model: "claude-sonnet-4-6",
		max_tokens: 768,
		messages: [
			{
				role: "user",
				content: `${buildReporterPrompt(reporterId)}\n\nSpieldaten:\n${gameContext}`,
			},
		],
	});

	// Best-effort name-fabrication check. Logged for visibility but does
	// not block the report — the worst false positive is a flagged
	// common noun, not a malformed text.
	const fabricated = findFabricatedNames(
		report,
		[...nameMap.values()].filter(Boolean),
	);
	if (fabricated.length > 0) {
		console.warn(
			`[matchReport] potential fabricated names in game ${gameId}:`,
			fabricated,
		);
	}

	await queryOne(
		`UPDATE games
		    SET match_report = $1,
		        reporter_id = $2,
		        match_report_audio_url = NULL,
		        match_report_audio_generated_at = NULL
		  WHERE id = $3
		RETURNING id`,
		[report, reporterId, gameId],
	);

	return { report, reporterId };
}
