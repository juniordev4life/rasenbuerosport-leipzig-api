import { describe, expect, it } from "vitest";
import {
	countStars,
	decodeHtmlEntities,
	extractLeagueInfo,
	parseLeaguePage,
	toLeaguePageHtml,
} from "../../scripts/lib/sofifaParser.utils.js";

// Star SVGs exactly as SoFIFA renders them (unchanged between FC 26 and FC27)
const FULL =
	'<svg viewBox="0 0 24 24" width="20" height="20" class="star"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>';
const HALF =
	'<svg viewBox="0 0 24 24" width="20" height="20" class="star"><path d="m22 9.24-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4V6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"></path></svg>';
const EMPTY =
	'<svg viewBox="0 0 24 24" width="20" height="20" class="star"><path d="m22 9.24-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"></path></svg>';

/**
 * One team row of the league table, in FC27 markup.
 * @param {object} team - Row values
 * @returns {string} Row HTML
 */
function teamRow({ logoId, size = 120, sofifaId, slug, name, rating, stars }) {
	const cdn = "https://cdn.sofifa.net";
	return `<tr><td class="a1"><figure class="avatar avatar-sm transparent"><img alt="" class="team" data-src="${cdn}/meta/team/${logoId}/${size}.png" data-srcset="${cdn}/meta/team/${logoId}/240.png 2x, ${cdn}/meta/team/${logoId}/360.png 3x" src="${cdn}/empty.png" data-root="${cdn}/" data-type="team"></figure></td><td class="s20"><div class="ellipsis"><a rel="nofollow" href="/players?na=21"><img title="Deutschland" alt="" src="${cdn}/pixel.gif" data-src="${cdn}/flags/de.png" data-srcset="${cdn}/flags/de@2x.png 2x, ${cdn}/flags/de@3x.png 3x" class="flag" width="21" height="16"></a> <a href="/team/${sofifaId}/${slug}/270002/">${name}</a><br>${rating} ${stars.join("")}</div></td><td class="col col-oa">${rating}</td></tr>`;
}

/**
 * A league page with the given title and rows.
 * @param {string} title - Page title
 * @param {string[]} rows - Row HTML
 * @returns {string} Page HTML
 */
function leaguePage(title, rows) {
	return `<!DOCTYPE html><html><head><title>${title}</title></head><body><table><tbody>${rows.join("")}</tbody></table></body></html>`;
}

const BAYERN = {
	logoId: 503,
	sofifaId: 21,
	slug: "bayern-munchen",
	name: "Bayern München",
	rating: 84,
	stars: [FULL, FULL, FULL, FULL, FULL],
};
const ELVERSBERG = {
	logoId: 3588,
	sofifaId: 580,
	slug: "sv-elversberg",
	name: "SV Elversberg",
	rating: 70,
	stars: [FULL, FULL, FULL, EMPTY, EMPTY],
};
// Low-rated team: one half and four outline stars make the longest rows
const GALWAY = {
	logoId: 312,
	sofifaId: 1571,
	slug: "galway-united",
	name: "Galway United",
	rating: 59,
	stars: [HALF, EMPTY, EMPTY, EMPTY, EMPTY],
};

describe("decodeHtmlEntities", () => {
	it("resolves named, decimal and hex entities", () => {
		expect(decodeHtmlEntities("Brighton &amp; Hove Albion")).toBe(
			"Brighton & Hove Albion",
		);
		expect(decodeHtmlEntities("Ligue 1 McDonald&#39;s")).toBe("Ligue 1 McDonald's");
		expect(decodeHtmlEntities("St Patrick&#x27;s")).toBe("St Patrick's");
	});

	it("leaves unknown entities and plain text untouched", () => {
		expect(decodeHtmlEntities("A &unknown; B & C")).toBe("A &unknown; B & C");
	});
});

describe("extractLeagueInfo", () => {
	it("reads the FC27 title layout (version and date first)", () => {
		const html = "<title>FC27 - 17.09.2026 - Deutschland - Bundesliga | SoFIFA</title>";
		expect(extractLeagueInfo(html)).toEqual({
			country: "Deutschland",
			leagueName: "Bundesliga",
		});
	});

	it("reads the FC 26 title layout (version and date last)", () => {
		const html = "<title>Dänemark - Superliga - FC 26 - 05.03.2026 | SoFIFA</title>";
		expect(extractLeagueInfo(html)).toEqual({
			country: "Dänemark",
			leagueName: "Superliga",
		});
	});

	it("decodes entities in the league name", () => {
		const html =
			"<title>FC27 - 17.09.2026 - Frankreich - Ligue 1 McDonald&#39;s | SoFIFA</title>";
		expect(extractLeagueInfo(html).leagueName).toBe("Ligue 1 McDonald's");
	});

	it("returns empty strings when the page has no title", () => {
		expect(extractLeagueInfo("<html></html>")).toEqual({ country: "", leagueName: "" });
	});
});

