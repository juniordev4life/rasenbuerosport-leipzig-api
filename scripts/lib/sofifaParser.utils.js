/**
 * Pure parsing helpers for saved SoFIFA league pages.
 *
 * A league page (https://sofifa.com/league/{id}) is saved either as plain
 * HTML source (`liga {id}.html`) or as the older RTF copy of that source
 * (`liga {id}.rtf`). Both are normalised to one HTML string and parsed by the
 * same code, so the format of the saved file never changes the result.
 *
 * Kept free of file-system access so it can be unit-tested with fixtures.
 */

/** Map German country names (from the SoFIFA page title) to ISO country codes */
export const COUNTRY_CODE_MAP = {
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
	"V. A. Emirate": "AE",
	Venezuela: "VE",
	"Vereinigte Staaten": "US",
	Zypern: "CY",
	Österreich: "AT",
};

/**
 * Established display names per SoFIFA league id. Since FC27 the page title
 * carries the sponsored name ("Serie A Enilive", "Sky Bet Championship",
 * "Saudi Abdul L. Jameel League (1)"), which changes with every sponsorship
 * deal. The app's league filter groups by `teams.league_name`, so the names
 * are pinned here; only a league missing from this map uses the SoFIFA title.
 */
export const LEAGUE_NAMES = {
	1: "Superliga", // Dänemark
	4: "Pro League", // Belgien
	7: "Série A", // Brasilien
	10: "Eredivisie", // Niederlande
	13: "Premier League", // England
	14: "Championship", // England
	16: "Ligue 1", // Frankreich
	17: "Ligue 2", // Frankreich
	19: "Bundesliga", // Deutschland
	20: "2. Bundesliga", // Deutschland
	31: "Serie A", // Italien
	32: "Serie B", // Italien
	39: "Major League Soccer", // USA
	41: "Eliteserien", // Norwegen
	50: "Premiership", // Schottland
	53: "La Liga", // Spanien
	54: "La Liga 2", // Spanien
	56: "Allsvenskan", // Schweden
	60: "League One", // England
	61: "League Two", // England
	63: "Super League", // Griechenland
	64: "Nemzeti Bajnokság I", // Ungarn
	65: "Premier Division", // Republik Irland
	66: "Ekstraklasa", // Polen
	68: "Süper Lig", // Türkei
	80: "Bundesliga", // Österreich
	83: "K League 1", // Korea, Republik
	189: "Super League", // Schweiz
	308: "Primeira Liga", // Portugal
	313: "Premyer Liqa", // Aserbaidschan
	317: "Hrvatska nogometna liga", // Kroatien
	318: "1. Division", // Zypern
	319: "První liga", // Tschechische Repub.
	322: "Veikkausliiga", // Finnland
	330: "Liga I", // Rumänien
	332: "Premier League", // Ukraine
	335: "Primera Division", // Chile
	336: "Categoría Primera A", // Kolumbien
	337: "División Profesional", // Paraguay
	338: "Primera División", // Uruguay
	350: "Pro League", // Saudi-Arabien
	351: "A-League Men", // Australien
	353: "Liga Profesional de Fútbol", // Argentinien
	2012: "Super League", // China VR
	2013: "Pro League", // V. A. Emirate
	2017: "División de Fútbol Profesional", // Bolivien
	2018: "Serie A", // Ecuador
	2019: "Primera Division", // Venezuela
	2020: "Liga 1", // Peru
	2076: "3. Liga", // Deutschland
	2149: "Super League", // Indien
};

/** Title segments that carry the game version ("FC27", "FC 26") or the roster date */
const VERSION_OR_DATE = /^(?:FC|FIFA) ?\d+$|^\d{2}\.\d{2}\.\d{4}$/;

/** Named HTML entities that occur in SoFIFA team and league names */
const NAMED_ENTITIES = {
	amp: "&",
	quot: '"',
	apos: "'",
	lt: "<",
	gt: ">",
	nbsp: " ",
};

/**
 * Decodes the HTML entities found in page source text.
 * @param {string} text - Raw text from the HTML source
 * @returns {string} Text with named and numeric entities resolved
 * @example
 * decodeHtmlEntities("Brighton &amp; Hove Albion"); // "Brighton & Hove Albion"
 */
export function decodeHtmlEntities(text) {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
		if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
		const isHex = code[1].toLowerCase() === "x";
		return String.fromCodePoint(
			parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10),
		);
	});
}

/**
 * Decode RTF special character escapes to proper Unicode.
 * Handles \'XX hex escapes and \uNNNN unicode escapes.
 * @param {string} text - RTF text
 * @returns {string} Text with RTF escapes resolved
 * @example
 * decodeRtf("D\\'e4nemark"); // "Dänemark"
 */
