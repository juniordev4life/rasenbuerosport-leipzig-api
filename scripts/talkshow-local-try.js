/**
 * Local one-shot talk-show generator. Runs the same two-step
 * pipeline the production cron triggers — Claude script + ElevenLabs
 * multi-speaker mp3 — but against your local Postgres + Firebase
 * Storage so you can iterate on prompt / pacing / voice tuning
 * without paying the round-trip through the cron / Cloud Run.
 *
 * Usage:
 *   npm run talkshow:try-local                 # current week
 *   npm run talkshow:try-local -- 2026-05-25   # any day inside the target week
 *
 * What you get:
 *   1. talkshow_episodes row in the local DB (UPSERT on week_start).
 *   2. mp3 uploaded to the SAME Firebase Storage bucket as PROD
 *      (`talkshow/<week_start>.mp3`). Be aware: running this for the
 *      live PROD week WILL overwrite the file the cron wrote. Content
 *      regenerates from the same Wrapped data, so usually harmless —
 *      but worth knowing before you go nuts on iterations.
 *   3. The Firebase URL printed at the end, plus an afplay one-liner
 *      so you can listen straight away.
 *
 * Env requirements (all already in .env if the dev API runs):
 *   DATABASE_URL                    → local Docker Postgres
 *   ANTHROPIC_API_KEY               → Claude script
 *   ELEVENLABS_API_KEY              → TTS
 *   ELEVENLABS_VOICE_ID_KLASSIKER   → Marcel
 *   ELEVENLABS_VOICE_ID_ANALYST     → Sophie
 *   ELEVENLABS_VOICE_ID_EUPHORIKER  → Frank
 *   ELEVENLABS_MODEL_ID             → e.g. eleven_multilingual_v2
 *   FIREBASE_STORAGE_BUCKET         → bucket name (no gs:// prefix)
 */

import "dotenv/config";
import { generateAndPersistEpisode } from "../src/api/services/talkshow.services.js";
import { renderEpisodeAudio } from "../src/api/services/talkshowAudio.services.js";

const arg = process.argv[2];
const reference = arg ? new Date(arg) : new Date();
if (Number.isNaN(reference.getTime())) {
	console.error(`✗ Bad date arg: "${arg}" — pass an ISO date like 2026-05-25.`);
	process.exit(1);
}

console.log(
	`▸ Building context for the week containing ${reference.toISOString().slice(0, 10)}`,
);

const episode = await generateAndPersistEpisode(reference);
const weekStart =
	typeof episode.week_start === "string"
		? episode.week_start
		: episode.week_start.toISOString().slice(0, 10);
const turnCount = episode.script_json?.turns?.length ?? "?";
const summary = episode.script_json?.summary ?? {};

console.log(
	`▸ Drehbuch persisted: week_start=${weekStart}, turns=${turnCount}`,
);
if (summary.per_speaker) {
	console.log("  Per-speaker word counts:");
	for (const [who, words] of Object.entries(summary.per_speaker)) {
		console.log(`    ${who.padEnd(8)} ${words}`);
	}
}

console.log(
	"▸ Rendering audio (this takes 2–5 minutes — ElevenLabs is sequential)…",
);
try {
	const audioUrl = await renderEpisodeAudio(weekStart);
	console.log(`\n✓ audio_url:\n  ${audioUrl}`);
	console.log("\nQuick listen:");
	console.log(
		`  curl -s "${audioUrl}" -o /tmp/talkshow-local.mp3 && afplay /tmp/talkshow-local.mp3`,
	);
	console.log(
		"\nOr in the app: start `npm run dev` in rasenbuerosport-leipzig-app and open /app/dashboard — Talkrunde-Card pulls the latest episode from the local API.",
	);
} catch (error) {
	console.error(`\n✗ Audio render failed: ${error?.message ?? error}`);
	console.error(
		"  Drehbuch is already in the DB; rerun with the same week to retry just the audio step.",
	);
	process.exit(1);
}
process.exit(0);
