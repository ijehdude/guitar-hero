/**
 * PLUGGABLE AUDIO SOURCE (Feature 3) — INTENTIONALLY STUBBED FOR THE MVP.
 *
 * "Search a song by name → fetch the track → auto-chart → play" is deliberately
 * NOT implemented here. Downloading/extracting copyrighted audio (e.g. YouTube)
 * raises real legal + Terms-of-Service problems, and it does not fit a stateless
 * static Vercel deploy (no persistent disk, short function timeouts).
 *
 * Instead we define the INTERFACE a future backend would implement, so the rest
 * of the app can target it cleanly. See ROADMAP.md → "Feature 3" for the legal
 * analysis and the separate infrastructure it requires.
 */
import type { Gem } from "../game/chart";

export interface SourcedTrack {
  title: string;
  artist: string;
  /** A legally-obtained, decodable audio source (e.g. licensed preview URL). */
  audioUrl: string;
  /** Optional pre-computed chart from the backend; else auto-chart client-side. */
  gems?: Gem[];
  bpm?: number;
  durationSec?: number;
  attribution?: string;
}

export interface AudioSource {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  search(query: string): Promise<SourcedTrack[]>;
}

/**
 * The only source shipped in the MVP: a clearly-labelled stub that returns no
 * results and explains why. Swap in a real implementation (Vercel serverless +
 * a *licensed* provider) without touching the UI.
 */
export const stubSource: AudioSource = {
  id: "stub",
  label: "Online search (coming soon)",
  available: false,
  async search() {
    throw new Error(
      "Online song search isn't available in this build. It requires a licensed " +
        "audio provider and a server backend — see ROADMAP.md. For now, upload your " +
        "own audio file to auto-generate a chart."
    );
  },
};

let active: AudioSource = stubSource;
export function getAudioSource(): AudioSource {
  return active;
}
export function setAudioSource(src: AudioSource): void {
  active = src;
}
