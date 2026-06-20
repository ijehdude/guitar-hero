/**
 * BUILT-IN SONGS — original, royalty-free music generated procedurally.
 *
 * composeSong() is a pure function: from a small SongDef (key, tempo, groove,
 * seed) it deterministically produces BOTH the audio event stream and the gem
 * chart. Because the gems come from the same melody the synth plays, the notes
 * you see are exactly the notes you hear — perfect, guaranteed sync.
 *
 * SynthTrack wraps a CompiledSong with a Web Audio lookahead scheduler.
 */
import type { Clock } from "../core/clock";
import type { Synth } from "./synth";
import type { AudioTrack } from "./track";
import type { Gem } from "../game/chart";

// ---- Music theory helpers ---------------------------------------------------
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const MINOR_PENTA = [0, 3, 5, 7, 10];

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Deterministic PRNG so every player gets the same (well-tuned) chart. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Song definitions -------------------------------------------------------
export type GrooveStyle = "four" | "rock";

export interface SongDef {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  bars: number; // total playable bars
  keyRoot: number; // midi note of the tonic
  groove: GrooveStyle;
  seed: number;
  unlockedByDefault: boolean;
  /** scale-degree roots of the chord progression (per bar, cycles) */
  progression: number[];
  intent: string; // short flavour text for song select
}

export interface AudioEvent {
  t: number; // songTime seconds
  type: "kick" | "snare" | "hat" | "bass" | "lead" | "pad";
  freq?: number;
  freqs?: number[];
  dur?: number;
  gain?: number;
  open?: boolean;
}

export interface CompiledSong {
  def: SongDef;
  gems: Gem[];
  events: AudioEvent[];
  duration: number;
}

export const SONGS: SongDef[] = [
  {
    id: "neon-overdrive",
    title: "Neon Overdrive",
    artist: "FRETSTORM Synth",
    bpm: 128,
    bars: 44,
    keyRoot: 45, // A2
    groove: "four",
    seed: 1337,
    unlockedByDefault: true,
    progression: [0, 5, 6, 4], // i - VI - VII - v
    intent: "Driving synthwave. Pure neon adrenaline.",
  },
  {
    id: "midnight-circuit",
    title: "Midnight Circuit",
    artist: "FRETSTORM Synth",
    bpm: 100,
    bars: 40,
    keyRoot: 40, // E2
    groove: "rock",
    seed: 7,
    unlockedByDefault: true,
    progression: [0, 6, 5, 4], // i - VII - VI - v
    intent: "Moody after-hours rock. Slower, heavier groove.",
  },
  {
    id: "starforge-anthem",
    title: "Starforge Anthem",
    artist: "FRETSTORM Synth",
    bpm: 150,
    bars: 48,
    keyRoot: 43, // G2
    groove: "four",
    seed: 99,
    unlockedByDefault: false,
    progression: [0, 4, 5, 6],
    intent: "Fast, triumphant, relentless. Unlock by 4★ on any song.",
  },
];

/** Tiny, gentle track used by the interactive tutorial. */
export const TUTORIAL_DEF: SongDef = {
  id: "tutorial-sparks",
  title: "First Sparks",
  artist: "FRETSTORM",
  bpm: 84,
  bars: 16,
  keyRoot: 45,
  groove: "four",
  seed: 3,
  unlockedByDefault: true,
  progression: [0, 5],
  intent: "Learn the frets and the strum.",
};

// ---- Composition ------------------------------------------------------------
const LEAD_ENTER_BAR = 2; // 2 bars of groove intro before notes start

