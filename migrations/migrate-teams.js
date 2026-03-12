import { readFileSync } from "node:fs";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:PASSWORT@127.0.0.1:5432/rasenbuerosport";
const BUCKET = "rasenbuerosport-leipzig-9d54f.firebasestorage.app";
const LOGO_DIR = join(homedir(), "team-logos-temp");

/**
 * Parse CSV - handles commas in quoted fields
 * @param {string} csv
 * @returns {{ headers: string[], rows: string[][] }}
 */
function parseCsv(csv) {
	const lines = csv.trim().split("\n");
	const headers = lines[0].split(",");
	const rows = [];

	for (let i = 1; i < lines.length; i++) {
		const row = [];
		let current = "";
		let inQuotes = false;

		for (const char of lines[i]) {
			if (char === '"') {
				inQuotes = !inQuotes;
			} else if (char === "," && !inQuotes) {
				row.push(current);
				current = "";
			} else {
				current += char;
			}
		}
		row.push(current);
		rows.push(row);
	}

	return { headers, rows };
}

/**
 * Convert CSV value to SQL-safe value
 * @param {string} val
 * @returns {string|null}
 */
function toValue(val) {
	if (!val || val === "null" || val === "") return null;
	return val;
}

async function main() {
	// 1. Read and parse CSV
	const csvPath = join(homedir(), "teams_full.csv");
	console.log(`Reading CSV from ${csvPath}...`);
	const csv = readFileSync(csvPath, "utf-8");
	const { headers, rows } = parseCsv(csv);
	console.log(`Found ${rows.length} teams, columns: ${headers.join(", ")}`);

	// 2. Connect to database
	const pool = new Pool({ connectionString: DATABASE_URL });
	console.log("Connected to database");

	// 3. Clear existing teams (from partial import)
	await pool.query("DELETE FROM teams");
	console.log("Cleared existing teams");

	// 4. Insert all teams
	let inserted = 0;
	for (const row of rows) {
		const id = toValue(row[0]);
		const name = toValue(row[1]);
		const shortName = toValue(row[2]);
		const logoUrl = toValue(row[3]);
		const sofifaId = toValue(row[4]);
		const overallRating = toValue(row[5]);
		const starRating = toValue(row[6]);
		const leagueName = toValue(row[7]);
		const countryCode = toValue(row[8]);

		if (!id || !name) continue;

		await pool.query(
			`INSERT INTO teams (id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			 ON CONFLICT (id) DO NOTHING`,
			[id, name, shortName, logoUrl, sofifaId ? Number(sofifaId) : null, overallRating ? Number(overallRating) : null, starRating ? Number(starRating) : null, leagueName, countryCode],
		);
		inserted++;
	}
	console.log(`Inserted ${inserted} teams`);

	// 5. Download all logos
	await mkdir(LOGO_DIR, { recursive: true });
	console.log(`Downloading logos to ${LOGO_DIR}...`);

	const teamsWithLogos = rows.filter((r) => toValue(r[3]));
	let downloaded = 0;
	let failed = 0;

	for (const row of teamsWithLogos) {
		const logoUrl = row[3];
		const sofifaId = toValue(row[4]);
		if (!logoUrl || logoUrl === "null") continue;

		// Extract filename from URL (e.g., "85.png")
		const urlParts = logoUrl.split("/");
		const filename = urlParts[urlParts.length - 1];
		const filePath = join(LOGO_DIR, filename);

		try {
			const res = await fetch(logoUrl);
			if (!res.ok) {
				console.error(`  Failed (${res.status}): ${filename}`);
				failed++;
				continue;
			}
			const buffer = Buffer.from(await res.arrayBuffer());
			await writeFile(filePath, buffer);
			downloaded++;

			if (downloaded % 50 === 0) {
				console.log(`  Downloaded ${downloaded}/${teamsWithLogos.length}...`);
			}
		} catch (err) {
			console.error(`  Error downloading ${filename}: ${err.message}`);
			failed++;
		}
	}
	console.log(`Downloaded ${downloaded} logos (${failed} failed)`);

	// 6. Upload to Cloud Storage via gsutil
	console.log(`\nUploading logos to gs://${BUCKET}/team-logos/...`);
	const { execSync } = await import("node:child_process");

	try {
		execSync(`gcloud storage cp "${LOGO_DIR}/*" gs://${BUCKET}/team-logos/`, {
			stdio: "inherit",
		});
		console.log("Upload complete!");
	} catch (err) {
		console.error("Upload failed. Try manually:");
		console.error(`gcloud storage cp "${LOGO_DIR}/*" gs://${BUCKET}/team-logos/`);
	}

	// 7. Update logo URLs in database
	console.log("Updating logo URLs in database...");
	const publicBase = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/team-logos%2F`;

	// Get list of successfully uploaded files
	const uploadedFiles = await readdir(LOGO_DIR);

	let updated = 0;
	for (const row of teamsWithLogos) {
		const id = row[0];
		const logoUrl = row[3];
		if (!logoUrl || logoUrl === "null") continue;

		const urlParts = logoUrl.split("/");
		const filename = urlParts[urlParts.length - 1];

		if (uploadedFiles.includes(filename)) {
			const newUrl = `${publicBase}${filename}?alt=media`;
			await pool.query("UPDATE teams SET logo_url = $1 WHERE id = $2", [newUrl, id]);
			updated++;
		}
	}
	console.log(`Updated ${updated} logo URLs`);

	await pool.end();
	console.log("\nDone! Migration complete.");
}

main().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
