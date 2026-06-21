/**
 * Self-contained E2E runner: serves the production build with Vite's preview
 * server, points the smoke test at it, then tears down. Assumes `vite build`
 * has run (the npm script chains it).
 */
import { preview } from "vite";

const PORT = 4317;
const server = await preview({
  preview: { port: PORT, host: false, strictPort: true },
});
process.env.BASE_URL = `http://localhost:${PORT}`;
console.log(`[e2e] serving dist/ on ${process.env.BASE_URL}`);

// smoke.mjs runs on import and calls process.exit() with the result code,
// which also tears down this preview server.
await import("./smoke.mjs");
// (unreached — smoke.mjs exits) keep a reference so the server isn't GC'd early
void server;
