#!/usr/bin/env node

/**
 * Updates all team logo_urls from sofifa CDN to Firebase Storage URLs.
 *
 * Extracts the CDN team ID from the current logo_url and maps it to:
 * https://firebasestorage.googleapis.com/v0/b/BUCKET/o/team-logos%2F{ID}.png?alt=media
 *
 * Run:
 *   cloud-sql-proxy rasenbuerosport-leipzig-9d54f:europe-west3:rasenbuerosport-db --port=5433 &
 *   DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:5433/rasenbuerosport" node scripts/update-logo-urls.js
 */

import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const BUCKET = "rasenbuerosport-leipzig-9d54f.firebasestorage.app";

if (!DATABASE_URL) {
	console.error("Missing DATABASE_URL in environment");
	process.exit(1);
}

const pool = new Pool({
	connectionString: DATABASE_URL,
	max: 5,
	connectionTimeoutMillis: 10000,
});

const client = await pool.connect();

try {
	// Get all teams with sofifa CDN or old Supabase logo URLs
	const { rows: teams } = await client.query(
		"SELECT id, name, logo_url FROM teams WHERE logo_url IS NOT NULL",
	);

	console.log(`Found ${teams.length} teams with logo URLs\n`);

	await client.query("BEGIN");

	let updated = 0;
	let skipped = 0;

	for (const team of teams) {
		// Extract CDN ID from sofifa URL: /team/{ID}/120.png
		let cdnId = null;
		const sofifaMatch = team.logo_url.match(/\/team\/(\d+)\//);
		if (sofifaMatch) {
			cdnId = sofifaMatch[1];
		}

		// Or from old Supabase URL: /team-logos/{ID}.png
		if (!cdnId) {
			const supabaseMatch = team.logo_url.match(/\/team-logos\/(\d+)\.png/);
			if (supabaseMatch) {
				cdnId = supabaseMatch[1];
			}
		}

		if (!cdnId) {
			console.log(`  ⏭ ${team.name}: no CDN ID found in ${team.logo_url}`);
			skipped++;
			continue;
		}

		const newUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/team-logos%2F${cdnId}.png?alt=media`;

		await client.query("UPDATE teams SET logo_url = $1 WHERE id = $2", [
			newUrl,
			team.id,
		]);
		updated++;
	}

	await client.query("COMMIT");
	console.log(`\nDone! ${updated} updated, ${skipped} skipped`);
} catch (err) {
	await client.query("ROLLBACK");
	console.error("Failed, rolled back:", err.message);
} finally {
	client.release();
	await pool.end();
}
