#!/usr/bin/env node

/**
 * Imports scraped SoFIFA team data into Cloud SQL PostgreSQL.
 *
 * - Reads scraped-teams.json (output of parse-sofifa-leagues.js)
 * - Matches each team, in order:
 *     1. by sofifa_id — the stable SoFIFA identity. The existing name is KEPT:
 *        games store team names as text (game_players.team_name,
 *        games.home_team_name / away_team_name), so a rename would orphan the
 *        team's history and crest. SoFIFA does rename clubs between editions
 *        (FC27: "Arsenal" → "Arsenal FC", "Inter" → "Inter Milan").
 *     2. by name — a row without that sofifa_id adopts it (legacy rows).
 *     3. otherwise the team is inserted.
 * - All-or-nothing: the first failing row rolls back the whole import and the
 *   script exits non-zero, so update-teams.js stops before touching logos.
 * - Teams missing from the scrape are left unchanged, never deleted.
 *
 * Run:
 *   npm run db:proxy   # in another terminal
 *   bash scripts/with-prod-db.sh node scripts/import-teams.js --dry-run
 *   bash scripts/with-prod-db.sh node scripts/import-teams.js
 *
 * --dry-run runs every statement and prints the summary, then rolls back.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes("--dry-run");

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
 * Only consulted for teams that are not matched by sofifa_id.
 */
const NAME_MAP = {
	"FC Bayern München": "Bayern München",
	"TSG 1899 Hoffenheim": "TSG Hoffenheim",
	"SV Werder Bremen": "Werder Bremen",
	"1. FC Heidenheim 1846": "1. FC Heidenheim",
};

const UPDATE_BY_SOFIFA_ID = `
	UPDATE teams SET
	  logo_url = $2, overall_rating = $3, star_rating = $4, league_name = $5, country_code = $6
	WHERE sofifa_id = $1
	RETURNING name`;

const UPSERT_BY_NAME = `
	INSERT INTO teams (sofifa_id, logo_url, overall_rating, star_rating, league_name, country_code, name)
	VALUES ($1, $2, $3, $4, $5, $6, $7)
	ON CONFLICT (name) DO UPDATE SET
	  sofifa_id = EXCLUDED.sofifa_id,
	  logo_url = EXCLUDED.logo_url,
	  overall_rating = EXCLUDED.overall_rating,
	  star_rating = EXCLUDED.star_rating,
	  league_name = EXCLUDED.league_name,
	  country_code = EXCLUDED.country_code
	RETURNING (xmax = 0) AS inserted`;

/**
 * Writes one scraped team, preferring the sofifa_id match (see file header).
 * @param {pg.PoolClient} client - Client inside the import transaction
 * @param {object} row - Scraped team with league metadata
 * @returns {Promise<{ outcome: "updated"|"adopted"|"inserted", keptName?: string }>} What happened to the row
 * @example
 * await importTeam(client, { name: "Arsenal FC", sofifa_id: 1, ... });
 * // { outcome: "updated", keptName: "Arsenal" }
 */
async function importTeam(client, row) {
	const values = [
		row.sofifa_id,
		row.logo_url,
		row.overall_rating,
		row.star_rating,
		row.league_name,
		row.country_code,
	];

	const byId = await client.query(UPDATE_BY_SOFIFA_ID, values);
	if (byId.rowCount > 0) {
		const dbName = byId.rows[0].name;
		return {
			outcome: "updated",
			keptName: dbName !== row.name ? dbName : undefined,
		};
	}

	const name = NAME_MAP[row.name] || row.name;
	const { rows } = await client.query(UPSERT_BY_NAME, [...values, name]);
	return { outcome: rows[0].inserted ? "inserted" : "adopted" };
}

// ── Main ────────────────────────────────────────────────────────────

const inputPath = join(import.meta.dirname, "scraped-teams.json");
const leagues = JSON.parse(readFileSync(inputPath, "utf-8"));

// Flatten all teams with league/country metadata
const rows = leagues.flatMap((league) =>
	league.teams.map((team) => ({
		...team,
		league_name: league.league_name,
		country_code: league.country_code,
	})),
);

console.log(
	`${DRY_RUN ? "[dry run] " : ""}Importing ${rows.length} teams from ${leagues.length} leagues\n`,
);

const client = await pool.connect();
const counts = { updated: 0, adopted: 0, inserted: 0 };
const keptNames = [];
const insertedNames = [];

try {
	await client.query("BEGIN");

	for (const row of rows) {
		const { outcome, keptName } = await importTeam(client, row);
		counts[outcome]++;
		if (keptName) keptNames.push(`${keptName} (SoFIFA: ${row.name})`);
		if (outcome === "inserted")
			insertedNames.push(`${row.name} [${row.league_name}]`);
	}

	const { rows: countRows } = await client.query(
		"SELECT COUNT(*) AS count FROM teams",
	);

	await client.query(DRY_RUN ? "ROLLBACK" : "COMMIT");

	console.log(`Updated by sofifa_id: ${counts.updated}`);
	console.log(`Matched by name (adopted sofifa_id): ${counts.adopted}`);
	console.log(`Inserted: ${counts.inserted}`);
	if (insertedNames.length) console.log(`  ${insertedNames.join("\n  ")}`);
	console.log(
		`Kept existing name despite a SoFIFA rename: ${keptNames.length}`,
	);
	if (keptNames.length) console.log(`  ${keptNames.join("\n  ")}`);
	console.log(
		`\n${DRY_RUN ? "Dry run — rolled back. Would leave" : "Done! Total"} teams in DB: ${countRows[0].count}`,
	);
} catch (err) {
	await client.query("ROLLBACK");
	console.error("Import failed, rolled back:", err.message);
	process.exitCode = 1;
} finally {
	client.release();
	await pool.end();
}