describe("countStars", () => {
	it("counts full stars as 1, half stars as 0.5 and outline stars as 0", () => {
		expect(countStars([FULL, FULL, FULL, FULL, HALF].join(""))).toBe(4.5);
		expect(countStars(GALWAY.stars.join(""))).toBe(0.5);
		expect(countStars("")).toBe(0);
	});
});

describe("parseLeaguePage", () => {
	it("parses FC27 rows with 120px crests", () => {
		const html = leaguePage("FC27 - 17.09.2026 - Deutschland - Bundesliga | SoFIFA", [
			teamRow(BAYERN),
			teamRow(ELVERSBERG),
		]);

		const league = parseLeaguePage(html);

		expect(league).toEqual({
			country: "Deutschland",
			country_code: "DE",
			league_name: "Bundesliga",
			teams: [
				{
					name: "Bayern München",
					sofifa_id: 21,
					logo_url: "https://cdn.sofifa.net/meta/team/503/120.png",
					overall_rating: 84,
					star_rating: 5,
				},
				{
					name: "SV Elversberg",
					sofifa_id: 580,
					logo_url: "https://cdn.sofifa.net/meta/team/3588/120.png",
					overall_rating: 70,
					star_rating: 3,
				},
			],
		});
	});

	it("keeps low-rated rows that are longer than 2000 characters", () => {
		const row = teamRow(GALWAY);
		// The old parser cut each row after 2000 characters and dropped these teams
		expect(row.indexOf("</div>") - row.indexOf("data-src=")).toBeGreaterThan(2000);

		const html = leaguePage(
			"FC27 - 17.09.2026 - Republik Irland - SSE Airtricity League Premier Division | SoFIFA",
			[teamRow(GALWAY), teamRow({ ...GALWAY, logoId: 1387, sofifaId: 753, name: "Waterford FC" })],
		);

		const { teams, country_code } = parseLeaguePage(html);

		expect(country_code).toBe("IE");
		expect(teams.map((t) => [t.name, t.overall_rating, t.star_rating])).toEqual([
			["Galway United", 59, 0.5],
			["Waterford FC", 59, 0.5],
		]);
	});

	it("still accepts the 60px crests of FC 26 pages", () => {
		const html = leaguePage("Deutschland - Bundesliga - FC 26 - 05.03.2026 | SoFIFA", [
			teamRow({ ...BAYERN, size: 60 }),
		]);

		expect(parseLeaguePage(html).teams[0].logo_url).toBe(
			"https://cdn.sofifa.net/meta/team/503/120.png",
		);
	});

	it("decodes entities in team names", () => {
		const html = leaguePage("FC27 - 17.09.2026 - England - Premier League | SoFIFA", [
			teamRow({ ...BAYERN, name: "Brighton &amp; Hove Albion" }),
		]);

		expect(parseLeaguePage(html).teams[0].name).toBe("Brighton & Hove Albion");
	});

	it("leaves the country code empty for an unknown country", () => {
		const html = leaguePage("FC27 - 17.09.2026 - Atlantis - Premier League | SoFIFA", []);

		expect(parseLeaguePage(html)).toMatchObject({ country: "Atlantis", country_code: "" });
	});
});

describe("toLeaguePageHtml", () => {
	it("joins an HTML file into one line", () => {
		expect(toLeaguePageHtml("<a>\n<b>\r\n</b>", "liga 19.html")).toBe("<a><b></b>");
	});

	it("decodes RTF escapes and hyperlink fields of an .rtf file", () => {
		const rtf = `<title>D\\'e4nemark - Superliga</title>\n<link href="{\\field{\\*\\fldinst{HYPERLINK "https://sofifa.com/league/1"}}{\\fldrslt \\cf3 \\ul \\ulc3 https://sofifa.com/league/1}}">`;

		expect(toLeaguePageHtml(rtf, "liga 1.rtf")).toBe(
			'<title>Dänemark - Superliga</title><link href="https://sofifa.com/league/1">',
		);
	});
});
