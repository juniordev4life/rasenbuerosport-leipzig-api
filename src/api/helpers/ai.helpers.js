/**
 * Shared helpers for the Anthropic-driven narrative endpoints (match
 * reports, Spiel der Woche, personal weekly recaps).
 *
 * Two responsibilities:
 *  - `callAnthropicWithRetry` — wraps `messages.create` with exponential
 *    backoff for retriable failures (rate limits, 5xx, network blips).
 *  - `findFabricatedNames` — best-effort post-validation: scans the
 *    generated narrative for capitalised words that look like personal
 *    names but are not in the supplied roster.
 */

import { getAnthropicClient } from "../../config/anthropic.config.js";

/**
 * Common German vocabulary that starts with a capital letter and would
 * otherwise pollute the name-fabrication check. Curated; not exhaustive,
 * but enough to keep the check from screaming on every "Tor" or
 * "Mannschaft".
 *
 * @type {ReadonlySet<string>}
 */
const COMMON_CAPITALISED_DE = new Set([
	"Abend",
	"Aktion",
	"Auswärts",
	"Ballbesitz",
	"Bilanz",
	"Comeback",
	"Drama",
	"Duell",
	"Duelle",
	"Ecke",
	"Eckenball",
	"Elfmeter",
	"Elfmeterschießen",
	"Ende",
	"Endspiel",
	"Fair",
	"Fehler",
	"Form",
	"Freistoß",
	"Gegner",
	"Gegentor",
	"Gelb",
	"Halbzeit",
	"Heim",
	"Heimsieg",
	"Karte",
	"Klassiker",
	"Krimi",
	"Last-Minute",
	"Match",
	"Minute",
	"Mannschaft",
	"Niederlage",
	"Office",
	"Pass",
	"Passgenauigkeit",
	"Penalty",
	"Pflichtsieg",
	"Platz",
	"Punkt",
	"Punkte",
	"Quote",
	"Rekord",
	"Remis",
	"Revanche",
	"Rot",
	"Runde",
	"Schock",
	"Schuss",
	"Serie",
	"Sieg",
	"Spannung",
	"Spiel",
	"Spiele",
	"Spielbericht",
	"Spieler",
	"Spielminute",
	"Spielverlauf",
	"Spielzeit",
	"Stadion",
	"Stark",
	"Statistik",
	"Stunde",
	"Team",
	"Tor",
	"Tore",
	"Treffer",
	"Triumph",
	"Vorlage",
	"Vorsprung",
	"Wende",
	"Wendepunkt",
	"Woche",
	"Wochenende",
	"Zweikampf",
	"Zweikampfquote",
	"Tag",
	"Bei",
	"Der",
	"Die",
	"Das",
	"Ein",
	"Eine",
	"Im",
	"In",
	"Auf",
	"Mit",
	"Trotz",
	"Trotzdem",
	"Unterm",
	"Unter",
	"Über",
	"Vor",
	"Nach",
	"Während",
	"Beim",
	"Zum",
	"Zur",
	"Vom",
	"Am",
	"Ans",
	"Ohne",
	"Aber",
	"Doch",
	"Und",
	"Oder",
	"So",
	"Nun",
	"Jetzt",
	"Schon",
	"Heute",
	"Gestern",
	"Morgen",
	"Freitag",
	"Samstag",
	"Sonntag",
	"Montag",
	"Dienstag",
	"Mittwoch",
	"Donnerstag",
	"Hattrick",
	"Doppelpack",
	"Joker",
	"Underdog",
	"Comeback-Sieg",
	"Geheimfavorit",
	"FC",
	"VfB",
	"VfL",
	"BVB",
	"FCB",
]);

/**
 * Decide whether an Anthropic error is worth retrying.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isRetriable(err) {
	const status =
		/** @type {{status?: number}} */ (err)?.status ??
		/** @type {{statusCode?: number}} */ (err)?.statusCode;
	if (status == null) return true; // network blip / no response — retry once
	return status === 429 || (status >= 500 && status < 600);
}

/**
 * Sleep for `ms` milliseconds — extracted so tests could mock it later.
 * @param {number} ms
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call `client.messages.create` with up to `retries` retries on
 * 429/5xx/network errors using exponential backoff (500ms, 1s, 2s).
 *
 * Throws an Error with `statusCode = 503` and a friendly message if all
 * retries fail — the caller can pass that straight to
 * `handleErrorResponse` and the user sees "KI gerade ausgelastet".
 *
 * @param {object} payload - The full payload for `messages.create`.
 * @param {object} [options]
 * @param {number} [options.retries=2]
 * @returns {Promise<{ text: string }>}
 */
export async function callAnthropicWithRetry(payload, { retries = 2 } = {}) {
	const client = getAnthropicClient();
	let lastError;

	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const response = await client.messages.create(payload);
			const text = response.content?.[0]?.text;
			if (!text) {
				const err = new Error("AI response had no text content");
				err.statusCode = 502;
				throw err;
			}
			return { text };
		} catch (err) {
			lastError = err;
			if (attempt === retries || !isRetriable(err)) break;
			const backoffMs = 500 * 2 ** attempt;
			await sleep(backoffMs);
		}
	}

	const err = new Error(
		"Die KI ist gerade nicht erreichbar. Bitte versuche es in einer Minute erneut.",
	);
	err.statusCode = 503;
	err.cause = lastError;
	throw err;
}

/**
 * Best-effort scan of an AI-generated narrative for player-name
 * fabrications. Returns the list of capitalised tokens that look like
 * personal names but do not appear in the supplied roster.
 *
 * The check is intentionally lenient — German has plenty of capitalised
 * words that are not names, so we filter against a curated common-word
 * deny-list and accept some false negatives. Findings are advisory:
 * callers typically log a warning and ship the report anyway, because
 * the worst case is "report mentions Spiel" being flagged.
 *
 * @param {string} report
 * @param {Iterable<string>} validNames
 * @returns {string[]} Capitalised tokens not in `validNames` and not in
 *   the common-word deny-list. Deduplicated, in first-occurrence order.
 *
 * @example
 *   findFabricatedNames(
 *     "Marco trifft, Phantomspieler legt auf.",
 *     ["Marco", "Klaus"]
 *   );
 *   // → ["Phantomspieler"]
 */
export function findFabricatedNames(report, validNames) {
	const validSet = new Set(validNames);
	const seen = new Set();
	const fabricated = [];
	const tokens = report.match(/\b[A-ZÄÖÜ][a-zäöüß-]{2,}\b/g) ?? [];
	for (const token of tokens) {
		if (validSet.has(token)) continue;
		if (COMMON_CAPITALISED_DE.has(token)) continue;
		if (seen.has(token)) continue;
		seen.add(token);
		fabricated.push(token);
	}
	return fabricated;
}
