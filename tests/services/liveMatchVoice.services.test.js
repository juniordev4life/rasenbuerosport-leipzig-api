import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/helpers/ai.helpers.js", () => ({
	callAnthropicWithRetry: vi.fn(),
}));
vi.mock("../../src/api/helpers/database.helpers.js", () => ({
	query: vi.fn(async () => []),
}));

import { callAnthropicWithRetry } from "../../src/api/helpers/ai.helpers.js";
import { query } from "../../src/api/helpers/database.helpers.js";
import {
	__test__,
	buildExtractPrompt,
	parseLiveMatchVoiceEvent,
} from "../../src/api/services/liveMatchVoice.services.js";

const PLAYERS = [
	{ id: "marco", username: "Marco", side: "home" },
	{ id: "flo", username: "FlorAln", side: "home" },
	{ id: "jay", username: "Jay", side: "away" },
	{ id: "bm", username: "BlackIVmaniac", side: "away" },
];

describe("buildExtractPrompt", () => {
	it("includes every player on the roster with their team", () => {
		const prompt = buildExtractPrompt({
			transcript: "Tor Marco Minute 17",
			players: PLAYERS,
			currentMinute: 22,
		});
		for (const p of PLAYERS) {
			expect(prompt).toContain(p.id);
			expect(prompt).toContain(p.username);
			expect(prompt).toContain(p.side);
		}
		expect(prompt).toContain("22");
		expect(prompt).toContain("Tor Marco Minute 17");
	});

	it("renders voice aliases inline so Claude treats them as valid names", () => {
		const prompt = buildExtractPrompt({
			transcript: "Tor Dirk",
			players: [
				{ id: "bm", username: "BlackIVmaniac", side: "away", aliases: ["Dirk", "DBL"] },
				{ id: "marco", username: "Marco", side: "home", aliases: [] },
			],
			currentMinute: 10,
		});
		expect(prompt).toMatch(/BlackIVmaniac.*auch genannt: Dirk, DBL/);
	});

	it("lists the four supported event types", () => {
		const prompt = buildExtractPrompt({
			transcript: "x",
			players: PLAYERS,
			currentMinute: 1,
		});
		expect(prompt).toContain("goal");
		expect(prompt).toContain("yellow_card");
		expect(prompt).toContain("red_card");
		expect(prompt).toContain("penalty_missed");
	});
});

