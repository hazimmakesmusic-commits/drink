// A Session is one hangout: players, settings, memory, and the director loop that makes the
// AI "live in the room" — quiet, then suddenly not.
import { randomBytes } from 'node:crypto';
import { Memory } from './memory.js';
import { Host } from './host.js';
import { EventRun } from './engine.js';
import { getPersona, DEFAULT_PERSONA, VIBES } from './personas.js';
import { nextDelayMs, whisperDelays, chooseLibraryEvent, maybeNovelEvent } from './director.js';
import { byId } from './events/library.js';
import { pick } from './content.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));

export class Session {
  constructor(code, hostAccount, opts = {}) {
    this.code = code;
    this.hostId = hostAccount.id;
    this.createdAt = Date.now();
    this.lastActive = Date.now();
    this.settings = {
      maxPlayers: clamp(opts.maxPlayers ?? 6, 2, 10),
      persona: getPersona(opts.persona).id,
      vibes: (opts.vibes || ['chaos']).filter((v) => VIBES.includes(v)).slice(0, 6),
      intensity: clamp(opts.intensity ?? 3, 1, 5),
      roast: clamp(opts.roast ?? 1, 0, 3),
    };
    if (!this.settings.vibes.length) this.settings.vibes = ['chaos'];
    this.players = new Map(); // id -> {id,name,avatar,sockets:Set,joinedAt,lastSeen}
    this.mem = new Memory();
    this.host = new Host(this);
    this.phase = 'lobby';
    this.run = null;
    this.commentary = null;
    this.ambient = { world: 'alien_planet', hueShift: 0, whisper: null };
    this.fxNonce = 0;
    this.timers = new Set();
    this.nextAt = null;
    this.pendingNovel = null;
    this.flushTimer = null;
    this.hostLostTimer = null;
    this.onEmpty = null;
    this.send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  }

  // ---- players ------------------------------------------------------------------------------------
  addPlayer(acct, ws) {
    let p = this.players.get(acct.id);
    if (!p) {
      if (this.players.size >= this.settings.maxPlayers) throw new Error('This session is full.');
      if (this.phase === 'ended') throw new Error('This session has ended.');
      p = { id: acct.id, name: acct.name, avatar: acct.avatar, sockets: new Set(), joinedAt: Date.now() };
      this.players.set(acct.id, p);
      this.mem.p(acct.id, acct.name);
    }
    p.name = acct.name; p.avatar = acct.avatar;
    p.sockets.add(ws);
    ws.sessionCode = this.code;
    if (acct.id === this.hostId) { clearTimeout(this.hostLostTimer); }
    this.touchActive();
    this.touch(true);
    return p;
  }

  dropSocket(ws) {
    for (const p of this.players.values()) {
      if (p.sockets.delete(ws) && p.sockets.size === 0) {
        p.lastSeen = Date.now();
        if (p.id === this.hostId && this.connectedIds().length) {
          clearTimeout(this.hostLostTimer);
          this.hostLostTimer = setTimeout(() => this.reassignHost(), 45000);
        }
      }
    }
    this.touch(true);
  }

  removePlayer(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    for (const ws of p.sockets) { ws.sessionCode = null; this.send(ws, { t: 'left' }); }
    if (this.phase === 'lobby') this.players.delete(pid);
    else p.sockets.clear();
    if (pid === this.hostId) this.reassignHost();
    this.touch(true);
  }

