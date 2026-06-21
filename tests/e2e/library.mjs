/**
 * Dev-mode E2E: verifies the in-app LIBRARY end-to-end against your local
 * `private_audio/` folder — manifest → fuzzy match → decode → browser charting →
 * play → score. Skips gracefully (exit 0) if no private audio is present, so it
 * never fails for someone who hasn't added their own files.
 *
 * Run via:  npm run test:e2e:library   (starts a vite DEV server + this)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5174";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: "networkidle" });
const skip = page.getByRole("button", { name: "Skip" });
if (await skip.isVisible().catch(() => false)) await skip.click();
await page.locator(".screen .btn.primary").first().click(); // Play → song select
await page.waitForFunction(() => !!window.__fretstorm, null, { timeout: 8000 });
await page.evaluate(() => window.__fretstorm.library.init?.()); // ensure ready
await sleep(800);

// Pick whichever catalog song actually has audio on this machine.
const pick = await page.evaluate(() => {
  const lib = window.__fretstorm.library;
  const e = lib.entries.find((x) => lib.isAvailable(x.id));
  return e ? { id: e.id, title: e.title } : null;
});

if (!pick) {
  console.log("⏭  SKIP: no private_audio files present — library play test skipped.");
  await browser.close();
  process.exit(0);
}
console.log(`▶  Playing catalog song: ${pick.title}`);

await page.evaluate((id) => {
  const lib = window.__fretstorm.library;
  window.__fretstorm.startCatalog(lib.entries.find((x) => x.id === id));
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
  const tdur = window.__fretstorm.engine?.track?.duration ?? null;
  const holds = (window.__fretstorm.engine?.chart?.notes ?? []).filter((n) => (n.duration ?? 0) > 0).length;
  return { score: s?.score, perfect: s?.perfect, good: s?.good, miss: s?.miss, trackDur: tdur, holds };
});
console.log("state:", JSON.stringify(st), "| errors:", errors.length);

// Songs now play FULL length (TtFaF is ~7 min, so well over the old 185s cap),
// and the GH2-style charter should produce at least some tap-and-hold notes.
const fullLength = st.trackDur != null && st.trackDur > 185;
const ok = !!st && st.score > 0 && errors.length === 0 && fullLength;
if (!fullLength) console.log("  ✗ expected full-length track (>185s), got", st.trackDur);
console.log("  holds in chart:", st.holds);
console.log(ok ? "\nLIBRARY E2E PASSED ✓" : "\nLIBRARY E2E FAILED ✗");
await browser.close();
process.exit(ok ? 0 : 1);
