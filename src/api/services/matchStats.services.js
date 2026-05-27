import { getAnthropicClient } from "../../config/anthropic.config.js";
import { getStorageBucket } from "../../config/firebase.config.js";
import { queryOne } from "../helpers/database.helpers.js";
import { normalisePassNetwork } from "../utils/passNetwork.utils.js";

const OVERVIEW_EXTRACTION_PROMPT = `You are analyzing a post-match statistics screen from EA Sports FC (FC25/FC26).

Extract ALL visible statistics from this image into a structured JSON object. The image shows a two-column layout with home team stats on the left and away team stats on the right.

The stats screen may be in German or English. Common stats include:
- Ballbesitzquote / Possession (percentage)
- Ballrückeroberungs-Zeit / Ball Recovery Time (seconds)
- Schüsse / Shots (count)
- Erwartete Tore / Expected Goals / xG (decimal)
- Pässe / Passes (count)
- Zweikämpfe / Duels (count)
- Gewonnene Zweikämpfe / Duels Won (count)
- Abgefangene Bälle / Interceptions (count)
- Paraden / Saves (count)
- Begangene Fouls / Fouls (count)
- Abseits / Offsides (count)
- Ecken / Corners (count)
- Freistöße / Free Kicks (count)
- Elfmeter / Penalties (count)
- Gelbe Karten / Yellow Cards (count)

Circular indicators on the sides (percentages):
- Dribbling-Erfolgsquote / Dribbling Success Rate
- Schusspräzision / Shot Accuracy
- Passgenauigkeit / Pass Accuracy

Return ONLY a valid JSON object with this exact structure. Use null for any stat not visible in the image:
{
  "possession": { "home": <number>, "away": <number> },
  "ball_recovery_time": { "home": <number>, "away": <number> },
  "shots": { "home": <number>, "away": <number> },
  "xg": { "home": <number>, "away": <number> },
  "passes": { "home": <number>, "away": <number> },
  "duels": { "home": <number>, "away": <number> },
  "duels_won": { "home": <number>, "away": <number> },
  "interceptions": { "home": <number>, "away": <number> },
  "saves": { "home": <number>, "away": <number> },
  "fouls": { "home": <number>, "away": <number> },
  "offsides": { "home": <number>, "away": <number> },
  "corners": { "home": <number>, "away": <number> },
  "free_kicks": { "home": <number>, "away": <number> },
  "penalties": { "home": <number>, "away": <number> },
  "yellow_cards": { "home": <number>, "away": <number> },
  "dribbling": { "home": <number>, "away": <number> },
  "shot_accuracy": { "home": <number>, "away": <number> },
  "pass_accuracy": { "home": <number>, "away": <number> }
}

Return ONLY the JSON object, no markdown fences, no explanation.`;

