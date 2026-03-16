import { getSeasonDateRange } from "../../utils/season.utils.js";
import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	getCommunityStatsSchema,
	getDashboardStatsSchema,
} from "../schemas/dashboardStats.schemas.js";
import {
	computeRollingWinRate,
	getCommonScores,
	getEloDistribution,
	getFullEloHistory,
	getGamesPerMonth,
	getGamesPerWeekday,
	getGoalsDistribution,
	getTeamStats,
	getXgVsGoals,
} from "../services/dashboardStats.services.js";

/**
 * Personal dashboard stats controller
 */
export const getDashboardStatsController = {
	schema: getDashboardStatsSchema,
	handler: async (request, reply) => {
		try {
			const { season } = request.query;
			let from;
			let to;

			if (season) {
				const range = getSeasonDateRange(season);
				from = range.from;
				to = range.to;
			}

			const playerId = request.user.id;

			const [eloHistory, xgVsGoals, gamesPerMonth, gamesPerWeekday, teamStats] =
				await Promise.all([
					getFullEloHistory(playerId, from, to),
					getXgVsGoals(playerId, from, to),
					getGamesPerMonth(playerId, from, to),
					getGamesPerWeekday(playerId, from, to),
					getTeamStats(playerId, from, to),
				]);

			const rollingWinRate = computeRollingWinRate(eloHistory);

			return setGeneralResponse(reply, 200, "Success", "Dashboard stats retrieved", {
				elo_history: eloHistory,
				rolling_win_rate: rollingWinRate,
				xg_vs_goals: xgVsGoals,
				games_per_month: gamesPerMonth,
				games_per_weekday: gamesPerWeekday,
				team_stats: teamStats,
			});
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

/**
 * Community-wide stats controller
 */
export const getCommunityStatsController = {
	schema: getCommunityStatsSchema,
	handler: async (request, reply) => {
		try {
			const { season } = request.query;
			let from;
			let to;

			if (season) {
				const range = getSeasonDateRange(season);
				from = range.from;
				to = range.to;
			}

			const [eloDistribution, commonScores, goalsDistribution] =
				await Promise.all([
					getEloDistribution(),
					getCommonScores(from, to),
					getGoalsDistribution(from, to),
				]);

			return setGeneralResponse(reply, 200, "Success", "Community stats retrieved", {
				elo_distribution: eloDistribution,
				common_scores: commonScores,
				goals_distribution: goalsDistribution,
			});
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
