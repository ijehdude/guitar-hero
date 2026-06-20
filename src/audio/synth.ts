/**
 * Web Audio synth — all built-in music AND game SFX are generated here, so the
 * game ships ZERO audio files (no licensing issues) and the music is sample-
 * accurately scheduled against the same clock the gameplay uses.
 *
 * Instruments expose schedule-at-time methods (absolute AudioContext time) used
 * by the song sequencer. SFX expose fire-now methods used by the engine.
 */

export class Synth {
  private ctx: AudioContext;
  private musicBus: GainNode;
  private sfxBus: GainNode;
  private delay: DelayNode;
  private delayFb: GainNode;
  private noise: AudioBuffer;

  constructor(ctx: AudioContext, master: GainNode) {
    this.ctx = ctx;

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.9;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.6;
    this.musicBus.connect(master);
    this.sfxBus.connect(master);

    // A light stereo-ish slap delay for leads (cheap "space" on mobile).
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.26;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.28;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0.5;
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(delayWet);
    delayWet.connect(this.musicBus);

    this.noise = this.makeNoise();
  }

  setMusicVolume(v: number) {
    this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  private makeNoise(): AudioBuffer {
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private env(g: GainNode, t: number, a: number, d: number, s: number, peak = 1) {
    const gn = g.gain;
    gn.cancelScheduledValues(t);
    gn.setValueAtTime(0.0001, t);
    gn.exponentialRampToValueAtTime(Math.max(0.001, peak), t + a);
    gn.exponentialRampToValueAtTime(0.0001, t + a + d + s);
  }

  // ---- Drums --------------------------------------------------------------
  kick(t: number, gain = 1) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.3);
  }

  snare(t: number, gain = 0.8) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(bp).connect(g).connect(this.musicBus);
    n.start(t);
    n.stop(t + 0.2);
  }

  hat(t: number, gain = 0.3, open = false) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    const dur = open ? 0.18 : 0.05;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(hp).connect(g).connect(this.musicBus);
    n.start(t);
    n.stop(t + dur + 0.02);
  }

  // ---- Bass ---------------------------------------------------------------
  bass(t: number, freq: number, dur: number, gain = 0.55) {
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.setValueAtTime(gain, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ---- Lead (the notes you play) -----------------------------------------
  lead(t: number, freq: number, dur: number, gain = 0.32) {
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    o1.type = "square";
    o2.type = "sawtooth";
    o1.frequency.value = freq;
    o2.frequency.value = freq * 1.005; // subtle detune
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(1600, t + Math.min(dur, 0.5));
    const g = this.ctx.createGain();
    const d = Math.max(0.12, dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(this.musicBus);
    g.connect(this.delay); // send to slap delay
    o1.start(t); o2.start(t);
    o1.stop(t + d + 0.05); o2.stop(t + d + 0.05);
  }

  // ---- Pad / chord stabs --------------------------------------------------
  pad(t: number, freqs: number[], dur: number, gain = 0.12) {
    for (const f of freqs) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2600;
      o.connect(lp).connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  // ---- SFX (fire immediately) --------------------------------------------
  private blip(freq: number, dur: number, gain: number, type: OscillatorType = "triangle") {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
    return { o, g, t };
  }

  hit(quality: "perfect" | "good") {
    const base = quality === "perfect" ? 1320 : 880;
    this.blip(base, 0.08, 0.25, "triangle");
    if (quality === "perfect") this.blip(base * 1.5, 0.06, 0.12, "sine");
  }

  miss() {
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(lp).connect(g).connect(this.sfxBus);
    n.start(t);
    n.stop(t + 0.18);
  }

  overdriveActivate() {
    const notes = [440, 554, 659, 880, 1108];
    notes.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + i * 0.05;
      o.type = "sawtooth";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + 0.42);
    });
  }

  uiClick() {
    this.blip(660, 0.04, 0.12, "square");
  }
}
