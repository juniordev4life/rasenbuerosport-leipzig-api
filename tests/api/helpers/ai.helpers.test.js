import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/anthropic.config.js", () => ({
	getAnthropicClient: vi.fn(),
}));

import { getAnthropicClient } from "../../../src/config/anthropic.config.js";
import {
	callAnthropicWithRetry,
	cleanLlmJson,
	findFabricatedNames,
	firstTextOf,
} from "../../../src/api/helpers/ai.helpers.js";

describe("cleanLlmJson", () => {
	it("strips the json fence Sonnet 5 puts around its answer", () => {
		expect(JSON.parse(cleanLlmJson('```json\n{ "possession": { "home": 43, "away": 57 } }\n```'))).toEqual({
			possession: { home: 43, away: 57 },
		});
	});

	it("leaves bare JSON alone and turns non-strings into an empty string", () => {
		expect(cleanLlmJson(' {"a":1} ')).toBe('{"a":1}');
		expect(cleanLlmJson(null)).toBe("");
	});
});

describe("firstTextOf", () => {
	it("skips a leading thinking block", () => {
		const response = {
			stop_reason: "end_turn",
			content: [
				{ type: "thinking", thinking: "" },
				{ type: "text", text: "Anpfiff." },
			],
		};
		expect(firstTextOf(response)).toBe("Anpfiff.");
	});

	it("returns null for a refusal or a response without text", () => {
		expect(firstTextOf({ stop_reason: "refusal", content: [{ type: "text", text: "x" }] })).toBeNull();
		expect(firstTextOf({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }] })).toBeNull();
		expect(firstTextOf(undefined)).toBeNull();
	});
});

describe("callAnthropicWithRetry", () => {
	it("returns the answer text behind a thinking block", async () => {
		const create = vi.fn(async () => ({
			stop_reason: "end_turn",
			content: [
				{ type: "thinking", thinking: "" },
				{ type: "text", text: "Bericht" },
			],
		}));
		getAnthropicClient.mockReturnValue({ messages: { create } });

		await expect(callAnthropicWithRetry({ model: "claude-sonnet-5" })).resolves.toEqual({ text: "Bericht" });
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("does not retry a refusal and surfaces the generic 503", async () => {
		const create = vi.fn(async () => ({ stop_reason: "refusal", content: [] }));
		getAnthropicClient.mockReturnValue({ messages: { create } });

		await expect(callAnthropicWithRetry({ model: "claude-sonnet-5" })).rejects.toMatchObject({
			statusCode: 503,
			cause: { statusCode: 422 },
		});
		expect(create).toHaveBeenCalledTimes(1);
	});
});

describe("findFabricatedNames", () => {
	it("returns an empty list when every name in the report is in the roster", () => {
		const report = "Marco trifft doppelt, Klaus pariert glanzvoll.";
		expect(findFabricatedNames(report, ["Marco", "Klaus"])).toEqual([]);
	});

	it("flags a name that is not in the roster", () => {
		const report = "Marco trifft, Phantomspieler legt auf.";
		expect(findFabricatedNames(report, ["Marco", "Klaus"])).toEqual([
			"Phantomspieler",
		]);
	});

	it("ignores common German capitalised vocabulary", () => {
		const report =
			"Tor in der Minute! Bei dramatischem Spielverlauf bleibt das Team stark.";
		expect(findFabricatedNames(report, ["Marco"])).toEqual([]);
	});

	it("deduplicates repeated unknown tokens and preserves first-occurrence order", () => {
		const report =
			"Geistspieler trifft. Marco antwortet. Geistspieler legt nach. Phantomtor!";
		expect(findFabricatedNames(report, ["Marco"])).toEqual([
			"Geistspieler",
			"Phantomtor",
		]);
	});

	it("respects German umlauts in valid names", () => {
		const report = "Lüke trifft erneut.";
		expect(findFabricatedNames(report, ["Lüke"])).toEqual([]);
	});

	it("handles an empty report", () => {
		expect(findFabricatedNames("", ["Marco"])).toEqual([]);
	});

	it("handles an empty roster", () => {
		const report = "Marco trifft.";
		expect(findFabricatedNames(report, [])).toEqual(["Marco"]);
	});
});
