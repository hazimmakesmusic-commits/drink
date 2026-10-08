// Interaction primitives. An event is a sequence of these; each one knows how to
//   begin()   -> build public/private views, return duration in ms
//   input()   -> handle a player's input, return true if state changed
//   isDone()  -> optional early finish
//   end()     -> compute a result ({scores, leaderId, lastId, blurb, ...})
// New experiences = new combinations, not new code.
import { POOLS, SECRET_MISSIONS, pick, shuffle } from './content.js';
import { cleanUserText } from './safety.js';

const now = () => Date.now();

/** Rank players by score. Higher is better. Ties broken randomly (flagged). */
export function rank(scores, ids) {
  const list = ids.map((id) => ({ id, v: scores[id] ?? -Infinity }));
  if (!list.length) return { leaderId: null, lastId: null, tie: false };
  const max = Math.max(...list.map((x) => x.v));
  const min = Math.min(...list.map((x) => x.v));
  const tops = list.filter((x) => x.v === max);
  const bottoms = list.filter((x) => x.v === min);
  return {
    leaderId: max === -Infinity ? null : pick(tops).id,
    lastId: min === max ? null : pick(bottoms).id,
    tie: tops.length > 1,
  };
}

const derange = (ids) => {
  if (ids.length < 2) return Object.fromEntries(ids.map((i) => [i, i]));
  for (let t = 0; t < 50; t++) {
    const s = shuffle(ids);
    if (s.every((x, i) => x !== ids[i])) return Object.fromEntries(ids.map((id, i) => [id, s[i]]));
  }
  return Object.fromEntries(ids.map((id, i) => [id, ids[(i + 1) % ids.length]]));
};

const roster = (run, exclude) => run.session.rosterFor(run.activeIds).filter((p) => p.id !== exclude);

