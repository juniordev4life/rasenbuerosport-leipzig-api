/**
 * Vitest global setup — runs once before every test file.
 *
 * Sets benign defaults for environment variables that some modules read at
 * import time. Tests should still call `vi.mock(...)` for any external
 * dependency they actually depend on (Firebase Admin, Anthropic, Postgres pool).
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ||
	"postgresql://postgres:localdev@127.0.0.1:5434/rasenbuerosport_test";
process.env.FIREBASE_PROJECT_ID =
	process.env.FIREBASE_PROJECT_ID || "rasenbuerosport-test";
process.env.WRAPPED_TRIGGER_SECRET =
	process.env.WRAPPED_TRIGGER_SECRET || "test-wrapped-secret";
process.env.ANTHROPIC_API_KEY =
	process.env.ANTHROPIC_API_KEY || "test-anthropic-key";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
