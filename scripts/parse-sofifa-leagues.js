#!/usr/bin/env node

/**
 * Parses saved SoFIFA league pages and extracts team data.
 *
 * Input:  `liga {id}.html` (page source) or `liga {id}.rtf` (older RTF copy)
 *         files from /Users/mslusalek/Projects/private/ligen/, where {id} is
 *         the SoFIFA league id (https://sofifa.com/league/{id})
 * Output: scripts/scraped-teams.json
 *
 * Fails without writing the output when a league yields no teams — that is
 * what a SoFIFA markup change looks like, and importing it would silently
 * keep the old ratings.
 *
 * Run: node scripts/parse-sofifa-leagues.js
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	LEAGUE_NAMES,
	parseLeaguePage,
	toLeaguePageHtml,
} from "./lib/sofifaParser.utils.js";

const LIGEN_DIR = "/Users/mslusalek/Projects/private/ligen";
const LEAGUE_FILE = /^liga (\d+)\.(?:html|rtf)$/;

// ── Main ────────────────────────────────────────────────────────────

const files = readdirSync(LIGEN_DIR).filter((f) => LEAGUE_FILE.test(f));

console.log(`Found ${files.length} league files\n`);

if (files.length === 0) {
	console.error(
		`✗ No "liga {id}.html" or "liga {id}.rtf" files in ${LIGEN_DIR}`,
	);
	process.exit(1);
}

const allLeagues = [];
const failures = [];
let totalTeams = 0;

for (const file of files) {
	const leagueId = parseInt(file.match(LEAGUE_FILE)[1], 10);
	const raw = readFileSync(join(LIGEN_DIR, file), "utf-8");
	const { league_name, country, country_code, teams } = parseLeaguePage(
		toLeaguePageHtml(raw, file),
	);
	const league = {
		league_id: leagueId,
		league_name: LEAGUE_NAMES[leagueId] ?? league_name,
		country,
		country_code,
		teams,
	};

	if (allLeagues.some((l) => l.league_id === leagueId)) {
		failures.push(
			`${file}: league ${leagueId} is saved twice (.html and .rtf)`,
		);
	}
	if (league.teams.length === 0) failures.push(`${file}: no teams found`);
	if (!league.country_code) {
		console.warn(`⚠ ${file}: no country code for "${league.country}"`);
	}

	allLeagues.push(league);
	totalTeams += league.teams.length;

	const status = league.teams.length > 0 ? "✓" : "✗ NO TEAMS";
	console.log(
		`${status} ${league.country} - ${league.league_name}: ${league.teams.length} teams (ID ${leagueId})`,
	);
}

if (failures.length > 0) {
	console.error(`\n✗ Not writing output:\n  ${failures.join("\n  ")}`);
	process.exit(1);
}

// Sort by league_id
allLeagues.sort((a, b) => a.league_id - b.league_id);

const outputPath = join(import.meta.dirname, "scraped-teams.json");

writeFileSync(outputPath, JSON.stringify(allLeagues, null, 2), "utf-8");

console.log(`\nTotal: ${totalTeams} teams across ${allLeagues.length} leagues`);
console.log(`Written to: ${outputPath}`);
