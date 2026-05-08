import { describe, expect, it } from "vitest";
import { findFabricatedNames } from "../../../src/api/helpers/ai.helpers.js";

describe("findFabricatedNames", () => {
	it("returns an empty list when every name in the report is in the roster", () => {
		const report = "Marco trifft doppelt, Klaus pariert glanzvoll.";
		expect(findFabricatedNames(report, ["Marco", "Klaus"])).toEqual([]);
	});

	it("flags a name that is not in the roster", () => {
		const report = "Marco trifft, Phantomspieler legt auf.";
		expect(findFabricatedNames(report, ["Marco", "Klaus"])).toEqual([
			"Phantomspieler",
		]);
	});

	it("ignores common German capitalised vocabulary", () => {
		const report =
			"Tor in der Minute! Bei dramatischem Spielverlauf bleibt das Team stark.";
		expect(findFabricatedNames(report, ["Marco"])).toEqual([]);
	});

	it("deduplicates repeated unknown tokens and preserves first-occurrence order", () => {
		const report =
			"Geistspieler trifft. Marco antwortet. Geistspieler legt nach. Phantomtor!";
		expect(findFabricatedNames(report, ["Marco"])).toEqual([
			"Geistspieler",
			"Phantomtor",
		]);
	});

	it("respects German umlauts in valid names", () => {
		const report = "Lüke trifft erneut.";
		expect(findFabricatedNames(report, ["Lüke"])).toEqual([]);
	});

	it("handles an empty report", () => {
		expect(findFabricatedNames("", ["Marco"])).toEqual([]);
	});

	it("handles an empty roster", () => {
		const report = "Marco trifft.";
		expect(findFabricatedNames(report, [])).toEqual(["Marco"]);
	});
});
