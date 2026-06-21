/**
 * Persistence layer (localStorage). Holds player settings, key bindings,
 * progression/unlocks and high scores. Generated charts for uploaded audio are
 * cached separately in IndexedDB (see audio/chartCache.ts) because they can be
 * large; this module only deals with small JSON blobs.
 */

export type Difficulty = "easy" | "medium" | "hard" | "expert";

export interface KeyBindings {
  /** event.code for each of the 5 frets, low->high */
  frets: [string, string, string, string, string];
  /** event.code for strum-down */
  strumDown: string;
  /** event.code for strum-up (alternate strum) */
  strumUp: string;
  /** star power / overdrive activation */
  overdrive: string;
  pause: string;
}

export interface Settings {
  /** ms; positive = notes judged later (compensates audio output latency) */
  audioOffsetMs: number;
  /** ms; positive = inputs treated as earlier (compensates input latency) */
  inputOffsetMs: number;
  /** seconds it takes a note to travel the highway. Lower = faster scroll. */
  noteTravelSec: number;
  masterVolume: number;
  colorblind: boolean; // adds distinct shapes/symbols per lane
  lefty: boolean; // mirror the highway
  screenShake: boolean;
  haptics: boolean; // vibrate on hits (Android touch; iOS web has no vibration)
  hitSfx: boolean; // little blip on each hit (off by default)
  hitAssist: boolean; // Easy-mode forgiveness: strum optional, wider windows
  bindings: KeyBindings;
  difficulty: Difficulty;
  tutorialSeen: boolean;
  /** Optional pairing to a personal "library host" (your laptop) for streaming
   *  your own audio to this device. Set via the Settings → Connect my library
   *  flow or a #connect= deep link. Audio is never stored on the server. */
  libraryHost?: { baseUrl: string; token: string };
}

export interface ScoreRecord {
  score: number;
  maxCombo: number;
  accuracy: number; // 0..1
  stars: number; // 0..5
  difficulty: Difficulty;
  fc: boolean; // full combo
  date: number;
}

const SETTINGS_KEY = "fretstorm.settings.v1";
const SCORES_KEY = "fretstorm.scores.v1";
const UNLOCK_KEY = "fretstorm.unlocks.v1";

export const DEFAULT_BINDINGS: KeyBindings = {
  // Home-row-ish layout that works for most keyboards: A S D F G
  frets: ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG"],
  strumDown: "ArrowDown",
  strumUp: "ArrowUp",
  overdrive: "Space",
  pause: "Escape",
};

export const DEFAULT_SETTINGS: Settings = {
  audioOffsetMs: 0,
  inputOffsetMs: 0,
  noteTravelSec: 1.15,
  masterVolume: 0.85,
  colorblind: false,
  lefty: false,
  screenShake: true,
  haptics: true,
  hitSfx: false,
  hitAssist: false,
  bindings: DEFAULT_BINDINGS,
  difficulty: "medium",
  tutorialSeen: false,
  libraryHost: undefined,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be full or blocked (private mode) — fail silently */
  }
}

export const store = {
  loadSettings(): Settings {
    const s = read<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
    // bindings is a nested object; merge defensively
    s.bindings = { ...DEFAULT_BINDINGS, ...s.bindings };
    return s;
  },
  saveSettings(s: Settings): void {
    write(SETTINGS_KEY, s);
  },

  /** Best score for a song+difficulty, or null. */
  bestScore(songId: string, difficulty: Difficulty): ScoreRecord | null {
    const all = read<Record<string, ScoreRecord>>(SCORES_KEY, {});
    return all[`${songId}:${difficulty}`] ?? null;
  },
  /** Returns true if this is a new best. */
  submitScore(songId: string, rec: ScoreRecord): boolean {
    const all = read<Record<string, ScoreRecord>>(SCORES_KEY, {});
    const key = `${songId}:${rec.difficulty}`;
    const prev = all[key];
    if (!prev || rec.score > prev.score) {
      all[key] = rec;
      write(SCORES_KEY, all);
      return true;
    }
    return false;
  },

  unlockedSongs(): string[] {
    return read<{ songs: string[] }>(UNLOCK_KEY, { songs: [] }).songs;
  },
  unlock(songId: string): void {
    const cur = new Set(this.unlockedSongs());
    cur.add(songId);
    write(UNLOCK_KEY, { songs: [...cur] });
  },
};
