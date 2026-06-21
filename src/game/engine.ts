/**
 * GameEngine — one play session. Owns the rAF loop and the judging core.
 *
 * Timing is judged against the audio clock (core/clock.ts) with the player's
 * calibration offsets applied. Input arrives as semantic events from the input
 * abstraction layer, so touch and keyboard share this exact code path.
 */
import { Clock } from "../core/clock";
import { InputManager } from "../core/input";
import type { Settings } from "../core/storage";
import { Synth } from "../audio/synth";
import type { AudioTrack } from "../audio/track";
import { Chart, Note, resetChart } from "./chart";
import { findHit } from "./judge";
import { Scoring, WINDOWS, WINDOWS_ASSIST } from "./scoring";
import { Highway, FRET_COLORS } from "./highway";
import { Particles } from "./particles";
import { computeLayout, Layout } from "./layout";

export interface SongMeta {
  id: string;
  title: string;
  artist: string;
  bpm: number;
}

export interface EngineDeps {
  canvas: HTMLCanvasElement;
  clock: Clock;
  synth: Synth;
  input: InputManager;
  getSettings: () => Settings;
}

export interface FinishResult {
  scoring: Scoring;
}

export class GameEngine {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private lastFrame = 0;
  private layout!: Layout;
  private cssW = 0;
  private cssH = 0;

  private track!: AudioTrack;
  private chart!: Chart;
  private meta!: SongMeta;
  private scoring!: Scoring;
  private highway = new Highway();
  private particles = new Particles();

  private cursor = 0; // earliest non-judged note index
  private sustains = new Set<Note>();
  private shake = 0;
  private finished = false;
  private paused = false;
  private countInUntil = 0; // songTime at which play "starts" (<=0)

  private unsubs: Array<() => void> = [];
  private reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  /** A recent strum that hasn't matched yet stays "armed" briefly, so a fret
   *  pressed a hair after the strum still lands the note (forgiving feel). */
  private strumArmedUntil = -Infinity; // -Infinity = not armed
  /** Whether the most recent input came from touch (gates haptic feedback). */
  private lastTouch = false;
  /** Centred judgement readout (PERFECT / GOOD / MISS / OVERDRIVE) shown in the
   *  reserved top band so it never overlaps the notes. */
  private judge: { text: string; sub: string; color: string; t: number; life: number } | null = null;

  private setJudge(text: string, color: string, sub = "", life = 0.55) {
    this.judge = { text, sub, color, t: 0, life };
  }

  onFinish: (r: FinishResult) => void = () => {};
  onPauseRequested: () => void = () => {};

  constructor(private deps: EngineDeps) {
    this.ctx = deps.canvas.getContext("2d", { alpha: false })!;
  }

  load(track: AudioTrack, chart: Chart, meta: SongMeta) {
    this.track = track;
    this.chart = chart;
    this.meta = meta;
    resetChart(chart);
    this.scoring = new Scoring(chart.noteCount);
    this.cursor = 0;
    this.sustains.clear();
    this.strumArmedUntil = -Infinity;
    this.judge = null;
    this.finished = false;
  }

  get score(): Scoring {
    return this.scoring;
  }

  async start() {
    await this.deps.clock.resume();
    this.resize(true);
    this.bindInput();
    this.deps.input.enabled = true;

    const lead = 2.6; // count-in seconds
    this.countInUntil = 0;
    this.deps.clock.start(-lead);
    this.track.start(this.deps.clock);

    this.paused = false;
    this.lastFrame = performance.now();
    this.loop(this.lastFrame);
  }

  pause() {
    if (this.paused || this.finished) return;
    this.paused = true;
    this.deps.clock.pause();
    // Suspend the whole audio context so the song ACTUALLY stops — a BufferTrack
    // (library/upload audio) is a real-time source that ignores the game clock.
    // Suspending also freezes ctx.currentTime, keeping audio + clock in sync.
    void this.deps.clock.ctx.suspend();
    this.deps.input.enabled = false;
    this.deps.input.reset();
    cancelAnimationFrame(this.raf);
  }

