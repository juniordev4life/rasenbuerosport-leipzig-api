import {
	callAnthropicWithRetry,
	findFabricatedNames,
} from "../helpers/ai.helpers.js";
import {
	computePlayerWeekStatsPure,
	computeProgress,
} from "../helpers/challenges.helpers.js";
import { query, queryOne } from "../helpers/database.helpers.js";
import { getActiveChallengesForPlayer } from "./challenges.services.js";
import { getUserStats } from "./stats.services.js";

const MATCH_REPORT_PROMPT = `Du bist ein unterhaltsamer, knapper Sportreporter für Büro-Kicker-Spiele (gespielt in EA Sports FC / FC26).

Schreibe einen kurzen Spielbericht (3-5 Sätze) auf Deutsch.

Regeln:
- Kurz und knackig, wie ein TV-Kommentar nach dem Spiel
- Benutze die echten Spielernamen und Teamnamen
- Hebe besondere Auffälligkeiten hervor, z.B.:
  - Underdog-Siege (wenig Ballbesitz aber gewonnen)
  - xG Over-/Underperformance (mehr/weniger Tore als erwartet)
  - Dominanter Ballbesitz der trotzdem verliert
  - Außergewöhnliche Passgenauigkeit oder Zweikampfquoten
- Wenn Karriere-Durchschnittswerte der Spieler verfügbar sind, vergleiche:
  - "Normalerweise ein Chancentod, traf heute alles"
  - "Weit unter seinem üblichen Niveau"
- Erwähne den Spielverlauf wenn dramatisch (Aufholjagden, Last-Minute-Tore)
- Bei Verlängerung: "Das Spiel ging in die Verlängerung..."
- Bei Elfmeterschießen: besonders dramatisch schreiben

Hinweis zu \`score_timeline\`:
- Jeder Eintrag ist bereits mit Klarnamen angereichert. Verlasse dich AUSSCHLIESSLICH auf diese Felder, NIE auf Spieler-IDs:
  - Tor: \`scorer\` (Torschütze) und optional \`assist\` (Vorlagengeber).
    Erwähne den Vorlagengeber wenn vorhanden ("legt für X auf", "Vorarbeit von Y").
  - Karte: \`offender\` (Spieler) und \`card_color\` ("yellow" | "red").
  - Verschossener Elfmeter: \`shooter\` (Schütze) und \`keeper\` (Torwart, kann fehlen).
- Karten und verschossene Elfmeter sind dramaturgisch erwähnenswert (Wendepunkt, Schock-Moment, Glück gehabt) — aber zähle sie NICHT als Tore.
- Wenn ein \`scorer\` / \`assist\` / \`offender\` / \`shooter\` / \`keeper\` "Unbekannt" ist, lass den Namen weg statt zu raten.

Storyline-Bausteine (\`storylines\`):
- \`newly_unlocked_badges\`: Badges die DIESES Spiel freigeschaltet hat. Erwähne sie wenn vorhanden ("…und holt sich damit den Vorlagengeber-Bronze-Badge").
- \`completed_challenges\`: Wochen-Challenges die DURCH dieses Spiel geschafft wurden ("…schließt die '5-Tore-Challenge' diese Woche ab").
- \`streaks\`: aktive Win/Loss-Serien (≥3) der Spieler. Erwähne wenn dramatisch ("…sein 5. Sieg in Folge", "…beendet die 4-Spiele-Niederlagenserie").
- Wenn alle drei leer sind, lass diese Aspekte einfach weg.

- Kein Markdown, nur Fließtext
- Maximal 5 Sätze
- Gib NUR den Spielbericht zurück, keine Einleitung oder Erklärung`;

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
		return {
			...base,
			score_after: `${entry.home}:${entry.away}`,
			goal_type: entry.goal_type ?? "play",
			scorer: resolveName(entry.scored_by, nameMap),
			assist: resolveName(entry.assist_by, nameMap),
		};
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
 * Generates an AI match report for a game.
 *
 * @param {string} gameId - Game UUID
 * @returns {Promise<string>} Generated report text
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
		try {
			const stats = await getUserStats(gp.player_id);
			playerContexts.push({
				name: gp.profiles?.username || "Unknown",
				team: gp.team,
				team_name: gp.team_name,
				career: {
					total_games: stats.total_games,
					win_rate: stats.win_rate,
					avg_possession: stats.career_match_stats?.avg_possession || null,
					avg_pass_accuracy:
						stats.career_match_stats?.avg_pass_accuracy || null,
					xg_efficiency: stats.career_match_stats?.xg_efficiency || null,
					current_streak: stats.current_streak,
				},
			});
		} catch {
			playerContexts.push({
				name: gp.profiles?.username || "Unknown",
				team: gp.team,
				team_name: gp.team_name,
				career: null,
			});
		}
	}

	const timelineForAI = Array.isArray(game.score_timeline)
		? game.score_timeline.map((entry) => buildAITimelineEntry(entry, nameMap))
		: [];

	const storylines = await buildStorylines(players, game);

	const gameContext = JSON.stringify({
		score: `${game.score_home}:${game.score_away}`,
		result_type: game.result_type,
		score_timeline: timelineForAI,
		match_stats: game.match_stats,
		players: playerContexts,
		storylines,
	});

	const { text: report } = await callAnthropicWithRetry({
		model: "claude-sonnet-4-20250514",
		max_tokens: 512,
		messages: [
			{
				role: "user",
				content: `${MATCH_REPORT_PROMPT}\n\nSpieldaten:\n${gameContext}`,
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
		"UPDATE games SET match_report = $1 WHERE id = $2 RETURNING id",
		[report, gameId],
	);

	return report;
}
