import { describe, expect, it } from "vitest";
import { aggregateDeltas } from "../../../src/api/services/elo/penaltyShotElo.services.js";

describe("aggregateDeltas", () => {
	it("returns empty object for empty input", () => {
		expect(aggregateDeltas([])).toEqual({});
		expect(aggregateDeltas(undefined)).toEqual({});
	});

	it("sums deltas across shots per player", () => {
		const shots = [
			{ elo_deltas: { alice: -5, bob: 5 } },
			{ elo_deltas: { alice: 3 } },
			{ elo_deltas: { alice: -5, carol: 5 } },
		];
		expect(aggregateDeltas(shots)).toEqual({
			alice: -7,
			bob: 5,
			carol: 5,
		});
	});

	it("ignores shots without elo_deltas", () => {
		const shots = [
			{ elo_deltas: { alice: 3 } },
			{ /* no elo_deltas */ },
			{ elo_deltas: null },
		];
		expect(aggregateDeltas(shots)).toEqual({ alice: 3 });
	});

	it("ignores non-numeric or non-finite delta values", () => {
		const shots = [
			{ elo_deltas: { alice: 3, bob: "5", carol: Number.NaN, dan: Infinity } },
		];
		expect(aggregateDeltas(shots)).toEqual({ alice: 3 });
	});
});
