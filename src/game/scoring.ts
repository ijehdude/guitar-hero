/**
 * Scoring, combos, multiplier and STAR POWER / OVERDRIVE.
 *
 * Multiplier ramps with your streak (1x→4x at 30 combo, GH-style). Overdrive,
 * earned by nailing notes, doubles the multiplier while active and drives the
 * big on-screen "juice". Tunable windows support a forgiving Easy/hit-assist mode.
 */

export type Judgement = "perfect" | "good" | "miss" | "overstrum";

export interface TimingWindows {
  perfect: number; // ± seconds
  good: number; // ± seconds
}

export const WINDOWS: TimingWindows = { perfect: 0.045, good: 0.095 };
export const WINDOWS_ASSIST: TimingWindows = { perfect: 0.07, good: 0.14 };

const PERFECT_POINTS = 60;
const GOOD_POINTS = 35;
const SUSTAIN_POINTS_PER_SEC = 40;

export class Scoring {
  score = 0;
  combo = 0;
  maxCombo = 0;
  streakForMult = 0;

  perfect = 0;
  good = 0;
  miss = 0;
  judged = 0; // total notes resolved
  readonly totalNotes: number;

  starPower = 0; // 0..1 meter
  overdriveActive = false;

  // transient flags for the renderer to react to (cleared each frame by engine)
  lastJudgement: Judgement | null = null;
  flashMultiplierBump = false;

  constructor(totalNotes: number) {
    this.totalNotes = totalNotes;
  }

  /** Current score multiplier (1..4), doubled to 8 during overdrive. */
  get multiplier(): number {
    const base = Math.min(4, 1 + Math.floor(this.streakForMult / 10));
    return this.overdriveActive ? base * 2 : base;
  }

  get accuracy(): number {
    if (this.judged === 0) return 1;
    return (this.perfect + this.good * 0.55) / this.judged;
  }

  get canActivateOverdrive(): boolean {
    return !this.overdriveActive && this.starPower >= 0.5;
  }

  registerHit(quality: "perfect" | "good"): number {
    const beforeMult = this.multiplier;
    this.combo++;
    this.streakForMult++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (quality === "perfect") this.perfect++;
    else this.good++;
    this.judged++;

    const gained = (quality === "perfect" ? PERFECT_POINTS : GOOD_POINTS) * this.multiplier;
    this.score += gained;

    // fill star power
    this.starPower = Math.min(1, this.starPower + (quality === "perfect" ? 0.022 : 0.013));

    if (this.multiplier > beforeMult) this.flashMultiplierBump = true;
    this.lastJudgement = quality;
    return gained;
  }

  registerSustainTick(seconds: number): void {
    this.score += SUSTAIN_POINTS_PER_SEC * seconds * this.multiplier;
    this.starPower = Math.min(1, this.starPower + seconds * 0.01);
  }

  registerMiss(): void {
    this.combo = 0;
    this.streakForMult = 0;
    this.miss++;
    this.judged++;
    this.lastJudgement = "miss";
    // a miss drops the boost and empties the meter (so it doesn't instantly re-arm)
    if (this.overdriveActive) {
      this.overdriveActive = false;
      this.starPower = 0;
    }
  }

  /** Strummed with no matching note → break combo, but not a "judged" note. */
  registerOverstrum(): void {
    if (this.combo > 0) {
      this.combo = 0;
      this.streakForMult = 0;
      this.lastJudgement = "overstrum";
    }
  }

  activateOverdrive(): boolean {
    if (!this.canActivateOverdrive) return false;
    this.overdriveActive = true;
    return true;
  }

  update(dt: number): void {
    if (this.overdriveActive) {
      this.starPower -= dt * 0.0625; // half a meter lasts ~8s
      if (this.starPower <= 0) {
        this.starPower = 0;
        this.overdriveActive = false;
      }
    }
  }

  get stars(): number {
    // 0..5 stars from accuracy, GH-style thresholds
    const a = this.accuracy;
    if (a >= 0.98) return 5;
    if (a >= 0.9) return 4;
    if (a >= 0.78) return 3;
    if (a >= 0.6) return 2;
    if (a >= 0.4) return 1;
    return 0;
  }

  get isFullCombo(): boolean {
    return this.miss === 0 && this.judged > 0;
  }
}
