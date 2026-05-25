/**
 * Parses a German live-match voice transcript into a structured event
 * the frontend's live-match state machine can replay (goal, yellow
 * card, red card, missed penalty).
 *
 * The transcript comes from the browser's Web Speech API on the
 * client; this service only does intent extraction via Claude, which
 * is given the current player roster so it can resolve a spoken first
 * name / nickname back to the real `player_id`.
 */

import { callAnthropicWithRetry } from "../helpers/ai.helpers.js";
import { query } from "../helpers/database.helpers.js";

const MODEL = "claude-sonnet-4-6";
const TIMEOUT_MS = 6000;
const VALID_EVENT_TYPES = new Set([
	"goal",
	"yellow_card",
	"red_card",
	"penalty_missed",
]);

/**
 * Strip Markdown code fences around a JSON payload if present.
 *
 * @param {string} raw
 * @returns {string}
 */
function cleanLlmJson(raw) {
	if (typeof raw !== "string") return "";
	return raw
		.replace(/^\s*```(?:json)?\s*/i, "")
		.replace(/\s*```\s*$/i, "")
		.trim();
}

/**
 * Build the extraction prompt. Kept as a pure function so unit tests
 * can assert the prompt content without making real Anthropic calls.
 *
 * @param {object} args
 * @param {string} args.transcript - Raw user transcript (German).
 * @param {Array<{ id: string, username: string, side: "home"|"away" }>} args.players
 * @param {number} args.currentMinute - The live-match clock when the user spoke.
 * @returns {string}
 */
export function buildExtractPrompt({ transcript, players, currentMinute }) {
	const roster = players
		.map((p) => {
			const aliasPart =
				Array.isArray(p.aliases) && p.aliases.length > 0
					? ` · auch genannt: ${p.aliases.join(", ")}`
					: "";
			return `- id: ${p.id} · name: ${p.username} · team: ${p.side}${aliasPart}`;
		})
		.join("\n");
	return `Du wandelst eine deutsche Live-Reporter-Eingabe für ein FIFA-Office-Match in ein strukturiertes Event um.

KONTEXT:
- Aktuelle Spielminute (falls der Sprecher keine nennt): ${currentMinute}
- Aktuelle Aufstellung (id · Name · Team):
${roster}

EINGABE:
"${transcript}"

DEINE AUFGABE:
1. Bestimme das Event:
   - "goal"           — Tor
   - "yellow_card"    — Gelbe Karte
   - "red_card"       — Rote Karte (auch Ampelkarte zählt als rot)
   - "penalty_missed" — Verschossener Elfmeter
2. Erkenne den genannten Spieler (Schütze bzw. verwarnten Spieler) aus der Aufstellung — Vornamen, Spitznamen, phonetische Varianten ODER ein gelisteter Alias unter „auch genannt" sind alle gültig. Wähle aus der Liste den wahrscheinlichsten Match.
3. Erkenne die Minute. Sprecher sagt "Minute siebzehn", "in der 17.", "17te". Konvertiere zu Integer 1-120. Wenn keine Minute genannt wird, nutze \`currentMinute\`.
4. Bei einem Tor: erkenne optional einen Vorlagengeber. Sprecher sagt "Vorlage X", "Pass von X", "nach Vorlage X", "Assist X". Der Vorlagengeber muss im SELBEN Team spielen wie der Schütze — sonst weglassen. Bei Eigentor, Karte oder verschossenem Elfer NIE einen Vorlagengeber zurückgeben.

REGELN:
- Antworte STRIKT als JSON, kein Markdown, keine Backticks, keine Erklärungstexte.
- Wenn das Event NICHT eindeutig zuordenbar ist (keine bekannte Person ODER kein bekanntes Event-Wort), gib \`{ "ok": false, "reason": "<kurzer Grund>" }\` zurück.
- Wenn alles passt: \`{ "ok": true, "eventType": "...", "playerId": "...", "minute": <int>, "assisterId": "<id>"|null }\`.
- \`assisterId\` ist optional — wenn kein Vorlagengeber genannt wird oder nicht im Team ist, sende \`null\`.
- Antworte mit gar keinem anderen Text als dem JSON.

BEISPIELE:
Eingabe: "Tor Marco Minute siebzehn"
Antwort: {"ok": true, "eventType": "goal", "playerId": "<Marcos-id>", "minute": 17, "assisterId": null}

Eingabe: "Tor Marco siebzehnte Minute Vorlage BlackIVmaniac"
Antwort: {"ok": true, "eventType": "goal", "playerId": "<Marcos-id>", "minute": 17, "assisterId": "<BlackIVmaniacs-id>"}

Eingabe: "Gelb für Florian Minute fünfunddreißig"
Antwort: {"ok": true, "eventType": "yellow_card", "playerId": "<Florians-id>", "minute": 35, "assisterId": null}

Eingabe: "Was war das denn"
Antwort: {"ok": false, "reason": "Kein erkennbares Event"}`;
}

