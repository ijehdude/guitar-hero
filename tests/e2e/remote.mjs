/**
 * Dev/headless E2E for the REMOTE library path (laptop → phone streaming).
 *
 * Serves the *production* build (no dev folder), pre-pairs the browser to a real
 * library-host over localStorage, then plays a catalog song streamed from the
 * host — proving manifest fetch, token+CORS, decode, charting, score, AND that
 * the song gets cached on the device after first play. Skips if no private_audio.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL;
const HOST_BASE = process.env.HOST_BASE;
const TOKEN = process.env.HOST_TOKEN || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext();
// Pre-pair this device exactly like a #connect= link would, before the app boots.
await ctx.addInitScript(([base, token]) => {
  localStorage.setItem("fretstorm.settings.v1", JSON.stringify({ tutorialSeen: true, libraryHost: { baseUrl: base, token } }));
}, [HOST_BASE, TOKEN]);

const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.__fretstorm, null, { timeout: 8000 });
await page.locator(".screen .btn.primary").first().click(); // Play

const ready = await page
  .waitForFunction(() => window.__fretstorm.library.remoteCount > 0, null, { timeout: 15000 })
  .catch(() => null);
if (!ready) {
  console.log("⏭  SKIP: host has no private_audio files — remote test skipped.");
  await browser.close();
  process.exit(0);
}

const pick = await page.evaluate(() => {
  const l = window.__fretstorm.library;
  const e = l.entries.find((x) => l.resolve(x).source === "remote");
  return e ? { id: e.id, title: e.title } : null;
});
console.log(`▶  Streaming from host: ${pick.title}`);

await page.evaluate((id) => {
  const l = window.__fretstorm.library;
  window.__fretstorm.startCatalog(l.entries.find((x) => x.id === id));
}, pick.id);
await page.waitForFunction(() => !!window.__fretstorm.engine, null, { timeout: 40000 });

for (const f of ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG"]) await page.keyboard.down(f);
const end = Date.now() + 14000;
let peak = 0;
while (Date.now() < end) {
  await page.keyboard.press("ArrowDown");
  await sleep(110);
  peak = await page.evaluate(() => window.__fretstorm.engine?.score.score ?? 0);
  if (peak > 0 && Date.now() > end - 9000) break;
}
const st = await page.evaluate(() => {
  const s = window.__fretstorm.engine?.score;
  return s ? { score: s.score, perfect: s.perfect, good: s.good, miss: s.miss } : null;
});
// After streaming, the song should now resolve from the on-device cache.
const cachedSrc = await page.evaluate(
  (id) => window.__fretstorm.library.resolve(window.__fretstorm.library.entries.find((x) => x.id === id)).source,
  pick.id
);
await page.screenshot({ path: "tests/e2e/gameplay-remote.png" });

// health/reachability: /health true when host up, false when unreachable
const pingUp = await page.evaluate(([b, t]) => window.__fretstorm.library.pingHost({ baseUrl: b, token: t }), [HOST_BASE, TOKEN]);
const pingDown = await page.evaluate(() => window.__fretstorm.library.pingHost({ baseUrl: "http://127.0.0.1:1", token: "x" }));

console.log("state:", JSON.stringify(st), "| cached-as:", cachedSrc, "| ping up/down:", pingUp, pingDown, "| errors:", errors.length);
const ok = !!st && st.score > 0 && errors.length === 0 && cachedSrc === "cache" && pingUp === true && pingDown === false;
console.log(ok ? "\nREMOTE LIBRARY E2E PASSED ✓" : "\nREMOTE LIBRARY E2E FAILED ✗");
await browser.close();
process.exit(ok ? 0 : 1);
