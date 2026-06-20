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

## 🚀 Run it locally

```bash
npm install      # install deps
npm run dev      # dev server with HMR → http://localhost:5173
npm run build    # production build → dist/
npm run preview  # serve the production build locally (use --host for phone testing)
npm run typecheck# optional: strict TypeScript check
```

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