  reassignHost() {
    if (this.isConnected(this.hostId)) return;
    const next = [...this.players.values()].filter((p) => p.sockets.size).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) { this.hostId = next.id; this.touch(true); }
  }

  isConnected(id) { return (this.players.get(id)?.sockets.size || 0) > 0; }
  connectedIds() { return [...this.players.values()].filter((p) => p.sockets.size).map((p) => p.id); }
  rosterFor(ids) { return ids.map((id) => this.players.get(id)).filter(Boolean).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })); }
  playerNames() { return [...this.players.values()].map((p) => p.name); }

  /** The name the AI uses for a player (aliases from the naming ceremony apply for a few events). */
  nameOf(id, useAlias = true) {
    const p = this.players.get(id);
    if (!p) return 'someone';
    const al = useAlias ? this.mem.alias(id) : null;
    return al || p.name;
  }

  memoryFacts() {
    const q = this.mem.quietest();
    const c = this.mem.mostChosen();
    return { eventCount: this.mem.eventCount, quietest: q?.name, mostChosen: c?.name };
  }

  pickSubject(bias, ids) {
    const act = ids.length ? ids : this.connectedIds();
    if (bias === 'mostChosen' || bias === 'council') {
      const m = this.mem.mostChosen();
      if (m && act.includes(m.pid)) return m.pid;
    }
    if (bias === 'quiet') {
      const q = this.mem.quietest();
      if (q && act.includes(q.pid)) return q.pid;
    }
    return pick(act);
  }

  // ---- settings ---------------------------------------------------------------------------------------
  updateSettings(pid, patch) {
    if (pid !== this.hostId) return;
    const s = this.settings;
    if (patch.intensity != null) s.intensity = clamp(patch.intensity, 1, 5);
    if (patch.roast != null) s.roast = clamp(patch.roast, 0, 3);
    if (Array.isArray(patch.vibes)) { const v = patch.vibes.filter((x) => VIBES.includes(x)).slice(0, 6); if (v.length) s.vibes = v; }
    if (patch.persona) s.persona = getPersona(patch.persona).id;
    if (patch.maxPlayers != null && this.phase === 'lobby') s.maxPlayers = clamp(patch.maxPlayers, Math.max(2, this.players.size), 10);
    // changing intensity mid-quiet re-rolls the next interruption
    if (patch.intensity != null && this.phase === 'ambient') this.scheduleNext();
    this.touch(true);
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------
  async start(pid) {
    if (pid !== this.hostId || this.phase !== 'lobby') return;
    if (this.connectedIds().length < 2) throw new Error('Need at least 2 players here.');
    this.phase = 'intro';
    const introLines = this.host.intro();
    const ev = {
      id: 'intro', title: 'INTRO', world: 'eye', vibes: [], intensity: [1, 5], noPreface: true,
      steps: introLines.map((text, i) => ({ t: 'say', id: `i${i}`, text, ms: i === 0 ? 3600 : i === 1 ? 2200 : 2800, fx: i === 0 ? 'calm' : undefined })),
    };
    this.run = new EventRun(this, ev);
    this.touch(true);
    await this.run.run();
    this.run = null;
    if (this.phase === 'ended') return;
    this.enterAmbient({ first: true });
  }

  enterAmbient({ first = false } = {}) {
    if (this.phase === 'ended') return;
    this.phase = 'ambient';
    this.run = null;
    this.commentary = null;
    this.ambient.hueShift = (this.ambient.hueShift + 40 + Math.random() * 90) % 360;
    this.ambient.world = this.mem.eventCount > 0 && Math.random() < 0.35 ? pick(['nebula', 'alien_planet', 'dream']) : 'alien_planet';
    this.ambient.whisper = null;
    this.scheduleNext({ first });
    this.touch(true);
  }

  scheduleNext({ first = false } = {}) {
    this.clearTimers();
    const gap = nextDelayMs(this, { first });
    this.nextAt = Date.now() + gap;
    this.later(gap, () => this.fireEvent());
    for (const d of whisperDelays(gap, this.settings.intensity)) {
      this.later(d, () => {
        if (this.phase !== 'ambient') return;
        this.ambient.whisper = { text: this.host.whisper(), id: randomBytes(3).toString('hex') };
        this.touch(true);
        this.later(7000, () => { if (this.ambient.whisper) { this.ambient.whisper = null; this.touch(true); } });
      });
    }
    // start composing an AI-authored event early, so it's ready when the gap ends
    this.pendingNovel = gap > 20000 ? maybeNovelEvent(this).catch(() => null) : null;
  }

  later(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }

  summon(pid, eventId) {
    if (pid !== this.hostId || this.phase !== 'ambient') return;
    // DEV_TOOLS lets the host (or tests) force a specific library event.
    this.forced = process.env.DEV_TOOLS === '1' && eventId ? byId[eventId] || null : null;
    this.clearTimers();
    this.fireEvent();
  }

  skip(pid) {
    if (pid !== this.hostId) return;
    this.run?.abort();
  }

  async fireEvent() {
    if (this.phase !== 'ambient' || this.firing) return;
    this.firing = true;
    this.clearTimers();
    if (this.connectedIds().length < 2) { this.firing = false; this.scheduleNext(); this.touch(true); return; }
    let ev = null;
    try { ev = (await Promise.race([this.pendingNovel ?? null, new Promise((r) => setTimeout(() => r(null), 600))])) || null; } catch { /* ignore */ }
    this.pendingNovel = null;
    if (this.forced) { ev = this.forced; this.forced = null; }
    if (!ev) ev = chooseLibraryEvent(this);
    this.phase = 'event';
    this.firing = false;
    this.ambient.whisper = null;
    const run = this.run = new EventRun(this, ev);
    this.touch(true);
    let summary;
    try { summary = await run.run(); } catch (e) { console.error('[session] event crashed', e); }
    this.run = null;
    if (this.phase === 'ended') return;
    if (summary) await this.finishEvent(ev, summary);
    this.enterAmbient();
  }

  async finishEvent(ev, summary) {
    const mem = this.mem;
    if (ev.requires === 'council') { const m = mem.mostChosen(); if (m) mem.done.add(`council:${m.pid}:${m.count}`); }
    if (ev.requires === 'prophecy_audit') {
      const p = mem.prophecies.find((x) => !x.audited);
      if (p) p.audited = true;
    }
    if (summary.joke) mem.addJoke(summary.joke);
    mem.events.push({ id: ev.id, title: ev.title, mechanics: summary.mechanics, summary: summary.bullets.slice(-1)[0], def: ev });
    this.phase = 'commentary';
    this.commentary = { lines: ['…'], endsAt: Date.now() + 3000, world: ev.world, id: randomBytes(3).toString('hex') };
    this.touch(true);
    const lines = await this.host.commentary(summary);
    lines.push(this.host.outro());
    const dur = Math.max(300, (2400 + lines.length * 2600) * (Number(process.env.TIME_SCALE) || 1));
    this.commentary = { lines, endsAt: Date.now() + dur, world: ev.world, id: randomBytes(3).toString('hex'), startedAt: Date.now() };
    this.touch(true);
    await new Promise((r) => this.later(dur, r));
  }

  end(pid) {
    if (pid !== this.hostId) return;
    this.phase = 'ended';
    this.run?.abort();
    this.clearTimers();
    this.touch(true);
    this.later(10 * 60 * 1000, () => this.onEmpty?.(this));
  }

  destroy() {
    this.phase = 'ended';
    this.run?.abort();
    this.clearTimers();
    clearTimeout(this.flushTimer);
    clearTimeout(this.hostLostTimer);
  }

  touchActive() { this.lastActive = Date.now(); }

  // ---- input routing ---------------------------------------------------------------------------------
  input(pid, msg) {
    this.touchActive();
    this.run?.input(pid, msg);
  }

  // ---- state broadcast --------------------------------------------------------------------------------
  touch(immediate = false) {
    if (immediate) { clearTimeout(this.flushTimer); this.flushTimer = null; this.flush(); return; }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 120);
  }

  flush() {
    const stage = this.run?.stageView() || null;
    for (const p of this.players.values()) {
      if (!p.sockets.size) continue;
      const msg = this.stateFor(p.id, stage);
      for (const ws of p.sockets) this.send(ws, msg);
    }
  }

  stateFor(pid, stage = this.run?.stageView() || null) {
    return {
      t: 'state',
      code: this.code,
      phase: this.phase,
      serverNow: Date.now(),
      settings: this.settings,
      hostId: this.hostId,
      persona: (({ id, name, glyph, hue }) => ({ id, name, glyph, hue }))(getPersona(this.settings.persona)),
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, connected: p.sockets.size > 0 })),
      me: { id: pid, isHost: pid === this.hostId },
      ambient: this.ambient,
      stage,
      view: this.run?.privateView(pid) || null,
      commentary: this.phase === 'commentary' ? this.commentary : null,
      eventCount: this.mem.eventCount,
    };
  }
}

export class SessionManager {
  constructor() {
    this.sessions = new Map();
    setInterval(() => this.gc(), 60 * 1000).unref();
  }

  newCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let i = 0; i < 50; i++) {
      const c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
      if (!this.sessions.has(c)) return c;
    }
    throw new Error('Could not allocate a code');
  }

  create(acct, opts) {
    const s = new Session(this.newCode(), acct, opts);
    s.onEmpty = (x) => this.remove(x);
    this.sessions.set(s.code, s);
    return s;
  }

  get(code) { return this.sessions.get(String(code || '').toUpperCase().trim()); }
  remove(s) { s.destroy(); this.sessions.delete(s.code); }

  gc() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      const idle = now - s.lastActive;
      if (idle > 4 * 3600 * 1000 || (s.phase === 'lobby' && idle > 30 * 60 * 1000)) this.remove(s);
    }
  }
}
