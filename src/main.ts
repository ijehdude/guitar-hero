/**
 * FRETSTORM — app orchestrator.
 *
 * Owns the long-lived systems (Clock, Synth, InputManager, Settings) and the
 * screen flow (menu → song select → play → results), plus an idle animated
 * stage that lives behind the menus. Gameplay itself lives in game/engine.ts.
 */
import "./style.css";
import { el, clear, screen } from "./ui/dom";
import { Clock } from "./core/clock";
import { Synth } from "./audio/synth";
import { InputManager } from "./core/input";
import {
  store, DEFAULT_SETTINGS, DEFAULT_BINDINGS, Settings, Difficulty, ScoreRecord,
} from "./core/storage";
import { SONGS, TUTORIAL_DEF, composeSong, SynthTrack, SongDef } from "./audio/songs";
import { BufferTrack } from "./audio/track";
import { buildChart } from "./game/chart";
import { decodeFile, analyzeBuffer } from "./audio/analyze";
import { fingerprint, getCachedChart, putCachedChart } from "./audio/chartCache";
import { GameEngine, SongMeta } from "./game/engine";
import { Highway } from "./game/highway";
import { computeLayout } from "./game/layout";
import { FRET_COLORS } from "./game/highway";

const DIFFS: Difficulty[] = ["easy", "medium", "hard", "expert"];
const DIFF_LABEL: Record<Difficulty, string> = {
  easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert",
};
const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Space: "SPACE", Enter: "ENTER", Escape: "ESC",
};
function keyLabel(code: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  return code.replace("Key", "").replace("Digit", "").replace("Numpad", "N");
}

class App {
  canvas = document.getElementById("stage") as HTMLCanvasElement;
  ui = document.getElementById("ui") as HTMLElement;
  clock = new Clock();
  synth = new Synth(this.clock.ctx, this.clock.master);
  settings: Settings = store.loadSettings();
  input = new InputManager(this.canvas, () => this.settings);

  engine: GameEngine | null = null;
  private idleHighway = new Highway();
  private idleRaf = 0;
  private idleLast = 0;
  private replay: (() => void) | null = null;
  private activeMeta: SongMeta | null = null;
  private activeDifficulty: Difficulty = "medium";

  constructor() {
    this.clock.setVolume(this.settings.masterVolume);
    // Expose the app for E2E tests / debugging (read-only inspection of state).
    (window as any).__fretstorm = this;
    // resume audio on first gesture (browser autoplay policy)
    const unlock = () => this.clock.resume();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    if (!this.settings.tutorialSeen) this.showFirstRun();
    else this.showMenu();
    this.startIdle();
  }

  save() {
    store.saveSettings(this.settings);
  }

  toast(msg: string) {
    const t = el("div", { class: "toast" }, msg);
    this.ui.append(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, 2200);
  }

