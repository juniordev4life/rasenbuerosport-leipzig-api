#!/usr/bin/env node

/**
 * Imports scraped FC 26 team data into Supabase.
 *
 * - Reads scraped-teams.json (output of parse-sofifa-leagues.js)
 * - Maps sofifa names to existing DB names where they differ
 * - Upserts all teams via onConflict('name') to preserve existing UUIDs
 *
 * Run: node scripts/import-teams.js
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

/** Create a fresh admin client (bypasses RLS) */
function freshClient() {
	return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
		auth: { autoRefreshToken: false, persistSession: false },
	});
}

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

async function importTeams() {
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

	console.log(
		`Importing ${rows.length} teams from ${leagues.length} leagues\n`,
	);

	const supabase = freshClient();

	// Upsert in batches of 50 to avoid payload limits
	const BATCH_SIZE = 50;
	let inserted = 0;
	let updated = 0;
	let errors = 0;

	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE);

		const { data, error } = await supabase
			.from("teams")
			.upsert(batch, { onConflict: "name" })
			.select("id, name");

		if (error) {
			console.error(
				`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`,
				error.message,
			);
			errors += batch.length;
			continue;
		}

		const count = data?.length || 0;
		inserted += count;
		console.log(
			`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${count} teams upserted`,
		);
	}

	console.log(`\nDone! ${inserted} teams upserted, ${errors} errors`);

	// Verify counts
	const { count } = await supabase
		.from("teams")
		.select("*", { count: "exact", head: true });

	console.log(`Total teams in DB: ${count}`);
}

importTeams().catch((err) => {
	console.error("Import failed:", err);
	process.exit(1);
});
