/**
 * The master clock. Everything in the game is timed against the Web Audio
 * hardware clock (AudioContext.currentTime), NOT requestAnimationFrame deltas —
 * rAF drifts and stutters, the audio clock does not. This is the single most
 * important decision for making a rhythm game feel tight.
 *
 * songTime(): seconds since the chart's t=0, in the same timebase as note times.
 */
export class Clock {
  readonly ctx: AudioContext;
  readonly master: GainNode;

  private startCtxTime = 0; // ctx.currentTime when song t=0 occurred
  private running = false;
  private pausedAt = 0; // songTime captured at pause

  constructor() {
    const AC: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
  }

  setVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  /** Browsers require a user gesture before audio can start. */
  async resume(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /**
   * Start (or restart) the song clock so that songTime == startAtSec right now.
   * Pass a small negative number (e.g. -3) for a count-in lead time.
   */
  start(startAtSec = 0): void {
    this.startCtxTime = this.ctx.currentTime - startAtSec;
    this.running = true;
  }

  pause(): void {
    if (!this.running) return;
    this.pausedAt = this.songTime();
    this.running = false;
  }

  resumePlayback(): void {
    if (this.running) return;
    this.startCtxTime = this.ctx.currentTime - this.pausedAt;
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.pausedAt = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Current position in the song, in seconds. */
  songTime(): number {
    return this.running ? this.ctx.currentTime - this.startCtxTime : this.pausedAt;
  }

  /** Convert a future songTime into an absolute ctx time for precise scheduling. */
  ctxTimeFor(songTimeSec: number): number {
    return this.startCtxTime + songTimeSec;
  }

  now(): number {
    return this.ctx.currentTime;
  }
}
