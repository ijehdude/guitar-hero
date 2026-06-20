# FRETSTORM — Roadmap

This document covers everything **beyond the MVP**: the online search/source
pipeline (Feature 3) and its infrastructure + legal risks, production-grade
auto-charting, deeper progression, online features, and more art polish. It's
ordered by suggested sequence, with technical approach and risks per item.

The MVP already ships: the neon highway, 5 frets + strum + chords + sustains,
tight hit detection, scoring/combo/multiplier/overdrive, 2 built-in songs (+1
unlock), in-browser upload auto-charting, four difficulties, tutorial, settings
(remap/calibration/accessibility), high scores, and a static Vercel deploy.

---

## Phasing at a glance

| Phase | Theme | Headline outcome |
| --- | --- | --- |
| **0** | MVP (done) | Playable, deployable, juicy. |
| **1** | Charting quality & content | Charts that feel hand-made; more songs; chart editor. |
| **2** | Progression & meta | Career, XP, missions, cosmetics. |
| **3** | Online (leaderboards/profiles) | Global scores & cloud saves (still cheap). |
| **4** | Feature 3 — search & source | Legally-sourced songs by name (the hard one). |
| **5** | Multiplayer & platform | Co-op/versus, PWA/native wrappers. |
| **6** | Art & audio polish pass | Award-grade finish. |

Recommended order of work: **1 → 2 → 6 (rolling) → 3 → 4 → 5.** Do the art-polish
pass (6) continuously, not just at the end.

---

## Phase 1 — Charting quality & content

### 1a. Production-grade auto-charting
The MVP analyzer is intentionally lightweight (time-domain energy flux + ZCR, no
FFT). Upgrade path:

- **Spectral onset detection** via FFT (e.g. a small `kissfft`/WASM build or the
  Web Audio `AnalyserNode` for offline framing): use **spectral flux across
  log-frequency bands** + **complex-domain** onset functions for far better
  transient detection than raw energy.
- **Multi-band lane mapping:** split into bass / mid / high bands; map onsets to
  frets by which band carries the transient (kick→green, snare→red/yellow,
  hats/lead→blue/orange). Produces musically-meaningful lane choices instead of
  a brightness proxy.
- **Robust tempo & beat tracking:** dynamic-programming beat tracking
  (Ellis-style) or a tempogram; detect tempo changes; align the 16th grid to the
  *beat phase*, not just the first onset.
- **Section/structure awareness:** self-similarity matrix to find verse/chorus;
  raise density and add chords in choruses, rest in breakdowns.
- **Difficulty modeling:** tune density/chord/hand-movement targets per
  difficulty using a playability cost function (avoid impossible jumps).
- **Performance:** run analysis in a **Web Worker** (off the main thread) with
  `OfflineAudioContext` for filtering; stream progress. WASM for the FFT hot loop.

**Risks:** auto-charts are inherently imperfect; set expectations and always
allow manual editing (1b). FFT/beat-tracking is CPU-heavy on low-end phones —
gate by device, offer a "fast/quality" toggle, cache aggressively.

### 1b. Chart editor & sharing
- In-browser editor: scrub the waveform, place/drag gems, set sustains, snap to
  grid, live playtest. Export/import chart JSON.
- **Community charts** as shareable files or via a lightweight store (Phase 3
  infra). Moderation + reporting needed if public.

### 1c. More built-in songs & genres
- Expand the procedural composer: more grooves (half-time, shuffle, double-time),
  song structures (intro/verse/chorus/bridge), and instruments. Add 8–12
  hand-tuned originals across tempos/moods.
- Optionally license a small pack of **real royalty-free tracks** (e.g. CC-BY or
  purchased royalty-free) with hand-authored charts for variety; keep attribution.

---

## Phase 2 — Career, progression & meta

- **Career mode:** ordered setlists/"venues"; clear a venue by hitting star
  thresholds to unlock the next. Boss songs at tier ends.
- **XP & levels**, daily/weekly **missions** ("FC a song on Hard", "300 combo").
- **Cosmetics / unlockables:** highway skins, note skins, fret-flare themes,
  strike-line effects, SFX packs, crowd themes — all cosmetic, all earnable.
- **Practice mode:** section looping, slow-down (time-stretch via WSOLA/phase
  vocoder so pitch is preserved), and per-section accuracy heatmaps.
- **Modifiers:** mirror, no-fail, double-speed, "hidden/sudden" (fade notes),
  random — with score multipliers/penalties.

**Tech:** still local-first. Migrate persistence from raw localStorage to a small
versioned store (e.g. IndexedDB via `idb`) with a schema + migration helper, so
progression data survives format changes.

---

## Phase 3 — Online (leaderboards, profiles, cloud saves)

Keep it **cheap and stateless-friendly** so it can ride Vercel + a managed DB.

- **Backend:** Vercel serverless/edge functions + a serverless Postgres
  (Neon/Supabase) or Upstash Redis for leaderboards (sorted sets).
- **Auth:** OAuth (GitHub/Google) or magic-link; or anonymous device IDs first.
- **Endpoints:** submit score (with anti-cheat checks), fetch leaderboard, cloud
  save/restore settings + progression.
