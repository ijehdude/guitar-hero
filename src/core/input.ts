/**
 * INPUT ABSTRACTION LAYER
 * -----------------------
 * Touch (mobile) and keyboard (PC) are translated into ONE set of semantic
 * events that the game engine consumes. Adding a new input source later (e.g.
 * gamepad, MIDI guitar) means emitting these same events — the engine never
 * needs to know where input came from.
 *
 * Emitted events:
 *   fretDown { lane }   a fret was pressed (0..4, low->high)
 *   fretUp   { lane }   a fret was released
 *   strum    { dir }    a strum occurred ("down" | "up")
 *   overdrive           star power / overdrive activation requested
 *   pause               pause requested
 *
 * The engine can also poll heldFrets() at the moment of a strum to resolve chords.
 */
import { Emitter } from "./events";
import type { Layout } from "../game/layout";
import type { Settings } from "./storage";

export interface InputEvents {
  fretDown: { lane: number; source: "touch" | "key" };
  fretUp: { lane: number; source: "touch" | "key" };
  strum: { dir: "down" | "up"; source: "touch" | "key" };
  overdrive: void;
  pause: void;
}

interface Pointer {
  role: "fret" | "strum";
  lane: number; // valid when role==="fret"
  startX: number;
  startY: number;
  lastStrumY: number;
  strummed: boolean;
}

export class InputManager extends Emitter<InputEvents> {
  enabled = false;
  private held = [false, false, false, false, false];
  private pointers = new Map<number, Pointer>();
  private layout: Layout | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private getSettings: () => Settings
  ) {
    super();
    this.attach();
  }

  setLayout(l: Layout) {
    this.layout = l;
  }

  heldFrets(): boolean[] {
    return this.held;
  }

  /** Highest held fret index, or -1. Useful for single-note "anchor" play. */
  topHeld(): number {
    for (let i = 4; i >= 0; i--) if (this.held[i]) return i;
    return -1;
  }

  private setHeld(lane: number, down: boolean, source: "touch" | "key") {
    if (this.held[lane] === down) return;
    this.held[lane] = down;
    this.emit(down ? "fretDown" : "fretUp", { lane, source });
  }

  // ---- Keyboard -----------------------------------------------------------
  private onKeyDown = (e: KeyboardEvent) => {
    const b = this.getSettings().bindings;
    if (e.code === b.pause) {
      e.preventDefault();
      this.emit("pause", undefined);
      return;
    }
    if (!this.enabled) return;
    if (e.repeat) return; // ignore auto-repeat

    const fi = b.frets.indexOf(e.code);
    if (fi >= 0) {
      e.preventDefault();
      this.setHeld(fi, true, "key");
      return;
    }
    if (e.code === b.strumDown) {
      e.preventDefault();
      this.emit("strum", { dir: "down", source: "key" });
    } else if (e.code === b.strumUp) {
      e.preventDefault();
      this.emit("strum", { dir: "up", source: "key" });
    } else if (e.code === b.overdrive) {
      e.preventDefault();
      this.emit("overdrive", undefined);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const b = this.getSettings().bindings;
    const fi = b.frets.indexOf(e.code);
    if (fi >= 0) {
      e.preventDefault();
      this.setHeld(fi, false, "key");
    }
  };

  // ---- Touch / pointer ----------------------------------------------------
  private laneAt(x: number, y: number): number {
    const L = this.layout;
    if (!L) return -1;
    // Generous vertical band around the strike line so thumbs feel forgiving.
    const band = L.fretRadius * 2.4;
    if (y < L.hitLineY - band || y > L.hitLineY + band) return -1;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < L.laneCentersHit.length; i++) {
      const dx = Math.abs(x - L.laneCentersHit[i]);
      if (dx < L.laneWidthHit * 0.62 && dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    }
    return best;
  }

  private inStrumZone(x: number, y: number): boolean {
    const L = this.layout;
    if (!L) return false;
    const z = L.strumZone;
    return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
  }

  private localPos(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    const [x, y] = this.localPos(e);
    const lane = this.laneAt(x, y);
    if (lane >= 0) {
      this.pointers.set(e.pointerId, {
        role: "fret", lane, startX: x, startY: y, lastStrumY: y, strummed: false,
      });
      this.setHeld(lane, true, "touch");
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    if (this.inStrumZone(x, y)) {
      this.pointers.set(e.pointerId, {
        role: "strum", lane: -1, startX: x, startY: y, lastStrumY: y, strummed: true,
      });
      this.emit("strum", { dir: "down", source: "touch" });
      this.canvas.setPointerCapture?.(e.pointerId);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.enabled) return;
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const [x, y] = this.localPos(e);

    if (p.role === "fret") {
      // Slide between adjacent frets (hammer-on style chord changes).
      const lane = this.laneAt(x, y);
      if (lane >= 0 && lane !== p.lane) {
        this.setHeld(p.lane, false, "touch");
        this.setHeld(lane, true, "touch");
        p.lane = lane;
      }
    } else {
      // Strum zone swipe: each direction change past a threshold = a new strum.
      const dy = y - p.lastStrumY;
      if (Math.abs(dy) > 26) {
        this.emit("strum", { dir: dy > 0 ? "down" : "up", source: "touch" });
        p.lastStrumY = y;
      }
    }
  };

  private endPointer = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (p.role === "fret") this.setHeld(p.lane, false, "touch");
    this.pointers.delete(e.pointerId);
  };

  private attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.endPointer);
    this.canvas.addEventListener("pointercancel", this.endPointer);
    // prevent iOS scroll/zoom/long-press selection on the play surface
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Release everything (used on pause / screen change). */
  reset() {
    for (let i = 0; i < 5; i++) if (this.held[i]) this.setHeld(i, false, "touch");
    this.pointers.clear();
  }

  destroy() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.clear();
  }
}
