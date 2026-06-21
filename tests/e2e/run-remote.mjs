/**
 * Runner for the remote-library E2E. Boots a real library-host (no tunnel) +
 * a Vite preview server (the production build), then runs remote.mjs against
 * both. Assumes `vite build` already ran (the npm script chains it).
 */
import { spawn } from "node:child_process";
import { preview } from "vite";
import fs from "node:fs";
import path from "node:path";

const HOST_PORT = 8799;
const APP_PORT = 4318;

// 1) start the library host (token written to private_audio/.host.json)
const host = spawn(process.execPath, ["tools/library-host.mjs"], {
  env: { ...process.env, HOST_PORT: String(HOST_PORT), NO_TUNNEL: "1", ALLOW_ORIGIN: `http://localhost:${APP_PORT}` },
  stdio: "inherit",
});
process.on("exit", () => { try { host.kill(); } catch {} });
await new Promise((r) => setTimeout(r, 1000));

let token = "";
try { token = JSON.parse(fs.readFileSync(path.resolve("private_audio/.host.json"), "utf8")).token; } catch {}

// 2) serve the production build
const server = await preview({ preview: { port: APP_PORT, strictPort: true } });
process.env.BASE_URL = `http://localhost:${APP_PORT}`;
process.env.HOST_BASE = `http://localhost:${HOST_PORT}`;
process.env.HOST_TOKEN = token;
console.log(`[e2e:remote] app ${process.env.BASE_URL}  host ${process.env.HOST_BASE}`);

await import("./remote.mjs"); // runs and process.exit()s (host killed on exit)
void server;
