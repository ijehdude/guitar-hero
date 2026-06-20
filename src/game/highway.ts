/**
 * The neon note highway renderer — FRETSTORM's visual identity.
 *
 * A pseudo-3D trapezoid highway converging to a vanishing point, glowing lane
 * dividers, scrolling beat lines, reactive stage lighting, animated strike
 * targets, perspective-scaled notes/chords/sustains, and colour-blind shapes.
 * Pure drawing + self-contained animation state; the engine feeds it a snapshot.
 */
import {
  Layout, LANES, yForDistance, scaleForDistance, laneXAt,
} from "./layout";
import type { Note } from "./chart";

export const FRET_COLORS = ["#2bff88", "#ff3b5c", "#ffe14d", "#29b6ff", "#ff8a2b"];
const FRET_GLOW = ["#0bffa0", "#ff2d6a", "#fff06a", "#39c6ff", "#ff9a3c"];

export interface HighwayState {
  songTime: number;
  travel: number; // seconds for a note to cross the whole highway
  notes: Note[];
  held: boolean[];
  colorblind: boolean;
  overdrive: boolean;
  starPower: number;
  combo: number;
  multiplier: number;
  bpm: number;
}

export class Highway {
  private laneGlow = [0, 0, 0, 0, 0]; // decays after a hit
  private pressAnim = [0, 0, 0, 0, 0]; // 0..1 press depth
  private scroll = 0; // background motion
  private energy = 0; // smoothed combo energy 0..1
  private odPulse = 0;

  flashLane(lane: number) {
    this.laneGlow[lane] = 1;
  }

  update(dt: number, st: HighwayState) {
    this.scroll += dt * (st.overdrive ? 1.8 : 1);
    this.odPulse += dt * 6;
    for (let i = 0; i < LANES; i++) {
      this.laneGlow[i] = Math.max(0, this.laneGlow[i] - dt * 3.2);
      const target = st.held[i] ? 1 : 0;
      this.pressAnim[i] += (target - this.pressAnim[i]) * Math.min(1, dt * 18);
    }
    const targetEnergy = Math.min(1, st.combo / 40);
    this.energy += (targetEnergy - this.energy) * Math.min(1, dt * 2);
  }

  render(ctx: CanvasRenderingContext2D, L: Layout, st: HighwayState) {
    L_RADIUS_CACHE.r = L.fretRadius; // keep gem size in sync before drawing notes
    this.drawBackground(ctx, L, st);
    this.drawHighwaySurface(ctx, L, st);
    this.drawBeatLines(ctx, L, st);
    this.drawNotes(ctx, L, st);
    this.drawFrets(ctx, L, st);
  }

