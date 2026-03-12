import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL =
	process.env.DATABASE_URL ||
	"postgresql://postgres:PASSWORT@127.0.0.1:5432/rasenbuerosport";
const FIREBASE_PROJECT_ID = "rasenbuerosport-leipzig-9d54f";

// Mapping: Supabase UUID -> Email -> Username
const USER_MAP = [
	{
		supabaseId: "255002d0-a6ff-4685-80d0-0acaf67ea9ab",
		email: "jeniffen.chandrabalan@redbulls.com",
		username: "jeniffen.chandrabalan",
	},
	{
		supabaseId: "2c884921-950a-45fa-a552-ebcf51f9e400",
		email: "dirk.schwarz@redbulls.com",
		username: "blacky1707",
	},
	{
		supabaseId: "fe3a0b5b-b8a4-441f-829b-38d9924ca3c6",
		email: "florian.alber@redbulls.com",
		username: "Florian",
	},
	{
		supabaseId: "bb93ec19-1551-4c14-920a-ab005deb3356",
		email: "niklas.kewerkopf@redbulls.com",
		username: "Nikinho",
	},
	{
		supabaseId: "80823558-3369-4807-a8fc-e1eb7bcc97e9",
		email: "marco.slusalek@redbulls.com",
		username: "Marco",
	},
];

async function main() {
	// 1. Initialize Firebase Admin
	initializeApp({
		projectId: FIREBASE_PROJECT_ID,
		credential: applicationDefault(),
	});
	const auth = getAuth();
	console.log("Firebase Admin initialized");

	// 2. Connect to database
	const pool = new Pool({ connectionString: DATABASE_URL });
	console.log("Connected to database");

	// 3. Create Firebase users and collect UID mapping
	const uidMap = [];

	for (const user of USER_MAP) {
		try {
			// Check if user already exists in Firebase
			let firebaseUser;
			try {
				firebaseUser = await auth.getUserByEmail(user.email);
				console.log(
					`  Found existing Firebase user: ${user.email} -> ${firebaseUser.uid}`,
				);
			} catch {
				// User doesn't exist, create
				firebaseUser = await auth.createUser({
					email: user.email,
					displayName: user.username,
					emailVerified: true,
				});
				console.log(
					`  Created Firebase user: ${user.email} -> ${firebaseUser.uid}`,
				);
			}

			uidMap.push({
				oldId: user.supabaseId,
				newId: firebaseUser.uid,
				email: user.email,
				username: user.username,
			});
		} catch (err) {
			console.error(`  Failed for ${user.email}: ${err.message}`);
		}
	}

	console.log(`\nUID Mapping (${uidMap.length} users):`);
	for (const m of uidMap) {
		console.log(`  ${m.username}: ${m.oldId} -> ${m.newId}`);
	}

	// 4. Disable FK constraints temporarily and update IDs directly
	console.log("\nUpdating profiles IDs...");
	for (const m of uidMap) {
		// Drop FKs, update ID, re-add FKs
		await pool.query(
			"UPDATE game_players SET player_id = $1 WHERE player_id = $2",
			[m.newId, m.oldId],
		);
		await pool.query("UPDATE games SET created_by = $1 WHERE created_by = $2", [
			m.newId,
			m.oldId,
		]);
		await pool.query("UPDATE profiles SET id = $1 WHERE id = $2", [
			m.newId,
			m.oldId,
		]);
		console.log(`  ${m.username}: updated`);
	}

	// 8. Verify
	const { rows } = await pool.query(
		"SELECT id, username FROM profiles ORDER BY username",
	);
	console.log("\nFinal profiles:");
	for (const r of rows) {
		console.log(`  ${r.username}: ${r.id}`);
	}

	await pool.end();
	console.log("\nDone! User migration complete.");
}

main().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
