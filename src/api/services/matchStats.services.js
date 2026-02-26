import { getSupabaseAdmin } from "../../config/supabase.config.js";
import { getAnthropicClient } from "../../config/anthropic.config.js";

const EXTRACTION_PROMPT = `You are analyzing a post-match statistics screen from EA Sports FC (FC25/FC26).

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

/**
 * Extracts match stats from an FC26 screenshot via Claude Vision API
 * @param {string} imageUrl - Public URL of the uploaded screenshot
 * @returns {Promise<object>} Extracted stats object
 */
export async function extractStatsFromImage(imageUrl) {
	const client = getAnthropicClient();

	const response = await client.messages.create({
		model: "claude-sonnet-4-20250514",
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
						text: EXTRACTION_PROMPT,
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
 * Stores extracted match stats and image URL for a game
 * @param {string} gameId - Game UUID
 * @param {object} matchStats - Extracted stats JSON
 * @param {string} imageUrl - Supabase Storage URL of the screenshot
 * @returns {Promise<object>} Updated game record
 */
export async function saveMatchStats(gameId, matchStats, imageUrl) {
	const supabase = getSupabaseAdmin();

	const { data, error } = await supabase
		.from("games")
		.update({
			match_stats: matchStats,
			stats_image_url: imageUrl,
		})
		.eq("id", gameId)
		.select()
		.single();

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	return data;
}

/**
 * Removes match stats from a game (for re-upload)
 * @param {string} gameId - Game UUID
 * @returns {Promise<object>} Updated game record
 */
export async function deleteMatchStats(gameId) {
	const supabase = getSupabaseAdmin();

	const { data, error } = await supabase
		.from("games")
		.update({
			match_stats: null,
			stats_image_url: null,
		})
		.eq("id", gameId)
		.select()
		.single();

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	return data;
}
