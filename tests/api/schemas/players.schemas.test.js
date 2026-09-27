/**
 * Fastify's response serializer drops every property the schema does not
 * list. The new-game lobby sorts players by `games_played`, so a schema that
 * forgets the field would silently fall back to the alphabetical order.
 */
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { getPlayersSchema } from "../../../src/api/schemas/players.schemas.js";

let app;

afterEach(async () => {
	await app?.close();
});

describe("getPlayersSchema — response serialization", () => {
	it("keeps games_played on every player", async () => {
		// Arrange
		app = Fastify();
		app.get("/players", { schema: getPlayersSchema }, async () => ({
			code: 200,
			title: "Success",
			message: "Players retrieved",
			data: [
				{ id: "uid-1", username: "AH", avatar_url: null, games_played: 42 },
				{ id: "uid-2", username: "FS", avatar_url: null, games_played: 0 },
			],
			error: [],
		}));

		// Act
		const res = await app.inject({ method: "GET", url: "/players" });

		// Assert
		expect(res.json().data).toEqual([
			{ id: "uid-1", username: "AH", avatar_url: null, games_played: 42 },
			{ id: "uid-2", username: "FS", avatar_url: null, games_played: 0 },
		]);
	});
});