  resume() {
    if (!this.paused || this.finished) return;
    this.paused = false;
    void this.deps.clock.ctx.resume();
    this.deps.clock.resumePlayback();
    this.deps.input.enabled = true;
    this.lastFrame = performance.now();
    this.loop(this.lastFrame);
  }

  quit() {
    cancelAnimationFrame(this.raf);
    this.deps.input.enabled = false;
    this.unbindInput();
    this.track?.stop();
    this.deps.clock.stop();
    // don't leave the context suspended if the player quit from the pause menu
    if (this.deps.clock.ctx.state === "suspended") void this.deps.clock.ctx.resume();
    this.particles.clear();
  }

  // ---- input wiring -------------------------------------------------------
  private bindInput() {
    const inp = this.deps.input;
    this.unsubs.push(
      inp.on("strum", ({ source }) => this.onStrum(source)),
      inp.on("fretDown", ({ lane, source }) => {
        this.highway.flashLane(lane); // subtle responsiveness
        this.onFretDown(source);
      }),
      inp.on("fretUp", () => this.releaseSustainsIfNeeded()),
      inp.on("pause", () => this.onPauseRequested())
    );
  }
  private unbindInput() {
    this.unsubs.forEach((u) => u());
    this.unsubs.length = 0;
  }

  private windows() {
    const s = this.deps.getSettings();
    return s.hitAssist || s.difficulty === "easy" ? WINDOWS_ASSIST : WINDOWS;
  }

  /** Browser-reported audio output latency (seconds). The sound is HEARD this
   *  much after it is scheduled, so we shift both visuals and judging by it to
   *  stay in sync with what the player actually hears — no manual calibration
   *  needed for the common case. The user's own offset is added on top. */
  private audioLatency(): number {
    const c = this.deps.clock.ctx;
    return c.outputLatency || c.baseLatency || 0;
  }

  /** The gameplay clock notes are drawn and judged against (synced to heard audio). */
  private playTime(): number {
    return this.deps.clock.songTime() - this.audioLatency();
  }

  private effTime(): number {
    const s = this.deps.getSettings();
    return this.playTime() - (s.audioOffsetMs + s.inputOffsetMs) / 1000;
  }

  /** Haptic feedback (Android touch only; iOS web has no Vibration API). */
  private haptic(pattern: number | number[]) {
    if (!this.lastTouch || !this.deps.getSettings().haptics) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }

  // ---- strum / tap handling (with input buffering) ------------------------
  private onStrum(source: "touch" | "key") {
    this.lastTouch = source === "touch";
    if (this.attemptHit()) {
      this.strumArmedUntil = -Infinity;
      return;
    }
    // Touch strums are just a free extra chance (frets already play on tap), so
    // they never penalise. Only a keyboard strum can overstrum, and it's
    // buffered: a fret pressed a few ms later still lands the note.
    if (source === "key") this.strumArmedUntil = this.playTime() + 0.09;
  }

  private onFretDown(source: "touch" | "key") {
    this.lastTouch = source === "touch";
    // MOBILE: tapping a coloured fret button plays the note directly — the
    // on-screen strum bar is a secondary/advanced control. Keyboard Hit-Assist
    // behaves the same. Both are "free" attempts (a miss is never an overstrum).
    if (source === "touch" || this.deps.getSettings().hitAssist) {
      this.attemptHit();
      return;
    }
    // KEYBOARD normal play: a fret press only rescues a recently-armed strum.
    if (this.playTime() <= this.strumArmedUntil) {
      if (this.attemptHit()) this.strumArmedUntil = -Infinity;
    }
  }