- **Anti-cheat:** submit a compact **replay** (input event log + chart hash +
  RNG seed) and **re-simulate server-side** to validate the score. Rate-limit;
  sign payloads; reject impossible inputs. (This is the crux — client-trust
  leaderboards get destroyed instantly.)
- **Env vars** (documented in `.env.example`): `DATABASE_URL`, auth secrets.

**Risks:** anti-cheat is an arms race — start with server re-simulation + outlier
detection; expect to iterate. Costs scale with traffic; cache leaderboards at the
edge.

---

## Phase 4 — Feature 3: search a song by name → source → chart → play

> **This is deliberately NOT in the MVP.** It is the highest-risk feature for
> legal and infrastructure reasons. The MVP ships only the **pluggable interface**
> (`src/audio/source.ts`, `AudioSource` + `stubSource`); the UI already targets it.

### Why it's hard
1. **Copyright / Terms of Service.** Downloading or extracting audio from
   YouTube, Spotify, etc. typically **violates their ToS and copyright law**.
   Stream-ripping is explicitly disallowed and has been litigated. Shipping that
   would expose the project (and Vercel account) to takedowns and liability.
2. **Infrastructure mismatch.** Fetching + decoding + analysing full tracks does
   **not** fit Vercel's static/serverless model: no persistent disk, short
   function timeouts (seconds), and large audio payloads. It needs real compute
   and storage.

### The responsible way to build it

**Audio sourcing (pick a legal lane):**
- **Licensed catalogs / official APIs** that *permit* playback or downloads
  (e.g. a licensed music API, podcast-style CC catalogs, Free Music Archive,
  Jamendo, ccMixter, or a deal with rights holders). Respect each API's terms.
- **Preview clips** where the license allows (e.g. 30s previews) — chart only the
  licensed segment.
- **User-owned files** (already supported in the MVP) and **user-linked**
  legally-hosted URLs.
- Store **metadata and the generated chart only** — never redistribute the audio
  unless licensed to.

**Architecture (separate from the static site):**
```
Static front-end (Vercel)
        │  search(query)        ── AudioSource interface
        ▼
Search/metadata service  ──►  licensed provider API
        │  returns {title, artist, licensed audioUrl/previewUrl, optional chart}
        ▼
Charting service (dedicated worker, NOT a 10s serverless fn)
   container/queue (Fly.io, Render, AWS ECS, Cloud Run, Modal):
   download (if licensed) → analyse (Phase 1a pipeline) → emit chart JSON
        │
        ▼
Object storage + cache (S3/R2) keyed by track id + version
        ▼
CDN-served chart JSON  ──►  front-end plays licensed audio + chart
```

- **Queue + worker** (BullMQ/SQS) for long analysis jobs; the front-end polls or
  uses websockets for "chart ready".
- **Cache** charts by `(provider, trackId, analyzerVersion)` so a song is
  analysed once globally, not per user.
- **Secrets** (provider keys) live only in the backend env, never the client.

### Risks
- **Legal is the gating risk** — do not ship any ripping path. Get the licensing
  story right first; everything else is straightforward engineering.
- **Cost** of compute + storage + bandwidth for analysis at scale.
- **Provider availability** varies by region/licensing.

---

## Phase 5 — Multiplayer & platform reach

- **Local/online co-op & versus:** shared highway or split highways; "battle"
  power-ups (steal a fret, blur the lane). Online needs low-latency sync —
  authoritative timing on the audio clock + lockstep input or rollback.
- **PWA:** installable, offline built-in songs, add-to-home-screen, fullscreen.
- **Native wrappers:** Capacitor/Tauri for app-store presence, better audio
  latency (native audio path), haptics on hits, and optional MIDI/Bluetooth
  guitar-controller support (the input layer already abstracts this).
- **Haptics:** `navigator.vibrate` on mobile for hit/miss/overdrive feedback.

---

## Phase 6 — Art & audio polish (continuous)

- **WebGL/WebGPU upgrade path** for the highway (bloom, chromatic aberration,
  volumetric neon, reactive shaders) once the 2D version's design is locked —
  keep the 2D renderer as a low-power fallback.
- **Crowd & venue layer:** silhouetted reactive crowd, lighting rigs that pulse
  with combo/overdrive, animated backgrounds per song mood.
- **Character/avatar + instrument** with strum animation synced to the player.
- **Mix polish:** sidechain ducking, per-song mastering, dynamic stems that drop
  out on misses (classic GH "you stop hearing the guitar when you miss").
- **Motion design:** screen transitions, results-screen flourishes, star reveals.
- **Audio accessibility:** visual-only mode, mono toggle, adjustable SFX vs music.
- **Localisation** and full keyboard/gamepad navigation of menus.

---

## Cross-cutting: quality & ops

- **Automated tests:** unit tests for scoring/judging windows, chart reduction,
  and the analyzer (golden charts). A deterministic engine (seeded RNG, fixed
  clock) makes replay-based regression tests possible.
- **Telemetry (privacy-respecting):** opt-in funnel + per-song accuracy
  distributions to tune difficulty and charts.
- **Performance budget:** maintain 60 fps on mid-tier phones; particle caps,
  DPR clamp, and worker offloading are already in place — keep a perf dashboard.
- **Accessibility audits:** colour-contrast, reduced-motion (`prefers-reduced-
  motion` → auto-disable shake), screen-reader menu pass.
