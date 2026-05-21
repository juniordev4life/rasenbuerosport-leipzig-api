import { describe, expect, it } from "vitest";
import {
	buildDramaSignals,
	buildKeyEvents,
	buildPlayerSpotlights,
	computeFormTrends,
	deriveWinners,
} from "../../src/api/services/talkshow.services.js";

describe("deriveWinners", () => {
	const stats = [
		{ username: "Marco", games: 6, wins: 5, losses: 1, goals: 4 },
		{ username: "Nikinho", games: 4, wins: 3, losses: 1, goals: 11 },
		{ username: "Jay", games: 8, wins: 2, losses: 6, goals: 5 },
		{ username: "Tobi", games: 3, wins: 0, losses: 3, goals: 0 },
	];

	it("picks mvp by wins", () => {
		expect(deriveWinners(stats).mvp).toEqual({
			name: "Marco",
			wins: 5,
			games: 6,
		});
	});

	it("picks topscorer by goals", () => {
		expect(deriveWinners(stats).topscorer).toEqual({
			name: "Nikinho",
			goals: 11,
		});
	});

	it("picks most active by games played", () => {
		expect(deriveWinners(stats).most_active).toEqual({
			name: "Jay",
			games: 8,
		});
	});

	it("returns nulls for empty input", () => {
		expect(deriveWinners([])).toEqual({
			mvp: null,
			topscorer: null,
			most_active: null,
		});
	});

	it("ignores players with zero goals/wins for those categories", () => {
		const winners = deriveWinners([
			{ username: "Marco", games: 2, wins: 0, goals: 0 },
		]);
		expect(winners.mvp).toBe(null);
		expect(winners.topscorer).toBe(null);
		expect(winners.most_active?.name).toBe("Marco");
	});
});

describe("computeFormTrends", () => {
	const thisWeek = [
		{ player_id: "p1", username: "Marco", games: 6, wins: 5 },
		{ player_id: "p2", username: "Jay", games: 4, wins: 0 },
		{ player_id: "p3", username: "Nikinho", games: 2, wins: 1 },
		{ player_id: "p4", username: "Tobi", games: 1, wins: 0 }, // below minGames
	];
	const lastWeek = [
		{ player_id: "p1", username: "Marco", games: 4, wins: 1 },
		{ player_id: "p2", username: "Jay", games: 4, wins: 3 },
		{ player_id: "p3", username: "Nikinho", games: 2, wins: 1 },
	];

	it("identifies risers with biggest win-rate gain", () => {
		const { form_risers } = computeFormTrends(thisWeek, lastWeek, { limit: 2 });
		expect(form_risers[0].name).toBe("Marco");
		expect(form_risers[0].win_rate_this_week).toBeGreaterThan(
			form_risers[0].win_rate_last_week,
		);
	});

	it("identifies fallers with biggest win-rate loss", () => {
		const { form_fallers } = computeFormTrends(thisWeek, lastWeek, {
			limit: 2,
		});
		expect(form_fallers[0].name).toBe("Jay");
	});

	it("excludes players below minGames threshold", () => {
		const { form_risers, form_fallers } = computeFormTrends(
			thisWeek,
			lastWeek,
		);
		const allNames = [...form_risers, ...form_fallers].map((p) => p.name);
		expect(allNames).not.toContain("Tobi");
	});

	it("excludes players without prior-week data", () => {
		const noPrior = computeFormTrends(thisWeek, []);
		expect(noPrior.form_risers).toHaveLength(0);
		expect(noPrior.form_fallers).toHaveLength(0);
	});
});

