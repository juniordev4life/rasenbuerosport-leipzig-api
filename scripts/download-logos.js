#!/usr/bin/env node

/**
 * Downloads all team logos from sofifa CDN and uploads them to Supabase Storage.
 * Then updates the logo_url in the teams table to point to the Supabase URL.
 *
 * Run: node scripts/download-logos.js
 *
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
	process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false },
});

const BUCKET = "team-logos";
const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Ensures the storage bucket exists
 */
async function ensureBucket() {
	const { data: buckets } = await supabase.storage.listBuckets();
	const exists = buckets?.some((b) => b.name === BUCKET);

	if (!exists) {
		const { error } = await supabase.storage.createBucket(BUCKET, {
			public: true,
			fileSizeLimit: 1024 * 1024, // 1 MB
			allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
		});
		if (error) {
			console.error("Failed to create bucket:", error.message);
			process.exit(1);
		}
		console.log(`Created bucket "${BUCKET}"`);
	} else {
		console.log(`Bucket "${BUCKET}" exists`);
	}
}

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
 * Uploads image to Supabase Storage
 * @param {string} path - File path in bucket (e.g., "503.png")
 * @param {Buffer} data - Image data
 * @returns {Promise<string|null>} Public URL or null
 */
async function uploadToStorage(path, data) {
	const { error } = await supabase.storage.from(BUCKET).upload(path, data, {
		contentType: "image/png",
		upsert: true,
	});

	if (error) {
		console.error(`  Upload error for ${path}:`, error.message);
		return null;
	}

	const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

	return urlData?.publicUrl || null;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
	const inputPath = join(import.meta.dirname, "scraped-teams.json");
	const leagues = JSON.parse(readFileSync(inputPath, "utf-8"));

	// Collect all unique logos (some teams might share CDN IDs)
	const logoMap = new Map();
	for (const league of leagues) {
		for (const team of league.teams) {
			if (team.logo_url) {
				// Extract the CDN team ID from URL: https://cdn.sofifa.net/meta/team/{ID}/120.png
				const match = team.logo_url.match(/\/team\/(\d+)\//);
				if (match) {
					logoMap.set(match[1], { cdnUrl: team.logo_url, teamName: team.name });
				}
			}
		}
	}

	console.log(`Found ${logoMap.size} unique logos to download\n`);

	await ensureBucket();

	let downloaded = 0;
	let failed = 0;
	const publicUrls = new Map(); // cdnId -> publicUrl

	const entries = [...logoMap.entries()];

	// Process in batches of 10 to be nice to the CDN
	const BATCH_SIZE = 10;
	for (let i = 0; i < entries.length; i += BATCH_SIZE) {
		const batch = entries.slice(i, i + BATCH_SIZE);

		const results = await Promise.all(
			batch.map(async ([cdnId, { cdnUrl, teamName }]) => {
				const imageData = await downloadImage(cdnUrl);
				if (!imageData) {
					console.error(`  Failed to download: ${teamName} (${cdnUrl})`);
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
	let updated = 0;

	for (const league of leagues) {
		for (const team of league.teams) {
			if (!team.logo_url) continue;

			const match = team.logo_url.match(/\/team\/(\d+)\//);
			if (!match) continue;

			const cdnId = match[1];
			const publicUrl = publicUrls.get(cdnId);
			if (!publicUrl) continue;

			const { error } = await supabase
				.from("teams")
				.update({ logo_url: publicUrl })
				.eq("sofifa_id", team.sofifa_id);

			if (error) {
				console.error(`  DB update error for ${team.name}:`, error.message);
			} else {
				updated++;
			}
		}
	}

	console.log(`Updated ${updated} teams with new logo URLs`);
	console.log("Done!");
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
