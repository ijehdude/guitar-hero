/**
 * Chart data model + difficulty reduction.
 *
 * A "master" note stream (from a built-in song generator OR the auto-charter) is
 * reduced into Easy/Medium/Hard/Expert by thinning density, clamping chord size,
 * and remapping into the allowed fret set. This is why a song authored once can
 * be played at every difficulty and still feel musical.
 */
import type { Difficulty } from "../core/storage";

export interface Note {
  id: number;
  time: number; // strike time in seconds (chart timebase, t=0 = song start)
  lanes: number[]; // fret indices 0..4, low->high (one = tap, many = chord)
  duration: number; // sustain length in seconds (0 = a tap note)

  // runtime judging state (mutated by the engine)
  judged?: boolean;
  hit?: boolean;
  held?: boolean; // currently holding a sustain
  sustainScored?: number; // last songTime we awarded sustain ticks
}

export interface Chart {
  difficulty: Difficulty;
  notes: Note[]; // sorted ascending by time
  noteCount: number; // number of judged objects (for accuracy %)
}

interface DiffCfg {
  lanes: number[]; // allowed fret indices
  minGap: number; // min seconds between consecutive kept notes
  maxChord: number;
}

const DIFF: Record<Difficulty, DiffCfg> = {
  easy: { lanes: [0, 1, 2], minGap: 0.33, maxChord: 1 },
  medium: { lanes: [0, 1, 2, 3], minGap: 0.21, maxChord: 1 },
  hard: { lanes: [0, 1, 2, 3, 4], minGap: 0.12, maxChord: 2 },
  expert: { lanes: [0, 1, 2, 3, 4], minGap: 0.07, maxChord: 3 },
};

/** Raw gem before difficulty processing. */
export interface Gem {
  time: number;
  lanes: number[];
  duration?: number;
}

export function buildChart(master: Gem[], difficulty: Difficulty): Chart {
  const cfg = DIFF[difficulty];
  const src = [...master].sort((a, b) => a.time - b.time);
  const out: Note[] = [];
  let lastKept = -Infinity;
  let id = 0;

  for (const g of src) {
    if (g.time - lastKept < cfg.minGap) continue; // thin density for the difficulty
    lastKept = g.time;

    // remap lanes into the allowed set, clamp chord size, dedupe
    const mapped = new Set<number>();
    for (const lane of g.lanes) {
      const t = lane / 4; // 0..1 across the 5-fret board
      const idx = Math.round(t * (cfg.lanes.length - 1));
      mapped.add(cfg.lanes[idx]);
      if (mapped.size >= cfg.maxChord) break;
    }
    const lanes = [...mapped].sort((a, b) => a - b);
    if (lanes.length === 0) continue;

    out.push({
      id: id++,
      time: g.time,
      lanes,
      duration: difficulty === "easy" ? 0 : Math.max(0, g.duration ?? 0),
    });
  }

  return { difficulty, notes: out, noteCount: out.length };
}

/** Reset per-attempt runtime state without rebuilding the chart. */
export function resetChart(chart: Chart): void {
  for (const n of chart.notes) {
    n.judged = false;
    n.hit = false;
    n.held = false;
    n.sustainScored = undefined;
  }
}
