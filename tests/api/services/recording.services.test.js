import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/api/helpers/database.helpers.js", () => ({
	query: vi.fn(),
	queryOne: vi.fn(),
}));

import { queryOne } from "../../../src/api/helpers/database.helpers.js";
import {
	getNextRecordingCommand,
	getRecordingStatus,
	getRecordingTimeline,
	reportRecordingStatus,
	setRecordingCommand,
	updateGameVideo,
} from "../../../src/api/services/recording.services.js";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

describe("setRecordingCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("upserts the single command slot and returns the stored row", async () => {
		const stored = {
			action: "start",
			game_id: "rec-123",
			updated_at: new Date().toISOString(),
		};
		queryOne.mockResolvedValueOnce(stored);

		const result = await setRecordingCommand("start", "rec-123");

		expect(result).toEqual(stored);
		expect(queryOne).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"), [
			"start",
			"rec-123",
		]);
	});
});

describe("getNextRecordingCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns idle when no command has ever been set", async () => {
		queryOne.mockResolvedValueOnce(null);

		const result = await getNextRecordingCommand();

		expect(result).toEqual({ action: "idle", game_id: null });
	});

	it("returns a fresh start command as-is", async () => {
		queryOne.mockResolvedValueOnce({
			action: "start",
			game_id: "rec-123",
			updated_at: new Date().toISOString(),
		});

		const result = await getNextRecordingCommand();

		expect(result).toEqual({ action: "start", game_id: "rec-123" });
	});

	it("masks a stale start command as idle", async () => {
		const staleDate = new Date(Date.now() - THREE_HOURS_MS - 60_000);
		queryOne.mockResolvedValueOnce({
			action: "start",
			game_id: "rec-old",
			updated_at: staleDate.toISOString(),
		});

		const result = await getNextRecordingCommand();

		expect(result).toEqual({ action: "idle", game_id: null });
	});

	it("does not mask an old stop command (stale stop is a no-op anyway)", async () => {
		const staleDate = new Date(Date.now() - THREE_HOURS_MS - 60_000);
		queryOne.mockResolvedValueOnce({
			action: "stop",
			game_id: "game-uuid",
			updated_at: staleDate.toISOString(),
		});

		const result = await getNextRecordingCommand();

		expect(result).toEqual({ action: "stop", game_id: "game-uuid" });
	});
});

describe("updateGameVideo", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates status and url and returns the row", async () => {
		const row = {
			id: "game-uuid",
			recording_id: "rec-123",
			video_status: "ready",
			highlight_url: "https://example.com/reel.mp4",
		};
		queryOne.mockResolvedValueOnce(row);

		const result = await updateGameVideo("game-uuid", {
			video_status: "ready",
			highlight_url: "https://example.com/reel.mp4",
		});

		expect(result).toEqual(row);
		expect(queryOne).toHaveBeenCalledWith(expect.stringContaining("COALESCE"), [
			"game-uuid",
			"ready",
			"https://example.com/reel.mp4",
		]);
	});

	it("passes null for a missing highlight_url so COALESCE keeps the old value", async () => {
		queryOne.mockResolvedValueOnce({ id: "game-uuid" });

		await updateGameVideo("game-uuid", { video_status: "uploaded" });

		expect(queryOne).toHaveBeenCalledWith(expect.any(String), [
			"game-uuid",
			"uploaded",
			null,
		]);
	});

	it("returns null when the game does not exist", async () => {
		queryOne.mockResolvedValueOnce(null);

		const result = await updateGameVideo("missing-uuid", {
			video_status: "uploaded",
		});

		expect(result).toBeNull();
	});
});

describe("reportRecordingStatus", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("upserts the single status slot and returns the stored row", async () => {
		const stored = {
			recording_id: "rec-123",
			status: "recording",
			updated_at: new Date().toISOString(),
		};
		queryOne.mockResolvedValueOnce(stored);

		const result = await reportRecordingStatus("rec-123", "recording");

		expect(result).toEqual(stored);
		expect(queryOne).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"), [
			"rec-123",
			"recording",
		]);
	});
});

describe("getRecordingStatus", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the status when the slot matches the recording id", async () => {
		queryOne.mockResolvedValueOnce({ recording_id: "rec-123", status: "recording" });

		const result = await getRecordingStatus("rec-123");

		expect(result).toEqual({ recording_id: "rec-123", status: "recording" });
	});

	it("returns null status when the slot is empty (agent has not reported)", async () => {
		queryOne.mockResolvedValueOnce(null);

		const result = await getRecordingStatus("rec-123");

		expect(result).toEqual({ recording_id: "rec-123", status: null });
	});

	it("returns null status when the slot holds a different (older) recording", async () => {
		queryOne.mockResolvedValueOnce({ recording_id: "rec-OLD", status: "recording" });

		const result = await getRecordingStatus("rec-123");

		expect(result).toEqual({ recording_id: "rec-123", status: null });
	});

	it("surfaces 'failed' for the matching recording", async () => {
		queryOne.mockResolvedValueOnce({ recording_id: "rec-123", status: "failed" });

		const result = await getRecordingStatus("rec-123");

		expect(result).toEqual({ recording_id: "rec-123", status: "failed" });
	});
});

describe("getRecordingTimeline", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns game id, result type and timeline", async () => {
		const timeline = [
			{ home: 1, away: 0, team: "home", minute: 12, event_type: "goal" },
		];
		queryOne.mockResolvedValueOnce({
			id: "game-uuid",
			result_type: "regular",
			score_timeline: timeline,
		});

		const result = await getRecordingTimeline("game-uuid");

		expect(result).toEqual({
			game_id: "game-uuid",
			result_type: "regular",
			score_timeline: timeline,
		});
	});

	it("normalizes a missing timeline to an empty array", async () => {
		queryOne.mockResolvedValueOnce({
			id: "game-uuid",
			result_type: null,
			score_timeline: null,
		});

		const result = await getRecordingTimeline("game-uuid");

		expect(result.score_timeline).toEqual([]);
		expect(result.result_type).toBeNull();
	});

	it("returns null when the game does not exist", async () => {
		queryOne.mockResolvedValueOnce(null);

		const result = await getRecordingTimeline("missing-uuid");

		expect(result).toBeNull();
	});
});
