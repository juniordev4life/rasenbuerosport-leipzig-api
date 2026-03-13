import "dotenv/config";
import { recalculateAllElo } from "../src/api/services/elo.services.js";

/**
 * One-time script to retroactively calculate Elo ratings for all existing games.
 * Run after executing 003_elo_system.sql migration.
 *
 * Usage: node migrations/recalculate-elo.js
 */
async function main() {
	console.log("Starting retroactive Elo calculation...\n");

	try {
		const result = await recalculateAllElo();
		console.log("\n✅ Elo recalculation complete!");
		console.log(`   Games processed: ${result.gamesProcessed}`);
		console.log(`   Players rated:   ${result.playersRated}`);
	} catch (error) {
		console.error("❌ Elo recalculation failed:", error);
		process.exit(1);
	}

	process.exit(0);
}

main();
