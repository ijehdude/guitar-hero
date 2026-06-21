/**
 * AUTO-CHARTER (Feature 2) — 100% in-browser, no server.
 *
 * Pipeline: decode -> mono -> onset envelope (energy flux) -> adaptive peak pick
 * -> tempo estimate (autocorrelation) -> quantize onsets to a 16th grid ->
 * assign lanes by brightness (zero-crossing rate as a cheap spectral proxy).
 *
 * The result is a dense "master" gem stream; chart.ts/buildChart() then thins it
 * to the chosen difficulty. It's intentionally lightweight (no FFT dependency)
 * so it runs smoothly on phones. ROADMAP.md covers the production-grade upgrade.
 */
import type { Gem } from "../game/chart";

export interface AnalyzeResult {
  gems: Gem[];
  bpm: number;
  duration: number;
}

const FRAME = 1024;
const HOP = 512;

export async function decodeFile(ctx: AudioContext, file: File): Promise<AudioBuffer> {
  const arr = await file.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}

/** Average all channels into a single mono Float32Array. */
export function toMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i];
  }
  const inv = 1 / buffer.numberOfChannels;
  for (let i = 0; i < len; i++) mono[i] *= inv;
  return mono;
}

export async function analyzeBuffer(
  buffer: AudioBuffer,
  onProgress?: (p: number) => void
): Promise<AnalyzeResult> {
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const mono = toMono(buffer);

  // ---- per-frame energy + zero-crossing rate ----
  const frames = Math.max(1, Math.floor((len - FRAME) / HOP));
  const energy = new Float32Array(frames);
  const zcr = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    let e = 0;
    let zc = 0;
    let prev = mono[start];
    for (let i = 1; i < FRAME; i++) {
      const s = mono[start + i];
      e += s * s;
      if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) zc++;
      prev = s;
    }
    energy[f] = Math.sqrt(e / FRAME);
    zcr[f] = zc / FRAME;
    if (onProgress && (f & 1023) === 0) {
      onProgress((f / frames) * 0.6);
      await microYield();
    }
  }

  // ---- onset envelope: half-wave rectified energy flux, smoothed ----
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    flux[f] = Math.max(0, energy[f] - energy[f - 1]);
  }
  smooth(flux, 2);

  const frameRate = sr / HOP;

  // ---- adaptive peak picking ----
  const win = Math.round(frameRate * 0.2); // 200ms adaptive window
  const minGapFrames = Math.round(frameRate * 0.09); // ~min 16th @ ~165bpm
  const onsets: { frame: number; strength: number }[] = [];
  let lastPeak = -Infinity;
  for (let f = 1; f < frames - 1; f++) {
    let mean = 0;
    let count = 0;
    for (let k = Math.max(0, f - win); k <= Math.min(frames - 1, f + win); k++) {
      mean += flux[k];
      count++;
    }
    mean /= count;
    const thr = mean * 1.6 + 1e-4;
    if (flux[f] > thr && flux[f] >= flux[f - 1] && flux[f] >= flux[f + 1] && f - lastPeak >= minGapFrames) {
      onsets.push({ frame: f, strength: flux[f] });
      lastPeak = f;
    }
  }
  if (onProgress) onProgress(0.75);
  await microYield();

  // ---- tempo via autocorrelation of the onset envelope ----
  const bpm = estimateTempo(flux, frameRate);

  // ---- quantize onsets to a 16th-note grid, assign lanes by brightness ----
  const spb = 60 / bpm;
  const sixteenth = spb / 4;
  const phase = onsets.length ? onsets[0].frame / frameRate % sixteenth : 0;

  // brightness percentiles for lane mapping
  const zVals = onsets.map((o) => zcr[o.frame]).sort((a, b) => a - b);
  const zLo = percentile(zVals, 0.1);
  const zHi = percentile(zVals, 0.9) || zLo + 1e-3;

  const taps: Gem[] = [];
  let lastTime = -Infinity;
  for (const o of onsets) {
    const raw = o.frame / frameRate;
    const q = Math.round((raw - phase) / sixteenth) * sixteenth + phase;
    const t = Math.max(0, q);
    if (t - lastTime < sixteenth * 0.5) continue; // de-dupe after quantization
    lastTime = t;
    const b = (zcr[o.frame] - zLo) / (zHi - zLo);
    const lane = Math.max(0, Math.min(4, Math.round(b * 4)));
    taps.push({ time: t, lanes: [lane], duration: 0 });
  }

  // GH2-style "tap and hold": collapse machine-gun clusters of onsets into ONE
  // held note, then extend isolated notes that ring out into sustains.
  const gems = consolidateDenseGems(taps, sixteenth * 1.3, 4, 0.28);
  applySustains(gems, energy, frameRate, buffer.duration);

  if (onProgress) onProgress(1);
  return { gems, bpm, duration: buffer.duration };
}

/**
 * Replace a run of >= `minRun` onsets each spaced <= `clusterGap` apart with a
 * single hold note spanning the run (lane = the run's median lane). Pure +
 * unit-testable. Runs shorter than `minHold` seconds stay as individual taps.
 */
export function consolidateDenseGems(gems: Gem[], clusterGap: number, minRun: number, minHold: number): Gem[] {
  const out: Gem[] = [];
  let i = 0;
  while (i < gems.length) {
    let j = i;
    while (j + 1 < gems.length && gems[j + 1].time - gems[j].time <= clusterGap) j++;
    const runLen = j - i + 1;
    const span = gems[j].time - gems[i].time;
    if (runLen >= minRun && span >= minHold) {
      const lanes = gems.slice(i, j + 1).map((g) => g.lanes[0]).sort((a, b) => a - b);
      out.push({ time: gems[i].time, lanes: [lanes[lanes.length >> 1]], duration: span });
    } else {
      for (let k = i; k <= j; k++) out.push(gems[k]);
    }
    i = j + 1;
  }
  return out;
}

/** Extend a tap into a sustain when the audio keeps ringing into the next gap. */
function applySustains(gems: Gem[], energy: Float32Array, frameRate: number, duration: number): void {
  for (let i = 0; i < gems.length; i++) {
    if ((gems[i].duration ?? 0) > 0) continue; // already a hold
    const t = gems[i].time;
    const tn = i + 1 < gems.length ? gems[i + 1].time : duration;
    const gap = tn - t;
    if (gap < 0.5) continue;
    const f0 = Math.min(energy.length - 1, Math.max(0, Math.round(t * frameRate)));
    const fEnd = Math.min(energy.length - 1, Math.round((t + gap) * frameRate));
    const e0 = energy[f0];
    if (!e0 || e0 < 1e-4) continue;
    let sum = 0, c = 0;
    for (let f = f0; f <= fEnd; f++) { sum += energy[f]; c++; }
    if (c && sum / c >= 0.5 * e0) gems[i].duration = Math.min(gap * 0.85, 2.0);
  }
}

function smooth(a: Float32Array, radius: number) {
  const copy = a.slice();
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    let c = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < a.length) {
        s += copy[j];
        c++;
      }
    }
    a[i] = s / c;
  }
}

function estimateTempo(flux: Float32Array, frameRate: number): number {
  // search lag range corresponding to 70..180 BPM
  const minLag = Math.round((60 / 180) * frameRate);
  const maxLag = Math.round((60 / 70) * frameRate);
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < flux.length; i++) sum += flux[i] * flux[i - lag];
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  let bpm = (60 * frameRate) / bestLag;
  // fold into a comfortable range
  while (bpm < 90) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

function microYield(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
