import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/api/helpers/database.helpers.js", () => ({
	query: vi.fn(),
	queryOne: vi.fn(),
}));

import { query, queryOne } from "../../../src/api/helpers/database.helpers.js";
import {
	getNextRecordingCommand,
	hasFailedCapture,
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
			null,
			null,
		]);
	});

	it("passes null for a missing highlight_url so COALESCE keeps the old value", async () => {
		queryOne.mockResolvedValueOnce({ id: "game-uuid" });

		await updateGameVideo("game-uuid", { video_status: "uploaded" });

		expect(queryOne).toHaveBeenCalledWith(expect.any(String), [
			"game-uuid",
			"uploaded",
			null,
			null,
			null,
		]);
	});

	it("persists result_type + penalty_shootout when the pipeline reports a shootout", async () => {
		queryOne.mockResolvedValueOnce({ id: "game-uuid" });
		const penaltyShootout = {
			score_before: { home: 0, away: 0 },
			final_score: { home: 6, away: 7 },
			winner_side: "away",
			source: "auto",
		};

		await updateGameVideo("game-uuid", {
			video_status: "ready",
			result_type: "penalty",
			penalty_shootout: penaltyShootout,
		});

		expect(queryOne).toHaveBeenCalledWith(
			expect.stringContaining("penalty_shootout = COALESCE"),
			[
				"game-uuid",
				"ready",
				null,
				"penalty",
				JSON.stringify(penaltyShootout),
			],
		);
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

	it("leaves the games row alone for a healthy capture", async () => {
		queryOne.mockResolvedValueOnce({ recording_id: "rec-123", status: "recording" });

		await reportRecordingStatus("rec-123", "recording");

		expect(query).not.toHaveBeenCalled();
	});

	it("marks the matching game failed when the capture dies", async () => {
		// Without this the game keeps video_status NULL and the app blocks the
		// match report forever ("preparing" spinner that never resolves).
		queryOne.mockResolvedValueOnce({ recording_id: "rec-123", status: "failed" });
		query.mockResolvedValueOnce([{ id: "game-1" }]);

		await reportRecordingStatus("rec-123", "failed");

		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE games SET video_status = 'failed'"),
			["rec-123"],
		);
		expect(query.mock.calls[0][0]).toContain("video_status IS NULL");
	});

	it("treats an aborted capture the same way", async () => {
		queryOne.mockResolvedValueOnce({ recording_id: "rec-9", status: "aborted" });
		query.mockResolvedValueOnce([]);

		await reportRecordingStatus("rec-9", "aborted");

		expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE games"), [
			"rec-9",
		]);
	});
});

describe("hasFailedCapture", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(["failed", "aborted"])("is true for a %s capture", async (status) => {
		queryOne.mockResolvedValueOnce({ status });

		await expect(hasFailedCapture("rec-123")).resolves.toBe(true);
	});

	it("is false while the capture is healthy", async () => {
		queryOne.mockResolvedValueOnce({ status: "recording" });

		await expect(hasFailedCapture("rec-123")).resolves.toBe(false);
	});

	it("is false when the slot holds another recording", async () => {
		queryOne.mockResolvedValueOnce(null);

		await expect(hasFailedCapture("rec-123")).resolves.toBe(false);
	});

	it("does not query at all without a recording id", async () => {
		await expect(hasFailedCapture(null)).resolves.toBe(false);
		expect(queryOne).not.toHaveBeenCalled();
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

	it("returns game id, result type, pending, timeline and lineup", async () => {
		const timeline = [
			{ home: 1, away: 0, team: "home", minute: 12, event_type: "goal" },
		];
		const players = [
			{ player_id: "p1", team: "home", username: "Marco" },
			{ player_id: "p2", team: "away", username: "Tobi" },
		];
		queryOne.mockResolvedValueOnce({
			id: "game-uuid",
			result_type: "regular",
			pending: false,
			score_timeline: timeline,
		});
		query.mockResolvedValueOnce(players);

		const result = await getRecordingTimeline("game-uuid");

		expect(result).toEqual({
			game_id: "game-uuid",
			result_type: "regular",
			pending: false,
			score_timeline: timeline,
			players,
		});
	});

	it("normalizes a missing timeline to an empty array", async () => {
		queryOne.mockResolvedValueOnce({
			id: "game-uuid",
			result_type: null,
			pending: true,
			score_timeline: null,
		});
		query.mockResolvedValueOnce([]);

		const result = await getRecordingTimeline("game-uuid");

		expect(result.score_timeline).toEqual([]);
		expect(result.result_type).toBeNull();
		expect(result.pending).toBe(true);
	});

	it("returns null when the game does not exist", async () => {
		queryOne.mockResolvedValueOnce(null);

		const result = await getRecordingTimeline("missing-uuid");

		expect(result).toBeNull();
	});
});
