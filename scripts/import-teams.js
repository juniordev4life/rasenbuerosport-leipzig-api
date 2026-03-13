#!/usr/bin/env node

/**
 * Imports scraped FC 26 team data into Cloud SQL PostgreSQL.
 *
 * - Reads scraped-teams.json (output of parse-sofifa-leagues.js)
 * - Maps sofifa names to existing DB names where they differ
 * - Upserts all teams via ON CONFLICT (name) to preserve existing UUIDs
 *
 * Run:
 *   cloud-sql-proxy rasenbuerosport-leipzig-9d54f:europe-west3:rasenbuerosport-db --port=5433 &
 *   DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:5433/rasenbuerosport" node scripts/import-teams.js
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
	console.error("Missing DATABASE_URL in environment");
	process.exit(1);
}

const pool = new Pool({
	connectionString: DATABASE_URL,
	max: 5,
	connectionTimeoutMillis: 10000,
});

/**
 * Map sofifa team names to existing DB names where they differ.
 * Existing Bundesliga teams keep their current names/UUIDs.
 */
const NAME_MAP = {
	"FC Bayern München": "Bayern München",
	"TSG 1899 Hoffenheim": "TSG Hoffenheim",
	"SV Werder Bremen": "Werder Bremen",
	"1. FC Heidenheim 1846": "1. FC Heidenheim",
};

// ── Main ────────────────────────────────────────────────────────────

const inputPath = join(import.meta.dirname, "scraped-teams.json");
const leagues = JSON.parse(readFileSync(inputPath, "utf-8"));

// Flatten all teams with league/country metadata
const rows = [];
for (const league of leagues) {
	for (const team of league.teams) {
		const name = NAME_MAP[team.name] || team.name;
		rows.push({
			name,
			logo_url: team.logo_url,
			sofifa_id: team.sofifa_id,
			overall_rating: team.overall_rating,
			star_rating: team.star_rating,
			league_name: league.league_name,
			country_code: league.country_code,
		});
	}
}

console.log(`Importing ${rows.length} teams from ${leagues.length} leagues\n`);

const client = await pool.connect();
let inserted = 0;
let errors = 0;

try {
	await client.query("BEGIN");

	for (const row of rows) {
		try {
			await client.query(
				`INSERT INTO teams (name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)
				 ON CONFLICT (name) DO UPDATE SET
				   logo_url = EXCLUDED.logo_url,
				   sofifa_id = EXCLUDED.sofifa_id,
				   overall_rating = EXCLUDED.overall_rating,
				   star_rating = EXCLUDED.star_rating,
				   league_name = EXCLUDED.league_name,
				   country_code = EXCLUDED.country_code`,
				[
					row.name,
					row.logo_url,
					row.sofifa_id,
					row.overall_rating,
					row.star_rating,
					row.league_name,
					row.country_code,
				],
			);
			inserted++;
		} catch (err) {
			console.error(`  ✗ ${row.name}: ${err.message}`);
			errors++;
		}
	}

	await client.query("COMMIT");

	// Log per-league summary
	for (const league of leagues) {
		console.log(
			`✓ ${league.country_code} - ${league.league_name}: ${league.teams.length} teams`,
		);
	}

	console.log(`\nDone! ${inserted} teams upserted, ${errors} errors`);

	// Verify count
	const { rows: countRows } = await client.query(
		"SELECT COUNT(*) as count FROM teams",
	);
	console.log(`Total teams in DB: ${countRows[0].count}`);
} catch (err) {
	await client.query("ROLLBACK");
	console.error("Import failed, rolled back:", err.message);
} finally {
	client.release();
	await pool.end();
}
