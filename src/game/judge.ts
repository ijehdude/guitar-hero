/**
 * Pure note-matching logic, factored out of the engine so it can be unit-tested
 * without a browser. Given the held frets at the instant of a strum, find the
 * closest un-judged note inside the timing window that the player has correctly
 * fretted.
 */
import type { Note } from "./chart";

export interface Windows {
  perfect: number;
  good: number;
}

/** Are exactly the right frets held for this note? `strict` forbids extra frets. */
export function matchLanes(note: Note, held: boolean[], strict: boolean): boolean {
  for (const lane of note.lanes) if (!held[lane]) return false;
  if (strict) {
    for (let i = 0; i < held.length; i++) {
      if (held[i] && !note.lanes.includes(i)) return false;
    }
  }
  return true;
}

export interface HitMatch {
  note: Note;
  abs: number; // |Δt| in seconds
}

/**
 * Search forward from `cursor` (the earliest un-judged note) for the closest
 * matching note within the Good window. Returns null if nothing matches → the
 * caller decides whether that's an overstrum.
 */
export function findHit(
  notes: Note[],
  cursor: number,
  now: number,
  w: Windows,
  held: boolean[],
  strict: boolean
): HitMatch | null {
  let best: Note | null = null;
  let bestAbs = Infinity;
  for (let i = cursor; i < notes.length; i++) {
    const n = notes[i];
    if (n.time > now + w.good) break;
    if (n.judged) continue;
    if (n.time < now - w.good) continue;
    const abs = Math.abs(n.time - now);
    if (abs < bestAbs && matchLanes(n, held, strict)) {
      best = n;
      bestAbs = abs;
    }
  }
  return best ? { note: best, abs: bestAbs } : null;
}