/**
 * Resolve a raw transcript into a structured event using Claude.
 *
 * @param {object} args
 * @param {string} args.transcript - User transcript from the browser STT.
 * @param {Array<{ id: string, username: string, side: "home"|"away" }>} args.players
 * @param {number} args.currentMinute
 * @returns {Promise<{ ok: true, eventType: string, playerId: string, minute: number, side: "home"|"away", transcript: string } | { ok: false, reason: string, transcript: string }>}
 */
export async function parseLiveMatchVoiceEvent({
	transcript,
	players,
	currentMinute,
}) {
	const cleanedTranscript = (transcript ?? "").trim();
	if (!cleanedTranscript) {
		return { ok: false, reason: "Leeres Transkript", transcript: "" };
	}

	const enrichedPlayers = await enrichWithAliases(players);

	const prompt = buildExtractPrompt({
		transcript: cleanedTranscript,
		players: enrichedPlayers,
		currentMinute,
	});

	const llmPromise = callAnthropicWithRetry({
		model: MODEL,
		max_tokens: 200,
		messages: [{ role: "user", content: prompt }],
	});
	const timeoutPromise = new Promise((resolve) =>
		setTimeout(() => resolve(null), TIMEOUT_MS),
	);
	const result = await Promise.race([llmPromise, timeoutPromise]);

	if (!result?.text) {
		return {
			ok: false,
			reason: "LLM-Timeout",
			transcript: cleanedTranscript,
		};
	}

	let parsed;
	try {
		parsed = JSON.parse(cleanLlmJson(result.text));
	} catch {
		return {
			ok: false,
			reason: "Ungültige LLM-Antwort",
			transcript: cleanedTranscript,
		};
	}

	if (!parsed?.ok) {
		return {
			ok: false,
			reason: parsed?.reason ?? "Nicht erkannt",
			transcript: cleanedTranscript,
		};
	}

	if (!VALID_EVENT_TYPES.has(parsed.eventType)) {
		return {
			ok: false,
			reason: "Unbekannter Event-Typ",
			transcript: cleanedTranscript,
		};
	}
	const player = players.find((p) => p.id === parsed.playerId);
	if (!player) {
		return {
			ok: false,
			reason: "Spieler nicht in der Aufstellung",
			transcript: cleanedTranscript,
		};
	}
	const minute = Number.parseInt(parsed.minute, 10);
	if (!Number.isFinite(minute) || minute < 1 || minute > 120) {
		return {
			ok: false,
			reason: "Ungültige Minute",
			transcript: cleanedTranscript,
		};
	}

	// Optional assister — only meaningful for goals, only when the
	// candidate is on the same team as the scorer. Anything else is
	// silently dropped rather than turned into a hard reject so a
	// noisy "Vorlage Y" tail can't sink an otherwise valid event.
	let assisterId = null;
	if (parsed.eventType === "goal" && parsed.assisterId) {
		const assister = players.find((p) => p.id === parsed.assisterId);
		if (
			assister &&
			assister.side === player.side &&
			assister.id !== player.id
		) {
			assisterId = assister.id;
		}
	}

	return {
		ok: true,
		eventType: parsed.eventType,
		playerId: player.id,
		side: player.side,
		minute,
		assisterId,
		transcript: cleanedTranscript,
	};
}

/**
 * Hydrate each player with their `voice_aliases` from the profiles
 * table. Guest IDs aren't in `profiles`, so they're returned with an
 * empty alias list — they can only be referenced by their in-app
 * name.
 *
 * @param {Array<{ id: string, username: string, side: "home"|"away" }>} players
 * @returns {Promise<Array<{ id: string, username: string, side: "home"|"away", aliases: string[] }>>}
 */
async function enrichWithAliases(players) {
	const ids = players.map((p) => p.id).filter((id) => !id.startsWith("__"));
	if (ids.length === 0) {
		return players.map((p) => ({ ...p, aliases: [] }));
	}
	const rows = await query(
		`SELECT id, voice_aliases FROM profiles WHERE id = ANY($1::text[])`,
		[ids],
	);
	const aliasMap = new Map(
		rows.map((r) => [
			r.id,
			Array.isArray(r.voice_aliases) ? r.voice_aliases : [],
		]),
	);
	return players.map((p) => ({ ...p, aliases: aliasMap.get(p.id) ?? [] }));
}

export const __test__ = { cleanLlmJson, enrichWithAliases };
