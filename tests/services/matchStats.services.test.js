import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/anthropic.config.js", () => ({
	getAnthropicClient: vi.fn(),
}));

import { getAnthropicClient } from "../../src/config/anthropic.config.js";
import {
	__test__,
	extractStatsFromImage,
} from "../../src/api/services/matchStats.services.js";

describe("extractStatsFromImage", () => {
	it("parses a fenced JSON answer behind a thinking block", async () => {
		const create = vi.fn(async () => ({
			stop_reason: "end_turn",
			content: [
				{ type: "thinking", thinking: "" },
				{ type: "text", text: '```json\n{ "shots": { "home": 5, "away": 7 } }\n```' },
			],
		}));
		getAnthropicClient.mockReturnValue({ messages: { create } });

		const stats = await extractStatsFromImage("https://storage.example/overview.jpg");

		expect(stats).toEqual({ shots: { home: 5, away: 7 } });
		expect(create.mock.calls[0][0]).toMatchObject({
			model: "claude-sonnet-5",
			output_config: { effort: "medium" },
		});
	});
});

const { splitPassesExtraction } = __test__;

describe("splitPassesExtraction", () => {
	it("separates pass network from the rest of the stats", () => {
		const raw = {
			pass_accuracy: { home: 88, away: 82 },
			passes: { home: 412, away: 388 },
			homePassNetwork: {
				lateralityScore: 75,
				verticalityScore: 25,
				centralPlayer: "8",
				topPassConnections: [{ from: "8", to: "10" }],
			},
			awayPassNetwork: {
				lateralityScore: -20,
				verticalityScore: 65,
				centralPlayer: "6",
				topPassConnections: [{ from: "6", to: "11" }],
			},
		};
		const out = splitPassesExtraction(raw);

		expect(out.stats).toEqual({
			pass_accuracy: { home: 88, away: 82 },
			passes: { home: 412, away: 388 },
		});
		expect(out.homePassNetwork).toMatchObject({
			laterality: "rechts",
			lateralityScore: 75,
		});
		expect(out.awayPassNetwork).toMatchObject({
			verticality: "gemischt",
			verticalityScore: 65,
		});
	});

	it("returns null for both networks when extractor omitted them", () => {
		const out = splitPassesExtraction({
			pass_accuracy: { home: 88, away: 82 },
		});
		expect(out.homePassNetwork).toBe(null);
		expect(out.awayPassNetwork).toBe(null);
		expect(out.stats).toEqual({ pass_accuracy: { home: 88, away: 82 } });
	});

	it("invalid network values become null (not corrupt JSON)", () => {
		const out = splitPassesExtraction({
			pass_accuracy: { home: 88, away: 82 },
			homePassNetwork: {
				lateralityScore: "not-a-number",
				verticalityScore: null,
			},
			awayPassNetwork: "broken",
		});
		expect(out.homePassNetwork).toBe(null);
		expect(out.awayPassNetwork).toBe(null);
	});

	it("handles a completely empty input", () => {
		expect(splitPassesExtraction({})).toEqual({
			stats: {},
			homePassNetwork: null,
			awayPassNetwork: null,
		});
		expect(splitPassesExtraction(null)).toEqual({
			stats: {},
			homePassNetwork: null,
			awayPassNetwork: null,
		});
	});
});