const PASSES_EXTRACTION_PROMPT = `You are analyzing the PASSES (Pässe) tab of a post-match statistics screen from EA Sports FC (FC25/FC26).

Extract ALL visible pass statistics from this image. The image shows a two-column layout with home team stats on the left and away team stats on the right.

The stats screen may be in German or English. Common pass stats include:

Top section (general):
- Passgenauigkeit / Pass Accuracy (percentage, shown as circular indicator)
- Pässe gesamt / Total Passes (count)
- Angekommen / Completed Passes (count)
- Abgefangen / Intercepted Passes (count)
- Abseits / Offside (count)

Pass types section (Passarten / Pass Types):
- Bodenpass / Ground Pass (count)
- Lob / Lob Pass (count)
- Steilpass / Through Ball (count)
- Steilpass (Lob) / Lobbed Through Ball (count)
- Flanke / Cross (count)
- Standard / Set Piece (count)

Playing style section (Spielstil / Style):
- Schlüsselpässe / Key Passes (count)
- Direktpass / First-Time Pass (count)
- Doppelpass / Double Pass / One-Two (count)
- Flügelspiel / Wing Play (count)
- Sololauf / Solo Run (count)

Return ONLY a valid JSON object with this exact structure. Use null for any stat not visible in the image:
{
  "pass_accuracy": { "home": <number>, "away": <number> },
  "passes": { "home": <number>, "away": <number> },
  "completed_passes": { "home": <number>, "away": <number> },
  "intercepted_passes": { "home": <number>, "away": <number> },
  "offside_passes": { "home": <number>, "away": <number> },
  "ground_passes": { "home": <number>, "away": <number> },
  "lob_passes": { "home": <number>, "away": <number> },
  "through_balls": { "home": <number>, "away": <number> },
  "lobbed_through_balls": { "home": <number>, "away": <number> },
  "crosses": { "home": <number>, "away": <number> },
  "set_pieces": { "home": <number>, "away": <number> },
  "key_passes": { "home": <number>, "away": <number> },
  "first_time_passes": { "home": <number>, "away": <number> },
  "double_passes": { "home": <number>, "away": <number> },
  "wing_passes": { "home": <number>, "away": <number> },
  "solo_runs": { "home": <number>, "away": <number> }
}

ZUSÄTZLICHE PASS-NETZWERK-ANALYSE:

Auf dem Pässe-Screen sind links unten und rechts unten zwei VISUELLE Pass-Netzwerke abgebildet, die die Spielfeld-Positionen der Spieler als Knoten und ihre Pass-Verbindungen als Linien zeigen. Dicke Linien bedeuten viele Pässe zwischen diesen Spielern.

Werte JEDES der beiden Netzwerke unabhängig aus. Schau dir die Spielfeld-Position der Knoten, die Knotengrößen und die Linien-Dicken an.

Bewertungsregeln:
- Lateralität (auf welcher Seite vom angreifenden Team aus läuft das Spiel): "links" / "rechts" / "symmetrisch"
  - lateralityScore: Zahl zwischen -100 (klar links) und +100 (klar rechts), 0 = perfekt symmetrisch
  - Label-Zuordnung: ≤ -60 → "links", ≥ +60 → "rechts", sonst "symmetrisch"
- Vertikalität: "zentral" / "flügel" / "gemischt"
  - verticalityScore: Zahl zwischen 0 (extrem flügellastig) und 100 (extrem zentral)
  - Label-Zuordnung: ≥ 70 → "zentral", ≤ 30 → "flügel", sonst "gemischt"
- centralPlayer: Trikotnummer des Spielers mit dem GRÖSSTEN Knoten (oder dem mit den meisten Verbindungen, wenn mehrere Knoten ähnlich groß sind)
- topPassConnections: die DREI dicksten Linien, als {from, to}-Paare mit Trikotnummern, dickste zuerst

WENN das Netzwerk nicht klar erkennbar ist (zu klein, verdeckt, zu wenig Daten): setze ALLE Felder auf null statt zu raten. Lieber keine Auswertung als eine erfundene.

Ergänze deine JSON-Antwort um folgende zwei Top-Level-Schlüssel — UNTER den oben genannten numerischen Pass-Statistiken, NICHT als Ersatz dafür:

"homePassNetwork": {
  "laterality": "links | rechts | symmetrisch | null",
  "verticality": "zentral | flügel | gemischt | null",
  "lateralityScore": <Zahl oder null>,
  "verticalityScore": <Zahl oder null>,
  "centralPlayer": "<Trikotnummer als String oder null>",
  "topPassConnections": [{ "from": "<Nummer>", "to": "<Nummer>" }, ...] (max 3)
},
"awayPassNetwork": { /* gleiche Struktur für das rechte Netzwerk */ }

Return ONLY the JSON object, no markdown fences, no explanation.`;

