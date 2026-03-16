/** Project start: Q1 2026 */
const PROJECT_START_YEAR = 2026;
const PROJECT_START_QUARTER = 1;

/**
 * Gets the season identifier for a given date
 * @param {Date} [date] - Defaults to now
 * @returns {string} Season key like "2026-Q1"
 */
export function getSeasonForDate(date = new Date()) {
	const year = date.getFullYear();
	const quarter = Math.ceil((date.getMonth() + 1) / 3);
	return `${year}-Q${quarter}`;
}

/**
 * Gets the current season identifier
 * @returns {string}
 */
export function getCurrentSeason() {
	return getSeasonForDate(new Date());
}

/**
 * Returns the start and end ISO date strings for a season
 * @param {string} seasonKey - e.g. "2026-Q2"
 * @returns {{ from: string, to: string }}
 */
export function getSeasonDateRange(seasonKey) {
	const match = seasonKey.match(/^(\d{4})-Q([1-4])$/);
	if (!match) throw new Error(`Invalid season key: ${seasonKey}`);

	const year = Number.parseInt(match[1], 10);
	const quarter = Number.parseInt(match[2], 10);

	const startMonth = (quarter - 1) * 3;
	const endMonth = startMonth + 2;
	const lastDay = new Date(year, endMonth + 1, 0).getDate();

	return {
		from: `${year}-${String(startMonth + 1).padStart(2, "0")}-01`,
		to: `${year}-${String(endMonth + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
	};
}

/**
 * Lists all seasons from project start to the current quarter
 * @returns {string[]} Array of season keys, most recent first
 */
export function listAllSeasons() {
	const now = new Date();
	const currentYear = now.getFullYear();
	const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);

	const seasons = [];
	let y = currentYear;
	let q = currentQuarter;

	while (
		y > PROJECT_START_YEAR ||
		(y === PROJECT_START_YEAR && q >= PROJECT_START_QUARTER)
	) {
		seasons.push(`${y}-Q${q}`);
		q--;
		if (q < 1) {
			q = 4;
			y--;
		}
	}

	return seasons;
}

/**
 * Gets a human-readable display label for a season
 * @param {string} seasonKey - e.g. "2026-Q2"
 * @returns {{ de: string, en: string }}
 */
export function getSeasonDisplayName(seasonKey) {
	const match = seasonKey.match(/^(\d{4})-Q([1-4])$/);
	if (!match) return { de: seasonKey, en: seasonKey };

	const year = match[1];
	const quarter = match[2];

	const names = {
		de: { 1: "Jan–Mär", 2: "Apr–Jun", 3: "Jul–Sep", 4: "Okt–Dez" },
		en: { 1: "Jan–Mar", 2: "Apr–Jun", 3: "Jul–Sep", 4: "Oct–Dec" },
	};

	return {
		de: `Q${quarter} ${year} (${names.de[quarter]})`,
		en: `Q${quarter} ${year} (${names.en[quarter]})`,
	};
}
