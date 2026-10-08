// The director decides WHEN the AI interrupts and WHAT happens. The goal is an unpredictable
// rhythm, not a conveyor belt: long silences, sudden bursts, mechanic variety, memory callbacks.
import { LIBRARY, byId } from './events/library.js';
import { isOriginal } from './originality.js';
import { pick } from './content.js';

const GAP = { 1: [150, 420], 2: [100, 300], 3: [70, 220], 4: [45, 150], 5: [30, 100] }; // seconds between events
const rand = (a, b) => a + Math.random() * (b - a);
const PACE = () => (process.env.PACE === 'fast' ? 0.08 : 1);

/** Milliseconds of quiet before the next interruption. */
export function nextDelayMs(session, { first = false } = {}) {
  const k = PACE();
  if (first) return Math.max(5000, rand(35, 70) * 1000 * k);
  const [lo, hi] = GAP[session.settings.intensity] || GAP[3];
  const roll = Math.random();
  let s;
  if (roll < 0.16) s = rand(12, 35); // sudden burst
  else if (roll > 0.88) s = rand(hi, hi * 2); // long, suspicious silence
  else s = rand(lo, hi);
  return Math.max(4000, s * 1000 * k);
}

/** Whisper (tiny ambient remark) timing: only when the quiet is long enough to matter. */
export function whisperDelays(gapMs, intensity) {
  const out = [];
  if (gapMs < 50000 * PACE() && PACE() === 1) return out;
  const n = Math.random() < 0.35 + intensity * 0.1 ? 1 + (gapMs > 150000 ? 1 : 0) : 0;
  for (let i = 0; i < n; i++) out.push(gapMs * rand(0.25, 0.8));
  return out;
}

function requirementMet(session, ev) {
  const m = session.mem;
  if (ev.requires === 'council') {
    const top = m.mostChosen();
    return !!top && top.count >= 3 && !m.done.has(`council:${top.pid}:${top.count}`) && session.isConnected(top.pid);
  }
  if (ev.requires === 'prophecy_audit') {
    return m.prophecies.some((p) => !p.audited && m.eventCount - p.atEvent >= 3);
  }
  return true;
}

export function eligible(session) {
  const { settings, mem } = session;
  const n = session.connectedIds().length;
  const recent = mem.events.map((e) => e.id);
  return LIBRARY.filter((ev) => {
    if (n < ev.minPlayers || n > ev.maxPlayers) return false;
    if (ev.requires && !requirementMet(session, ev)) return false;
    const idx = recent.lastIndexOf(ev.id);
    if (idx !== -1 && recent.length - idx <= ev.cooldown) return false;
    return true;
  });
}

function weight(session, ev) {
  const { settings, mem } = session;
  let w = ev.weight;
  const overlap = ev.vibes.filter((v) => settings.vibes.includes(v)).length;
  w *= settings.vibes.length ? (overlap ? 1 + overlap * 0.8 : 0.4) : 1;
  const [lo, hi] = ev.intensity;
  const i = settings.intensity;
  w *= i >= lo && i <= hi ? 1 : 0.15;
  if (!mem.events.some((e) => e.id === ev.id)) w *= 1.7; // fresh content first
  // avoid the same interaction primitives back-to-back
  const prev = mem.events.slice(-2).flatMap((e) => e.mechanics || []);
  const mine = new Set(ev.steps.map((s) => s.t).filter((t) => !['say', 'reveal', 'verdict'].includes(t)));
  for (const t of mine) if (prev.includes(t)) w *= 0.55;
  if (ev.requires) w *= 10; // callbacks to session memory should land soon after they become possible
  return Math.max(0.01, w);
}

export function chooseLibraryEvent(session) {
  const pool = eligible(session);
  if (!pool.length) return pick(LIBRARY.filter((e) => !e.requires));
  const weights = pool.map((e) => weight(session, e));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

/** Kick off (maybe) an AI-authored event. Resolves to an event or null. */
export async function maybeNovelEvent(session) {
  if (session.mem.eventCount < 2 || Math.random() > 0.3) return null;
  const recent = session.mem.events.map((e) => e.def).filter(Boolean);
  const ev = await session.host.novelEvent(recent.length ? recent : LIBRARY.slice(0, 3));
  if (!ev) return null;
  return isOriginal(ev, LIBRARY).ok ? ev : null;
}

export { byId };
