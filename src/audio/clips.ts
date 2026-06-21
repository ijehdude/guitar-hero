/**
 * Clip override store. Resolves which window of a song to play:
 *   per-device override (localStorage, set in the in-app clip editor)
 *     → committed override (data/segments.json)
 *       → auto-pick (clip.ts pickClip)
 * The auto-pick is best-effort; overrides are how the player *ensures* the chorus.
 */
import segmentsRaw from "../data/segments.json";
import { Clip, pickClip } from "./clip";

const LS_KEY = "fretstorm.clips.v1";
// segments.json may carry a "_comment" string key; ids are looked up explicitly
// so the cast is safe.
const segments = segmentsRaw as unknown as Record<string, Clip>;

function load(): Record<string, Clip> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
function save(all: Record<string, Clip>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* private mode / full */
  }
}

/** An explicit override for this song (device or committed), or null. */
export function getOverride(id: string): Clip | null {
  return load()[id] ?? segments[id] ?? null;
}

export function setOverride(id: string, clip: Clip): void {
  const all = load();
  all[id] = clip;
  save(all);
}

export function clearOverride(id: string): void {
  const all = load();
  delete all[id];
  save(all);
}

export function hasOverride(id: string): boolean {
  return id in load() || id in segments;
}

/** The clip to use for a song: explicit override, else auto-pick from the audio. */
export function effectiveClip(id: string, buffer: AudioBuffer): Clip {
  return getOverride(id) ?? pickClip(buffer);
}
