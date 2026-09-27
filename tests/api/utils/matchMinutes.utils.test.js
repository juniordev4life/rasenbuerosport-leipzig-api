import { describe, expect, it } from "vitest";
import { matchMinutesForResultType } from "../../../src/api/utils/matchMinutes.utils.js";

describe("matchMinutesForResultType", () => {
	it("returns 90 for regular time and unknown values", () => {
		expect(matchMinutesForResultType("regular")).toBe(90);
		expect(matchMinutesForResultType(null)).toBe(90);
		expect(matchMinutesForResultType(undefined)).toBe(90);
		expect(matchMinutesForResultType("penalties")).toBe(90);
	});

	it("returns 120 for extra time and a penalty shootout", () => {
		expect(matchMinutesForResultType("extra_time")).toBe(120);
		expect(matchMinutesForResultType("penalty")).toBe(120);
	});
});
