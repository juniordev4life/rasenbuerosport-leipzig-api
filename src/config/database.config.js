import pg from "pg";

const { Pool } = pg;

let pool = null;

/**
 * Returns the PostgreSQL connection pool singleton
 * @returns {pg.Pool}
 */
export function getPool() {
	if (!pool) {
		pool = new Pool({
			connectionString: process.env.DATABASE_URL,
			max: 10,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 5000,
		});
	}
	return pool;
}

/**
 * Gracefully closes the pool (for shutdown hooks)
 * @returns {Promise<void>}
 */
export async function closePool() {
	if (pool) {
		await pool.end();
		pool = null;
	}
}