export const PRIMS = {
  // ---------------------------------------------------------------------------------------------
  say: {
    async begin(run, cur) {
      cur.pub = { text: await run.render(cur.def.text), big: true };
      return cur.def.ms ?? 3800;
    },
    end: () => ({}),
  },

  // ---------------------------------------------------------------------------------------------
  secret: {
    async begin(run, cur) {
      const { def, targets } = cur;
      let assign = {};
      if (def.assign === 'identity') {
        const map = derange(targets);
        for (const id of targets) {
          assign[id] = await run.render(
            `Secretly become {other} for the next minute: copy their mannerisms, laugh, posture. Do not say who you are being.`,
            { other: run.session.nameOf(map[id]) },
          );
        }
        cur.state.identity = map;
      } else {
        const pool = def.pool?.length ? def.pool : SECRET_MISSIONS;
        const deck = shuffle(pool);
        const same = def.assign === 'same' ? await run.render(deck[0]) : null;
        for (let i = 0; i < targets.length; i++) assign[targets[i]] = same ?? (await run.render(deck[i % deck.length]));
      }
      cur.state.assign = assign;
      for (const id of targets) cur.priv[id] = { kind: 'secret', label: def.label || 'SECRET INSTRUCTION', text: assign[id] };
      cur.pub = { text: await run.render(def.text || 'Check your phone. Tell no one.'), sub: 'Everyone has a different instruction.', big: true };
      return (def.duration ?? 60) * 1000;
    },
    input(run, cur, pid, msg) {
      if (msg.done && cur.targets.includes(pid) && !cur.responded.has(pid)) { cur.responded.add(pid); return true; }
      return false;
    },
    isDone: (run, cur) => cur.def.duration > 25 ? false : cur.targets.every((id) => cur.responded.has(id)),
    end: (run, cur) => ({ assignments: cur.state.assign, identity: cur.state.identity, blurb: 'Everyone received a different secret instruction and carried it out.' }),
  },

  // ---------------------------------------------------------------------------------------------
  point: {
    async begin(run, cur) {
      const prompt = await run.render(cur.def.prompt);
      cur.state.picks = {};
      for (const id of cur.targets) {
        cur.priv[id] = { kind: 'point', prompt, options: roster(run, cur.def.allowSelf ? null : id) };
      }
      cur.pub = { text: prompt, sub: 'Point at someone on your phone.' };
      return (cur.def.duration ?? 25) * 1000;
    },
    input(run, cur, pid, msg) {
      if (!cur.targets.includes(pid) || cur.responded.has(pid)) return false;
      if (!run.activeIds.includes(msg.target)) return false;
      if (msg.target === pid && !cur.def.allowSelf) return false;
      cur.state.picks[pid] = msg.target;
      cur.responded.add(pid);
      return true;
    },
    isDone: (run, cur) => cur.targets.every((id) => cur.responded.has(id)),
    end(run, cur) {
      const scores = Object.fromEntries(run.activeIds.map((id) => [id, 0]));
      for (const t of Object.values(cur.state.picks)) scores[t] = (scores[t] || 0) + 1;
      const r = rank(scores, run.activeIds);
      if (!Object.values(scores).some((v) => v > 0)) { r.leaderId = null; r.lastId = null; }
      const top = r.leaderId ? scores[r.leaderId] : 0;
      return {
        scores, picks: cur.state.picks, ...r, track: cur.def.track !== false, kind: 'point',
        display: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, `${v} vote${v === 1 ? '' : 's'}`])),
        blurb: r.leaderId ? `${run.session.nameOf(r.leaderId)} was pointed at by ${top} of ${cur.targets.length} players${r.tie ? ' (after a tie)' : ''}.` : 'Nobody pointed at anybody.',
      };
    },
  },

  // ---------------------------------------------------------------------------------------------
  choose: {
    async begin(run, cur) {
      const { def, targets } = cur;
      const source = def.options?.length ? def.options : POOLS[def.pool] || [];
      const count = Math.min(def.count ?? 4, source.length);
      const prompt = await run.render(def.prompt || 'Choose.');
      const shared = def.shared || !def.pool;
      const sharedSet = shared ? await Promise.all((def.options?.length ? def.options : shuffle(source).slice(0, count)).map((o) => run.render(o))) : null;
      cur.state.offered = {};
      cur.state.picks = {};
      for (const id of targets) {
        const options = sharedSet || shuffle(source).slice(0, count);
        cur.state.offered[id] = options;
        cur.priv[id] = { kind: 'choose', prompt, options };
      }
      cur.pub = { text: prompt, sub: 'Choose on your phone.', options: sharedSet || undefined };
      return (def.duration ?? 22) * 1000;
    },
    input(run, cur, pid, msg) {
      if (!cur.targets.includes(pid) || cur.responded.has(pid)) return false;
      const opt = cur.state.offered[pid]?.[msg.option];
      if (opt == null) return false;
      cur.state.picks[pid] = opt;
      cur.responded.add(pid);
      return true;
    },
    isDone: (run, cur) => cur.targets.every((id) => cur.responded.has(id)),
    end(run, cur) {
      const tally = {};
      const offered = new Set(Object.values(cur.state.offered).flat());
      for (const o of offered) tally[o] = 0;
      for (const o of Object.values(cur.state.picks)) tally[o] = (tally[o] || 0) + 1;
      const entries = Object.entries(tally);
      const max = Math.max(0, ...entries.map(([, v]) => v));
      const min = Math.min(...entries.map(([, v]) => v));
      const top = max > 0 ? pick(entries.filter(([, v]) => v === max))[0] : pick([...offered]);
      const least = pick(entries.filter(([, v]) => v === min))[0];
      return {
        tally, picks: cur.state.picks, top, least, kind: 'choose',
        blurb: `The group chose "${top}"${max > 0 ? ` (${max} vote${max === 1 ? '' : 's'})` : ''}. Least chosen: "${least}".`,
      };
    },
  },

  // ---------------------------------------------------------------------------------------------
  type: {
    async begin(run, cur) {
      const prompt = await run.render(cur.def.prompt);
      cur.state.texts = {};
      for (const id of cur.targets) cur.priv[id] = { kind: 'type', prompt, placeholder: cur.def.placeholder || '', maxLen: cur.def.maxLen ?? 60 };
      cur.pub = { text: prompt, sub: 'Type your answer on your phone.' };
      return (cur.def.duration ?? 40) * 1000;
    },
    input(run, cur, pid, msg) {
      if (!cur.targets.includes(pid) || cur.responded.has(pid)) return false;
      const t = cleanUserText(msg.text, cur.def.maxLen ?? 60);
      if (!t) return false;
      cur.state.texts[pid] = t;
      cur.responded.add(pid);
      return true;
    },
    isDone: (run, cur) => cur.targets.every((id) => cur.responded.has(id)),
    end(run, cur) {
      const texts = cur.state.texts;
      const vals = Object.values(texts);
      if (cur.def.remember === 'prophecy') {
        for (const [pid, t] of Object.entries(texts)) run.session.mem.prophecies.push({ pid, name: run.session.nameOf(pid, false), text: t, atEvent: run.session.mem.eventCount });
      }
      const authorId = vals.length ? pick(Object.keys(texts)) : null;
      return {
        texts, kind: 'type', words: vals, lastText: authorId ? texts[authorId] : 'an unnamed thing', lastAuthorId: authorId,
        blurb: vals.length ? `Players wrote: ${vals.map((v) => `"${v}"`).join(', ')}.` : 'Nobody wrote anything.',
      };
    },
  },

  // ---------------------------------------------------------------------------------------------
  tap: {
    async begin(run, cur) {
      const { def } = cur;
      const prompt = await run.render(def.prompt);
      const dur = (def.duration ?? 12) * 1000;
      cur.state = { mode: def.mode || 'mash', counts: {}, times: {}, pulseAt: Math.round(dur * (0.3 + Math.random() * 0.4)), startedAt: now() };
      for (const id of cur.targets) cur.priv[id] = { kind: 'tap', mode: cur.state.mode, prompt, label: def.label || (cur.state.mode === 'mash' ? 'TAP' : 'NOW') };
      cur.pub = { text: prompt, sub: cur.state.mode === 'mash' ? 'Everyone tap. Tap like it matters.' : 'Trust your instincts.', mode: cur.state.mode };
      return dur;
    },
    input(run, cur, pid, msg) {
      const st = cur.state;
      if (!cur.targets.includes(pid)) return false;
      if (st.mode === 'timing') {
        if (st.times[pid] != null) return false;
        st.times[pid] = now() - st.startedAt;
        cur.responded.add(pid);
        return true;
      }
      const allowed = Math.floor(((now() - st.startedAt) / 1000) * 14) + 14 - (st.counts[pid] || 0);
      const n = Math.max(0, Math.min(Number(msg.n) || 0, 14, allowed));
      if (!n) return false;
      st.counts[pid] = (st.counts[pid] || 0) + n;
      return true;
    },
    isDone: (run, cur) => cur.state.mode === 'timing' && cur.targets.every((id) => cur.responded.has(id)),
    live: (run, cur) => (cur.state.mode === 'mash' ? { counts: cur.state.counts } : {}),
    end(run, cur) {
      const st = cur.state;
      const scores = {};
      if (st.mode === 'timing') {
        for (const id of cur.targets) scores[id] = st.times[id] == null ? -Infinity : -Math.abs(st.times[id] - st.pulseAt);
      } else {
        for (const id of cur.targets) scores[id] = st.counts[id] || 0;
      }
      const r = rank(scores, cur.targets);
      const display = Object.fromEntries(cur.targets.map((id) => [id, st.mode === 'timing' ? (st.times[id] == null ? 'never tapped' : `${Math.abs(st.times[id] - st.pulseAt)}ms off`) : `${st.counts[id] || 0} taps`]));
      if (st.mode === 'mash' && !Object.values(st.counts).some((v) => v > 0)) { r.leaderId = null; r.lastId = null; }
      return { scores, display, ...r, kind: 'tap', blurb: r.leaderId ? `${run.session.nameOf(r.leaderId)} ${st.mode === 'timing' ? 'tapped closest to the hidden moment' : 'tapped the most'}; ${r.lastId ? `${run.session.nameOf(r.lastId)} was last` : 'no clear loser'}.` : 'Nobody tapped.' };
    },
  },

  // ---------------------------------------------------------------------------------------------
  hold: {
    async begin(run, cur) {
      const { def } = cur;
      const prompt = await run.render(def.prompt);
      const mode = def.mode || 'target';
      cur.state = { mode, down: {}, held: {}, everDown: new Set(), startedAt: now(), targetMs: def.targetMs ?? 15000 };
      for (const id of cur.targets) cur.priv[id] = { kind: 'hold', mode, prompt, label: def.label || 'HOLD', targetMs: mode === 'target' ? cur.state.targetMs : undefined };
      cur.pub = { text: prompt, sub: mode === 'target' ? 'No clocks. Trust your thumb.' : mode === 'endurance' ? 'Last one holding wins. Do not let go.' : 'Hold until it ends.', mode };
      return (def.duration ?? (mode === 'target' ? Math.round(cur.state.targetMs / 1000) + 12 : 30)) * 1000;
    },
    input(run, cur, pid, msg) {
      const st = cur.state;
      if (!cur.targets.includes(pid)) return false;
      if (msg.down && st.down[pid] == null && st.held[pid] == null) { st.down[pid] = now(); st.everDown.add(pid); return true; }
      if (msg.up && st.down[pid] != null) {
        st.held[pid] = now() - st.down[pid];
        delete st.down[pid];
        cur.responded.add(pid);
        return true;
      }
      return false;
    },
    isDone(run, cur) {
      const st = cur.state;
      if (st.mode === 'target') return cur.targets.every((id) => st.held[id] != null);
      if (st.mode === 'endurance') return st.everDown.size >= cur.targets.length && Object.keys(st.down).length <= 1 && cur.responded.size >= cur.targets.length - 1;
      return false;
    },
    live: (run, cur) => ({ holding: Object.keys(cur.state.down).length }),
    end(run, cur) {
      const st = cur.state;
      const t = now();
      for (const id of Object.keys(st.down)) { st.held[id] = t - st.down[id]; }
      const scores = {}, display = {};
      for (const id of cur.targets) {
        const h = st.held[id];
        if (st.mode === 'target') {
          scores[id] = h == null ? -Infinity : -Math.abs(h - st.targetMs);
          display[id] = h == null ? 'never touched it' : `${(h / 1000).toFixed(1)}s (${h >= st.targetMs ? '+' : ''}${((h - st.targetMs) / 1000).toFixed(1)}s)`;
        } else {
          scores[id] = h ?? 0;
          display[id] = `${((h ?? 0) / 1000).toFixed(1)}s`;
        }
      }
      const r = rank(scores, cur.targets);
      return { scores, display, ...r, kind: 'hold', blurb: r.leaderId ? `${run.session.nameOf(r.leaderId)} won the hold (${display[r.leaderId]}); ${r.lastId ? run.session.nameOf(r.lastId) + ' was worst' : ''}.` : 'Nobody held anything.' };
    },
  },

  // ---------------------------------------------------------------------------------------------
  shake: {
    async begin(run, cur) {
      const prompt = await run.render(cur.def.prompt);
      cur.state = { counts: {}, startedAt: now() };
      for (const id of cur.targets) cur.priv[id] = { kind: 'shake', prompt };
      cur.pub = { text: prompt, sub: 'Shake your phone. Or mash the button if your phone is a coward.' };
      return (cur.def.duration ?? 12) * 1000;
    },
    input(run, cur, pid, msg) {
      const st = cur.state;
      if (!cur.targets.includes(pid)) return false;
      const allowed = Math.floor(((now() - st.startedAt) / 1000) * 10) + 10 - (st.counts[pid] || 0);
      const n = Math.max(0, Math.min(Number(msg.n) || 0, 10, allowed));
      if (!n) return false;
      st.counts[pid] = (st.counts[pid] || 0) + n;
      return true;
    },
    live: (run, cur) => ({ counts: cur.state.counts }),
    end(run, cur) {
      const scores = Object.fromEntries(cur.targets.map((id) => [id, cur.state.counts[id] || 0]));
      const r = rank(scores, cur.targets);
      if (!Object.values(scores).some((v) => v > 0)) { r.leaderId = null; r.lastId = null; }
      return { scores, display: Object.fromEntries(cur.targets.map((id) => [id, `${scores[id]} shakes`])), ...r, kind: 'shake', blurb: r.leaderId ? `${run.session.nameOf(r.leaderId)} shook the most; ${r.lastId ? run.session.nameOf(r.lastId) + ' the least' : 'it was close'}.` : 'Nobody shook anything.' };
    },
  },

  // ---------------------------------------------------------------------------------------------
  trap: {
    async begin(run, cur) {
      const { def } = cur;
      const prompt = await run.render(def.prompt);
      const trapName = def.trapName || 'RED PLANET';
      const hues = shuffle([190, 120, 45, 270, 160, 300, 210]);
      const n = 6;
      const objects = Array.from({ length: n }, (_, i) => ({
        id: `o${i}`, x: 12 + ((i * 37 + Math.random() * 20) % 76), y: 22 + ((i * 23 + Math.random() * 20) % 56),
        r: 30 + Math.random() * 28, hue: hues[i % hues.length], dur: 7 + Math.random() * 8, delay: -Math.random() * 8,
      }));
      const trapIdx = Math.floor(Math.random() * n);
      objects[trapIdx].hue = 0; objects[trapIdx].trap = true; objects[trapIdx].r = 44;
      cur.state = { trapId: objects[trapIdx].id, tripper: null, tripAt: 0 };
      for (const id of cur.targets) cur.priv[id] = { kind: 'trap', prompt, objects, trapName };
      cur.pub = { text: prompt, sub: 'Touch whatever you like. Except one thing.', objects, trapName };
      return (def.duration ?? 20) * 1000;
    },
    input(run, cur, pid, msg) {
      const st = cur.state;
      if (st.tripper || !cur.targets.includes(pid)) return false;
      if (msg.hit !== st.trapId) return false;
      st.tripper = pid; st.tripAt = now();
      cur.worldOverride = 'glitch';
      cur.fxNow = 'explode';
      cur.pub = { ...cur.pub, exploded: true, tripper: run.session.nameOf(pid) };
      return { endIn: 2400 };
    },
    end(run, cur) {
      const t = cur.state.tripper;
      return {
        tripperId: t, lastId: t, leaderId: null, kind: 'trap',
        display: t ? { [t]: 'touched it' } : {},
        blurb: t ? `${run.session.nameOf(t)} touched the forbidden ${cur.pub.trapName || 'planet'} and exploded the interface.` : 'Everyone obeyed. Nobody touched the forbidden object. Suspicious.',
      };
    },
  },

  // ---------------------------------------------------------------------------------------------
  draw: {
    async begin(run, cur) {
      const prompt = await run.render(cur.def.prompt);
      cur.state.drawings = {};
      for (const id of cur.targets) cur.priv[id] = { kind: 'draw', prompt };
      cur.pub = { text: prompt, sub: 'Draw it on your phone with your finger.' };
      return (cur.def.duration ?? 35) * 1000;
    },
    input(run, cur, pid, msg) {
      if (!cur.targets.includes(pid) || cur.responded.has(pid)) return false;
      if (typeof msg.img !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(msg.img) || msg.img.length > 90000) return false;
      cur.state.drawings[pid] = msg.img;
      cur.responded.add(pid);
      return true;
    },
    isDone: (run, cur) => cur.targets.every((id) => cur.responded.has(id)),
    end: (run, cur) => ({ drawings: cur.state.drawings, kind: 'draw', blurb: `${Object.keys(cur.state.drawings).length} drawings were submitted.` }),
  },

  // ---------------------------------------------------------------------------------------------
  sync: {
    async begin(run, cur) {
      const prompt = await run.render(cur.def.prompt);
      cur.state = { progress: 0, peak: 0, holding: new Set(), holdSeconds: (cur.def.holdSeconds ?? 4) * Math.min(1, run.scale) };
      for (const id of cur.targets) cur.priv[id] = { kind: 'sync', prompt, label: cur.def.label || 'HOLD' };
      cur.tickMs = 100;
      cur.pub = { text: prompt, sub: 'EVERY finger must be down. Together. Tell each other.' };
      return (cur.def.duration ?? 25) * 1000;
    },
    input(run, cur, pid, msg) {
      if (!cur.targets.includes(pid)) return false;
      const has = cur.state.holding.has(pid);
      if (msg.holding && !has) { cur.state.holding.add(pid); return true; }
      if (!msg.holding && has) { cur.state.holding.delete(pid); return true; }
      return false;
    },
    tick(run, cur, dt) {
      const st = cur.state;
      const need = cur.targets.filter((id) => run.session.isConnected(id)).length;
      const have = [...st.holding].filter((id) => cur.targets.includes(id)).length;
      const step = dt / (st.holdSeconds * 1000);
      const before = st.progress;
      if (need > 0 && have >= need) st.progress = Math.min(1, st.progress + step);
      else if (have > 0) st.progress = Math.max(0, st.progress - step * 0.35);
      else st.progress = Math.max(0, st.progress - step * 0.8);
      st.peak = Math.max(st.peak, st.progress);
      return Math.abs(st.progress - before) > 0.004;
    },
    isDone: (run, cur) => cur.state.progress >= 1,
    live: (run, cur) => ({ progress: cur.state.progress, holding: cur.state.holding.size, total: cur.targets.length }),
    end(run, cur) {
      const success = cur.state.progress >= 1;
      return { success, kind: 'sync', blurb: success ? 'The group held together and succeeded.' : `The group failed to synchronise (peak ${Math.round(cur.state.peak * 100)}%).` };
    },
  },

  // ---------------------------------------------------------------------------------------------
  reveal: {
    async begin(run, cur) {
      const { def } = cur;
      const src = (def.from && run.results[def.from]) || run.lastResult || {};
      const name = (id) => run.session.nameOf(id);
      let items = [];
      const kind = def.kind || 'lines';
      if (kind === 'secrets') items = Object.entries(src.assignments || {}).map(([id, text]) => ({ name: name(id), text }));
      else if (kind === 'texts') items = Object.entries(src.texts || {}).map(([id, text]) => ({ name: name(id), text }));
      else if (kind === 'drawings') items = Object.entries(src.drawings || {}).map(([id, img]) => ({ name: name(id), img }));
      else if (kind === 'tally') items = Object.entries(src.tally || {}).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
      else if (kind === 'scores') items = Object.entries(src.display || {}).map(([id, text]) => ({ name: name(id), text, win: id === src.leaderId, lose: id === src.lastId })).sort((a, b) => Number(b.win) - Number(a.win));
      else if (kind === 'roster') items = run.activeIds.map((id) => ({ name: run.session.nameOf(id, false), text: run.session.mem.alias(id) || '' }));
      else items = await Promise.all((def.lines || []).map(async (l) => ({ text: await run.render(l) })));
      cur.pub = { heading: await run.render(def.title || 'RESULTS'), kind, items, reveal: true };
      return def.ms ?? Math.min(24000, 6000 + items.length * 1800);
    },
    end: () => ({}),
  },

  // ---------------------------------------------------------------------------------------------
  verdict: {
    async begin(run, cur) {
      const { def } = cur;
      const title = await run.render(def.title || 'THE VERDICT');
      if (def.per === 'player') {
        const lines = [];
        const aliasMap = {};
        for (const id of run.activeIds) {
          const text = await run.slot(def.slot, { key: `${def.slot}:${id}`, vars: { subject: run.session.nameOf(id) } });
          lines.push({ name: run.session.nameOf(id, false), text });
          aliasMap[id] = text;
        }
        if (def.apply === 'alias') for (const id of run.activeIds) run.session.mem.setAlias(id, aliasMap[id], 3);
        cur.state.lines = lines;
        cur.pub = { heading: title, lines, verdict: true };
        return def.ms ?? Math.min(24000, 6000 + lines.length * 2200);
      }
      const text = def.slot ? `${def.text ? (await run.render(def.text)) + ' ' : ''}${await run.slot(def.slot)}` : await run.render(def.text);
      cur.state.text = text;
      cur.pub = { heading: title, text, verdict: true };
      return def.ms ?? 8000;
    },
    end: (run, cur) => ({ text: cur.state.text, lines: cur.state.lines, kind: 'verdict', blurb: cur.state.text || 'The AI delivered its verdict.' }),
  },
};
