import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockReply } from "../../test-utils.js";

const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));

vi.mock("../../../src/config/firebase.config.js", () => ({
	getFirebaseAuth: () => ({ verifyIdToken }),
}));

import { requireAuth } from "../../../src/api/middlewares/auth.middlewares.js";

/**
 * Builds a request stub with a bearer token and spy loggers.
 * @param {object} [headers]
 * @returns {object}
 */
function buildRequest(headers = { authorization: "Bearer test-token" }) {
	return { headers, log: { info: vi.fn(), warn: vi.fn() } };
}

const NEUTRAL_403 = {
	code: 403,
	title: "Forbidden",
	message: "User not authorized",
	data: null,
	error: ["Access denied"],
};

describe("requireAuth", () => {
	beforeEach(() => {
		verifyIdToken.mockReset();
	});

	it("rejects a request without a bearer token with 401", async () => {
		const { reply, getStatus, getPayload } = buildMockReply();

		await requireAuth(buildRequest({}), reply);

		expect(getStatus()).toBe(401);
		expect(getPayload().message).toBe(
			"Missing or invalid authorization header",
		);
		expect(verifyIdToken).not.toHaveBeenCalled();
	});

	it("answers a failed verification with a generic 401 and logs the detail", async () => {
		const detail = new Error(
			'Firebase ID token has incorrect "aud" claim. Expected "internal-project".',
		);
		detail.code = "auth/argument-error";
		verifyIdToken.mockRejectedValue(detail);
		const { reply, getStatus, getPayload } = buildMockReply();
		const request = buildRequest();

		await requireAuth(request, reply);

		expect(getStatus()).toBe(401);
		expect(getPayload().error).toEqual(["Token verification failed"]);
		expect(JSON.stringify(getPayload())).not.toContain("internal-project");
		expect(request.log.info).toHaveBeenCalledWith(
			{ code: "auth/argument-error", reason: detail.message },
			expect.any(String),
		);
		expect(request.user).toBeUndefined();
	});

	it("admits a verified account on the allowed domain", async () => {
		verifyIdToken.mockResolvedValue({
			uid: "uid-1",
			email: "max.mustermann@redbulls.com",
			email_verified: true,
		});
		const { reply } = buildMockReply();
		const request = buildRequest();

		await requireAuth(request, reply);

		expect(reply.sent).toBe(false);
		expect(verifyIdToken).toHaveBeenCalledWith("test-token");
		expect(request.user).toEqual({
			id: "uid-1",
			email: "max.mustermann@redbulls.com",
		});
	});

	it("matches the email domain case-insensitively", async () => {
		verifyIdToken.mockResolvedValue({
			uid: "uid-1",
			email: "Max.Mustermann@RedBulls.com",
			email_verified: true,
		});
		const { reply } = buildMockReply();
		const request = buildRequest();

		await requireAuth(request, reply);

		expect(reply.sent).toBe(false);
		expect(request.user.id).toBe("uid-1");
	});

	it.each([
		["another domain", { email: "attacker@gmail.com", email_verified: true }],
		["an unverified address", { email: "max@redbulls.com", email_verified: false }],
		["a missing verification flag", { email: "max@redbulls.com" }],
		["a lookalike suffix", { email: "max@redbulls.com.evil.com", email_verified: true }],
		["a lookalike prefix", { email: "max@evilredbulls.com", email_verified: true }],
		["a subdomain", { email: "max@mail.redbulls.com", email_verified: true }],
		["no email claim", { email_verified: true }],
	])("rejects %s with the neutral 403", async (_label, claims) => {
		verifyIdToken.mockResolvedValue({ uid: "uid-2", ...claims });
		const { reply, getStatus, getPayload } = buildMockReply();
		const request = buildRequest();

		await requireAuth(request, reply);

		expect(getStatus()).toBe(403);
		expect(getPayload()).toEqual(NEUTRAL_403);
		expect(request.user).toBeUndefined();
		expect(request.log.warn).toHaveBeenCalledOnce();
	});
});
