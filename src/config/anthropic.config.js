import Anthropic from "@anthropic-ai/sdk";

let client = null;

/**
 * Returns the Anthropic client singleton
 * @returns {Anthropic}
 */
export function getAnthropicClient() {
	if (!client) {
		client = new Anthropic({
			apiKey: process.env.ANTHROPIC_API_KEY,
		});
	}
	return client;
}