const DEFENSE_EXTRACTION_PROMPT = `You are analyzing the DEFENSE (Abwehr) tab of a post-match statistics screen from EA Sports FC (FC25/FC26).

Extract ALL visible defensive statistics from this image. The image shows a two-column layout with home team stats on the left and away team stats on the right.

The stats screen may be in German or English. Common defense stats include:

Top section (general):
- Tacklingquote / Tackle Success Rate (percentage, shown as circular indicator)
- Faire Tacklings / Fair Tackles (count)
- Gewonnene Tacklings / Won Tackles (count)
- Grätschen / Slide Tackles (count)

Middle section:
- Abfangaktionen / Interceptions (count)
- Blocks / Blocks (count)
- Paraden / Saves (count)
- Klärungsaktionen / Clearances (count)

Duels section (Zweikämpfe / Duels):
- Angriffszweikämpfe gewonnen / Attacking Duels Won (count)
- Defensivzweikämpfe gewonnen / Defensive Duels Won (count)
- Luftzweikämpfe gewonnen / Aerial Duels Won (count)
- Ausgedribbelt / Dribbled Past (count)

Discipline section:
- Fouls / Fouls (count)
- Elfmeter / Penalties (count)
- Gelbe Karten / Yellow Cards (count)
- Rote Karten / Red Cards (count)

Return ONLY a valid JSON object with this exact structure. Use null for any stat not visible in the image:
{
  "tackle_success": { "home": <number>, "away": <number> },
  "fair_tackles": { "home": <number>, "away": <number> },
  "won_tackles": { "home": <number>, "away": <number> },
  "slide_tackles": { "home": <number>, "away": <number> },
  "interceptions": { "home": <number>, "away": <number> },
  "blocks": { "home": <number>, "away": <number> },
  "saves": { "home": <number>, "away": <number> },
  "clearances": { "home": <number>, "away": <number> },
  "attacking_duels_won": { "home": <number>, "away": <number> },
  "defensive_duels_won": { "home": <number>, "away": <number> },
  "aerial_duels_won": { "home": <number>, "away": <number> },
  "dribbled_past": { "home": <number>, "away": <number> },
  "fouls": { "home": <number>, "away": <number> },
  "penalties_conceded": { "home": <number>, "away": <number> },
  "yellow_cards": { "home": <number>, "away": <number> },
  "red_cards": { "home": <number>, "away": <number> }
}

Return ONLY the JSON object, no markdown fences, no explanation.`;

/** Map type to its extraction prompt */
const PROMPTS = {
	overview: OVERVIEW_EXTRACTION_PROMPT,
	passes: PASSES_EXTRACTION_PROMPT,
	defense: DEFENSE_EXTRACTION_PROMPT,
};

/** Map type to its image URL column */
const IMAGE_COLUMNS = {
	overview: "stats_image_url",
	passes: "passes_image_url",
	defense: "defense_image_url",
};

/**
 * Extracts match stats from an FC26 screenshot via Claude Vision API
 * @param {string} imageUrl - Public URL of the uploaded screenshot
 * @param {"overview"|"passes"|"defense"} type - Screenshot type
 * @returns {Promise<object>} Extracted stats object
 */
export async function extractStatsFromImage(imageUrl, type = "overview") {
	const client = getAnthropicClient();
	const prompt = PROMPTS[type] || PROMPTS.overview;

	const response = await client.messages.create({
		model: "claude-sonnet-4-6",
		max_tokens: 1024,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: { type: "url", url: imageUrl },
					},
					{
						type: "text",
						text: prompt,
					},
				],
			},
		],
	});

	const text = response.content[0]?.text;
	if (!text) {
		const err = new Error("No response from AI model");
		err.statusCode = 502;
		throw err;
	}

	try {
		return JSON.parse(text);
	} catch {
		const err = new Error("Failed to parse AI response as JSON");
		err.statusCode = 502;
		throw err;
	}
}

/**
 * Split the AI-extracted JSON into the regular numeric stats (which
 * get merged into the `match_stats` JSONB column) and the visual
 * pass-network indicators (which land in their own dedicated columns
 * via `home_pass_network` / `away_pass_network`).
 *
 * Validation goes through `normalisePassNetwork`, so anything the LLM
 * returned off-schema becomes `null` rather than corrupt JSON in the
 * database. A missing network block is treated the same as an empty
 * one — `null` in the column.
 *
 * @param {object} extracted - Raw AI extraction output.
 * @returns {{
 *   stats: object,
 *   homePassNetwork: object|null,
 *   awayPassNetwork: object|null,
 * }}
 */
function splitPassesExtraction(extracted) {
	const { homePassNetwork, awayPassNetwork, ...stats } = extracted ?? {};
	return {
		stats,
		homePassNetwork: normalisePassNetwork(homePassNetwork),
		awayPassNetwork: normalisePassNetwork(awayPassNetwork),
	};
}

