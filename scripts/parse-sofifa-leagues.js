#!/usr/bin/env node

/**
 * Parses saved SoFIFA league RTF files and extracts team data.
 *
 * Input:  RTF files from /Users/mslusalek/Projects/private/ligen/
 * Output: scripts/scraped-teams.json
 *
 * Run: node scripts/parse-sofifa-leagues.js
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LIGEN_DIR = "/Users/mslusalek/Projects/private/ligen";

/** Map German country names (from sofifa title) to ISO country codes */
const COUNTRY_CODE_MAP = {
	Argentinien: "AR",
	Aserbaidschan: "AZ",
	Australien: "AU",
	Belgien: "BE",
	Bolivien: "BO",
	Brasilien: "BR",
	Bulgarien: "BG",
	Chile: "CL",
	"China VR": "CN",
	Deutschland: "DE",
	Dänemark: "DK",
	Ecuador: "EC",
	England: "GB-ENG",
	Finnland: "FI",
	Frankreich: "FR",
	Griechenland: "GR",
	Indien: "IN",
	Irland: "IE",
	Israel: "IL",
	Italien: "IT",
	Kolumbien: "CO",
	"Korea, Republik": "KR",
	Kroatien: "HR",
	Mexiko: "MX",
	Niederlande: "NL",
	Norwegen: "NO",
	Paraguay: "PY",
	Peru: "PE",
	Polen: "PL",
	Portugal: "PT",
	"Republik Irland": "IE",
	Rumänien: "RO",
	Russland: "RU",
	"Saudi-Arabien": "SA",
	Schottland: "GB-SCT",
	Schweden: "SE",
	Schweiz: "CH",
	Serbien: "RS",
	Spanien: "ES",
	Südafrika: "ZA",
	"Tschechische Republik": "CZ",
	"Tschechische Repub.": "CZ",
	Tschechien: "CZ",
	Türkei: "TR",
	Ukraine: "UA",
	Ungarn: "HU",
	Uruguay: "UY",
	USA: "US",
	"V.A. Emirate": "AE",
	Venezuela: "VE",
	"Vereinigte Staaten": "US",
	Zypern: "CY",
	Österreich: "AT",
};

/**
 * Decode RTF special character escapes to proper Unicode.
 * Handles \'XX hex escapes and \uNNNN unicode escapes.
 * @param {string} text
 * @returns {string}
 */
function decodeRtf(text) {
	// Remove \uc0 prefix (unicode char count = 0, no replacement char follows)
	let decoded = text.replace(/\\uc0\s?/g, "");

	// Replace \'XX hex escapes (ISO 8859-1 / Windows-1252)
	decoded = decoded.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
		const code = parseInt(hex, 16);
		return String.fromCharCode(code);
	});

	// Replace \uNNNN unicode escapes — with optional replacement char (? or space)
	decoded = decoded.replace(/\\u(\d+)\s?\??/g, (_, code) =>
		String.fromCodePoint(parseInt(code, 10)),
	);

	return decoded;
}

/**
 * Extracts league name and country from the <title> tag.
 * Format: "Country - League Name - FC 26 - DATE | SoFIFA"
 * @param {string} content - raw RTF content
 * @returns {{ country: string, leagueName: string }}
 */
function extractLeagueInfo(content) {
	const titleMatch = content.match(/<title>([^<]+)<\/title>/);
	if (!titleMatch) return { country: "", leagueName: "" };

	const title = decodeRtf(titleMatch[1]);
	// Split "Country - League Name - FC 26 - ..."
	const parts = title.split(" - ");
	return {
		country: parts[0]?.trim() || "",
		leagueName: parts[1]?.trim() || "",
	};
}

/**
 * Counts stars in a team data string.
 * Full star path starts with "M12 17.27", half star contains "V6.1"
 * @param {string} teamBlock
 * @returns {number}
 */
function countStars(teamBlock) {
	const starMatches = teamBlock.match(/class="star"><path d="([^"]*)"/g) || [];
	let stars = 0;

	for (const match of starMatches) {
		if (match.includes("M12 17.27")) {
			stars += 1.0; // full star
		} else if (match.includes("V6.1")) {
			stars += 0.5; // half star
		}
		// empty stars (outline only) contribute 0
	}

	return stars;
}

/**
 * Strips RTF formatting to extract clean HTML-like content.
 * Removes RTF field wrappers, formatting codes, and cell boundaries.
 * @param {string} rtf
 * @returns {string}
 */