describe("cleanLlmJson", () => {
	it("strips markdown fences", () => {
		expect(__test__.cleanLlmJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
		expect(__test__.cleanLlmJson('```\n{"a":1}\n```')).toBe('{"a":1}');
		expect(__test__.cleanLlmJson('{"a":1}')).toBe('{"a":1}');
	});
});

describe("parseLiveMatchVoiceEvent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		query.mockResolvedValue([]);
	});

	it("hydrates each player with voice_aliases from the DB and feeds them to the prompt", async () => {
		query.mockResolvedValue([
			{ id: "bm", voice_aliases: ["Dirk", "DBL"] },
			{ id: "marco", voice_aliases: ["Marc"] },
		]);
		callAnthropicWithRetry.mockResolvedValue({
			text: '{"ok": true, "eventType": "goal", "playerId": "bm", "minute": 10}',
		});
		const result = await parseLiveMatchVoiceEvent({
			transcript: "Tor Dirk",
			players: PLAYERS,
			currentMinute: 10,
		});
		expect(result.ok).toBe(true);
		expect(query).toHaveBeenCalledWith(expect.any(String), [
			["marco", "flo", "jay", "bm"],
		]);
		const promptArg = callAnthropicWithRetry.mock.calls[0][0].messages[0].content;
		expect(promptArg).toContain("auch genannt: Dirk, DBL");
		expect(promptArg).toContain("auch genannt: Marc");
	});

	it("returns a structured event when the LLM resolves the player", async () => {
		callAnthropicWithRetry.mockResolvedValue({
			text: '{"ok": true, "eventType": "goal", "playerId": "marco", "minute": 17}',
		});
		const result = await parseLiveMatchVoiceEvent({
			transcript: "Tor Marco Minute 17",
			players: PLAYERS,
			currentMinute: 22,
		});
		expect(result).toEqual({
			ok: true,
			eventType: "goal",
			playerId: "marco",
			side: "home",
			minute: 17,
			assisterId: null,
			transcript: "Tor Marco Minute 17",
		});
	});

	it("returns the assister when it's a same-team teammate of the scorer", async () => {
		callAnthropicWithRetry.mockResolvedValue({
			text: '{"ok": true, "eventType": "goal", "playerId": "marco", "minute": 17, "assisterId": "flo"}',
		});
		const result = await parseLiveMatchVoiceEvent({
			transcript: "Tor Marco Minute 17 Vorlage Florian",
			players: PLAYERS,
			currentMinute: 17,
		});
		expect(result.ok).toBe(true);
		expect(result.assisterId).toBe("flo");
	});

	it("drops an assister that's on the opposing team", async () => {
		callAnthropicWithRetry.mockResolvedValue({
			text: '{"ok": true, "eventType": "goal", "playerId": "marco", "minute": 17, "assisterId": "jay"}',
		});
		const result = await parseLiveMatchVoiceEvent({
			transcript: "Tor Marco Vorlage Jay",
			players: PLAYERS,
			currentMinute: 17,
		});
		expect(result.ok).toBe(true);
		expect(result.assisterId).toBeNull();
	});

	it("ignores the assister field on non-goal events", async () => {
		callAnthropicWithRetry.mockResolvedValue({
			text: '{"ok": true, "eventType": "yellow_card", "playerId": "flo", "minute": 35, "assisterId": "marco"}',
		});
		const result = await parseLiveMatchVoiceEvent({
			transcript: "Gelb Florian",
			players: PLAYERS,
			currentMinute: 35,
		});
		expect(result.ok).toBe(true);
		expect(result.assisterId).toBeNull();
	});

	it("survives markdown-fenced LLM responses", async () => {
		callAnthropicWithRetry.mockResolvedValue({
			text: '```json\n{"ok": true, "eventType": "yellow_card", "playerId": "flo", "minute": 35}\n```',
		});
		const result = await parseLiveMatchVoiceEvent({
			transcript: "Gelb für Florian Minute 35",
			players: PLAYERS,
			currentMinute: 35,
		});
		expect(result.ok).toBe(true);
		expect(result.eventType).toBe("yellow_card");
		expect(result.minute).toBe(35);
	});

	it("rejects an empty transcript without calling the LLM", async () => {
		const result = await parseLiveMatchVoiceEvent({
			transcript: "   ",
			players: PLAYERS,
			currentMinute: 10,
		});
		expect(result.ok).toBe(false);
		expect(callAnthropicWithRetry).not.toHaveBeenCalled();
	});

	it("returns ok:false when the LLM says it can't parse", async () => {
		callAnthropicWithRetry.mockResolvedValue({
			text: '{"ok": false, "reason": "Kein Event"}',
		});
		const result = await parseLiveMatchVoiceEvent({
			transcript: "Was war das?",
			players: PLAYERS,
			currentMinute: 1,
		});
		expect(result).toEqual({
			ok: false,
			reason: "Kein Event",
			transcript: "Was war das?",
		});
	});

	it("rejects a player not on the roster", async () => {
		callAnthropicWithRetry.mockResolvedValue({
			text: '{"ok": true, "eventType": "goal", "playerId": "ghost", "minute": 10}',
		});
		const result = await parseLiveMatchVoiceEvent({
			transcript: "Tor",
			players: PLAYERS,
			currentMinute: 10,
		});
		expect(result.ok).toBe(false);
		expect(result.reason).toMatch(/Aufstellung/);
	});

	it("rejects unsupported event types", async () => {
		callAnthropicWithRetry.mockResolvedValue({
			text: '{"ok": true, "eventType": "corner", "playerId": "marco", "minute": 10}',
		});
		const result = await parseLiveMatchVoiceEvent({
			transcript: "Ecke",
			players: PLAYERS,
			currentMinute: 10,
		});
		expect(result.ok).toBe(false);
		expect(result.reason).toMatch(/Event-Typ/);
	});

	it("rejects out-of-range minutes", async () => {
		callAnthropicWithRetry.mockResolvedValue({
			text: '{"ok": true, "eventType": "goal", "playerId": "marco", "minute": 200}',
		});
		const result = await parseLiveMatchVoiceEvent({
			transcript: "x",
			players: PLAYERS,
			currentMinute: 10,
		});
		expect(result.ok).toBe(false);
		expect(result.reason).toMatch(/Minute/);
	});

	it("returns ok:false when the LLM returns broken JSON", async () => {
		callAnthropicWithRetry.mockResolvedValue({ text: "not-json" });
		const result = await parseLiveMatchVoiceEvent({
			transcript: "x",
			players: PLAYERS,
			currentMinute: 10,
		});
		expect(result.ok).toBe(false);
		expect(result.reason).toMatch(/LLM/);
	});
});