/**
 * Stores extracted match stats and image URL for a game.
 * Merges new stats into existing match_stats JSONB. For the passes
 * screenshot, also extracts and persists the per-team pass-network
 * indicators to their dedicated columns (validated via
 * `normalisePassNetwork` — invalid → null).
 *
 * @param {string} gameId - Game UUID
 * @param {object} newStats - Extracted stats JSON (partial)
 * @param {string} imageUrl - Cloud Storage URL of the screenshot
 * @param {"overview"|"passes"|"defense"} type - Screenshot type
 * @returns {Promise<object>} Updated game record
 */
export async function saveMatchStats(
	gameId,
	newStats,
	imageUrl,
	type = "overview",
) {
	const imageColumn = IMAGE_COLUMNS[type] || IMAGE_COLUMNS.overview;

	const existing = await queryOne(
		"SELECT match_stats FROM games WHERE id = $1",
		[gameId],
	);

	let statsToMerge = newStats;
	let homePassNetwork = null;
	let awayPassNetwork = null;
	let writePassNetwork = false;
	if (type === "passes") {
		const split = splitPassesExtraction(newStats);
		statsToMerge = split.stats;
		homePassNetwork = split.homePassNetwork;
		awayPassNetwork = split.awayPassNetwork;
		writePassNetwork = true;
	}

	const mergedStats = { ...(existing?.match_stats || {}), ...statsToMerge };

	const data = writePassNetwork
		? await queryOne(
				`UPDATE games
				    SET match_stats = $1,
				        ${imageColumn} = $2,
				        home_pass_network = $3::jsonb,
				        away_pass_network = $4::jsonb
				  WHERE id = $5
				RETURNING *`,
				[
					JSON.stringify(mergedStats),
					imageUrl,
					homePassNetwork ? JSON.stringify(homePassNetwork) : null,
					awayPassNetwork ? JSON.stringify(awayPassNetwork) : null,
					gameId,
				],
			)
		: await queryOne(
				`UPDATE games SET match_stats = $1, ${imageColumn} = $2 WHERE id = $3 RETURNING *`,
				[JSON.stringify(mergedStats), imageUrl, gameId],
			);

	if (!data) {
		const err = new Error("Game not found");
		err.statusCode = 404;
		throw err;
	}

	return data;
}

/**
 * Best-effort delete of the original screenshot in Firebase Storage
 * after a successful extraction + DB write. The Anthropic call only
 * reads the image once (via signed download URL), and the frontend
 * uses `{type}_image_url` solely as a truthy "stats present" flag —
 * so the underlying object is dead weight from this point on.
 *
 * Errors are deliberately swallowed: if the delete fails (network
 * blip, missing object, permission issue), the stats are still
 * correctly stored and the user sees the right UI. The orphan object
 * can be cleaned up later by a sweeper or just left in the bucket.
 *
 * @param {string} gameId - Game UUID
 * @param {"overview"|"passes"|"defense"} type - Screenshot type
 * @returns {Promise<void>}
 * @example
 * await deleteMatchStatsImage("abc-123", "passes");
 */
export async function deleteMatchStatsImage(gameId, type) {
	try {
		const bucket = getStorageBucket();
		await bucket.file(`match-stats/${gameId}/${type}.jpg`).delete();
	} catch {
		// Intentional no-op — see JSDoc above.
	}
}

/**
 * Helpers exported only for unit-testing the split logic in
 * isolation. Not part of the public service API.
 */
export const __test__ = { splitPassesExtraction };

/**
 * Removes match stats from a game (for re-upload)
 * @param {string} gameId - Game UUID
 * @returns {Promise<object>} Updated game record
 */
export async function deleteMatchStats(gameId) {
	const data = await queryOne(
		`UPDATE games SET match_stats = NULL,
		    stats_image_url = NULL,
		    passes_image_url = NULL,
		    defense_image_url = NULL,
		    home_pass_network = NULL,
		    away_pass_network = NULL
		WHERE id = $1 RETURNING *`,
		[gameId],
	);

	if (!data) {
		const err = new Error("Game not found");
		err.statusCode = 404;
		throw err;
	}

	return data;
}
