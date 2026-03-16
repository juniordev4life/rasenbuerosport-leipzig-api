import {
	getCurrentSeason,
	getSeasonDateRange,
	getSeasonDisplayName,
	listAllSeasons,
} from "../../utils/season.utils.js";
import { getLeaderboard } from "./leaderboard.services.js";

/**
 * Returns metadata about all available seasons
 * @returns {object}
 */
export function getSeasonsList() {
	const allSeasons = listAllSeasons();
	const currentSeason = getCurrentSeason();

	return {
		current: currentSeason,
		seasons: allSeasons.map((key) => ({
			key,
			display_name: getSeasonDisplayName(key),
			is_current: key === currentSeason,
		})),
	};
}

/**
 * Returns the podium (top 3) for each completed season
 * @returns {Promise<object[]>}
 */
export async function getSeasonArchive() {
	const allSeasons = listAllSeasons();
	const currentSeason = getCurrentSeason();

	const completedSeasons = allSeasons.filter((s) => s !== currentSeason);

	const archive = [];

	for (const seasonKey of completedSeasons) {
		const { from, to } = getSeasonDateRange(seasonKey);
		const leaderboard = await getLeaderboard(3, from, to, "all");

		if (leaderboard.length === 0) continue;

		archive.push({
			season: seasonKey,
			display_name: getSeasonDisplayName(seasonKey),
			podium: leaderboard.map((player, index) => ({
				rank: index + 1,
				player_id: player.player_id,
				username: player.username,
				avatar_url: player.avatar_url,
				points: player.points,
				wins: player.wins,
				draws: player.draws,
				losses: player.losses,
				games: player.games,
			})),
		});
	}

	return archive;
}
