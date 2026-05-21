import { describe, expect, it } from "vitest";
import { computeUnderStrengthPeriods } from "../../src/api/utils/underStrength.utils.js";

const teams = { home: "Arsenal", away: "Inter" };

describe("computeUnderStrengthPeriods", () => {
	it("returns 20 minutes for a red card in minute 70 of a regular match", () => {
		const periods = computeUnderStrengthPeriods(
			[{ event_type: "red_card", team: "away", minute: 70 }],
			"regular",
			teams,
		);
		expect(periods).toEqual([
			{
				team_name: "Inter",
				side: "away",
				from_minute: 70,
				until_minute: 90,
				duration_minutes: 20,
				reason: "red_card",
			},
		]);
	});

	it("uses 120 minutes as end for extra-time matches", () => {
		const periods = computeUnderStrengthPeriods(
			[{ event_type: "red_card", team: "home", minute: 80 }],
			"extra_time",
			teams,
		);
		expect(periods[0].until_minute).toBe(120);
		expect(periods[0].duration_minutes).toBe(40);
	});

	it("handles card events with card_type red the same as red_card", () => {
		const periods = computeUnderStrengthPeriods(
			[{ event_type: "card", card_type: "red", team: "away", minute: 30 }],
			"regular",
			teams,
		);
		expect(periods).toHaveLength(1);
		expect(periods[0].duration_minutes).toBe(60);
	});

	it("attaches the player name when nameMap resolves the player_id", () => {
		const nameMap = new Map([["uid-jay", "Jay"]]);
		const periods = computeUnderStrengthPeriods(
			[
				{
					event_type: "red_card",
					team: "away",
					minute: 70,
					player_id: "uid-jay",
				},
			],
			"regular",
			teams,
			nameMap,
		);
		expect(periods[0].player).toBe("Jay");
	});

	it("returns one entry per red card (no merging)", () => {
		const periods = computeUnderStrengthPeriods(
			[
				{ event_type: "red_card", team: "away", minute: 30 },
				{ event_type: "red_card", team: "away", minute: 75 },
			],
			"regular",
			teams,
		);
		expect(periods).toHaveLength(2);
		expect(periods.map((p) => p.duration_minutes)).toEqual([60, 15]);
	});

	it("ignores red cards without a minute or recognised team side", () => {
		const periods = computeUnderStrengthPeriods(
			[
				{ event_type: "red_card", team: "away" }, // no minute
				{ event_type: "red_card", minute: 50 }, // no team
				{ event_type: "yellow_card", team: "away", minute: 40 }, // not red
			],
			"regular",
			teams,
		);
		expect(periods).toHaveLength(0);
	});
});