  /** Resolve an armed strum that never found a note → a real overstrum. */
  private expireArmedStrum() {
    if (!Number.isFinite(this.strumArmedUntil)) return;
    if (this.playTime() > this.strumArmedUntil) {
      this.strumArmedUntil = -Infinity;
      const s = this.deps.getSettings();
      if (!(s.hitAssist || s.difficulty === "easy")) this.scoring.registerOverstrum();
    }
  }

  private strict(): boolean {
    const s = this.deps.getSettings();
    return !s.hitAssist && (s.difficulty === "hard" || s.difficulty === "expert");
  }

  /** Try to resolve a note with the currently-held frets. Returns true on a hit. */
  private attemptHit(): boolean {
    if (this.paused || this.finished) return false;
    const now = this.effTime();
    const w = this.windows();
    const held = this.deps.input.heldFrets();

    const match = findHit(this.chart.notes, this.cursor, now, w, held, this.strict());
    if (!match) return false; // no match — caller decides whether it's an overstrum
    const best = match.note;
    const bestAbs = match.abs;

    const quality: "perfect" | "good" = bestAbs <= w.perfect ? "perfect" : "good";
    best.judged = true;
    best.hit = true;
    const gained = this.scoring.registerHit(quality);
    this.haptic(quality === "perfect" ? 16 : 8); // punchier buzz for a perfect

    // juice — particle bursts stay at the strike target; the TEXT readout is centred.
    const lane = best.lanes[Math.floor(best.lanes.length / 2)];
    const x = this.layout.laneCentersHit[lane];
    const y = this.layout.hitLineY;
    const color = FRET_COLORS[lane];
    for (const l of best.lanes) this.highway.flashLane(l);
    if (quality === "perfect") {
      this.particles.perfect(x, y, color);
      this.setJudge("PERFECT", "#7ef9ff", "+" + gained);
    } else {
      this.particles.hit(x, y, color, 1);
      this.setJudge("GOOD", "#2bff88", "+" + gained);
    }
    if (this.deps.getSettings().hitSfx) this.deps.synth.hit(quality);

    if (this.scoring.flashMultiplierBump) {
      this.particles.ring(this.layout.cx, this.layout.hitLineY, "#ff2d95");
      this.scoring.flashMultiplierBump = false;
      this.shake = Math.min(this.shake + 4, 8);
    }

    if (best.duration > 0) {
      best.held = true;
      best.sustainScored = this.deps.clock.songTime();
      this.sustains.add(best);
    }
    return true;
  }

  private releaseSustainsIfNeeded() {
    const held = this.deps.input.heldFrets();
    for (const n of this.sustains) {
      const stillHeld = n.lanes.every((l) => held[l]);
      if (!stillHeld) {
        n.held = false;
        this.sustains.delete(n);
      }
    }
  }

  private updateSustains() {
    const t = this.deps.clock.songTime();
    const held = this.deps.input.heldFrets();
    for (const n of this.sustains) {
      const end = n.time + n.duration;
      const stillHeld = n.lanes.every((l) => held[l]);
      if (!stillHeld || t >= end) {
        if (stillHeld && t >= end) {
          this.scoring.registerSustainTick(Math.max(0, end - (n.sustainScored ?? end)));
        }
        n.held = false;
        this.sustains.delete(n);
        continue;
      }
      const dt = t - (n.sustainScored ?? t);
      if (dt > 0) {
        this.scoring.registerSustainTick(dt);
        n.sustainScored = t;
        // sparkle at the strike target
        if (Math.random() < 0.4) {
          const lane = n.lanes[0];
          this.particles.hit(this.layout.laneCentersHit[lane], this.layout.hitLineY, FRET_COLORS[lane], 0.5);
        }
      }
    }
  }

  private tryOverdrive() {
    if (this.scoring.activateOverdrive()) {
      this.deps.synth.overdriveActivate();
      this.haptic([18, 30, 18]); // celebratory double-pulse

      this.particles.ring(this.layout.cx, this.layout.hitLineY, "#ffd24a");
      this.setJudge("OVERDRIVE!", "#ffd24a", "", 0.85);
      this.shake = 10;
    }
  }

