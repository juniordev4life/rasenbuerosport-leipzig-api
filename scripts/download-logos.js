#!/usr/bin/env node

/**
 * Downloads all team logos from sofifa CDN and uploads them to Google Cloud Storage.
 * Then updates the logo_url in the teams table to point to the public GCS URL.
 *
 * Run:
 *   cloud-sql-proxy rasenbuerosport-leipzig-9d54f:europe-west3:rasenbuerosport-db --port=5433 &
 *   DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:5433/rasenbuerosport" node scripts/download-logos.js
 *
 * Requires:
 *   - DATABASE_URL env var
 *   - gcloud auth (Application Default Credentials)
 *   - GCS bucket: rasenbuerosport-leipzig-9d54f.firebasestorage.app (or STORAGE_BUCKET env var)
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Storage } from "@google-cloud/storage";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const BUCKET_NAME =
	process.env.STORAGE_BUCKET || "rasenbuerosport-leipzig-9d54f.firebasestorage.app";
const LOGO_PREFIX = "team-logos";

if (!DATABASE_URL) {
	console.error("Missing DATABASE_URL in environment");
	process.exit(1);
}

const pool = new Pool({
	connectionString: DATABASE_URL,
	max: 5,
	connectionTimeoutMillis: 10000,
});

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Downloads an image from sofifa CDN
 * @param {string} url
 * @returns {Promise<Buffer|null>}
 */
async function downloadImage(url) {
	try {
		const res = await fetch(url, {
			headers: {
				"User-Agent": USER_AGENT,
				Referer: "https://sofifa.com/",
			},
		});
		if (!res.ok) return null;
		return Buffer.from(await res.arrayBuffer());
	} catch {
		return null;
	}
}

/**
 * Uploads image to Google Cloud Storage
 * @param {string} fileName - File name in bucket (e.g., "503.png")
 * @param {Buffer} data - Image data
 * @returns {Promise<string|null>} Public URL or null
 */
async function uploadToStorage(fileName, data) {
	try {
		const file = bucket.file(`${LOGO_PREFIX}/${fileName}`);
		await file.save(data, {
			contentType: "image/png",
			resumable: false,
			metadata: {
				cacheControl: "public, max-age=31536000",
			},
		});

		return `https://storage.googleapis.com/${BUCKET_NAME}/${LOGO_PREFIX}/${fileName}`;
	} catch (err) {
		console.error(`  Upload error for ${fileName}:`, err.message);
		return null;
	}
}

// ── Main ────────────────────────────────────────────────────────────

const inputPath = join(import.meta.dirname, "scraped-teams.json");
const leagues = JSON.parse(readFileSync(inputPath, "utf-8"));

// Collect all unique logos
const logoMap = new Map();
for (const league of leagues) {
	for (const team of league.teams) {
		if (team.logo_url) {
			const match = team.logo_url.match(/\/team\/(\d+)\//);
			if (match) {
				logoMap.set(match[1], { cdnUrl: team.logo_url, teamName: team.name });
			}
		}
	}
}

console.log(`Found ${logoMap.size} unique logos to download\n`);

let downloaded = 0;
let failed = 0;
const publicUrls = new Map();

const entries = [...logoMap.entries()];

// Process in batches of 10
const BATCH_SIZE = 10;
for (let i = 0; i < entries.length; i += BATCH_SIZE) {
	const batch = entries.slice(i, i + BATCH_SIZE);

	await Promise.all(
		batch.map(async ([cdnId, { cdnUrl, teamName }]) => {
			const imageData = await downloadImage(cdnUrl);
			if (!imageData) {
				console.error(`  ✗ Download failed: ${teamName} (${cdnUrl})`);
				failed++;
				return;
			}

			const publicUrl = await uploadToStorage(`${cdnId}.png`, imageData);
			if (publicUrl) {
				publicUrls.set(cdnId, publicUrl);
				downloaded++;
			} else {
				failed++;
			}
		}),
	);

	const progress = Math.min(i + BATCH_SIZE, entries.length);
	console.log(
		`  Progress: ${progress}/${entries.length} (${downloaded} ok, ${failed} failed)`,
	);

	// Small delay between batches
	if (i + BATCH_SIZE < entries.length) {
		await new Promise((r) => setTimeout(r, 200));
	}
}

console.log(`\nDownloaded: ${downloaded}, Failed: ${failed}\n`);

// Update logo_url in DB for all teams
console.log("Updating logo_url in database...\n");

const client = await pool.connect();
let updated = 0;

try {
	await client.query("BEGIN");

	for (const league of leagues) {
		for (const team of league.teams) {
			if (!team.logo_url) continue;

			const match = team.logo_url.match(/\/team\/(\d+)\//);
			if (!match) continue;

			const cdnId = match[1];
			const publicUrl = publicUrls.get(cdnId);
			if (!publicUrl) continue;

			await client.query(
				"UPDATE teams SET logo_url = $1 WHERE sofifa_id = $2",
				[publicUrl, team.sofifa_id],
			);
			updated++;
		}
	}

	await client.query("COMMIT");
	console.log(`Updated ${updated} teams with new logo URLs`);
	console.log("Done!");
} catch (err) {
	await client.query("ROLLBACK");
	console.error("DB update failed, rolled back:", err.message);
} finally {
	client.release();
	await pool.end();
}
