// Tiny synthesized stingers (no audio files). Muted state is remembered per device.
import { store } from './ui.js';

let ctx = null;
let muted = store.get('muted', false);
export const isMuted = () => muted;
export const setMuted = (m) => { muted = m; store.set('muted', m); };

export function unlock() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no audio */ }
}

function tone({ type = 'sine', f0, f1, dur = 0.4, gain = 0.12, at = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise({ dur = 0.3, gain = 0.1, at = 0, freq = 1200 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = gain;
  s.connect(f).connect(g).connect(ctx.destination);
  s.start(t);
}

export const sfx = {
  alert() { tone({ type: 'sawtooth', f0: 880, f1: 110, dur: 0.7, gain: 0.09 }); tone({ type: 'square', f0: 220, f1: 55, dur: 0.9, gain: 0.05, at: 0.05 }); },
  glitch() { for (let i = 0; i < 5; i++) noise({ dur: 0.07, gain: 0.12, at: i * 0.06, freq: 600 + Math.random() * 3000 }); },
  explode() { tone({ type: 'sine', f0: 140, f1: 28, dur: 1.1, gain: 0.3 }); noise({ dur: 0.9, gain: 0.22, freq: 300 }); },
  calm() { [261.6, 329.6, 392].forEach((f, i) => tone({ f0: f, dur: 1.6, gain: 0.05, at: i * 0.12 })); },
  scan() { tone({ type: 'triangle', f0: 200, f1: 1200, dur: 1.2, gain: 0.05 }); },
  blip() { tone({ type: 'triangle', f0: 520, f1: 780, dur: 0.09, gain: 0.07 }); },
  lock() { tone({ type: 'square', f0: 330, f1: 660, dur: 0.12, gain: 0.05 }); },
  whisper() { noise({ dur: 0.6, gain: 0.025, freq: 2500 }); },
};
