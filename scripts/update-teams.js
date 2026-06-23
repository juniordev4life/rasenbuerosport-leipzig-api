#!/usr/bin/env node

/**
 * Updates the teams table end-to-end in a single step.
 *
 * Runs the three-stage team pipeline in order:
 *   1. parse-sofifa-leagues.js — regenerates scripts/scraped-teams.json
 *      from the SoFIFA RTF files in ligen/
 *   2. import-teams.js — upserts every team into Cloud SQL
 *      (ON CONFLICT (name) DO UPDATE, preserving existing UUIDs). This writes
 *      SoFIFA-CDN logo_urls.
 *   3. update-logo-urls.js — rewrites logo_url from the SoFIFA CDN back to the
 *      Firebase Storage bucket, so logos stay self-hosted (matches PROD).
 *
 * Bundling step 3 makes the logo re-hosting impossible to forget. Note: a
 * brand-new club added in a run gets a Firebase URL whose image may not be in
 * the bucket yet (404) — fetch/upload it with download-logos.js if so.
 *
 * Each step is transactional and a non-zero exit aborts the run before the
 * next step. DATABASE_URL is required and checked up front, so a missing
 * connection string fails fast — before any parsing work is done.
 *
 * Run:
 *   cloud-sql-proxy rasenbuerosport-leipzig-9d54f:europe-west3:rasenbuerosport-db --port=5433 &
 *   DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:5433/rasenbuerosport" npm run teams:update
 */

import "dotenv/config";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
	console.error("Missing DATABASE_URL in environment — aborting before parse.");
	console.error(
		'Set it, e.g.: DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:5433/rasenbuerosport" npm run teams:update',
	);
	process.exit(1);
}

const scriptsDir = import.meta.dirname;

/**
 * Runs a sibling script as a child Node process, inheriting stdio.
 * A non-zero exit throws, which aborts the pipeline.
 * @param {string} file - script filename relative to this scripts/ dir
 * @param {string} label - human-readable step label for logging
 * @returns {void}
 * @example
 * runStep("parse-sofifa-leagues.js", "Step 1/3 — Parse SoFIFA leagues");
 */
function runStep(file, label) {
	console.log(`\n▶ ${label} (${file})`);
	execFileSync(process.execPath, [join(scriptsDir, file)], {
		stdio: "inherit",
	});
}

// ── Main ────────────────────────────────────────────────────────────

console.log("Updating teams: parse → import → re-host logos");

try {
	runStep("parse-sofifa-leagues.js", "Step 1/3 — Parse SoFIFA leagues");
	runStep("import-teams.js", "Step 2/3 — Upsert teams into Cloud SQL");
	runStep(
		"update-logo-urls.js",
		"Step 3/3 — Re-host logos on Firebase Storage",
	);
	console.log("\n✓ Teams update complete (logos re-hosted on Firebase).");
	console.log(
		"  Note: brand-new clubs may need their logo uploaded to the bucket (scripts/download-logos.js).",
	);
} catch (err) {
	console.error(`\n✗ Teams update failed: ${err.message}`);
	process.exit(1);
}