  private checkMisses() {
    const now = this.effTime();
    const w = this.windows();
    const notes = this.chart.notes;
    while (this.cursor < notes.length) {
      const n = notes[this.cursor];
      if (n.judged) {
        this.cursor++;
        continue;
      }
      if (n.time < now - w.good) {
        n.judged = true;
        this.scoring.registerMiss();
        const lane = n.lanes[0];
        this.particles.miss(this.layout.laneCentersHit[lane], this.layout.hitLineY);
        this.setJudge("MISS", "#ff3b5c");
        this.deps.synth.miss();
        this.shake = Math.min(this.shake + 2, 6);
        this.cursor++;
      } else {
        break;
      }
    }
  }

  // ---- main loop ----------------------------------------------------------
  private loop = (now: number) => {
    if (this.paused || this.finished) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.resize(false);
    const songTime = this.deps.clock.songTime();
    this.track.update(songTime); // sequencer schedules against the real audio clock
    const visTime = this.playTime(); // notes are drawn/judged against heard audio

    this.scoring.update(dt);
    // Boost is automatic now: fires the instant the meter is charged.
    if (this.scoring.canActivateOverdrive) this.tryOverdrive();
    this.expireArmedStrum();
    this.checkMisses();
    this.updateSustains();
    this.particles.update(dt);
    if (this.judge) {
      this.judge.t += dt;
      if (this.judge.t >= this.judge.life) this.judge = null;
    }
    this.shake = Math.max(0, this.shake - dt * 22);

    const st = {
      songTime: visTime,
      travel: this.deps.getSettings().noteTravelSec,
      notes: this.chart.notes,
      held: this.deps.input.heldFrets(),
      colorblind: this.deps.getSettings().colorblind,
      overdrive: this.scoring.overdriveActive,
      starPower: this.scoring.starPower,
      combo: this.scoring.combo,
      multiplier: this.scoring.multiplier,
      bpm: this.meta.bpm,
    };
    this.highway.update(dt, st);
    this.render(st);

    if (songTime >= this.track.duration + 0.2) {
      this.finish();
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private finish() {
    this.finished = true;
    this.deps.input.enabled = false;
    this.track.stop();
    this.unbindInput();
    this.onFinish({ scoring: this.scoring });
  }

  // ---- rendering ----------------------------------------------------------
  private resize(force: boolean) {
    const c = this.deps.canvas;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    if (!force && w === this.cssW && h === this.cssH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w;
    this.cssH = h;
    this.layout = computeLayout(w, h, this.deps.getSettings());
    this.deps.input.setLayout(this.layout);
  }

  private render(st: Parameters<Highway["render"]>[2]) {
    const ctx = this.ctx;
    ctx.save();
    if (this.shake > 0.2 && this.deps.getSettings().screenShake && !this.reducedMotion) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    this.highway.render(ctx, this.layout, st);
    this.particles.render(ctx);
    ctx.restore();

    this.drawHUD(st.songTime);
    this.drawJudgement();
    this.drawCountIn(st.songTime);
  }

  /** Centred PERFECT / GOOD / MISS / OVERDRIVE readout in the reserved top band. */
  private drawJudgement() {
    if (!this.judge) return;
    const L = this.layout;
    const j = this.judge;
    const p = j.t / j.life; // 0..1
    const alpha = p < 0.12 ? p / 0.12 : 1 - (p - 0.12) / 0.88;
    const pop = 1 + (1 - Math.min(1, p / 0.18)) * 0.45; // quick scale-in
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(L.cx, L.judgeY);
    ctx.scale(pop, pop);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = j.color;
    ctx.shadowColor = j.color;
    ctx.shadowBlur = 18;
    ctx.font = "800 30px Rajdhani, system-ui, sans-serif";
    ctx.fillText(j.text, 0, 0);
    if (j.sub) {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = Math.max(0, alpha) * 0.9;
      ctx.fillStyle = "#cfeaff";
      ctx.font = "700 14px Rajdhani, system-ui, sans-serif";
      ctx.fillText(j.sub, 0, 22);
    }
    ctx.restore();
  }

  private drawHUD(songTime: number) {
    const ctx = this.ctx;
    const L = this.layout;
    const s = this.scoring;
    ctx.save();
    ctx.textBaseline = "top";

    // score (top-left)
    ctx.textAlign = "left";
    ctx.fillStyle = "#eafcff";
    ctx.font = "700 30px Rajdhani, system-ui, sans-serif";
    ctx.fillText(Math.round(s.score).toLocaleString(), 18, 14 + this.safeTop());
    ctx.fillStyle = "#8b86c9";
    ctx.font = "600 13px Rajdhani, system-ui, sans-serif";
    ctx.fillText(this.meta.title.toUpperCase(), 18, 50 + this.safeTop());

    // multiplier + combo (center top)
    ctx.textAlign = "center";
    const mult = s.multiplier;
    ctx.font = "800 40px Rajdhani, system-ui, sans-serif";
    ctx.fillStyle = s.overdriveActive ? "#ffd24a" : mult >= 4 ? "#ff2d95" : "#14f1ff";
    ctx.shadowColor = ctx.fillStyle as string;
    ctx.shadowBlur = 12;
    ctx.fillText(mult + "x", L.cx, 12 + this.safeTop());
    ctx.shadowBlur = 0;
    if (s.combo >= 5) {
      ctx.fillStyle = "#eafcff";
      ctx.font = "700 18px Rajdhani, system-ui, sans-serif";
      ctx.fillText(s.combo + " COMBO", L.cx, 58 + this.safeTop());
    }

    // star power meter (top-right)
    const mw = 150, mh = 12;
    const mx = L.w - mw - 18, my = 22 + this.safeTop();
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    this.roundRect(ctx, mx, my, mw, mh, 6);
    ctx.fill();
    const sp = s.starPower;
    ctx.fillStyle = s.overdriveActive ? "#ffd24a" : sp >= 0.5 ? "#ff2d95" : "#9d4bff";
    if (s.overdriveActive || sp >= 0.5) {
      ctx.shadowColor = ctx.fillStyle as string;
      ctx.shadowBlur = 14;
    }
    this.roundRect(ctx, mx, my, Math.max(2, mw * sp), mh, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = s.overdriveActive ? "#ffd24a" : "#8b86c9";
    ctx.font = "600 11px Rajdhani, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(s.overdriveActive ? "BOOST ACTIVE" : "BOOST", L.w - 18, my + mh + 4);

    // progress bar (very bottom)
    const prog = Math.max(0, Math.min(1, songTime / this.track.duration));
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(0, L.h - 4, L.w, 4);
    ctx.fillStyle = "#14f1ff";
    ctx.fillRect(0, L.h - 4, L.w * prog, 4);
    ctx.restore();
  }

  private drawCountIn(songTime: number) {
    if (songTime >= 0) return;
    const ctx = this.ctx;
    const L = this.layout;
    const n = Math.ceil(-songTime);
    const frac = 1 - (-songTime - Math.floor(-songTime));
    ctx.save();
    ctx.globalAlpha = 0.4 + frac * 0.6;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${80 + frac * 30}px Rajdhani, system-ui, sans-serif`;
    ctx.fillStyle = "#ff2d95";
    ctx.shadowColor = "#ff2d95";
    ctx.shadowBlur = 30;
    ctx.fillText(String(n), L.cx, L.h * 0.4);
    ctx.font = "600 18px Rajdhani, system-ui, sans-serif";
    ctx.fillStyle = "#eafcff";
    ctx.fillText("GET READY", L.cx, L.h * 0.4 + 70);
    ctx.restore();
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private safeTop() {
    return 0; // canvas already accounts for full-bleed; keep HUD inside margins
  }
  private safeBottom() {
    return 0;
  }
}
