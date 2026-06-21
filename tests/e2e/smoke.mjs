/**
 * End-to-end smoke test — drives FRETSTORM in a real (headless) Chromium:
 * navigates the menus, plays a built-in song with real keyboard input, and
 * asserts the score actually climbs. Also confirms the contrast case (holding
 * frets WITHOUT strumming scores nothing) so the reported bug can't regress.
 *
 * Run via:  npm run test:e2e   (builds, serves dist/, runs this)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4317";
const FRETS = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG"];
let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✅ PASS" : "❌ FAIL"}  ${name}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gotoSong(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(BASE, { waitUntil: "networkidle" });
  // First-run "How to Play" → Skip (a real click counts as the audio-unlock gesture)
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  // Menu → Play (primary button)
  await page.locator(".screen .btn.primary").first().click();
  // Song select → first (unlocked) song card
  await page.locator(".screen .list .card").first().click();
  // wait until the engine is live
  await page.waitForFunction(() => !!window.__fretstorm?.engine, null, { timeout: 12000 });
  return errors;
}

async function run() {
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });

  // ---- Scenario 1: real play (fret + strum) should score ------------------
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = await gotoSong(page);

    // Hold all five frets (legal in Easy/Medium → any single note matches),
    // then strum repeatedly while notes arrive.
    for (const f of FRETS) await page.keyboard.down(f);
    const deadline = Date.now() + 13000;
    let peak = 0;
    while (Date.now() < deadline) {
      await page.keyboard.press("ArrowDown");
      await sleep(110);
      peak = await page.evaluate(() => window.__fretstorm.engine?.score.score ?? 0);
      if (peak > 0 && Date.now() > deadline - 9000) break; // early out once scoring proven
    }
    for (const f of FRETS) await page.keyboard.up(f);

    const state = await page.evaluate(() => {
      const s = window.__fretstorm.engine?.score;
      return s ? { score: s.score, combo: s.combo, perfect: s.perfect, good: s.good, miss: s.miss } : null;
    });
    console.log("   live state:", JSON.stringify(state));

    await page.screenshot({ path: "tests/e2e/gameplay.png" });
    check("no uncaught page errors", errors.length === 0);
    if (errors.length) console.log("   errors:", errors.slice(0, 4));
    check("score climbs above zero with fret + strum", !!state && state.score > 0);
    check("hits registered (perfect+good > 0)", !!state && state.perfect + state.good > 0);
    await ctx.close();
  }

  // ---- Scenario 2: holding frets WITHOUT strumming scores nothing ---------
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await gotoSong(page);
    for (const f of FRETS) await page.keyboard.down(f); // never strum
    await sleep(12000);
    for (const f of FRETS) await page.keyboard.up(f);
    const state = await page.evaluate(() => {
      const s = window.__fretstorm.engine?.score;
      return s ? { score: s.score, miss: s.miss } : null;
    });
    console.log("   no-strum state:", JSON.stringify(state));
    check("no strum => score stays zero", !!state && state.score === 0);
    check("no strum => notes counted as misses", !!state && state.miss > 0);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL E2E TESTS PASSED ✓" : failures + " E2E TEST(S) FAILED ✗"}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
