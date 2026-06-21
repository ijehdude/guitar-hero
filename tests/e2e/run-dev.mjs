/**
 * Runner for the dev-mode library E2E. Boots a real Vite DEV server (so the
 * dev-only private_audio plugin is active), then runs library.mjs against it.
 */
import { createServer } from "vite";

const PORT = 5174;
const server = await createServer({ server: { port: PORT, strictPort: true } });
await server.listen();
process.env.BASE_URL = `http://localhost:${PORT}`;
console.log(`[e2e:dev] vite dev serving on ${process.env.BASE_URL}`);

await import("./library.mjs"); // runs and process.exit()s
void server;
