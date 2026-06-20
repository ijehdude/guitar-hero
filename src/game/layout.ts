/**
 * Shared geometry for the note highway. BOTH the renderer (highway.ts) and the
 * touch input layer (core/input.ts) compute zones from this single source, so
 * what you see is exactly what you can tap. Uses a simple linear perspective:
 * lanes are a trapezoid that converges toward a vanishing point near the top.
 */
import type { Settings } from "../core/storage";

export const LANES = 5 as const;

export interface Layout {
  w: number;
  h: number;
  cx: number;
  highwayTop: number; // y where notes spawn (far)
  hitLineY: number; // y of the strike line (near, d=0)
  nearHalfWidth: number; // half-width of highway at hit line
  farConverge: number; // width/spacing scale at the far end (0..1)
  laneCentersHit: number[]; // lane center X at the hit line
  laneWidthHit: number; // lane width at hit line
  fretRadius: number; // radius of the strike targets / touch buttons
  strumZone: { x: number; y: number; w: number; h: number };
  lefty: boolean;
}

export function computeLayout(w: number, h: number, settings: Settings): Layout {
  const cx = w / 2;
  const portrait = h >= w;

  // Reserve bottom band for thumb controls / strum on touch; keep targets reachable.
  const controlsBand = portrait ? Math.min(220, h * 0.26) : Math.min(150, h * 0.22);
  const hitLineY = h - controlsBand;
  const highwayTop = portrait ? h * 0.06 : h * 0.04;

  // Highway width: wide enough to read, but leaves margins on desktop.
  const maxHalf = Math.min(w * 0.46, 520);
  const nearHalfWidth = maxHalf;
  const laneWidthHit = (nearHalfWidth * 2) / LANES;

  const laneCentersHit: number[] = [];
  for (let i = 0; i < LANES; i++) {
    const idx = settings.lefty ? LANES - 1 - i : i;
    laneCentersHit[i] = cx - nearHalfWidth + laneWidthHit * (idx + 0.5);
  }

  const fretRadius = Math.min(laneWidthHit * 0.42, 52);

  // Strum zone: the full-width band below the strike line.
  const strumZone = {
    x: 0,
    y: hitLineY + fretRadius * 0.7,
    w,
    h: h - (hitLineY + fretRadius * 0.7),
  };

  return {
    w, h, cx,
    highwayTop,
    hitLineY,
    nearHalfWidth,
    farConverge: 0.32,
    laneCentersHit,
    laneWidthHit,
    fretRadius,
    strumZone,
    lefty: settings.lefty,
  };
}

/** Map note distance d (0 = at hit line, 1 = far spawn) to screen Y. */
export function yForDistance(L: Layout, d: number): number {
  // Slight ease so notes "rush" the strike line near the bottom (perspective).
  const f = Math.pow(clamp01(d), 1.0);
  return L.hitLineY - (L.hitLineY - L.highwayTop) * f;
}

/** Perspective scale (lane spacing & note size) at distance d. */
export function scaleForDistance(L: Layout, d: number): number {
  return lerp(1, L.farConverge, clamp01(d));
}

/** Lane center X at distance d. */
export function laneXAt(L: Layout, lane: number, d: number): number {
  const s = scaleForDistance(L, d);
  return L.cx + (L.laneCentersHit[lane] - L.cx) * s;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
