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
 * Executes a SQL query and returns the first row or null
 * @param {string} sql - Parameterized SQL query
 * @param {any[]} [params] - Query parameters
 * @returns {Promise<object|null>}
 */
export async function queryOne(sql, params = []) {
	const { rows } = await getPool().query(sql, params);
	return rows[0] || null;
}