function stripRtf(rtf) {
	let text = rtf.replace(/\r?\n/g, "");

	// Remove RTF field wrappers for HYPERLINKs:
	// {\field{\*\fldinst{HYPERLINK "URL"}}{\fldrslt \cf3 \ul \ulc3 \strokec3 DISPLAY}} → URL
	// But we need to keep the href="URL" structure, so replace the whole field with just the URL
	text = text.replace(
		/\{\\field\{\\\*\\fldinst\{HYPERLINK "([^"]*)"\}\}\{\\fldrslt[^}]*\}\}/g,
		"$1",
	);

	// Remove remaining RTF control words (e.g. \cf2, \cell, \row, \pard..., \itap1, etc.)
	text = text.replace(
		/\\(itap\d|trowd|taflags\d|trgaph\d+|trleft-?\d+|trbrdrt|trbrdrl|trbrdrr|trbrdrb|brdrnil|clvertalc|clshdrawnil|clwWidth\d+|clftsWidth\d|clmart\d+|clmarl\d+|clmarb\d+|clmarr\d+|clbrdrt|clbrdrl|clbrdrb|clbrdrr|clpadt\d+|clpadl\d+|clpadb\d+|clpadr\d+|gaph|cellx\d+|pard|intbl|pardeftab\d+|partightenfactor\d|cf\d+|expnd\d|expndtw\d|kerning\d|outl\d|strokewidth\d|strokec\d|ul |ulc\d|f\d+ |fs\d+)\s?/g,
		"",
	);

	// Remove \cell \row markers
	text = text.replace(/\\cell\s*/g, "");
	text = text.replace(/\\row\s*/g, "");

	return text;
}

/**
 * Parses a single RTF league file and extracts all teams.
 * @param {string} filePath
 * @param {number} leagueId
 * @returns {{ league_id: number, league_name: string, country: string, country_code: string, teams: object[] }}
 */
function parseLeagueFile(filePath, leagueId) {
	const raw = readFileSync(filePath, "utf-8");
	const content = raw.replace(/\r?\n/g, "");

	const { country, leagueName } = extractLeagueInfo(content);
	const countryCode = COUNTRY_CODE_MAP[country] || "";

	// Strip RTF to get cleaner content for regex matching
	const clean = stripRtf(content);

	// Step 1: Find all team logo images → extract logo IDs
	// data-src="https://cdn.sofifa.net/meta/team/{LOGO_ID}/60.png"
	const logoRegex =
		/data-src="https:\/\/cdn\.sofifa\.net\/meta\/team\/(\d+)\/60\.png"/g;
	const logoPositions = [];
	let logoMatch;
	// biome-ignore lint/suspicious/noAssignInExpressions: regex exec pattern
	while ((logoMatch = logoRegex.exec(clean)) !== null) {
		logoPositions.push({ logoId: logoMatch[1], index: logoMatch.index });
	}

	// Step 2: For each logo, find the team link and rating that follows
	const teams = [];
	for (const { logoId, index } of logoPositions) {
		// Look at the next ~2000 chars after the logo for the team data
		const block = clean.substring(index, index + 2000);

		// Team URL and name: /team/{SOFIFA_ID}/{slug}/">TEAM_NAME</a>
		const teamMatch = block.match(
			/\/team\/(\d+)\/[^"]*">([^<]+)<\/a><br>(\d+)\s*(.*?)<\/div>/,
		);
		if (!teamMatch) continue;

		const [, sofifaId, rawName, ratingStr, starsBlock] = teamMatch;
		const name = decodeRtf(rawName).trim();
		const overallRating = parseInt(ratingStr, 10);
		const starRating = countStars(starsBlock);

		teams.push({
			name,
			sofifa_id: parseInt(sofifaId, 10),
			logo_url: `https://cdn.sofifa.net/meta/team/${logoId}/120.png`,
			overall_rating: overallRating,
			star_rating: starRating,
		});
	}

	return {
		league_id: leagueId,
		league_name: leagueName,
		country,
		country_code: countryCode,
		teams,
	};
}

// ── Main ────────────────────────────────────────────────────────────

const files = readdirSync(LIGEN_DIR).filter(
	(f) => f.startsWith("liga ") && f.endsWith(".rtf"),
);

console.log(`Found ${files.length} league files\n`);

const allLeagues = [];
let totalTeams = 0;

for (const file of files) {
	const leagueId = parseInt(file.replace("liga ", "").replace(".rtf", ""), 10);
	const filePath = join(LIGEN_DIR, file);
	const league = parseLeagueFile(filePath, leagueId);

	allLeagues.push(league);
	totalTeams += league.teams.length;

	const status = league.teams.length > 0 ? "✓" : "✗ NO TEAMS";
	console.log(
		`${status} ${league.country} - ${league.league_name}: ${league.teams.length} teams (ID ${leagueId})`,
	);
}

// Sort by league_id
allLeagues.sort((a, b) => a.league_id - b.league_id);

const outputPath = join(import.meta.dirname, "scraped-teams.json");

writeFileSync(outputPath, JSON.stringify(allLeagues, null, 2), "utf-8");

console.log(`\nTotal: ${totalTeams} teams across ${allLeagues.length} leagues`);
console.log(`Written to: ${outputPath}`);
