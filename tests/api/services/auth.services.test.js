import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryOne } = vi.hoisted(() => ({ queryOne: vi.fn() }));

vi.mock("../../../src/api/helpers/database.helpers.js", () => ({ queryOne }));

import {
	isAllowedAvatarUrl,
	updateUserProfile,
} from "../../../src/api/services/auth.services.js";

const BUCKET = "avatar-test.firebasestorage.app";
const STORAGE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;
const OWN_UPLOAD = `${STORAGE}/avatars%2Fuid-1%2Favatar.png?alt=media&token=abc`;
const GOOGLE_PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocK-photo=s96-c";
const ORIGINAL_BUCKET = process.env.FIREBASE_STORAGE_BUCKET;

beforeEach(() => {
	process.env.FIREBASE_STORAGE_BUCKET = BUCKET;
	queryOne.mockReset();
	queryOne.mockResolvedValue({ id: "uid-1" });
});

afterEach(() => {
	if (ORIGINAL_BUCKET === undefined) {
		delete process.env.FIREBASE_STORAGE_BUCKET;
	} else {
		process.env.FIREBASE_STORAGE_BUCKET = ORIGINAL_BUCKET;
	}
});

describe("isAllowedAvatarUrl", () => {
	it.each([
		["the user's own upload", OWN_UPLOAD],
		["a Google account photo", GOOGLE_PHOTO],
	])("accepts %s", (_label, url) => {
		expect(isAllowedAvatarUrl(url, "uid-1")).toBe(true);
	});

	it.each([
		["another user's upload", `${STORAGE}/avatars%2Fuid-2%2Favatar.png`],
		[
			"another bucket",
			"https://firebasestorage.googleapis.com/v0/b/evil.firebasestorage.app/o/avatars%2Fuid-1%2Fa.png",
		],
		["another folder in the bucket", `${STORAGE}/match-stats%2Fshot.png`],
		["an external host", "https://tracker.example/pixel.png"],
		[
			"a lookalike Storage host",
			`https://firebasestorage.googleapis.com.evil.com/v0/b/${BUCKET}/o/avatars%2Fuid-1%2Fa.png`,
		],
		["a lookalike photo host", "https://lh3.googleusercontent.com.evil.com/a/x"],
		["credentials before the photo host", "https://lh3.googleusercontent.com@evil.com/a/x"],
		["plain http", "http://lh3.googleusercontent.com/a/x"],
	])("rejects %s", (_label, url) => {
		expect(isAllowedAvatarUrl(url, "uid-1")).toBe(false);
	});

	it("rejects every Storage URL when no bucket is configured", () => {
		delete process.env.FIREBASE_STORAGE_BUCKET;

		expect(isAllowedAvatarUrl(OWN_UPLOAD, "uid-1")).toBe(false);
		expect(isAllowedAvatarUrl(GOOGLE_PHOTO, "uid-1")).toBe(true);
	});
});

describe("updateUserProfile", () => {
	it("stores an allowed avatar URL", async () => {
		await updateUserProfile("uid-1", { avatar_url: OWN_UPLOAD });

		expect(queryOne).toHaveBeenCalledOnce();
		expect(queryOne.mock.calls[0][1][2]).toBe(OWN_UPLOAD);
	});

	it("keeps the current avatar when avatar_url is null", async () => {
		await updateUserProfile("uid-1", { username: "Max", avatar_url: null });

		expect(queryOne.mock.calls[0][1]).toEqual(["uid-1", "Max", null, null]);
	});

	it("rejects a disallowed avatar URL with 400 before touching the database", async () => {
		await expect(
			updateUserProfile("uid-1", {
				avatar_url: "https://tracker.example/pixel.png",
			}),
		).rejects.toMatchObject({ statusCode: 400, message: "Invalid avatar URL" });
		expect(queryOne).not.toHaveBeenCalled();
	});
});
