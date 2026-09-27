import { getPool } from "../../config/database.config.js";

/**
 * Executes a SQL query and returns all rows
 * @param {string} sql - Parameterized SQL query
 * @param {any[]} [params] - Query parameters
 * @returns {Promise<object[]>}
 */
export async function query(sql, params = []) {
	const { rows } = await getPool().query(sql, params);
	return rows;
}

/**
 * Runs `fn` inside a transaction on a dedicated pool client. Always ends the
 * transaction: COMMIT on success, ROLLBACK on any error (also errors that
 * carry a statusCode), so a failed call can never hand a connection with an
 * open transaction back to the pool. A connection whose ROLLBACK itself fails
 * is destroyed instead of being reused.
 *
 * @template T
 * @param {(client: import("pg").PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @example
 * const game = await withTransaction(async (client) => {
 *   const { rows } = await client.query("SELECT * FROM games WHERE id = $1 FOR UPDATE", [id]);
 *   return rows[0];
 * });
 */
export async function withTransaction(fn) {
	const client = await getPool().connect();
	let broken = false;
	try {
		await client.query("BEGIN");
		const result = await fn(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK").catch(() => {
			broken = true;
		});
		throw error;
	} finally {
		client.release(broken ? true : undefined);
	}
}

/**
 * Executes a SQL query and returns the first row or null
 * @param {string} sql - Parameterized SQL query
 * @param {any[]} [params] - Query parameters
 * @returns {Promise<object|null>}
 */
export async function queryOne(sql, params = []) {
	const { rows } = await getPool().query(sql, params);
	return rows[0] || null;
}
