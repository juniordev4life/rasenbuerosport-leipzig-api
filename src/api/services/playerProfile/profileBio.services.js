/**
 * LLM-driven adjective + 1-sentence bio for the player profile.
 *
 * Generation is gated by a cheap cache so we only burn Claude
 * tokens when something meaningful actually changed:
 *   - base archetype switched, OR
 *   - the player has played ≥ `bioRegenerateAfterMatches` matches
 *     since the last generation
 *
 * Both cases are decided by `shouldRegenerateBio`. The Claude call
 * itself is wrapped with a 5-second timeout so a slow LLM doesn't
 * block the profile endpoint — on timeout we fall back to the
 * previous cached bio (or `null` if none exists).
 */

import { PROFILE_CONSTANTS } from "../../../constants/profile.constants.js";
import { ARCHETYPES } from "../../../constants/profileArchetypes.constants.js";
import { callAnthropicWithRetry } from "../../helpers/ai.helpers.js";

const BIO_MODEL = "claude-sonnet-4-6";
const BIO_TIMEOUT_MS = 5000;

/**
 * Strip Markdown code fences around a JSON payload, if present.
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
 * Decide whether the cached bio is stale enough to warrant a new
 * Claude call.
 *
 * @param {object|null} cachedBio
 * @param {string} currentArchetype
 * @param {number} currentMatchCount
 * @returns {boolean}
 */
export function shouldRegenerateBio(
	cachedBio,
	currentArchetype,
	currentMatchCount,
) {
	if (!cachedBio) return true;
	if (
		PROFILE_CONSTANTS.bioRegenerateOnArchetypeChange &&
		cachedBio.baseArchetype !== currentArchetype
	) {
		return true;
	}
	const since =
		currentMatchCount - (Number(cachedBio.matchCountAtGeneration) || 0);
	return since >= PROFILE_CONSTANTS.bioRegenerateAfterMatches;
}

/**
 * Compose the prompt that asks Claude for the adjective + bio.
 *
 * Kept as a pure function so the prompt content is auditable in
 * unit tests (no Anthropic call needed to inspect it).
 *
 * @param {object} args
 * @param {string} args.baseArchetype
 * @param {object} args.axes
 * @param {number} args.matchCount
 * @param {Array<{ result: "win"|"loss"|"draw" }>} [args.recentMatches]
 * @returns {string}
 */
export function buildBioPrompt({
	baseArchetype,
	axes,
	matchCount,
	recentMatches = [],
}) {
	const meta = ARCHETYPES[baseArchetype] ?? {
		label: baseArchetype,
		description: "",
	};
	const recents = recentMatches
		.map((m) => (m.result === "win" ? "S" : m.result === "loss" ? "N" : "U"))
		.join(", ");

	return `Du generierst eine kurze, prägnante Beschreibung für einen Spieler in der internen Office-FIFA-App "Rasenbürosport Leipzig Liga".

KONTEXT:
- Grund-Archetyp: ${meta.label}
- Beschreibung des Archetyps: ${meta.description}
- Anzahl Spiele: ${matchCount}

ACHSEN-WERTE (0-100, Perzentil innerhalb der Liga):
- Finisher: ${axes.finisher} (Tore pro Spiel)
- Playmaker: ${axes.playmaker} (Vorlagen pro Spiel)
- Clutch: ${axes.clutch} (Aktionen in Schlussphase)
- Consistency: ${axes.consistency} (Gleichmäßigkeit der Leistung)
- Discipline: ${axes.discipline} (wenig Rote Karten)
- Winner: ${axes.winner} (Mitspieler besser machen)

LETZTE ERGEBNISSE: ${recents || "noch keine"}

DEINE AUFGABE:
1. Wähle ein einzelnes Adjektiv-Vorwort für den Archetyp-Titel (Beispiele:
   "eiskalt", "präzise", "explosiv", "lautlos", "kühl", "ruhig", "unaufhaltsam").
   Das Adjektiv muss zu den dominanten Achsen-Werten passen.

2. Generiere eine 1-Satz-Bio (max. 12 Wörter), die den Spielercharakter
   prägnant beschreibt. Faktisch zu den Werten, nie erfunden.
   Augenzwinkernd erlaubt, niemals beleidigend.

STILREGELN:
- Sprache: Deutsch
- Niemals den Spieler-Namen, andere Personen oder Vereine nennen
- Keine politischen, religiösen oder diskriminierenden Anspielungen
- Direkter Stil, kein "du", kein "der Spieler"

ANTWORT-FORMAT (strikt JSON, KEIN Markdown, KEINE Backticks):
{
  "adjective": "eiskalt",
  "bio": "Killt seine Chancen, lebt aber gefährlich am Disziplin-Limit."
}`;
}

/**
 * Generate a fresh bio via Claude, with a hard timeout.
 *
 * @param {object} args - Same shape as `buildBioPrompt`.
 * @returns {Promise<{ adjective: string, bio: string }|null>} `null` on timeout / parse failure.
 */
async function callBioLLM(args) {
	const prompt = buildBioPrompt(args);
	const llmPromise = callAnthropicWithRetry({
		model: BIO_MODEL,
		max_tokens: 200,
		messages: [{ role: "user", content: prompt }],
	});
	const timeoutPromise = new Promise((resolve) => {
		setTimeout(() => resolve(null), BIO_TIMEOUT_MS);
	});
	const result = await Promise.race([llmPromise, timeoutPromise]);
	if (!result || !result.text) return null;

	try {
		const cleaned = cleanLlmJson(result.text);
		const parsed = JSON.parse(cleaned);
		if (
			typeof parsed?.adjective !== "string" ||
			typeof parsed?.bio !== "string"
		) {
			return null;
		}
		return {
			adjective: parsed.adjective.trim(),
			bio: parsed.bio.trim(),
		};
	} catch {
		return null;
	}
}

/**
 * Either return the previously cached bio (if still fresh enough)
 * or generate a new one and stamp it with the current archetype +
 * match count. Falls back to the cached bio on LLM timeout/failure
 * so the profile endpoint never breaks because the LLM is slow.
 *
 * @param {object} args
 * @param {string} args.baseArchetype
 * @param {object} args.axes
 * @param {number} args.matchCount
 * @param {Array<object>} [args.recentMatches]
 * @param {object|null} args.cachedBio
 * @returns {Promise<object|null>}
 */
export async function generateOrLoadBio(args) {
	const { baseArchetype, matchCount, cachedBio } = args;

	if (!shouldRegenerateBio(cachedBio, baseArchetype, matchCount)) {
		return cachedBio;
	}

	const fresh = await callBioLLM(args);
	if (!fresh) {
		return cachedBio ?? null;
	}

	return {
		adjective: fresh.adjective,
		bio: fresh.bio,
		baseArchetype,
		matchCountAtGeneration: matchCount,
		generatedAt: new Date().toISOString(),
		model: BIO_MODEL,
	};
}

export const __test__ = { cleanLlmJson };
