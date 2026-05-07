import { describe, expect, it } from "vitest";
import { setGeneralResponse } from "../../../src/api/helpers/response.helpers.js";
import { buildMockReply } from "../../test-utils.js";

describe("setGeneralResponse", () => {
	it("returns the standard envelope shape", () => {
		// Arrange
		const { reply, getStatus, getPayload } = buildMockReply();

		// Act
		setGeneralResponse(reply, 200, "Success", "Hello", { id: 1 });

		// Assert
		expect(getStatus()).toBe(200);
		expect(getPayload()).toEqual({
			code: 200,
			title: "Success",
			message: "Hello",
			data: { id: 1 },
			error: [],
		});
	});

	it("defaults `data` to null when omitted", () => {
		// Arrange
		const { reply, getPayload } = buildMockReply();

		// Act
		setGeneralResponse(reply, 204, "No Content", "Empty");

		// Assert
		expect(getPayload().data).toBeNull();
	});

	it("always includes an empty error array on success", () => {
		// Arrange
		const { reply, getPayload } = buildMockReply();

		// Act
		setGeneralResponse(reply, 200, "Success", "OK", []);

		// Assert
		expect(getPayload().error).toEqual([]);
	});

	it("propagates the HTTP status code through `reply.status`", () => {
		// Arrange
		const { reply, getStatus } = buildMockReply();

		// Act
		setGeneralResponse(reply, 404, "Not Found", "Game does not exist", null);

		// Assert
		expect(getStatus()).toBe(404);
	});
});
