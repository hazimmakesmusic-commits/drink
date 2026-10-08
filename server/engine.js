// EventRun: executes one event (a list of primitive steps) against a session.
// The server is the source of truth; clients render whatever stage/private view they are sent.
import { PRIMS, rank } from './primitives.js';
import { fill } from './host.js';
import { shuffle } from './content.js';

const SLOT_RE = /\{\{([a-z_0-9]+)\}\}/g;
// Slots whose content depends on earlier results can't be prefetched at event start.
const DEPENDENT = new Set(['conclusion', 'mistranslation', 'word_prophecy', 'field_report']);
const withTimeout = (p, ms, fb) => Promise.race([p, new Promise((r) => setTimeout(() => r(fb), ms))]);

export class EventRun {
  constructor(session, ev, { subjectId } = {}) {
    this.session = session;
    this.ev = ev;
    this.activeIds = session.connectedIds();
    this.results = {};
    this.lastResult = null;
    this.lastLeaderId = null;
    this.vars = {};
    this.slots = new Map();
    this.cur = null;
    this.index = -1;
    this.aborted = false;
    this.scale = Number(process.env.TIME_SCALE) || 1; // dev/test only: shrink step durations
    this.bullets = [];
    this.timers = new Set();
    this.fxId = 0;
    this.subjectId = subjectId || session.pickSubject(ev.subject || ev.requires, this.activeIds);
    this.steps = [...this.preface(), ...ev.steps];
    this.setupVars();
  }

  preface() {
    if (this.ev.noPreface) return [];
    const out = [{ t: 'say', id: 'stinger', text: this.session.host.stinger(), ms: 2600, fx: 'alert', world: this.ev.world }];
    if (this.ev.intro) out.push({ t: 'say', id: 'intro', text: this.ev.intro, ms: 3600, world: this.ev.world });
    return out;
  }

  setupVars() {
    const s = this.session;
    this.vars.subject = s.nameOf(this.subjectId);
    shuffle(this.activeIds).forEach((id, i) => { this.vars[`p${i + 1}`] = s.nameOf(id); });
    this.vars.n = String(this.activeIds.length);
    this.vars.event = this.ev.title;
  }

  // ---- text rendering ---------------------------------------------------------------------------
  slot(name, { key = name, vars = {} } = {}) {
    if (!this.slots.has(key)) {
      const base = name.replace(/_\d+$/, '');
      const p = this.session.host.gen(base, { vars: { ...this.vars, ...vars }, event: this.ev.title });
      this.slots.set(key, withTimeout(p, 4200, null).then((v) => v ?? this.session.host.gen(base, { vars: { ...this.vars, ...vars }, fallbackOnly: true })));
    }
    return this.slots.get(key);
  }

  async render(tpl, extra = {}) {
    if (tpl == null) return '';
    const names = [...String(tpl).matchAll(SLOT_RE)].map((m) => m[1]);
    const got = {};
    await Promise.all([...new Set(names)].map(async (n) => { got[n] = await this.slot(n); }));
    return fill(String(tpl).replace(SLOT_RE, (_, n) => got[n]), { ...this.vars, ...extra });
  }

  prefetch() {
    const found = new Set();
    for (const st of this.steps) for (const v of Object.values(st)) {
      const arr = Array.isArray(v) ? v : [v];
      for (const x of arr) if (typeof x === 'string') for (const m of x.matchAll(SLOT_RE)) if (!DEPENDENT.has(m[1])) found.add(m[1]);
    }
    for (const n of found) this.slot(n);
  }

  // ---- targets ------------------------------------------------------------------------------------
  targetsFor(who = 'all') {
    const act = this.activeIds.filter((id) => this.session.isConnected(id));
    if (who === 'subject') return act.filter((id) => id === this.subjectId);
    if (who === 'others') return act.filter((id) => id !== this.subjectId);
    if (who === 'leader') return act.filter((id) => id === (this.lastLeaderId || this.subjectId));
    return act;
  }

  // ---- lifecycle ------------------------------------------------------------------------------------
  after(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); if (!this.aborted) fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  abort() {
    this.aborted = true;
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    this.timers.clear();
    this.cur?.finish?.();
  }

  async run() {
    this.prefetch();
    for (let i = 0; i < this.steps.length && !this.aborted; i++) {
      const def = this.steps[i];
      if (def.when) { const [k, v] = def.when.split('='); if (String(this.vars[k]) !== v) continue; }
      this.index = i;
      const prim = PRIMS[def.t];
      const cur = this.cur = {
        def, prim, key: `${this.ev.id}:${i}:${Date.now() % 100000}`, i, state: {}, priv: {}, pub: {},
        responded: new Set(), targets: this.targetsFor(def.who), startedAt: 0, endsAt: 0,
        world: def.world || this.ev.world, line: null, fx: null,
      };
      let duration;
      try {
        duration = await prim.begin(this, cur);
      } catch (e) {
        console.error('[engine] begin failed', def.t, e);
        continue;
      }
      if (this.aborted) break;
      if (this.scale !== 1) duration = Math.max(400, duration * this.scale);
      cur.startedAt = Date.now();
      cur.endsAt = cur.startedAt + duration;
      if (def.fx) this.fx(def.fx);
      this.session.touch(true);

      await new Promise((resolve) => {
        let done = false;
        const handles = [];
        cur.finish = () => { if (done) return; done = true; handles.forEach((h) => { clearTimeout(h); clearInterval(h); }); resolve(); };
        handles.push(setTimeout(cur.finish, duration));
        const taunts = def.taunts || [];
        taunts.forEach((text, k) => handles.push(setTimeout(async () => { cur.line = await this.render(text); this.session.touch(); }, ((k + 1) / (taunts.length + 1)) * duration * 0.85)));
        if (cur.tickMs && prim.tick) {
          let last = Date.now();
          handles.push(setInterval(() => {
            const t = Date.now();
            if (prim.tick(this, cur, t - last)) this.session.touch();
            last = t;
            if (prim.isDone?.(this, cur)) cur.finish();
          }, cur.tickMs));
        }
        // sets of timers so abort() can clear them
        this.timers.add(handles[0]);
      });
      if (this.aborted) break;
      let result = {};
      try { result = prim.end(this, cur) || {}; } catch (e) { console.error('[engine] end failed', def.t, e); }
      this.record(def, cur, result);
      cur.finish = null;
    }
    this.cur = null;
    return this.summary();
  }

