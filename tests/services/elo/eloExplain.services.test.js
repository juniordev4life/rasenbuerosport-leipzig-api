import { describe, expect, it } from "vitest";
import { explainEloChange } from "../../../src/api/services/elo/eloExplain.services.js";

describe("explainEloChange", () => {
	const baseResult = { share: 0.5 };

	it("tags a single goal", () => {
		const tags = explainEloChange(
			baseResult,
			{ goals: 1, assists: 0, redCards: [] },
			true,
		);
		expect(tags).toContain("Torschütze");
		expect(tags).toContain("Sieg");
	});

	it("tags multiple goals with count", () => {
		const tags = explainEloChange(
			baseResult,
			{ goals: 3, assists: 0, redCards: [] },
			true,
		);
		expect(tags).toContain("3 Tore");
	});

	it("tags a single assist", () => {
		const tags = explainEloChange(
			baseResult,
			{ goals: 0, assists: 1, redCards: [] },
			true,
		);
		expect(tags).toContain("Vorlagengeber");
	});

	it("tags multiple assists with count", () => {
		const tags = explainEloChange(
			baseResult,
			{ goals: 0, assists: 2, redCards: [] },
			false,
		);
		expect(tags).toContain("2 Vorlagen");
	});

	it("tags red cards with the minute", () => {
		const tags = explainEloChange(
			baseResult,
			{ goals: 0, assists: 0, redCards: [{ minute: 84 }] },
			false,
		);
		expect(tags).toContain("Rote Karte (84')");
		expect(tags).toContain("Niederlage");
	});

	it("flags Mitläufer-Schutz on a low-share loss", () => {
		const tags = explainEloChange(
			{ share: 0.2 },
			{ goals: 0, assists: 0, redCards: [] },
			false,
		);
		expect(tags).toContain("Mitläufer-Schutz");
	});

	it("flags Mitläufer-Bonus on a low-share win", () => {
		const tags = explainEloChange(
			{ share: 0.2 },
			{ goals: 0, assists: 0, redCards: [] },
			true,
		);
		expect(tags).toContain("Mitläufer-Bonus");
	});

	it("flags Carry-Performance on a high-share win", () => {
		const tags = explainEloChange(
			{ share: 0.75 },
			{ goals: 3, assists: 0, redCards: [] },
			true,
		);
		expect(tags).toContain("Carry-Performance");
	});

	it("flags Trotz Top-Beitrag on a high-share loss", () => {
		const tags = explainEloChange(
			{ share: 0.75 },
			{ goals: 2, assists: 0, redCards: [] },
			false,
		);
		expect(tags).toContain("Trotz Top-Beitrag");
	});

	it("handles missing stats fields gracefully", () => {
		const tags = explainEloChange(baseResult, {}, true);
		expect(tags).toContain("Sieg");
		expect(tags).not.toContain("Torschütze");
	});
});