export function decodeRtf(text) {
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
 * Strips RTF formatting to extract clean HTML-like content.
 * Removes RTF field wrappers, formatting codes, and cell boundaries.
 * @param {string} rtf - RTF copy of a page's HTML source
 * @returns {string} The HTML source without RTF markup
 * @example
 * stripRtf('{\\field{\\*\\fldinst{HYPERLINK "https://sofifa.com/"}}{\\fldrslt x}}');
 * // "https://sofifa.com/"
 */
export function stripRtf(rtf) {
	let text = rtf.replace(/\r?\n/g, "");

	// Decode RTF unicode escapes early so team names are clean
	text = decodeRtf(text);

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
 * Normalises a saved league file to a single-line HTML string.
 * @param {string} raw - File contents
 * @param {string} fileName - File name; `.rtf` selects the RTF decoder
 * @returns {string} HTML source on one line
 * @example
 * toLeaguePageHtml(readFileSync("liga 19.html", "utf-8"), "liga 19.html");
 */
export function toLeaguePageHtml(raw, fileName) {
	if (fileName.endsWith(".rtf")) return stripRtf(raw);
	return raw.replace(/\r?\n/g, "");
}

/**
 * Extracts league name and country from the <title> tag. Accepts both
 * SoFIFA title layouts:
 *   FC 26: "Dänemark - Superliga - FC 26 - 05.03.2026 | SoFIFA"
 *   FC27:  "FC27 - 17.09.2026 - Dänemark - 3F Superliga | SoFIFA"
 * @param {string} html - Page HTML
 * @returns {{ country: string, leagueName: string }} Empty strings when no title is found
 * @example
 * extractLeagueInfo("<title>FC27 - 17.09.2026 - Deutschland - Bundesliga | SoFIFA</title>");
 * // { country: "Deutschland", leagueName: "Bundesliga" }
 */
export function extractLeagueInfo(html) {
	const titleMatch = html.match(/<title>([^<]+)<\/title>/);
	if (!titleMatch) return { country: "", leagueName: "" };

	const title = decodeHtmlEntities(titleMatch[1]).replace(
		/\s*\|\s*SoFIFA\s*$/,
		"",
	);
	const [country = "", ...leagueParts] = title
		.split(" - ")
		.map((part) => part.trim())
		.filter((part) => !VERSION_OR_DATE.test(part));

	return { country, leagueName: leagueParts.join(" - ") };
}

/**
 * Counts stars in a team data string.
 * Full star path starts with "M12 17.27", half star contains "V6.1"
 * @param {string} teamBlock - HTML following the team's rating
 * @returns {number} Star rating in 0.5 steps
 * @example
 * countStars('<svg class="star"><path d="M12 17.27 ..."></path></svg>'); // 1
 */
export function countStars(teamBlock) {
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
 * Parses the team table of a SoFIFA league page.
 *
 * Every team row starts with its crest, lazy-loaded via
 * `data-src="https://cdn.sofifa.net/meta/team/{LOGO_ID}/{SIZE}.png"` — the
 * size is 60 on FC 26 pages and 120 on FC27 pages, so any size is accepted.
 * A row runs up to the next crest: a fixed-length window cut off low-rated
 * teams, whose five outline stars make the row longer than the top teams'.
 * @param {string} html - Single-line page HTML (see toLeaguePageHtml)
 * @returns {{ country: string, country_code: string, league_name: string, teams: object[] }} Parsed league
 * @example
 * const league = parseLeaguePage(toLeaguePageHtml(raw, "liga 19.html"));
 * league.teams[0]; // { name: "Bayern München", sofifa_id: 21, logo_url: "…/120.png", overall_rating: 84, star_rating: 4.5 }
 */
export function parseLeaguePage(html) {
	const { country, leagueName } = extractLeagueInfo(html);

	const logoRegex =
		/data-src="https:\/\/cdn\.sofifa\.net\/meta\/team\/(\d+)\/\d+\.png"/g;
	const crests = [...html.matchAll(logoRegex)];
	const teams = [];

	for (const [i, { 1: logoId, index }] of crests.entries()) {
		// The team link, rating and stars follow within the same row
		const block = html.substring(index, crests[i + 1]?.index ?? html.length);
		const teamMatch = block.match(
			/\/team\/(\d+)\/[^"]*">([^<]+)<\/a><br>(\d+)\s*(.*?)<\/div>/,
		);
		if (!teamMatch) continue;

		const [, sofifaId, rawName, ratingStr, starsBlock] = teamMatch;
		teams.push({
			name: decodeHtmlEntities(rawName).trim(),
			sofifa_id: parseInt(sofifaId, 10),
			logo_url: `https://cdn.sofifa.net/meta/team/${logoId}/120.png`,
			overall_rating: parseInt(ratingStr, 10),
			star_rating: countStars(starsBlock),
		});
	}

	return {
		country,
		country_code: COUNTRY_CODE_MAP[country] || "",
		league_name: leagueName,
		teams,
	};
}