  // ---- idle animated stage ------------------------------------------------
  private startIdle() {
    cancelAnimationFrame(this.idleRaf);
    this.idleLast = performance.now();
    const ctx = this.canvas.getContext("2d", { alpha: false })!;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - this.idleLast) / 1000);
      this.idleLast = now;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (this.canvas.width !== Math.round(w * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const L = computeLayout(w, h, this.settings);
      const st = {
        songTime: now / 1000, travel: 1.4, notes: [], held: [false, false, false, false, false],
        colorblind: this.settings.colorblind, overdrive: false, starPower: 0, combo: 0, multiplier: 1, bpm: 120,
      };
      this.idleHighway.update(dt, st);
      this.idleHighway.render(ctx, L, st);
      this.idleRaf = requestAnimationFrame(tick);
    };
    this.idleRaf = requestAnimationFrame(tick);
  }
  private stopIdle() {
    cancelAnimationFrame(this.idleRaf);
    this.idleRaf = 0;
  }

  // ---- screens ------------------------------------------------------------
  private setScreen(node: HTMLElement) {
    clear(this.ui);
    this.ui.append(node);
  }

  showMenu() {
    if (!this.idleRaf) this.startIdle();
    this.setScreen(
      screen(
        el("h1", { class: "wordmark" }, "FRETSTORM"),
        el("div", { class: "tagline" }, "⚡ ride the strum · chase the storm ⚡"),
        el("div", { class: "col" }, [
          el("button", { class: "btn primary", onclick: () => this.showSongSelect() }, "▶  Play"),
          el("button", { class: "btn", onclick: () => this.startTutorial() }, "How to Play"),
          el("button", { class: "btn", onclick: () => this.showSettings(() => this.showMenu()) }, "Settings"),
        ]),
        el("div", { class: "small" }, "Keyboard: A S D F G + ↑/↓ strum + SPACE overdrive · Mobile: tap frets + strum bar")
      )
    );
  }

  showFirstRun() {
    const b = this.settings.bindings;
    this.setScreen(
      screen(
        el("h1", { class: "wordmark", style: { fontSize: "clamp(34px,9vw,72px)" } }, "FRETSTORM"),
        el("h2", { class: "title" }, "How to Play"),
        el("div", { class: "sub" }, [
          "Notes fall down the neon highway toward the glowing strike line. ",
          "Hold the matching coloured fret(s) and ", el("b", {}, "strum"), " right as they land.",
        ]),
        el("div", { class: "row" }, FRET_COLORS.map((c, i) =>
          el("div", { class: "keycap", style: { borderColor: c, color: c, boxShadow: `0 0 14px ${c}` } }, keyLabel(b.frets[i]))
        )),
        el("div", { class: "small" }, "↑ / ↓ = strum   ·   SPACE = overdrive   ·   ESC = pause  (all remappable in Settings)"),
        el("div", { class: "sub" }, "On a phone? Just tap the matching coloured button as each note reaches the line. (Prefer real strumming? Hold a fret and use the strum bar below.)"),
        el("div", { class: "col" }, [
          el("button", { class: "btn primary", onclick: () => this.startTutorial() }, "Start Tutorial"),
          el("button", { class: "btn ghost", onclick: () => { this.settings.tutorialSeen = true; this.save(); this.showMenu(); } }, "Skip"),
        ])
      )
    );
  }

  showSongSelect() {
    const unlocked = new Set(store.unlockedSongs());
    const diffRow = el("div", { class: "seg" },
      DIFFS.map((d) =>
        el("button", {
          class: "btn", "aria-pressed": String(this.settings.difficulty === d),
          onclick: () => { this.settings.difficulty = d; this.save(); this.showSongSelect(); },
        }, DIFF_LABEL[d])
      )
    );

    const cards = SONGS.map((def) => {
      const locked = !def.unlockedByDefault && !unlocked.has(def.id);
      const best = store.bestScore(def.id, this.settings.difficulty);
      return el("button", {
        class: "card",
        style: locked ? { opacity: "0.55", cursor: "help" } : {},
        onclick: () => { if (locked) { this.toast("🔒 " + def.intent); } else { this.synth.uiClick(); this.startBuiltIn(def); } },
      }, [
        el("div", { class: "meta" }, [
          el("div", { class: "song-title" }, (locked ? "🔒 " : "") + def.title),
          el("div", { class: "song-sub" }, `${def.artist} · ${def.bpm} BPM · ${def.intent}`),
        ]),
        best ? el("div", { class: "badge best" }, `★${best.stars} · ${best.score.toLocaleString()}`) : el("div", { class: "badge tag" }, "NEW"),
      ]);
    });

    this.setScreen(
      screen(
        el("h2", { class: "title" }, "Select a Song"),
        el("div", { class: "small" }, "Difficulty"),
        diffRow,
        el("div", { class: "list" }, cards),
        el("div", { class: "list" }, [
          el("button", { class: "btn", onclick: () => this.showUpload() }, "⬆  Load Your Own Audio"),
          el("button", { class: "btn ghost", disabled: "true", title: "See ROADMAP.md", style: { opacity: "0.5" } }, "🔎  Search Online (roadmap)"),
        ]),
        el("div", { class: "row" }, [
          el("button", { class: "btn ghost", onclick: () => this.showMenu() }, "← Back"),
          el("button", { class: "btn ghost", onclick: () => this.showSettings(() => this.showSongSelect()) }, "Settings"),
        ])
      )
    );
  }

  // ---- settings (remap + calibration + toggles) ---------------------------
  showSettings(back: () => void) {
    const s = this.settings;
    const valueSpan = (txt: string) => el("span", { class: "value" }, txt);

    const speedVal = valueSpan(speedLabel(s.noteTravelSec));
    const volVal = valueSpan(Math.round(s.masterVolume * 100) + "%");
    const audioVal = valueSpan(s.audioOffsetMs + " ms");
    const inputVal = valueSpan(s.inputOffsetMs + " ms");

    const slider = (min: number, max: number, step: number, val: number, oninput: (v: number) => void) =>
      el("input", { type: "range", min, max, step, value: val, oninput: (e: Event) => oninput(Number((e.target as HTMLInputElement).value)) });

    const toggle = (key: keyof Settings, label: string, hint: string) =>
      el("div", { class: "field" }, [
        el("div", {}, [el("label", {}, label), el("div", { class: "hint" }, hint)]),
        el("button", {
          class: "btn", "aria-pressed": String(Boolean(s[key])),
          onclick: (e: Event) => {
            (s as any)[key] = !s[key];
            (e.target as HTMLButtonElement).setAttribute("aria-pressed", String(Boolean(s[key])));
            (e.target as HTMLButtonElement).textContent = s[key] ? "On" : "Off";
            this.save();
          },
        }, s[key] ? "On" : "Off"),
      ]);

    // remap keycaps
    let listening: { btn: HTMLElement; apply: (code: string) => void } | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (!listening) return;
      e.preventDefault();
      listening.apply(e.code);
      listening.btn.classList.remove("listening");
      listening.btn.textContent = keyLabel(e.code);
      listening = null;
      this.save();
    };
    window.addEventListener("keydown", onKey);

    const keycap = (code: string, apply: (c: string) => void) => {
      const cap = el("button", { class: "keycap" }, keyLabel(code));
      cap.addEventListener("click", () => {
        if (listening) listening.btn.classList.remove("listening");
        listening = { btn: cap, apply };
        cap.classList.add("listening");
        cap.textContent = "…";
      });
      return cap;
    };

    const fretCaps = el("div", { class: "row" },
      s.bindings.frets.map((code, i) =>
        el("div", { style: { textAlign: "center" } }, [
          el("div", { class: "small", style: { color: FRET_COLORS[i] } }, "Fret " + (i + 1)),
          keycap(code, (c) => (s.bindings.frets[i] = c)),
        ])
      )
    );

    const node = screen(
      el("h2", { class: "title" }, "Settings"),

      el("div", { class: "field" }, [
        el("div", {}, [el("label", {}, "Note Speed"), el("div", { class: "hint" }, "How fast notes travel the highway")]),
        slider(0.75, 1.8, 0.05, roundN(2.55 - s.noteTravelSec, 2), (v) => { s.noteTravelSec = roundN(2.55 - v, 2); speedVal.textContent = speedLabel(s.noteTravelSec); this.save(); }),
        speedVal,
      ]),
      el("div", { class: "field" }, [
        el("div", {}, [el("label", {}, "Volume")]),
        slider(0, 1, 0.05, s.masterVolume, (v) => { s.masterVolume = v; this.clock.setVolume(v); volVal.textContent = Math.round(v * 100) + "%"; this.save(); }),
        volVal,
      ]),

      el("div", { class: "field" }, [
        el("div", {}, [el("label", {}, "Audio Latency"), el("div", { class: "hint" }, "Use the calibrator if notes feel early/late")]),
        slider(-200, 200, 5, s.audioOffsetMs, (v) => { s.audioOffsetMs = v; audioVal.textContent = v + " ms"; this.save(); }),
        audioVal,
      ]),
      el("div", { class: "row" }, [
        el("button", { class: "btn ghost", onclick: () => this.runCalibration((ms) => { s.audioOffsetMs = ms; audioVal.textContent = ms + " ms"; this.save(); this.showSettings(back); }) }, "🎯 Calibrate Latency"),
      ]),
      el("div", { class: "field" }, [
        el("div", {}, [el("label", {}, "Input Latency"), el("div", { class: "hint" }, "Advanced fine-tune (touch devices)")]),
        slider(-100, 100, 5, s.inputOffsetMs, (v) => { s.inputOffsetMs = v; inputVal.textContent = v + " ms"; this.save(); }),
        inputVal,
      ]),

      toggle("colorblind", "Colour-blind shapes", "Distinct shape per fret, not just colour"),
      toggle("hitAssist", "Hit Assist (easy)", "Wider timing, strum optional, no overstrum penalty"),
      toggle("lefty", "Left-handed", "Mirror the highway"),
      toggle("screenShake", "Screen shake", "Disable for comfort / motion sensitivity"),
      toggle("haptics", "Haptics", "Vibrate on hits (Android phones; iOS web can't vibrate)"),

      el("h2", { class: "title", style: { fontSize: "20px", marginTop: "10px" } }, "Key Bindings"),
      fretCaps,
      el("div", { class: "row" }, [
        labeledCap("Strum ↓", keycap(s.bindings.strumDown, (c) => (s.bindings.strumDown = c))),
        labeledCap("Strum ↑", keycap(s.bindings.strumUp, (c) => (s.bindings.strumUp = c))),
        labeledCap("Overdrive", keycap(s.bindings.overdrive, (c) => (s.bindings.overdrive = c))),
        labeledCap("Pause", keycap(s.bindings.pause, (c) => (s.bindings.pause = c))),
      ]),
      el("div", { class: "row" }, [
        el("button", { class: "btn ghost", onclick: () => { this.settings.bindings = { ...DEFAULT_BINDINGS, frets: [...DEFAULT_BINDINGS.frets] }; this.save(); this.showSettings(back); } }, "Reset Keys"),
        el("button", { class: "btn primary", onclick: () => { window.removeEventListener("keydown", onKey); back(); } }, "Done"),
      ])
    );
    this.setScreen(node);
  }

  /** Simple latency calibrator: tap the strum/space in time with the ticks. */
  runCalibration(done: (ms: number) => void) {
    const taps: number[] = [];
    const interval = 0.6;
    const beats: number[] = [];
    this.clock.resume();
    const t0 = this.clock.now() + 0.6;
    for (let i = 0; i < 16; i++) {
      const at = t0 + i * interval;
      beats.push(at);
      this.synth.kick(at, 0.9);
      if (i % 2 === 0) this.synth.hat(at + interval / 2, 0.2);
    }

    // The engine already auto-compensates AudioContext output latency, so the
    // calibrator measures the RESIDUAL on top of it (avoids double-counting):
    // compare taps to when each beat is actually heard (scheduled + outputLatency).
    const lat = this.clock.ctx.outputLatency || this.clock.ctx.baseLatency || 0;
    const measure = () => {
      const t = this.clock.now();
      let nearest = beats[0], bd = Infinity;
      for (const b of beats) { const d = Math.abs(b + lat - t); if (d < bd) { bd = d; nearest = b; } }
      const off = (t - (nearest + lat)) * 1000;
      if (Math.abs(off) < 250) taps.push(off);
      counter.textContent = `Taps: ${taps.length} / 8`;
    };
    const onKey = (e: KeyboardEvent) => { if (e.code === this.settings.bindings.strumDown || e.code === "Space" || e.code === this.settings.bindings.strumUp) { e.preventDefault(); measure(); finishIfDone(); } };
    const onTap = (e: PointerEvent) => { if ((e.target as HTMLElement).closest(".btn")) return; measure(); finishIfDone(); };

    const counter = el("div", { class: "value", style: { fontSize: "22px" } }, "Taps: 0 / 8");
    const finishIfDone = () => {
      if (taps.length >= 8) {
        window.removeEventListener("keydown", onKey);
        overlay.removeEventListener("pointerdown", onTap);
        const sorted = [...taps].sort((a, b) => a - b);
        const median = Math.round(sorted[Math.floor(sorted.length / 2)]);
        done(median);
        this.toast(`Calibrated: ${median} ms`);
      }
    };

    const overlay = screen(
      el("h2", { class: "title" }, "Latency Calibration"),
      el("div", { class: "sub" }, "Tap the strum key (or anywhere) exactly on each beat. We'll average your timing."),
      counter,
      el("div", { class: "small" }, "Listen for the kick drum…"),
      el("button", { class: "btn ghost", onclick: () => { window.removeEventListener("keydown", onKey); overlay.removeEventListener("pointerdown", onTap); done(this.settings.audioOffsetMs); } }, "Cancel")
    );
    overlay.addEventListener("pointerdown", onTap);
    window.addEventListener("keydown", onKey);
    this.setScreen(overlay);
  }

  // ---- upload / auto-chart ------------------------------------------------
  showUpload() {
    const drop = el("div", { class: "drop" }, "Tap to choose an audio file — or drag & drop here") as HTMLElement;
    const fileInput = el("input", { type: "file", accept: "audio/*", style: { display: "none" } }) as HTMLInputElement;
    const bar = el("i");
    const progress = el("div", { class: "progress hidden" }, bar);
    const status = el("div", { class: "small" }, "MP3 / WAV / OGG / M4A · analysed privately in your browser");

    const handle = async (file: File) => {
      progress.classList.remove("hidden");
      const setP = (p: number) => ((bar as HTMLElement).style.width = Math.round(p * 100) + "%");
      try {
        status.textContent = "Decoding…";
        setP(0.05);
        await this.clock.resume();
        const buffer = await decodeFile(this.clock.ctx, file);
        const key = fingerprint(file);
        let gems, bpm: number;
        const cached = await getCachedChart(key);
        if (cached) {
          status.textContent = "Loaded cached chart ✓";
          gems = cached.gems; bpm = cached.bpm;
          setP(1);
        } else {
          status.textContent = "Analysing audio (beats & onsets)…";
          const res = await analyzeBuffer(buffer, setP);
          gems = res.gems; bpm = res.bpm;
          await putCachedChart({ key, gems, bpm, duration: res.duration, title: file.name });
        }
        const chart = buildChart(gems, this.settings.difficulty);
        if (chart.noteCount < 4) { this.toast("Couldn't find enough beats in that track."); return; }
        const track = new BufferTrack(this.clock.ctx, this.clock.master, buffer);
        const meta: SongMeta = { id: "upload:" + key, title: file.name.replace(/\.[^.]+$/, ""), artist: "Your Library", bpm };
        this.replay = () => { const c = buildChart(gems!, this.settings.difficulty); this.play(new BufferTrack(this.clock.ctx, this.clock.master, buffer), c, meta); };
        this.play(track, chart, meta);
      } catch (err) {
        console.error(err);
        this.toast("Could not analyse that file.");
        progress.classList.add("hidden");
      }
    };

    drop.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) handle(fileInput.files[0]); });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("hover"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("hover"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault(); drop.classList.remove("hover");
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f) handle(f);
    });

    this.setScreen(
      screen(
        el("h2", { class: "title" }, "Load Your Own Audio"),
        el("div", { class: "sub" }, "FRETSTORM analyses the track right here in your browser (Web Audio) and auto-generates a chart at your selected difficulty. Nothing is uploaded to a server."),
        drop, fileInput, progress, status,
        el("div", { class: "small" }, "Difficulty: " + DIFF_LABEL[this.settings.difficulty] + " (change it on the song-select screen)"),
        el("button", { class: "btn ghost", onclick: () => this.showSongSelect() }, "← Back")
      )
    );
  }

  // ---- starting / running songs ------------------------------------------
  startBuiltIn(def: SongDef) {
    const compiled = composeSong(def);
    const meta: SongMeta = { id: def.id, title: def.title, artist: def.artist, bpm: def.bpm };
    this.replay = () => {
      const chart = buildChart(compiled.gems, this.settings.difficulty);
      this.play(new SynthTrack(this.synth, compiled), chart, meta);
    };
    const chart = buildChart(compiled.gems, this.settings.difficulty);
    this.play(new SynthTrack(this.synth, compiled), chart, meta);
    if (!this.settings.hitAssist && this.playHintCount < 2) {
      this.playHintCount++;
      this.showStrumHint(false);
    }
  }

  private playHintCount = 0;

  startTutorial() {
    const prevAssist = this.settings.hitAssist;
    const prevDiff = this.settings.difficulty;
    // Teach the REAL mechanic: strum is required (hit-assist OFF), but Easy
    // gives wide timing windows and no overstrum penalty so it's forgiving.
    this.settings.hitAssist = false;
    this.settings.difficulty = "easy";
    const compiled = composeSong(TUTORIAL_DEF, { sparse: true });
    const chart = buildChart(compiled.gems, "easy");
    const meta: SongMeta = { id: TUTORIAL_DEF.id, title: TUTORIAL_DEF.title, artist: TUTORIAL_DEF.artist, bpm: TUTORIAL_DEF.bpm };
    this.replay = null;
    this.play(new SynthTrack(this.synth, compiled), chart, meta, () => {
      this.settings.hitAssist = prevAssist;
      this.settings.difficulty = prevDiff;
      this.settings.tutorialSeen = true;
      this.save();
    });
    this.showStrumHint(true);
  }

  /** Transient on-screen reminder of the core control (platform-aware). */
  private showStrumHint(tutorial = false) {
    const b = this.settings.bindings;
    const desktop = matchMedia("(pointer: fine)").matches && !matchMedia("(pointer: coarse)").matches;
    const title = desktop ? (tutorial ? "It takes two: fret + strum" : "Fret + Strum") : "Tap the notes!";
    const how = desktop
      ? `Hold a fret key, then tap ${keyLabel(b.strumDown)} / ${keyLabel(b.strumUp)} to STRUM`
      : "Tap the matching coloured button as each note reaches the line";
    const hint = el("div", { class: "play-hint" }, [
      el("b", {}, title),
      el("span", {}, how),
    ]);
    this.ui.append(hint);
    requestAnimationFrame(() => hint.classList.add("show"));
    setTimeout(() => { hint.classList.remove("show"); setTimeout(() => hint.remove(), 500); }, tutorial ? 9000 : 5000);
  }

  private play(track: any, chart: any, meta: SongMeta, onDone?: () => void) {
    this.stopIdle();
    clear(this.ui);
    this.activeMeta = meta;
    this.activeDifficulty = this.settings.difficulty;
    this.clock.setVolume(this.settings.masterVolume);

    const pauseBtn = el("button", { class: "hud-btn", title: "Pause", onclick: () => this.togglePause() }, "II");
    this.ui.append(pauseBtn);

    const engine = new GameEngine({ canvas: this.canvas, clock: this.clock, synth: this.synth, input: this.input, getSettings: () => this.settings });
    this.engine = engine;
    engine.onPauseRequested = () => this.togglePause();
    engine.onFinish = ({ scoring }) => {
      onDone?.();
      this.engine = null;
      this.showResults(meta, scoring);
    };
    engine.load(track, chart, meta);
    engine.start();
  }

  // ---- pause --------------------------------------------------------------
  private paused = false;
  togglePause() {
    if (!this.engine) return;
    if (this.paused) { this.resumeGame(); return; }
    this.paused = true;
    this.engine.pause();
    const overlay = el("div", { class: "screen", id: "pause-overlay" }, [
      el("h2", { class: "title" }, "Paused"),
      el("div", { class: "song-title", style: { fontSize: "18px" } }, this.activeMeta?.title ?? ""),
      el("div", { class: "col" }, [
        el("button", { class: "btn primary", onclick: () => this.resumeGame() }, "Resume"),
        this.replay ? el("button", { class: "btn", onclick: () => this.restartGame() }, "↻ Restart") : null,
        el("button", { class: "btn ghost", onclick: () => this.quitToSelect() }, "Quit to Song Select"),
      ]),
    ]);
    this.ui.append(overlay);
  }
  private resumeGame() {
    document.getElementById("pause-overlay")?.remove();
    this.paused = false;
    this.engine?.resume();
  }
  private restartGame() {
    document.getElementById("pause-overlay")?.remove();
    this.paused = false;
    this.engine?.quit();
    this.engine = null;
    if (this.replay) this.replay();
  }
  private quitToSelect() {
    document.getElementById("pause-overlay")?.remove();
    this.paused = false;
    this.engine?.quit();
    this.engine = null;
    this.startIdle();
    this.showSongSelect();
  }

  // ---- results ------------------------------------------------------------
  private showResults(meta: SongMeta, scoring: import("./game/scoring").Scoring) {
    this.startIdle();
    clear(this.ui);
    const diff = this.activeDifficulty;
    const rec: ScoreRecord = {
      score: Math.round(scoring.score), maxCombo: scoring.maxCombo, accuracy: scoring.accuracy,
      stars: scoring.stars, difficulty: diff, fc: scoring.isFullCombo, date: Date.now(),
    };
    const isUpload = meta.id.startsWith("upload:");
    const isTutorial = meta.id === TUTORIAL_DEF.id;
    let newBest = false;
    if (!isTutorial) newBest = store.submitScore(meta.id, rec);

    // unlock logic: 4★ on anything unlocks the bonus track
    if (scoring.stars >= 4) {
      const locked = SONGS.find((s) => !s.unlockedByDefault && !store.unlockedSongs().includes(s.id));
      if (locked) { store.unlock(locked.id); setTimeout(() => this.toast(`🔓 Unlocked: ${locked.title}!`), 600); }
    }

    const starRow = el("div", { class: "row" }, Array.from({ length: 5 }, (_, i) =>
      el("div", { style: { fontSize: "40px", color: i < scoring.stars ? "#ffd24a" : "#3a3360", filter: i < scoring.stars ? "drop-shadow(0 0 10px #ffd24a)" : "none" } }, "★")
    ));

    const stat = (label: string, value: string, color = "#14f1ff") =>
      el("div", { class: "field", style: { maxWidth: "320px" } }, [el("label", {}, label), el("span", { class: "value", style: { color } }, value)]);

    this.setScreen(
      screen(
        el("h2", { class: "title" }, isTutorial ? "Tutorial Complete!" : scoring.isFullCombo ? "★ FULL COMBO ★" : "Results"),
        el("div", { class: "song-title", style: { fontSize: "22px" } }, meta.title),
        starRow,
        newBest ? el("div", { class: "badge best", style: { fontSize: "14px" } }, "✦ NEW HIGH SCORE ✦") : null,
        el("div", { class: "col" }, [
          stat("Score", Math.round(scoring.score).toLocaleString(), "#ffd24a"),
          stat("Accuracy", (scoring.accuracy * 100).toFixed(1) + "%"),
          stat("Max Combo", String(scoring.maxCombo), "#ff2d95"),
          stat("Perfect / Good / Miss", `${scoring.perfect} / ${scoring.good} / ${scoring.miss}`),
          stat("Difficulty", DIFF_LABEL[diff], "#9d4bff"),
        ]),
        el("div", { class: "row" }, [
          this.replay ? el("button", { class: "btn primary", onclick: () => { const r = this.replay!; this.startIdle(); r(); } }, "↻ Retry") : null,
          el("button", { class: "btn", onclick: () => this.showSongSelect() }, "Song Select"),
          el("button", { class: "btn ghost", onclick: () => this.showMenu() }, "Menu"),
        ])
      )
    );
  }
}

// ---- small helpers ----------------------------------------------------------
function labeledCap(label: string, cap: HTMLElement): HTMLElement {
  return el("div", { style: { textAlign: "center" } }, [el("div", { class: "small" }, label), cap]);
}
function speedLabel(travelSec: number): string {
  // smaller travel = faster; show an arcade-style 1..9 scale
  const n = Math.round((1.8 - travelSec) / (1.8 - 0.75) * 8) + 1;
  return "Speed " + n;
}
function roundN(v: number, n: number): number {
  const p = Math.pow(10, n);
  return Math.round(v * p) / p;
}

// boot
new App();
