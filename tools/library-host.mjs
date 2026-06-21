/**
 * FRETSTORM LIBRARY HOST  —  run on your (24/7) laptop:  `npm run host`
 *
 * Streams the audio in ./private_audio to YOUR phone so you can open the hosted
 * app (e.g. guitar-hero-fawn.vercel.app) anywhere and play, with NO upload. The
 * audio goes laptop → phone directly; it is never stored on Vercel/GitHub.
 *
 * Security: every request needs a secret token (persisted in
 * private_audio/.host.json). CORS is restricted to the app origin. The token is
 * passed to the phone via the URL hash, so it's never sent to Vercel's servers.
 *
 * Transport: serves plain HTTP locally; if `cloudflared` is installed it opens a
 * free HTTPS tunnel and prints a pairing link + QR. (Any tunnel works.)
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const DIR = path.resolve(process.cwd(), "private_audio");
const PORT = Number(process.env.HOST_PORT || 8788);
const APP_URL = process.env.APP_URL || "https://guitar-hero-fawn.vercel.app";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || new URL(APP_URL).origin;
const AUDIO_RE = /\.(mp3|m4a|ogg|wav|flac)$/i;

// ---- persistent token + optional permanent URL ------------------------------
const tokenFile = path.join(DIR, ".host.json");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(tokenFile, "utf8")) || {}; } catch {}
let token = cfg.token || "";
if (!token) {
  token = crypto.randomBytes(24).toString("base64url");
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(tokenFile, JSON.stringify({ ...cfg, token }, null, 2)); } catch {}
}
// A stable public URL (Tailscale Funnel / Cloudflare named tunnel) → pair once,
// forever. Set via env PUBLIC_URL or "publicUrl" in private_audio/.host.json.
const PUBLIC_URL = (process.env.PUBLIC_URL || cfg.publicUrl || "").replace(/\/+$/, "");

const listFiles = () => { try { return fs.readdirSync(DIR).filter((f) => AUDIO_RE.test(f)); } catch { return []; } };

function lanIP() {
  for (const ifc of Object.values(os.networkInterfaces()).flat()) {
    if (ifc && ifc.family === "IPv4" && !ifc.internal) return ifc.address;
  }
  return "localhost";
}

// ---- server -----------------------------------------------------------------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, Content-Type");

  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const tok = u.searchParams.get("token") || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (tok !== token) { res.statusCode = 403; return res.end("forbidden"); }

  if (u.pathname === "/health") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, count: listFiles().length }));
  }

  if (u.pathname === "/manifest") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ files: listFiles() }));
  }

  if (u.pathname.startsWith("/audio/")) {
    const name = decodeURIComponent(u.pathname.slice("/audio/".length));
    const fp = path.join(DIR, name);
    if (!fp.startsWith(DIR) || !AUDIO_RE.test(fp) || !fs.existsSync(fp)) { res.statusCode = 404; return res.end("not found"); }
    const size = fs.statSync(fp).size;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", "audio/mpeg");
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      let start = range[1] ? parseInt(range[1], 10) : 0;
      let end = range[2] ? parseInt(range[2], 10) : size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= size) end = size - 1;
      if (start > end) { res.statusCode = 416; res.setHeader("Content-Range", `bytes */${size}`); return res.end(); }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
      return fs.createReadStream(fp, { start, end }).pipe(res);
    }
    res.setHeader("Content-Length", size);
    return fs.createReadStream(fp).pipe(res);
  }

  res.statusCode = 404;
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`\n🎸 FRETSTORM library host`);
  console.log(`   serving ${listFiles().length} songs from ${DIR}`);
  console.log(`   local:  http://localhost:${PORT}   (LAN: http://${lanIP()}:${PORT})`);
  if (PUBLIC_URL) {
    // Stable URL configured → pair once, forever. No quick tunnel needed.
    printPairing(PUBLIC_URL, "permanent");
    console.log(`   Using permanent URL ${PUBLIC_URL} — make sure your tunnel`);
    console.log(`   (Tailscale Funnel / Cloudflare named tunnel) forwards it to port ${PORT}.`);
  } else if (process.env.NO_TUNNEL) {
    console.log(`   (tunnel disabled — token: ${token})`);
  } else {
    startTunnel();
  }
});

// ---- pairing + tunnel -------------------------------------------------------
function printPairing(base, note = "") {
  const link = `${APP_URL}/#connect=${encodeURIComponent(base)}~${encodeURIComponent(token)}`;
  console.log(`\n────────────────────────────────────────────────────────`);
  console.log(`📱 Pair your phone — open this link or scan the QR${note ? ` (${note})` : ""}:`);
  console.log(`\n   ${link}\n`);
  import("qrcode-terminal")
    .then((q) => q.default.generate(link, { small: true }))
    .catch(() => console.log("   (install qrcode-terminal to show a QR here)"));
  console.log(`\n   Keep this link private — the token is your access key.`);
  console.log(`────────────────────────────────────────────────────────\n`);
}

function startTunnel() {
  const cf = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`], { stdio: ["ignore", "pipe", "pipe"] });
  let printed = false;
  const scan = (buf) => {
    const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !printed) { printed = true; printPairing(m[0]); }
  };
  cf.stdout.on("data", scan);
  cf.stderr.on("data", scan);
  cf.on("error", () => {
    console.log(`\n⚠  cloudflared not found — install it for an HTTPS link that works anywhere:`);
    console.log(`     macOS:  brew install cloudflared`);
    console.log(`   Or, on the SAME Wi-Fi as your laptop, pair with the LAN address:`);
    printPairing(`http://${lanIP()}:${PORT}`, "same Wi-Fi only");
  });
  process.on("SIGINT", () => { try { cf.kill(); } catch {} process.exit(0); });
}
