import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireAgentSecret } from "../../../src/api/middlewares/agentAuth.middlewares.js";
import { buildMockReply } from "../../test-utils.js";

const ORIGINAL_SECRET = process.env.AGENT_SECRET;

describe("requireAgentSecret", () => {
	beforeEach(() => {
		process.env.AGENT_SECRET = "test-agent-secret";
	});

	afterEach(() => {
		if (ORIGINAL_SECRET === undefined) {
			delete process.env.AGENT_SECRET;
		} else {
			process.env.AGENT_SECRET = ORIGINAL_SECRET;
		}
	});

	it("passes when the header matches the configured secret", async () => {
		const { reply } = buildMockReply();
		const request = { headers: { "x-agent-secret": "test-agent-secret" } };

		await requireAgentSecret(request, reply);

		expect(reply.sent).toBe(false);
	});

	it("rejects a wrong secret with 401", async () => {
		const { reply, getStatus, getPayload } = buildMockReply();
		const request = { headers: { "x-agent-secret": "nope" } };

		await requireAgentSecret(request, reply);

		expect(getStatus()).toBe(401);
		expect(getPayload().title).toBe("Unauthorized");
	});

	it("rejects a missing header with 401", async () => {
		const { reply, getStatus } = buildMockReply();

		await requireAgentSecret({ headers: {} }, reply);

		expect(getStatus()).toBe(401);
	});

	it("rejects everything when AGENT_SECRET is not configured", async () => {
		delete process.env.AGENT_SECRET;
		const { reply, getStatus } = buildMockReply();
		// Header value irrelevant — an unset secret must never authenticate,
		// even when the client sends an empty/undefined-ish value.
		const request = { headers: { "x-agent-secret": "" } };

		await requireAgentSecret(request, reply);

		expect(getStatus()).toBe(401);
	});
});
