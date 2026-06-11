import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/api/services/recording.services.js", () => ({
	getNextRecordingCommand: vi.fn(),
	getRecordingStatus: vi.fn(),
	reportRecordingStatus: vi.fn(),
	setRecordingCommand: vi.fn(),
	updateGameVideo: vi.fn(),
}));

import {
	getNextRecordingCommandController,
	getRecordingStatusController,
	reportRecordingStatusController,
	setRecordingCommandController,
	updateGameVideoController,
} from "../../../src/api/controllers/recording.controllers.js";
import {
	getNextRecordingCommand,
	getRecordingStatus,
	reportRecordingStatus,
	setRecordingCommand,
	updateGameVideo,
} from "../../../src/api/services/recording.services.js";
import { buildMockReply } from "../../test-utils.js";

describe("getNextRecordingCommandController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the command in the standard envelope", async () => {
		getNextRecordingCommand.mockResolvedValueOnce({
			action: "start",
			game_id: "rec-123",
		});
		const { reply, getStatus, getPayload } = buildMockReply();

		await getNextRecordingCommandController.handler({}, reply);

		expect(getStatus()).toBe(200);
		expect(getPayload().data).toEqual({ action: "start", game_id: "rec-123" });
	});
});

describe("setRecordingCommandController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("forwards action and game_id to the service", async () => {
		setRecordingCommand.mockResolvedValueOnce({
			action: "stop",
			game_id: "game-uuid",
		});
		const { reply, getStatus, getPayload } = buildMockReply();
		const request = { body: { action: "stop", game_id: "game-uuid" } };

		await setRecordingCommandController.handler(request, reply);

		expect(setRecordingCommand).toHaveBeenCalledWith("stop", "game-uuid");
		expect(getStatus()).toBe(200);
		expect(getPayload().data.action).toBe("stop");
	});
});

describe("updateGameVideoController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates the game video fields", async () => {
		updateGameVideo.mockResolvedValueOnce({
			id: "game-uuid",
			video_status: "uploaded",
		});
		const { reply, getStatus, getPayload } = buildMockReply();
		const request = {
			params: { gameId: "game-uuid" },
			body: { video_status: "uploaded" },
		};

		await updateGameVideoController.handler(request, reply);

		expect(updateGameVideo).toHaveBeenCalledWith("game-uuid", {
			video_status: "uploaded",
		});
		expect(getStatus()).toBe(200);
		expect(getPayload().data.video_status).toBe("uploaded");
	});

	it("returns 404 when the game does not exist", async () => {
		updateGameVideo.mockResolvedValueOnce(null);
		const { reply, getStatus, getPayload } = buildMockReply();
		const request = {
			params: { gameId: "00000000-0000-0000-0000-000000000000" },
			body: { video_status: "recording" },
		};

		await updateGameVideoController.handler(request, reply);

		expect(getStatus()).toBe(404);
		expect(getPayload().title).toBe("Not Found");
	});
});

describe("reportRecordingStatusController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("forwards recording_id and status to the service", async () => {
		reportRecordingStatus.mockResolvedValueOnce({
			recording_id: "rec-123",
			status: "recording",
		});
		const { reply, getStatus, getPayload } = buildMockReply();
		const request = { body: { recording_id: "rec-123", status: "recording" } };

		await reportRecordingStatusController.handler(request, reply);

		expect(reportRecordingStatus).toHaveBeenCalledWith("rec-123", "recording");
		expect(getStatus()).toBe(200);
		expect(getPayload().data.status).toBe("recording");
	});
});

describe("getRecordingStatusController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the status for the queried recording id", async () => {
		getRecordingStatus.mockResolvedValueOnce({
			recording_id: "rec-123",
			status: "failed",
		});
		const { reply, getStatus, getPayload } = buildMockReply();
		const request = { query: { recording_id: "rec-123" } };

		await getRecordingStatusController.handler(request, reply);

		expect(getRecordingStatus).toHaveBeenCalledWith("rec-123");
		expect(getStatus()).toBe(200);
		expect(getPayload().data.status).toBe("failed");
	});
});