  fx(kind) {
    this.fxId++;
    if (this.cur) this.cur.fx = { kind, id: `${this.ev.id}:${this.fxId}` };
  }

  // ---- results & memory -------------------------------------------------------------------------------
  record(def, cur, r) {
    const mem = this.session.mem;
    const s = this.session;
    this.results[def.id] = r;
    if (def.t !== 'say' && def.t !== 'reveal' && def.t !== 'verdict') this.lastResult = r;
    mem.noteMechanic(def.t);

    const nm = (id) => (id ? s.nameOf(id) : '');
    if (r.leaderId !== undefined) {
      this.vars.leader = nm(r.leaderId) || this.vars.subject;
      this.vars[`${def.id}.leader`] = this.vars.leader;
      this.lastLeaderId = r.leaderId || this.lastLeaderId;
    }
    if (r.lastId !== undefined) {
      this.vars.last = nm(r.lastId) || this.vars.p1;
      this.vars[`${def.id}.last`] = this.vars.last;
    }
    if (r.tripperId !== undefined) this.vars.tripper = nm(r.tripperId) || 'nobody';
    if (r.top !== undefined) { this.vars.top = r.top; this.vars[`${def.id}.top`] = r.top; }
    if (r.least !== undefined) { this.vars.least = r.least; this.vars[`${def.id}.least`] = r.least; }
    if (r.tripperId !== undefined) this.vars.tripped = r.tripperId ? 'yes' : 'no';
    if (r.words) this.vars.words = r.words;
    if (r.lastText !== undefined) { this.vars.last_text = r.lastText; this.vars[`${def.id}.text`] = r.lastText; this.vars.last_text_author = nm(r.lastAuthorId) || 'someone'; this.lastTexts = r.texts; }
    if (r.kind === 'point' && r.leaderId && this.lastTexts?.[r.leaderId]) this.vars.leader_text = this.lastTexts[r.leaderId];
    if (r.success !== undefined) this.vars.success = r.success ? 'yes' : 'no';
    if (r.text) this.vars[`${def.id}.text`] = r.text;

    if (cur.targets.length && !['say', 'reveal', 'verdict'].includes(def.t)) {
      for (const id of cur.targets) mem.noteParticipation(id, cur.responded.has(id) || (def.t === 'tap' && (cur.state.counts?.[id] || 0) > 0) || (def.t === 'shake' && (cur.state.counts?.[id] || 0) > 0) || (def.t === 'hold' && cur.state.everDown?.has(id)) || def.t === 'sync' || def.t === 'trap');
    }
    if (r.kind === 'point' && r.track && r.leaderId) mem.noteChosen(r.leaderId);
    else if (['tap', 'hold', 'shake'].includes(r.kind)) {
      if (r.leaderId) mem.noteWin(r.leaderId);
      if (r.lastId) mem.noteLoss(r.lastId);
    } else if (r.kind === 'trap' && r.lastId) mem.noteLoss(r.lastId);
    if (r.blurb) this.bullets.push(r.blurb);
  }

  summary() {
    const s = this.session;
    const last = this.lastResult || {};
    return {
      title: this.ev.title,
      id: this.ev.id,
      bullets: this.bullets.slice(-4),
      leader: this.vars.leader && this.vars.leader !== this.vars.subject ? this.vars.leader : last.leaderId ? s.nameOf(last.leaderId) : null,
      last: last.lastId ? s.nameOf(last.lastId) : null,
      subject: this.vars.subject,
      mechanics: [...new Set(this.ev.steps.map((x) => x.t))],
      joke: this.ev.joke ? fill(this.ev.joke, this.vars) : null,
      vars: this.vars,
    };
  }

  // ---- views ------------------------------------------------------------------------------------------
  stageView() {
    const c = this.cur;
    if (!c) return null;
    const live = c.prim.live?.(this, c);
    return {
      key: c.key, type: c.def.t, title: this.ev.title, step: c.i + 1, steps: this.steps.length,
      world: c.worldOverride || c.world, fx: c.fx, startedAt: c.startedAt, endsAt: c.endsAt, line: c.line,
      targets: c.targets, responded: [...c.responded], live,
      ...c.pub,
    };
  }

  privateView(pid) {
    const c = this.cur;
    if (!c) return null;
    if (['say', 'reveal', 'verdict'].includes(c.def.t)) return null;
    if (!c.targets.includes(pid)) return { kind: 'wait', key: c.key };
    const v = c.priv[pid];
    if (!v) return { kind: 'wait', key: c.key };
    return { ...v, key: c.key, done: c.responded.has(pid) };
  }

  input(pid, msg) {
    const c = this.cur;
    if (!c || msg.key !== c.key || !c.prim.input) return;
    const res = c.prim.input(this, c, pid, msg);
    if (!res) return;
    if (res.endIn) this.after(res.endIn, () => c.finish?.());
    if (c.prim.isDone?.(this, c)) c.finish?.();
    this.session.touch(false);
  }
}
