/**
 * Clip selection + trimming. Library songs are long, so we play a single ~3-min
 * window that (almost always) contains the chorus, chosen by finding the most
 * energetic sustained section of the track. The player can override it by ear
 * (see clips.ts + the in-app clip editor). Pure-ish: pickClipFromMono has no DOM
 * deps so it's unit-testable in Node.
 */
import { toMono } from "./analyze";

export interface Clip {
  start: number; // seconds
  end: number; // seconds
}

export const CLIP_SEC = 180; // target clip length (~3 min)
const WHOLE_SONG_GRACE = 15; // songs within this of the target play in full

/**
 * Pick the highest mean-energy window of `targetSec`, then snap its start to a
 * nearby energy dip for a clean entry. Choruses are the loud, full sections, so
 * the loudest sustained window reliably includes one.
 */
export function pickClipFromMono(mono: Float32Array, sampleRate: number, targetSec = CLIP_SEC): Clip {
  const duration = mono.length / sampleRate;
  if (duration <= targetSec + WHOLE_SONG_GRACE) return { start: 0, end: duration };

  const frameSec = 0.5;
  const frameLen = Math.max(1, Math.floor(frameSec * sampleRate));
  const nFrames = Math.floor(mono.length / frameLen);
  const energy = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let e = 0;
    const s = f * frameLen;
    for (let i = 0; i < frameLen; i++) {
      const v = mono[s + i];
      e += v * v;
    }
    energy[f] = Math.sqrt(e / frameLen);
  }
  smooth(energy, 2);

  const winFrames = Math.max(1, Math.round(targetSec / frameSec));
  const lastStart = nFrames - winFrames;
  if (lastStart <= 0) return { start: 0, end: duration };

  // prefix sums → O(n) sliding-window mean
  const prefix = new Float64Array(nFrames + 1);
  for (let i = 0; i < nFrames; i++) prefix[i + 1] = prefix[i] + energy[i];
  let bestStart = 0;
  let bestMean = -Infinity;
  for (let s = 0; s <= lastStart; s++) {
    const mean = (prefix[s + winFrames] - prefix[s]) / winFrames;
    if (mean > bestMean) {
      bestMean = mean;
      bestStart = s;
    }
  }

  // snap start to a local energy minimum within ±3 s for a cleaner entry
  let snap = bestStart;
  let snapVal = energy[bestStart];
  for (let d = -6; d <= 6; d++) {
    const idx = bestStart + d;
    if (idx < 0 || idx > lastStart) continue;
    if (energy[idx] < snapVal) {
      snapVal = energy[idx];
      snap = idx;
    }
  }

  let start = snap * frameSec;
  start = Math.max(0, Math.min(start, duration - targetSec));
  return { start, end: start + targetSec };
}

export function pickClip(buffer: AudioBuffer, targetSec = CLIP_SEC): Clip {
  return pickClipFromMono(toMono(buffer), buffer.sampleRate, targetSec);
}

/** Copy `[start,end]` into a fresh buffer with short fades (no click on cut). */
export function sliceBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, start: number, end: number, fade = 0.06): AudioBuffer {
  const sr = buffer.sampleRate;
  const startF = Math.max(0, Math.floor(start * sr));
  const endF = Math.min(buffer.length, Math.floor(end * sr));
  const len = Math.max(1, endF - startF);
  const out = ctx.createBuffer(buffer.numberOfChannels, len, sr);
  const fadeF = Math.min(Math.floor(fade * sr), Math.floor(len / 2));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) dst[i] = src[startF + i];
    for (let i = 0; i < fadeF; i++) {
      const g = i / fadeF;
      dst[i] *= g;
      dst[len - 1 - i] *= g;
    }
  }
  return out;
}

/** Trimmed buffer for a clip — returns the original if the clip is the whole song. */
export function applyClip(ctx: BaseAudioContext, buffer: AudioBuffer, clip: Clip): AudioBuffer {
  if (clip.start <= 0.05 && clip.end >= buffer.duration - 0.05) return buffer;
  return sliceBuffer(ctx, buffer, clip.start, clip.end);
}

export function clipsEqual(a: Clip | undefined | null, b: Clip | undefined | null): boolean {
  if (!a || !b) return false;
  return Math.abs(a.start - b.start) < 0.25 && Math.abs(a.end - b.end) < 0.25;
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
