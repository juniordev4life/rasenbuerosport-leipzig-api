import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/api/helpers/database.helpers.js", () => ({
	query: vi.fn(),
	queryOne: vi.fn(),
}));

import { queryOne } from "../../../src/api/helpers/database.helpers.js";
import {
	getNextRecordingCommand,
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
