import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/anthropic.config.js", () => ({
	getAnthropicClient: vi.fn(),
}));
vi.mock("../../../src/api/helpers/database.helpers.js", () => ({
	query: vi.fn(async () => []),
	queryOne: vi.fn(async () => ({ league: { games: 10, goals: 30, shootouts: 1, players: 2 } })),
	withTransaction: vi.fn(),
}));
vi.mock("../../../src/api/services/leagueSeason.services.js", () => ({
	requireLeagueSeason: vi.fn(),
	toSeasonDto: vi.fn((s) => ({ id: s.id })),
}));
vi.mock("../../../src/api/services/season/seasonStandings.services.js", () => ({
	loadSeasonData: vi.fn(async () => ({ games: [], gamePlayers: [], profiles: [], standing: null })),
	buildSeasonRating: vi.fn(() => ({ season: { min_games: 30 }, players: [] })),
	buildLeagueTable: vi.fn(() => ({ rows: [] })),
}));
vi.mock("../../../src/api/services/talkshowAudio.services.js", () => ({
	renderTurnsToMp3: vi.fn(async (_turns, path) => `https://storage.example/${path}`),
}));

import { getAnthropicClient } from "../../../src/config/anthropic.config.js";
import { query } from "../../../src/api/helpers/database.helpers.js";
import { requireLeagueSeason } from "../../../src/api/services/leagueSeason.services.js";
import {
	generateSeasonTalkrundeScript,
	renderSeasonTalkrundeAudio,
} from "../../../src/api/services/season/seasonTalkrunde.services.js";
import { renderTurnsToMp3 } from "../../../src/api/services/talkshowAudio.services.js";

const SEASON = {
	id: "fc26",
	name: "EA FC 26",
	starts_at: "2026-03-12T23:00:00Z",
	ends_at: "2026-09-22T13:00:00Z",
	recap_generated_at: "2026-09-27T18:00:00Z",
	awards: [],
	talkrunde: null,
};

describe("generateSeasonTalkrundeScript", () => {
	beforeEach(() => vi.clearAllMocks());

	it("refuses before the recap exists", async () => {
		requireLeagueSeason.mockResolvedValue({ ...SEASON, recap_generated_at: null });
		await expect(generateSeasonTalkrundeScript("fc26")).rejects.toMatchObject({ statusCode: 409 });
	});

	it("stores the parsed script of the season special", async () => {
		requireLeagueSeason.mockResolvedValue(SEASON);
		const create = vi.fn(async () => ({
			model: "claude-sonnet-5",
			stop_reason: "end_turn",
			content: [
				{ type: "thinking", thinking: "" },
				{ type: "text", text: "[MARCEL] Hallo und herzlich willkommen zur Sonderfolge der Bürowoche.\n[SOPHIE] 397 Spiele.\n[FRANK] Wahnsinn!" },
			],
		}));
		getAnthropicClient.mockReturnValue({ messages: { create } });

		const result = await generateSeasonTalkrundeScript("fc26");

		expect(result.turns).toBe(3);
		const [payload] = create.mock.calls[0];
		expect(payload).toMatchObject({
			model: "claude-sonnet-5",
			thinking: { type: "adaptive" },
			output_config: { effort: "medium" },
		});
		expect(payload.messages[0].content).toContain("SONDERFOLGE");
		const [sql, params] = query.mock.calls.at(-1);
		expect(sql).toContain("SET talkrunde");
		expect(JSON.parse(params[1])).toMatchObject({ status: "script", audio_url: null, model: "claude-sonnet-5" });
	});
});

describe("renderSeasonTalkrundeAudio", () => {
	beforeEach(() => vi.clearAllMocks());

	it("renders the stored turns to a fresh object path", async () => {
		requireLeagueSeason.mockResolvedValue({
			...SEASON,
			talkrunde: { script: { turns: [{ speaker: "MARCEL", reporter_id: "klassiker", text: "Hallo" }] } },
		});

		const result = await renderSeasonTalkrundeAudio("fc26");

		expect(renderTurnsToMp3.mock.calls[0][1]).toMatch(/^talkshow\/season-fc26-\d{14}\.mp3$/);
		expect(result.audio_url).toContain("talkshow/season-fc26-");
	});
});