export function composeSong(def: SongDef, opts: { sparse?: boolean } = {}): CompiledSong {
  const rnd = mulberry32(def.seed);
  const spb = 60 / def.bpm; // seconds per beat
  const barSec = spb * 4;
  const events: AudioEvent[] = [];
  const gems: Gem[] = [];

  const scale = NATURAL_MINOR;
  const leadScale = MINOR_PENTA;
  const leadLo = def.keyRoot + 24; // lead register (2 octaves up)
  const leadHi = leadLo + 16;

  const laneForMidi = (m: number) => {
    const t = (m - leadLo) / (leadHi - leadLo);
    return Math.max(0, Math.min(4, Math.round(t * 4)));
  };

  // Pre-generate reusable melodic motifs (phrase repetition = musical). Authored
  // at 16th-note resolution so Expert gets dense runs while easier difficulties
  // are thinned to eighths/quarters by chart.ts.
  type LeadStep = { sub: number; deg: number; len: number; accent: boolean };
  const makeMotif = (): LeadStep[] => {
    const steps: LeadStep[] = [];
    let deg = Math.floor(rnd() * leadScale.length);
    const playProb = opts.sparse ? 0.32 : 0.5; // chance a given 16th slot sounds
    for (let s = 0; s < 16; s++) {
      const onBeat = s % 4 === 0;
      if (!onBeat && rnd() > playProb) continue; // beats more likely than offbeats
      const step = rnd() > 0.5 ? 1 : -1;
      if (rnd() > 0.72) deg += step * 2;
      else deg += step;
      deg = Math.max(0, Math.min(leadScale.length * 2 - 1, deg));
      // longer (sustained) notes at phrase ends
      const len = onBeat && rnd() > 0.8 ? (rnd() > 0.5 ? 4 : 2) : 1;
      steps.push({ sub: s, deg, len, accent: onBeat });
    }
    return steps;
  };
  const motifs = [makeMotif(), makeMotif(), makeMotif(), makeMotif()];

  const degToMidi = (deg: number) => {
    const oct = Math.floor(deg / leadScale.length);
    const idx = deg % leadScale.length;
    return leadLo + oct * 12 + leadScale[idx];
  };

  for (let bar = 0; bar < def.bars; bar++) {
    const barStart = bar * barSec;
    const chordRoot = def.progression[bar % def.progression.length];

    // --- chord pad (every bar, soft) ---
    const padRoot = def.keyRoot + 12 + scale[chordRoot % scale.length];
    const third = def.keyRoot + 12 + scale[(chordRoot + 2) % scale.length] + (chordRoot + 2 >= scale.length ? 12 : 0);
    const fifth = def.keyRoot + 12 + scale[(chordRoot + 4) % scale.length] + (chordRoot + 4 >= scale.length ? 12 : 0);
    events.push({ t: barStart, type: "pad", freqs: [padRoot, third, fifth].map(midiToFreq), dur: barSec, gain: 0.09 });

    // --- drums ---
    for (let beat = 0; beat < 4; beat++) {
      const tb = barStart + beat * spb;
      if (def.groove === "four") {
        events.push({ t: tb, type: "kick", gain: 1 });
        if (beat % 2 === 1) events.push({ t: tb, type: "snare", gain: 0.7 });
      } else {
        if (beat === 0 || beat === 2) events.push({ t: tb, type: "kick", gain: 1 });
        if (beat === 1 || beat === 3) events.push({ t: tb, type: "snare", gain: 0.8 });
      }
      // offbeat hats
      events.push({ t: tb, type: "hat", gain: 0.25 });
      events.push({ t: tb + spb / 2, type: "hat", gain: 0.18, open: beat === 3 });
    }

    // --- bass (root eighths with octave pops) ---
    const bassRoot = def.keyRoot + scale[chordRoot % scale.length];
    for (let e = 0; e < 8; e++) {
      const tb = barStart + e * (spb / 2);
      const oct = e % 4 === 3 ? 12 : 0;
      events.push({ t: tb, type: "bass", freq: midiToFreq(bassRoot + oct), dur: spb / 2, gain: 0.5 });
    }

    // --- lead + gems (only after the intro bars) ---
    if (bar >= LEAD_ENTER_BAR) {
      const motif = motifs[bar % motifs.length];
      const sixteenth = spb / 4;
      for (const st of motif) {
        const t = barStart + st.sub * sixteenth;
        const midi = degToMidi(st.deg);
        const dur = st.len * sixteenth;
        events.push({ t, type: "lead", freq: midiToFreq(midi), dur, gain: st.accent ? 0.34 : 0.27 });

        const lane = laneForMidi(midi);
        const lanes = [lane];
        // occasional power-chord style two-fret accent on strong beats (expert flavour)
        if (st.accent && rnd() > 0.8) {
          const second = lane >= 4 ? lane - 1 : lane + 1;
          lanes.push(second);
        }
        gems.push({ time: t, lanes, duration: st.len >= 3 ? dur * 0.85 : 0 });
      }
    }
  }

  const duration = def.bars * barSec + 1.5;
  gems.sort((a, b) => a.time - b.time);
  events.sort((a, b) => a.t - b.t);
  return { def, gems, events, duration };
}

// ---- SynthTrack: schedule a CompiledSong against the clock ------------------
export class SynthTrack implements AudioTrack {
  readonly duration: number;
  private idx = 0;
  private clock: Clock | null = null;
  private active = false;

  constructor(private synth: Synth, private song: CompiledSong) {
    this.duration = song.duration;
  }

  start(clock: Clock): void {
    this.clock = clock;
    this.active = true;
    // skip events already in the past (e.g. resuming mid-song)
    const now = clock.songTime();
    while (this.idx < this.song.events.length && this.song.events[this.idx].t < now) this.idx++;
  }

  update(songTime: number): void {
    if (!this.active || !this.clock) return;
    const lookahead = songTime + 0.12; // schedule ~120ms ahead
    const ev = this.song.events;
    while (this.idx < ev.length && ev[this.idx].t <= lookahead) {
      const e = ev[this.idx++];
      const at = this.clock.ctxTimeFor(e.t);
      switch (e.type) {
        case "kick": this.synth.kick(at, e.gain); break;
        case "snare": this.synth.snare(at, e.gain); break;
        case "hat": this.synth.hat(at, e.gain, e.open); break;
        case "bass": this.synth.bass(at, e.freq!, e.dur!, e.gain); break;
        case "lead": this.synth.lead(at, e.freq!, e.dur!, e.gain); break;
        case "pad": this.synth.pad(at, e.freqs!, e.dur!, e.gain); break;
      }
    }
  }

  stop(): void {
    this.active = false;
  }
}
