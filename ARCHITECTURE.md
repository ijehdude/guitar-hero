# FRETSTORM — Architecture

A tour of how the game is put together, why the key decisions were made, and
where to extend it.

---

## 1. Stack & rationale

**Vite + TypeScript + Canvas 2D + Web Audio API. No UI framework.**

A rhythm game's quality is dominated by **latency** and **frame consistency**.
Pulling a virtual-DOM framework (React, etc.) into the per-frame render path adds
reconciliation overhead and indirection for zero benefit — the gameplay is one
`<canvas>` redrawn every frame. So:

- **Gameplay** is hand-rolled on Canvas 2D, driven by `requestAnimationFrame`.
- **Menus/HUD overlays** are plain DOM (`#ui`), because menus *should* be
  accessible (focusable, screen-reader-friendly, easy file inputs & remapping).
- **TypeScript** for safety on the timing/scoring math.
- **Vite** for instant HMR in dev and a tiny static build (~18 KB gzipped JS)
  that Vercel auto-detects.

---

## 2. The master clock (the most important decision)

`core/clock.ts` wraps an `AudioContext` and exposes `songTime()` =
`audioCtx.currentTime - startTime`. **Everything** — note positions, judging,
the sequencer — is timed against this.

Why not `rAF` deltas? Because `rAF` jitters and drifts relative to the audio
hardware; over a 90-second song that drift is audible/visible and ruins feel.
The audio clock is sample-accurate and is the same timebase the sound actually
plays on. Scheduling (`ctxTimeFor(songTime)`) converts a future song position
into an absolute audio time for click-free note scheduling.

**Calibration.** Judgement uses an effective time:

```
effTime = songTime() - (audioOffsetMs + inputOffsetMs) / 1000
```

so the player can compensate for output/Bluetooth latency. `runCalibration()` in
`main.ts` plays a metronome and measures the median offset of the player's taps.

---

## 3. Input abstraction layer

`core/input.ts` (`InputManager`) is the single place that knows about hardware.
It listens to keyboard + pointer events and emits **semantic** events:

```
fretDown {lane}  fretUp {lane}  strum {dir}  overdrive  pause
```

The engine consumes only these — it never touches DOM events — so:

- **Touch and keyboard share one code path.** Identical judging for both.
- **New input sources** (gamepad, Web MIDI guitar) just emit the same events.
- Touch hit-zones come from the **same `layout.ts`** the renderer draws from, so
  the buttons line up exactly with the visuals. Multitouch is supported (hold
  chords with several fingers); the strum bar accepts taps *and* directional
  swipes; sliding between frets is allowed for fast changes.

`heldFrets()` lets the engine resolve chords at the instant of a strum.

---

## 4. Audio: synth, songs, tracks

- **`audio/synth.ts`** — Web Audio voices (kick, snare, hat, bass, detuned
  square/saw lead with a slap delay, pads) and game SFX (hit/miss/overdrive/UI).
  All built-in sound is generated here → **no audio files, no licensing**.
- **`audio/songs.ts`** — `composeSong(def)` is a **pure, deterministic** function
  (seeded PRNG) that turns a small `SongDef` (key, tempo, groove, chord
  progression) into **both** the audio event stream *and* the gem chart. Because
  the gems are derived from the same melody the synth plays, **what you see is
  what you hear** — perfect sync by construction. Authored at 16th-note
  resolution so Expert gets dense runs.
- **`audio/track.ts`** — `AudioTrack` is the playable-audio interface
  (`start/update/stop`). `BufferTrack` plays a decoded file; `SynthTrack`
  (in songs.ts) runs a **120 ms lookahead scheduler** over the event stream.
  The engine drives either one identically.

---

## 5. Charting

- **`game/chart.ts`** — the `Note` model and `buildChart(gems, difficulty)`,
  which reduces a dense master stream into Easy/Medium/Hard/Expert by thinning
  density (min gap), clamping chord size, and remapping into the allowed fret set.
  One authored/analysed song → four playable difficulties.
- **`audio/analyze.ts`** — the **in-browser auto-charter** (Feature 2): decode →
  mono → energy-flux onset envelope → adaptive peak picking → autocorrelation
  tempo estimate → quantise onsets to a 16th grid → assign lanes by brightness
  (zero-crossing rate as a cheap spectral proxy). No FFT dependency, so it's
  light enough for phones. Results are cached in **IndexedDB** (`chartCache.ts`)
  keyed by a file fingerprint.

---

## 6. The engine (judging core)

`game/engine.ts` owns the rAF loop and the judging logic:

- **Hit:** on a `strum` (or, in Hit-Assist, a `fretDown`), search un-judged notes
  within the Good window for the closest one whose required frets are held;
  classify Perfect/Good by `|Δt|`. Hard/Expert require an exact chord (no extra
  frets); easier modes are lenient.
- **Miss:** a `cursor` walks the sorted note list; any note that passes
  `now − goodWindow` un-hit is a miss.
- **Sustains:** a held note scores ticks while its frets stay down.
- **Overstrum** breaks the combo (exempt in forgiving modes).
- **Overdrive:** earned via star-power meter; doubles the multiplier and drives
  the on-screen spectacle while it drains.
- Emits **juice** (particles, popups, screen shake, SFX) and draws the canvas HUD.

`game/scoring.ts` holds all score/combo/multiplier/star-power state and the
star/grade thresholds.

---

## 7. Rendering & "juice"

- **`game/highway.ts`** — the visual identity: a perspective trapezoid converging
  to a vanishing point, glowing dividers/edges, scrolling beat & measure lines,
  reactive horizon glow that intensifies with combo and goes gold in Overdrive,
  animated strike targets that depress when held, and perspective-scaled
  notes/chords/sustains. **Colour-blind mode** gives each lane a distinct *shape*
  (circle/triangle/square/diamond/pentagon), not just a colour.
- **`game/particles.ts`** — pooled, additive-blended neon sparks, perfect-hit
  shards, shock rings, and floating score/judgement popups. Capped for mobile.
- **`game/layout.ts`** — the shared geometry source for renderer *and* input.

---

## 8. Mobile + PC from one codebase

- One responsive full-bleed `<canvas>`; DPR-aware sizing capped at 2× for perf.
- `layout.ts` computes a portrait-or-landscape layout, reserving a thumb-reachable
  control band on touch; perspective math lives only in the renderer.
- Input differences are fully absorbed by the abstraction layer.
- `touch-action: none`, `user-select: none`, safe-area insets, and an audio-unlock
  gesture handle the mobile-browser quirks.

---

## 9. Static vs serverless

**Everything in the MVP is static.** No server, no database, no env vars. Audio
analysis is client-side; persistence is localStorage + IndexedDB.

The only thing that would need a backend — **online song search/sourcing
(Feature 3)** — is deliberately left as a **pluggable interface**
(`audio/source.ts`, `stubSource`). The UI already targets that interface, so a
future Vercel-serverless implementation (with a *licensed* provider) slots in
without UI changes. The legal and infrastructure analysis is in `ROADMAP.md`.

---

## 10. Extending it

- **New built-in song:** add a `SongDef` to `SONGS` in `audio/songs.ts`.
- **New instrument/SFX:** add a voice to `Synth`.
- **New input device:** emit the existing `InputEvents` from a new manager.
- **Better auto-charts:** swap `analyze.ts` internals for an FFT/ML pipeline
  (see roadmap) — the `Gem[]` contract stays the same.
- **Real online search:** implement `AudioSource` and `setAudioSource(...)`.
