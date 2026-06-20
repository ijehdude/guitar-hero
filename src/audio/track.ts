/**
 * AudioTrack — the playable-audio abstraction. Whatever the source (procedural
 * synth song or a user-uploaded file), the engine drives it the same way:
 * start() at song t=0, update() each frame for lookahead scheduling, stop().
 */
import type { Clock } from "../core/clock";

export interface AudioTrack {
  readonly duration: number;
  start(clock: Clock): void;
  update(songTime: number): void;
  stop(): void;
}

/** Plays a decoded AudioBuffer (used for the upload / auto-chart path). */
export class BufferTrack implements AudioTrack {
  readonly duration: number;
  private src: AudioBufferSourceNode | null = null;
  private started = false;

  constructor(
    private ctx: AudioContext,
    private dest: GainNode,
    private buffer: AudioBuffer
  ) {
    this.duration = buffer.duration;
  }

  start(clock: Clock): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.dest);
    const when = clock.ctxTimeFor(0);
    const now = this.ctx.currentTime;
    if (when >= now) {
      src.start(when);
    } else {
      // We started mid-buffer (e.g. resume) — offset into the audio.
      src.start(now, now - when);
    }
    this.src = src;
    this.started = true;
  }

  update(_songTime: number): void {
    /* nothing to schedule — the buffer plays itself */
  }

  stop(): void {
    if (this.src && this.started) {
      try {
        this.src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.src = null;
  }
}