  // ---- stage / background -------------------------------------------------
  private drawBackground(ctx: CanvasRenderingContext2D, L: Layout, st: HighwayState) {
    const g = ctx.createLinearGradient(0, 0, 0, L.h);
    g.addColorStop(0, "#0a0320");
    g.addColorStop(0.5, "#06010f");
    g.addColorStop(1, "#04010c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.w, L.h);

    // reactive horizon glow behind the vanishing point
    const hue = st.overdrive ? "rgba(255,210,74," : "rgba(157,75,255,";
    const glowR = 180 + this.energy * 220 + (st.overdrive ? Math.sin(this.odPulse) * 30 : 0);
    const rg = ctx.createRadialGradient(L.cx, L.highwayTop, 10, L.cx, L.highwayTop, glowR);
    rg.addColorStop(0, hue + (0.5 + this.energy * 0.4) + ")");
    rg.addColorStop(1, hue + "0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, L.w, L.h);

    // faint horizon scanlines for retro identity
    ctx.save();
    ctx.globalAlpha = 0.12 + this.energy * 0.1;
    ctx.strokeStyle = st.overdrive ? "#ffd24a" : "#9d4bff";
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const yy = L.highwayTop - 4 - i * 9;
      ctx.beginPath();
      ctx.moveTo(L.cx - 260, yy);
      ctx.lineTo(L.cx + 260, yy);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- highway surface ----------------------------------------------------
  private highwayPath(ctx: CanvasRenderingContext2D, L: Layout) {
    const topL = laneXAt(L, 0, 1) - (L.laneWidthHit * scaleForDistance(L, 1)) / 2;
    const topR = laneXAt(L, LANES - 1, 1) + (L.laneWidthHit * scaleForDistance(L, 1)) / 2;
    const botL = L.cx - L.nearHalfWidth;
    const botR = L.cx + L.nearHalfWidth;
    ctx.beginPath();
    ctx.moveTo(botL, L.hitLineY);
    ctx.lineTo(topL, L.highwayTop);
    ctx.lineTo(topR, L.highwayTop);
    ctx.lineTo(botR, L.hitLineY);
    ctx.closePath();
  }

  private drawHighwaySurface(ctx: CanvasRenderingContext2D, L: Layout, st: HighwayState) {
    ctx.save();
    this.highwayPath(ctx, L);
    ctx.clip();

    const g = ctx.createLinearGradient(0, L.highwayTop, 0, L.hitLineY);
    g.addColorStop(0, "rgba(20,10,45,0.2)");
    g.addColorStop(1, st.overdrive ? "rgba(60,45,10,0.55)" : "rgba(30,12,60,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.w, L.h);

    // lane fills + per-lane held glow
    for (let i = 0; i < LANES; i++) {
      const glow = Math.max(this.laneGlow[i], this.pressAnim[i] * 0.5);
      if (glow <= 0.02) continue;
      const xTop = laneXAt(L, i, 1);
      const xBot = laneXAt(L, i, 0);
      const wTop = L.laneWidthHit * scaleForDistance(L, 1);
      const wBot = L.laneWidthHit;
      ctx.globalAlpha = glow * 0.5;
      ctx.fillStyle = FRET_COLORS[i];
      ctx.beginPath();
      ctx.moveTo(xBot - wBot / 2, L.hitLineY);
      ctx.lineTo(xTop - wTop / 2, L.highwayTop);
      ctx.lineTo(xTop + wTop / 2, L.highwayTop);
      ctx.lineTo(xBot + wBot / 2, L.hitLineY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // lane dividers (6 lines)
    ctx.strokeStyle = st.overdrive ? "rgba(255,210,74,0.5)" : "rgba(120,90,200,0.5)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= LANES; i++) {
      const xBot = L.cx - L.nearHalfWidth + L.laneWidthHit * i;
      const xTop = L.cx + (xBot - L.cx) * scaleForDistance(L, 1);
      ctx.beginPath();
      ctx.moveTo(xBot, L.hitLineY);
      ctx.lineTo(xTop, L.highwayTop);
      ctx.stroke();
    }
    ctx.restore();

    // glowing outer edges
    ctx.save();
    ctx.shadowColor = st.overdrive ? "#ffd24a" : "#ff2d95";
    ctx.shadowBlur = 18;
    ctx.strokeStyle = st.overdrive ? "#ffd24a" : "#ff2d95";
    ctx.lineWidth = 3;
    this.highwayPath(ctx, L);
    ctx.stroke();
    ctx.restore();
  }

  private drawBeatLines(ctx: CanvasRenderingContext2D, L: Layout, st: HighwayState) {
    if (!st.bpm) return;
    const spb = 60 / st.bpm;
    const start = Math.floor(st.songTime / spb) - 1;
    ctx.save();
    this.highwayPath(ctx, L);
    ctx.clip();
    for (let b = start; b < start + Math.ceil(st.travel / spb) + 2; b++) {
      const tt = b * spb;
      const d = (tt - st.songTime) / st.travel;
      if (d < -0.05 || d > 1.02) continue;
      const y = yForDistance(L, d);
      const s = scaleForDistance(L, d);
      const half = L.nearHalfWidth * s;
      const measure = ((b % 4) + 4) % 4 === 0;
      ctx.globalAlpha = (1 - d) * (measure ? 0.5 : 0.2);
      ctx.strokeStyle = measure ? "#14f1ff" : "#5a4a9a";
      ctx.lineWidth = measure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(L.cx - half, y);
      ctx.lineTo(L.cx + half, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- notes --------------------------------------------------------------
  private drawNotes(ctx: CanvasRenderingContext2D, L: Layout, st: HighwayState) {
    // far -> near so nearer notes draw on top
    const visible: Note[] = [];
    for (const n of st.notes) {
      if (n.judged && !n.held) continue;
      const d = (n.time - st.songTime) / st.travel;
      if (d < -0.1 || d > 1.06) continue;
      visible.push(n);
    }
    visible.sort((a, b) => b.time - a.time);

    for (const n of visible) {
      const d = (n.time - st.songTime) / st.travel;
      // sustain trail
      if (n.duration > 0) this.drawSustain(ctx, L, st, n, d);
      for (const lane of n.lanes) {
        const dd = n.held ? 0 : d;
        const x = laneXAt(L, lane, dd);
        const y = yForDistance(L, dd);
        const s = scaleForDistance(L, dd);
        this.drawGem(ctx, x, y, s, lane, st.colorblind, st.overdrive);
      }
    }
  }

  private drawSustain(ctx: CanvasRenderingContext2D, L: Layout, st: HighwayState, n: Note, d: number) {
    const dEnd = (n.time + n.duration - st.songTime) / st.travel;
    const dHead = n.held ? 0 : Math.max(0, d);
    const dTail = Math.min(1.05, dEnd);
    if (dTail <= dHead) return;
    for (const lane of n.lanes) {
      const x1 = laneXAt(L, lane, dHead);
      const y1 = yForDistance(L, dHead);
      const x2 = laneXAt(L, lane, dTail);
      const y2 = yForDistance(L, dTail);
      const w1 = L.fretRadius * 0.5 * scaleForDistance(L, dHead);
      const w2 = L.fretRadius * 0.5 * scaleForDistance(L, dTail);
      ctx.save();
      ctx.globalAlpha = n.held ? 0.9 : 0.55;
      ctx.fillStyle = FRET_COLORS[lane];
      ctx.shadowColor = FRET_GLOW[lane];
      ctx.shadowBlur = n.held ? 22 : 10;
      ctx.beginPath();
      ctx.moveTo(x1 - w1, y1);
      ctx.lineTo(x2 - w2, y2);
      ctx.lineTo(x2 + w2, y2);
      ctx.lineTo(x1 + w1, y1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawGem(
    ctx: CanvasRenderingContext2D, x: number, y: number, scale: number,
    lane: number, colorblind: boolean, overdrive: boolean
  ) {
    const r = L_RADIUS_CACHE.r * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = overdrive ? "#ffffff" : FRET_GLOW[lane];
    ctx.shadowBlur = 18 * scale;

    // body
    const grad = ctx.createRadialGradient(0, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.35, overdrive ? "#fff3c0" : FRET_COLORS[lane]);
    grad.addColorStop(1, FRET_GLOW[lane]);
    ctx.fillStyle = grad;
    this.shapeFor(ctx, lane, r, colorblind);
    ctx.fill();

    // rim
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    this.shapeFor(ctx, lane, r, colorblind);
    ctx.stroke();
    ctx.restore();
  }

  /** Colour-blind support: each lane also has a distinct SHAPE. */
  private shapeFor(ctx: CanvasRenderingContext2D, lane: number, r: number, colorblind: boolean) {
    ctx.beginPath();
    if (!colorblind) {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      return;
    }
    switch (lane) {
      case 0: // circle
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        break;
      case 1: { // triangle
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
          const px = Math.cos(a) * r, py = Math.sin(a) * r;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
      }
      case 2: // square
        ctx.rect(-r * 0.82, -r * 0.82, r * 1.64, r * 1.64);
        break;
      case 3: { // diamond
        ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
        ctx.closePath();
        break;
      }
      default: { // pentagon / star-ish
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          const px = Math.cos(a) * r, py = Math.sin(a) * r;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
    }
  }

  // ---- strike targets / frets --------------------------------------------
  private drawFrets(ctx: CanvasRenderingContext2D, L: Layout, st: HighwayState) {
    L_RADIUS_CACHE.r = L.fretRadius; // keep gem radius in sync with layout

    // strike line
    ctx.save();
    ctx.strokeStyle = st.overdrive ? "rgba(255,210,74,0.9)" : "rgba(234,252,255,0.7)";
    ctx.lineWidth = 3;
    ctx.shadowColor = st.overdrive ? "#ffd24a" : "#14f1ff";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(L.cx - L.nearHalfWidth, L.hitLineY);
    ctx.lineTo(L.cx + L.nearHalfWidth, L.hitLineY);
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < LANES; i++) {
      const x = L.laneCentersHit[i];
      const press = this.pressAnim[i];
      const r = L.fretRadius * (1 - press * 0.12);
      const y = L.hitLineY + press * 4;

      // outer ring
      ctx.save();
      ctx.translate(x, y);
      ctx.shadowColor = FRET_GLOW[i];
      ctx.shadowBlur = 14 + this.laneGlow[i] * 26 + press * 18;
      ctx.lineWidth = 4;
      ctx.strokeStyle = FRET_COLORS[i];
      this.shapeFor(ctx, i, r, st.colorblind);
      ctx.stroke();

      // inner fill brightens when pressed/hit
      const lit = Math.max(press, this.laneGlow[i]);
      ctx.globalAlpha = 0.18 + lit * 0.75;
      const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, FRET_COLORS[i]);
      ctx.fillStyle = grad;
      this.shapeFor(ctx, i, r * 0.86, st.colorblind);
      ctx.fill();
      ctx.restore();
    }
  }
}

// gem radius is set from layout each frame in drawFrets (avoids threading it
// through every call site)
const L_RADIUS_CACHE = { r: 40 };
