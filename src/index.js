import "dotenv/config";
import { createServer } from "./server.js";
import { setup } from "./setup.js";

const server = createServer();

await setup(server);

const port = Number.parseInt(process.env.PORT, 10) || 3001;
const host = process.env.HOST || "0.0.0.0";

try {
	await server.listen({ port, host });
} catch (err) {
	server.log.error(err);
	process.exit(1);
}