describe("buildPlayerSpotlights", () => {
	it("uses risers and fallers when available", () => {
		const trends = {
			form_risers: [
				{
					name: "Marco",
					win_rate_last_week: 0.25,
					win_rate_this_week: 0.83,
					games_this_week: 6,
					wins_this_week: 5,
				},
			],
			form_fallers: [
				{
					name: "Jay",
					win_rate_last_week: 0.75,
					win_rate_this_week: 0,
					games_this_week: 4,
					wins_this_week: 0,
				},
			],
		};
		const spotlights = buildPlayerSpotlights(trends, []);
		expect(spotlights).toHaveLength(2);
		expect(spotlights[0].role).toBe("rising");
		expect(spotlights[1].role).toBe("falling");
	});

	it("falls back to topscorer when no trends qualify", () => {
		const trends = { form_risers: [], form_fallers: [] };
		const thisWeek = [
			{ username: "Nikinho", games: 4, wins: 3, goals: 11 },
			{ username: "Marco", games: 5, wins: 2, goals: 4 },
		];
		const spotlights = buildPlayerSpotlights(trends, thisWeek);
		expect(spotlights).toHaveLength(1);
		expect(spotlights[0].role).toBe("topscorer");
		expect(spotlights[0].name).toBe("Nikinho");
	});

	it("returns empty array when nothing to highlight", () => {
		const spotlights = buildPlayerSpotlights(
			{ form_risers: [], form_fallers: [] },
			[{ username: "Marco", games: 2, wins: 1, goals: 0 }],
		);
		expect(spotlights).toEqual([]);
	});
});

describe("buildKeyEvents", () => {
	const nameMap = new Map([
		["uid-jay", "Jay"],
		["uid-marco", "Marco"],
		["uid-niki", "Nikinho"],
	]);

	it("resolves player ids to names for goals", () => {
		const events = buildKeyEvents(
			[
				{
					event_type: "goal",
					minute: 30,
					scored_by: "uid-niki",
					assist_by: "uid-marco",
				},
			],
			nameMap,
		);
		expect(events).toEqual([
			{
				minute: 30,
				type: "goal",
				scorer: "Nikinho",
				assist: "Marco",
				goal_type: "play",
			},
		]);
	});

	it("includes red cards and missed penalties", () => {
		const events = buildKeyEvents(
			[
				{ event_type: "red_card", minute: 7, player_id: "uid-jay" },
				{
					event_type: "penalty_missed",
					minute: 80,
					shooter_id: "uid-marco",
				},
			],
			nameMap,
		);
		expect(events).toEqual([
			{ minute: 7, type: "red_card", player: "Jay" },
			{ minute: 80, type: "penalty_missed", shooter: "Marco" },
		]);
	});

	it("caps output at the requested limit", () => {
		const timeline = Array.from({ length: 12 }, (_, i) => ({
			event_type: "goal",
			minute: i * 5,
			scored_by: "uid-marco",
		}));
		expect(buildKeyEvents(timeline, nameMap, 5)).toHaveLength(5);
	});
});

describe("buildDramaSignals", () => {
	it("flags extra-time games", () => {
		expect(
			buildDramaSignals({
				result_type: "extra_time",
				score_home: 2,
				score_away: 1,
				score_timeline: [],
			}),
		).toContain("extra_time_winner");
	});

	it("flags penalty shootouts", () => {
		expect(
			buildDramaSignals({
				result_type: "penalties",
				score_home: 2,
				score_away: 2,
				score_timeline: [],
			}),
		).toContain("penalty_shootout");
	});

	it("includes red-card minute markers", () => {
		const signals = buildDramaSignals({
			result_type: "regular",
			score_home: 2,
			score_away: 1,
			score_timeline: [{ event_type: "red_card", minute: 7 }],
		});
		expect(signals).toContain("red_card_min_7");
	});

	it("includes late-goal markers (minute >= 85)", () => {
		const signals = buildDramaSignals({
			result_type: "regular",
			score_home: 1,
			score_away: 0,
			score_timeline: [
				{ event_type: "goal", minute: 88, home: 1, away: 0 },
			],
		});
		expect(signals).toContain("late_goal_min_88");
	});

	it("detects a comeback when the trailing team recovers ≥2 goals", () => {
		const signals = buildDramaSignals({
			result_type: "regular",
			score_home: 3,
			score_away: 2,
			score_timeline: [
				{ event_type: "goal", home: 0, away: 1, minute: 10 },
				{ event_type: "goal", home: 0, away: 2, minute: 25 },
				{ event_type: "goal", home: 1, away: 2, minute: 50 },
				{ event_type: "goal", home: 2, away: 2, minute: 70 },
				{ event_type: "goal", home: 3, away: 2, minute: 88 },
			],
		});
		expect(signals).toContain("comeback_2_goal");
	});
});
