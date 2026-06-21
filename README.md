# FRETSTORM ⚡

A neon-arcade **rhythm guitar game** for the browser — 5 coloured frets + a strum,
notes scrolling down a glowing highway, chords, combos, a multiplier, and a
star-power **overdrive**. Plays on **phones (touch)** and **desktop (keyboard)**
from one codebase. Built with **Vite + TypeScript + Canvas 2D + Web Audio** and
deploys to **Vercel as a static site** with zero backend.

> Working title chosen from three candidates: **FRETSTORM**, _Riff Riot_, _Neon Fretline_.

![stack](https://img.shields.io/badge/stack-Vite%20%2B%20TS%20%2B%20Canvas%20%2B%20WebAudio-ff2d95) ![deploy](https://img.shields.io/badge/deploy-Vercel%20(static)-14f1ff)

---

## ✨ What's in the MVP

- **Neon note highway** — pseudo-3D perspective lanes, reactive stage lighting,
  scrolling beat lines, animated strike targets.
- **5 frets + strum**, single notes **and chords**, plus **sustains** (held notes).
- **Tight hit detection** — Perfect / Good / Miss timing windows judged against
  the **audio hardware clock** (not rAF), with player **latency calibration**.
- **Scoring**: score, combo, streak-based **multiplier (1×→4×)**, and
  **Overdrive** (star power) that doubles the multiplier and ignites the screen.
- **Difficulties**: Easy / Medium / Hard / Expert (density, fret count, chord size).
- **2 + 1 built-in songs** — original, royalty-free music synthesised in-browser,
  with charts generated from the *same* note data the synth plays → perfect sync.
  (Plus a bonus track unlocked at 4★.)
- **Load your own audio** → **in-browser auto-charting** (onset/tempo/energy
  analysis, Web Audio, no server), cached in IndexedDB.
- **Juice**: particle bursts, perfect-hit shards, shock rings, screen shake,
  combo-reactive glow, satisfying SFX.
- **Accessibility & onboarding**: interactive first-run tutorial, forgiving Easy /
  Hit-Assist mode, **colour-blind shapes** per fret, adjustable note speed,
  remappable keys, left-handed mirror, screen-shake toggle, latency calibrator.
- **Persistent** high scores, unlocks, and settings (localStorage).

---

## 🎮 Controls

**Desktop (default, all remappable in Settings):**

| Action | Key |
| --- | --- |
| Frets (green → orange) | `A` `S` `D` `F` `G` |
| Strum | `↓` / `↑` |
| Overdrive | `Space` |
| Pause | `Esc` |

**Mobile:** tap the 5 coloured fret buttons; **tap or swipe the strum bar** below
them. The on-screen **star** button (bottom-left) fires Overdrive when ready.

---

## 🎵 Your music library (local audio, never uploaded)

FRETSTORM ships an **in-app Library** — a curated catalog of iconic songs as
**metadata only** (titles/artists/groups), with a **local artist/title search**
that never touches the network. **No audio is bundled or deployed.** A catalog
song becomes playable once its audio is present *on your device*, two ways:

- **Local dev folder:** drop files into **`private_audio/`** (git-ignored). The
  dev server serves them only during `npm run dev`; they're auto-matched to the
  catalog by filename (`Artist - Title.mp3`), auto-charted in the browser, and
  cached. **This folder is never committed or deployed** (see `.gitignore` +
  `vite.config.ts` — the loader is `apply: "serve"` only).
- **In-app Import** (works on the hosted site too): *Songs → Import / Add Audio*
  → pick your files. They're decoded, charted, and cached in **IndexedDB on your
  device**. Nothing is uploaded to any server.

**~3-minute clips.** Library songs are auto-trimmed to a single ~3-min window
chosen around the **loudest section** (almost always the chorus), so sessions stay
snappy. To set it by ear, tap the **✂︎** next to a song: drag where the clip starts,
**Preview**, then **Save** (saved on that device; or pin it for all devices in
`src/data/segments.json`). FRETSTORM Originals are short and play in full.

> ⚖️ **Use music you own.** The app never sources or distributes audio — you
> supply your own files, which stay on your machine/browser. Online "search any
> song" (rip from YouTube etc.) is **intentionally not built** — it raises real
> copyright/ToS issues and doesn't fit a static deploy. It remains a clearly
> labelled, stubbed pluggable interface; see `ROADMAP.md` (Phase 4).

**What runs where:** the catalog UI, local search, browser charting, IndexedDB
caching, the FRETSTORM Originals (synth tracks), and user-supplied audio all run
**client-side and deploy fine to Vercel**. The only thing that's local-dev-only
is reading the `private_audio/` folder.

## 📡 Play your home library from anywhere (laptop streams to your phone)

Want to open the **hosted** app on your phone — even on cellular — and play your
own library **without uploading anything**? Run a tiny **library host** on a
laptop (ideally on 24/7 at home); it streams the audio in `private_audio/`
straight to your phone. The audio never touches Vercel.

**One-time setup**

```bash
# on the laptop (where private_audio/ lives):
brew install cloudflared        # free HTTPS tunnel (or use Tailscale Funnel)
npm run host                    # serves private_audio/, opens a tunnel,
                                # prints a pairing link + QR
```

**Pair your phone (once):** scan the printed **QR** with your phone camera — it
opens the app already paired — or copy the link into the app: *Settings →
Your Library → paste → Connect*. Then just pick a song and play.

- 🔒 **Token-gated to you.** Every request needs a secret token (stored in
  `private_audio/.host.json`); the token rides in the URL **hash**, so it's never
  sent to Vercel. CORS is locked to the app origin. **Don't share the link.**
- 📥 **Caches after first play.** Once you've streamed a song, it's cached in your
  phone's IndexedDB — replays don't need the laptop.
- 🟢 **In-app status.** The song list shows **Library online · N songs** /
  **Library offline** so you always know if the laptop is reachable (tap it to re-check).
- ⚠️ **The laptop must be reachable** for a song you haven't cached yet — that's the
  trade-off for never putting audio on a server. A 24/7 laptop covers it.
- 🏠 **Same Wi-Fi?** You don't even need a tunnel — `npm run host` also prints a
  LAN pairing link, or just open the laptop's `npm run dev -- --host` URL.

**Pair once, forever (permanent URL).** The default quick tunnel's URL changes on
restart (re-scan needed). For a link that never changes, point a *stable* HTTPS URL
at the host port (8788) and set it as `PUBLIC_URL` — the host then uses it and skips
the quick tunnel:

```bash
# Option A — Tailscale Funnel (free, no domain needed):
brew install tailscale && tailscale up
tailscale funnel 8788          # → https://<machine>.<tailnet>.ts.net
PUBLIC_URL=https://<machine>.<tailnet>.ts.net npm run host

# Option B — Cloudflare named tunnel (if you own a domain):
#   cloudflared tunnel login && cloudflared tunnel create fretstorm
#   cloudflared tunnel route dns fretstorm library.yourdomain.com
#   run it pointing at localhost:8788, then:
PUBLIC_URL=https://library.yourdomain.com npm run host
```

(You can also put `"publicUrl"` in `private_audio/.host.json` instead of the env var.)
Scan the QR **once** and it works forever.

**Auto-start at login (macOS).** So you never run `npm run host` manually:

```bash
PUBLIC_URL=https://<your-permanent-url> npm run host:install   # starts now + every login
npm run host:uninstall                                          # remove it
```

It installs a `launchd` agent that keeps the host running (logs to
`~/Library/Logs/fretstorm-host.log`). With Tailscale Funnel persisting on its own,
that's the whole "set it once" setup.

This is personal use: your own files, from your own machine, to your own devices.
The public deploy still contains **zero audio**.

## 🚀 Run it locally

```bash
npm install      # install deps
npm run dev      # dev server with HMR → http://localhost:5173
npm run build    # production build → dist/
npm run preview  # serve the production build locally (use --host for phone testing)
npm run typecheck# optional: strict TypeScript check
```

### Tests

```bash
npx playwright install chromium   # one-time: fetch the headless browser
npm run test:e2e                  # build + drive the real game in Chromium
npm run test:e2e:library          # dev-mode: play a real song from private_audio/
npm run test:e2e:remote           # play a song streamed from the library host
```

`test:e2e` plays a built-in song with real keyboard + touch input and asserts the
score climbs (and that holding frets *without* strumming scores nothing, and that
haptics fire). `test:e2e:library` boots a dev server and plays an actual song from
your `private_audio/` folder end-to-end (decode → browser charting → score);
it **skips gracefully** if you haven't added any audio. Both screenshot live
gameplay to `tests/e2e/*.png`.

> **Test on your phone:** run `npm run dev -- --host` (or `npm run preview -- --host`)
> and open the printed Network URL on a phone on the same Wi-Fi. Tap once to enable
> audio (browser autoplay policy).

---

## ☁️ Deploy to Vercel (GitHub → live URL)

The MVP is a **100% static** front-end (all audio analysis runs in the browser),
so it deploys on Vercel's free tier with **no backend and no env vars**.

1. **Create a GitHub repo and push:**
   ```bash
   git init
   git add .
   git commit -m "FRETSTORM MVP"
   git branch -M main
   git remote add origin https://github.com/<you>/fretstorm.git
   git push -u origin main
   ```
2. **Import to Vercel:** go to <https://vercel.com/new>, pick the repo. Vercel
   auto-detects **Vite** (this repo also pins it in `vercel.json`):
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. **Env vars:** none required for the MVP. (`.env.example` documents the
   placeholders the *roadmap-only* online-search backend would use.)
4. **Deploy** → you get a live `*.vercel.app` URL.
5. **Auto-deploy:** every push to `main` triggers a production deploy; pull
   requests get preview URLs automatically.

---

## 🏗️ Architecture (short overview)

| Concern | Choice | Why |
| --- | --- | --- |
| **Stack** | Vite + TypeScript + Canvas 2D + Web Audio, **no UI framework** | Keep React out of the hot loop; tiny bundle (~18 KB gz); pure static build. |
| **Timing** | Master clock = `AudioContext.currentTime` (`core/clock.ts`) | rAF drifts; the audio clock is sample-accurate — essential for feel. |
| **Input** | One **abstraction layer** (`core/input.ts`) emits semantic events | Touch & keyboard feed identical engine code; new sources drop in cleanly. |
| **Built-in music** | Procedural **synth + sequencer** (`audio/synth.ts`, `audio/songs.ts`) | Zero audio files → no licensing; gems come from the same notes the synth plays → perfect sync. |
| **Auto-charting** | In-browser onset/tempo/energy analysis (`audio/analyze.ts`) | No server; runs on phones; cached in IndexedDB. |
| **Mobile + PC** | One responsive `<canvas>` + shared `layout.ts` geometry | What you see is exactly what you tap; perspective is purely render-side. |
| **Static vs server** | **All static.** Feature 3 (online search) is a stubbed, pluggable interface | Honest about copyright/ToS + serverless statelessness — see `ROADMAP.md`. |

```
src/
  core/      clock · input abstraction · event bus · storage(localStorage)
  audio/     synth · songs(composer+sequencer) · analyze(auto-chart) ·
             track(playable abstraction) · chartCache(IndexedDB) · source(stub)
  game/      engine(loop+judging) · highway(renderer) · scoring · particles ·
             chart(model+difficulty) · layout(shared geometry)
  ui/        dom helpers   |   main.ts = app orchestrator + screens
```

See **`ARCHITECTURE.md`** for the deeper tour and **`ROADMAP.md`** for what's next.

---

## 📝 Assumptions & notes

- **No copyrighted audio shipped.** Built-in tracks are synthesised originals.
  The "load your own audio" path analyses files **locally** and never uploads them.
- **Online song search (Feature 3) is intentionally not built** — it raises real
  legal/ToS issues and doesn't fit a stateless static deploy. It's defined as a
  pluggable interface (`audio/source.ts`) and fully scoped in `ROADMAP.md`.
- `npm run build` uses Vite/esbuild (fast, type-stripping). Run `npm run typecheck`
  for full strict TypeScript checking (kept as a separate step so a stray type
  quibble never blocks a deploy).
- Best experienced with headphones; use **Settings → Calibrate Latency** if audio
  feels ahead/behind (especially on Bluetooth).

---

## 🎵 Credits

Music, art direction, and code: original for FRETSTORM. No third-party audio or
art assets. Fonts use the system stack (swap in a webfont if you like).
