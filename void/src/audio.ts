// Procedural ambient soundscape built live with the Web Audio API.
// No audio files, so no licences to worry about and nothing to download.
// Browsers only allow sound after a user gesture, so nothing starts until first touch.

interface Mode {
  root: number; // Hz of the drone root
  ratios: number[]; // drone partials
  scale: number[]; // semitone steps for chime notes
  cutoff: number;
  chimeEvery: [number, number];
  bright: number;
}

const MODES: Mode[] = [
  // Liquid Dream: warm, lydian shimmer
  { root: 55, ratios: [1, 1.5, 2, 3.0, 4.5], scale: [0, 2, 4, 6, 7, 9, 11], cutoff: 900, chimeEvery: [3.5, 8], bright: 0.5 },
  // Cosmic Jelly: higher, glassy, pentatonic bells
  { root: 65.4, ratios: [1, 2, 3, 4.5, 6], scale: [0, 2, 4, 7, 9], cutoff: 1500, chimeEvery: [2.2, 5.5], bright: 0.9 },
  // Melting Dimension: low, uneasy, detuned
  { root: 49, ratios: [1, 1.414, 2.02, 2.97, 3.5], scale: [0, 1, 5, 6, 10], cutoff: 520, chimeEvery: [5, 11], bright: 0.25 },
];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wet!: GainNode;
  private dryBus!: GainNode;
  private filter!: BiquadFilterNode;
  private droneOsc: OscillatorNode[] = [];
  private droneGain: GainNode[] = [];
  private padGain!: GainNode;
  private padOsc: OscillatorNode[] = [];
  private noiseGain!: GainNode;
  private holdOsc: OscillatorNode | null = null;
  private holdGain: GainNode | null = null;
  private mode = 0;
  private enabled = false;
  private volume = 0.6;
  private nextChime = 0;
  private timer: number | null = null;
  available = typeof window !== 'undefined' && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);

  get on() { return this.enabled; }

  /** Must be called from a user gesture the first time. */
  async enable() {
    if (!this.available) return false;
    if (!this.ctx) this.build();
    try { await this.ctx!.resume(); } catch { return false; }
    this.enabled = true;
    this.applyVolume(1.2);
    this.startScheduler();
    return true;
  }

  disable() {
    this.enabled = false;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    window.setTimeout(() => { if (!this.enabled) this.ctx?.suspend(); }, 900);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.enabled) this.applyVolume(0.15);
  }

  private applyVolume(tc: number) {
    if (!this.ctx) return;
    // perceptual curve, capped so nothing ever gets loud
    this.master.gain.setTargetAtTime(Math.pow(this.volume, 1.7) * 0.5, this.ctx.currentTime, tc);
  }

  /** Suspend when the tab is hidden, resume when it returns. */
  pause() { if (this.ctx && this.enabled) this.ctx.suspend(); }
  resume() { if (this.ctx && this.enabled) this.ctx.resume(); }

  private build() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.4;
    this.master.connect(comp).connect(ctx.destination);

    // synthetic reverb tail
    const len = Math.floor(ctx.sampleRate * 3.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.7;
    this.dryBus = ctx.createGain();
    this.dryBus.gain.value = 0.8;
    this.wet.connect(conv).connect(this.master);
    this.dryBus.connect(this.master);

    // drone through a slowly breathing low-pass
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = MODES[0].cutoff;
    this.filter.Q.value = 0.7;
    this.filter.connect(this.dryBus);
    this.filter.connect(this.wet);
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.045; lfoG.gain.value = 260;
    lfo.connect(lfoG).connect(this.filter.frequency);
    lfo.start();

    const m = MODES[0];
    for (let i = 0; i < 5; i++) {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sine' : 'triangle';
      o.frequency.value = m.root * m.ratios[i];
      o.detune.value = (i - 2) * 4;
      const g = ctx.createGain();
      g.gain.value = [0.16, 0.1, 0.07, 0.035, 0.02][i];
      o.connect(g).connect(this.filter);
      o.start();
      // each partial drifts a few cents, slowly, forever
      const l = ctx.createOscillator(); const lg = ctx.createGain();
      l.frequency.value = 0.03 + i * 0.011; lg.gain.value = 5 + i * 2;
      l.connect(lg).connect(o.detune); l.start();
      this.droneOsc.push(o); this.droneGain.push(g);
    }

    // airy pad: detuned saws through a narrow band-pass, tremolo'd very slowly
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 880; bp.Q.value = 1.2;
    this.padGain.connect(bp); bp.connect(this.wet); bp.connect(this.dryBus);
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = m.root * 8 * (1 + i * 0.5);
      o.detune.value = (i - 1) * 9;
      const g = ctx.createGain(); g.gain.value = 0.02;
      o.connect(g).connect(this.padGain); o.start();
      this.padOsc.push(o);
    }
    const trem = ctx.createOscillator(); const tg = ctx.createGain();
    trem.frequency.value = 0.08; tg.gain.value = 0.012;
    trem.connect(tg).connect(this.padGain.gain); trem.start();
    this.padGain.gain.value = 0.03;

    // soft noise bed (wind in the void)
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; nd[i] = last * 3.5; }
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0.06;
    ns.connect(this.noiseGain).connect(this.wet); ns.start();
  }

  setWorld(i: number) {
    this.mode = i;
    if (!this.ctx) return;
    const m = MODES[i], t = this.ctx.currentTime;
    this.droneOsc.forEach((o, k) => o.frequency.setTargetAtTime(m.root * m.ratios[k], t, 1.2));
    this.filter.frequency.setTargetAtTime(m.cutoff, t, 1.0);
    this.padOsc.forEach((o, k) => o.frequency.setTargetAtTime(m.root * 8 * (1 + k * 0.5), t, 1.5));
    this.padGain.gain.setTargetAtTime(0.02 + m.bright * 0.03, t, 1.5);
    this.noiseGain.gain.setTargetAtTime(i === 2 ? 0.1 : 0.05, t, 1.5);
  }

  private startScheduler() {
    if (this.timer) return;
    this.timer = window.setInterval(() => {
      if (!this.ctx || !this.enabled) return;
      const now = this.ctx.currentTime;
      if (now >= this.nextChime) {
        const m = MODES[this.mode];
        const [a, b] = m.chimeEvery;
        this.nextChime = now + a + Math.random() * (b - a);
        const step = m.scale[(Math.random() * m.scale.length) | 0];
        const oct = 4 + ((Math.random() * 2) | 0);
        this.chime(m.root * Math.pow(2, oct - 1) * Math.pow(2, step / 12), 0.05 + 0.04 * m.bright, 3 + Math.random() * 2);
      }
    }, 250);
  }

  /** Soft FM bell. Attack is never abrupt. */
  private chime(freq: number, vol: number, dur: number, dest?: AudioNode) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const car = ctx.createOscillator(), mod = ctx.createOscillator();
    const mg = ctx.createGain(), g = ctx.createGain();
    car.type = 'sine'; mod.type = 'sine';
    car.frequency.value = freq; mod.frequency.value = freq * 2.003;
    mg.gain.setValueAtTime(freq * 0.9, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.02, t + dur * 0.6);
    mod.connect(mg).connect(car.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g);
    g.connect(dest ?? this.wet);
    if (!dest) g.connect(this.dryBus);
    car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
  }

  private ok() { return !!this.ctx && this.enabled; }

  tap(x: number) {
    if (!this.ok()) return;
    const m = MODES[this.mode];
    const idx = Math.min(m.scale.length - 1, Math.max(0, Math.floor((x * 0.5 + 0.5) * m.scale.length)));
    this.chime(m.root * 8 * Math.pow(2, m.scale[idx] / 12), 0.1, 2.4);
  }

  double() {
    if (!this.ok()) return;
    const m = MODES[this.mode];
    const ctx = this.ctx!;
    [0, 2, 4].forEach((n, i) => {
      window.setTimeout(() => this.ok() && this.chime(m.root * 8 * Math.pow(2, m.scale[Math.min(m.scale.length - 1, n)] / 12), 0.07, 2.8), i * 110);
    });
    // a low swell
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(m.root * 2, t); o.frequency.exponentialRampToValueAtTime(m.root * 4, t + 1.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.13, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g); g.connect(this.wet); g.connect(this.dryBus); o.start(t); o.stop(t + 2);
  }

  holdStart() {
    if (!this.ok() || this.holdOsc) return;
    const ctx = this.ctx!, m = MODES[this.mode];
    this.holdOsc = ctx.createOscillator();
    this.holdGain = ctx.createGain();
    this.holdOsc.type = 'sine';
    this.holdOsc.frequency.value = m.root * 4;
    this.holdGain.gain.value = 0.0001;
    this.holdOsc.connect(this.holdGain);
    this.holdGain.connect(this.wet); this.holdGain.connect(this.dryBus);
    this.holdOsc.start();
  }

  holdUpdate(e: number) {
    if (!this.ok() || !this.holdOsc || !this.holdGain) return;
    const m = MODES[this.mode], t = this.ctx!.currentTime;
    this.holdOsc.frequency.setTargetAtTime(m.root * 4 * (1 + e * 2.5), t, 0.1);
    this.holdGain.gain.setTargetAtTime(0.02 + e * 0.1, t, 0.12);
  }

  holdEnd(e: number) {
    if (this.holdOsc && this.holdGain && this.ctx) {
      const t = this.ctx.currentTime;
      this.holdGain.gain.cancelScheduledValues(t);
      this.holdGain.gain.setTargetAtTime(0.0001, t, 0.08);
      this.holdOsc.stop(t + 0.5);
      this.holdOsc = null; this.holdGain = null;
    }
    if (!this.ok() || e < 0.05) return;
    const m = MODES[this.mode];
    const n = 2 + Math.round(e * 3);
    for (let i = 0; i < n; i++) {
      window.setTimeout(() => this.ok() && this.chime(m.root * 8 * Math.pow(2, m.scale[i % m.scale.length] / 12), 0.05 + e * 0.05, 3), i * 70);
    }
    // soft thump
    const ctx = this.ctx!, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(m.root * 2.2, t); o.frequency.exponentialRampToValueAtTime(m.root * 0.8, t + 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12 + e * 0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g); g.connect(this.dryBus); g.connect(this.wet); o.start(t); o.stop(t + 1);
  }

  portal() {
    if (!this.ok()) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; f.type = 'lowpass';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.7); o.frequency.exponentialRampToValueAtTime(90, t + 1.6);
    f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(2200, t + 0.7); f.frequency.exponentialRampToValueAtTime(240, t + 1.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(f).connect(g); g.connect(this.wet); g.connect(this.dryBus);
    o.start(t); o.stop(t + 2);
  }

  /** Jelly pulse: a soft glassy pluck. */
  pulse(strength = 1) {
    if (!this.ok()) return;
    const m = MODES[this.mode];
    this.chime(m.root * 4 * Math.pow(2, m.scale[(Math.random() * m.scale.length) | 0] / 12), 0.03 * strength, 2.2);
  }
}
