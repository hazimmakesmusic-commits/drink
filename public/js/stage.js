// The in-session view. The server sends a public `stage` (what the room sees) and a private
// `view` (what THIS phone is asked to do). Components mount once per step key and then update in place.
import { h, clear, typewriter, vibrate } from './ui.js';
import { sfx } from './audio.js';

const sizeFor = (t) => (t.length < 26 ? 'xl' : t.length < 64 ? 'l' : 'm');
const byId = (st, id) => st.players.find((p) => p.id === id);

export function SessionView(root, S, A) {
  const hud = h('div', { class: 'hud' });
  const tbar = h('div', { class: 'tbar' }, h('i'));
  const stageEl = h('div', { class: 'stage' });
  const dock = h('div', { class: 'dock' });
  const el = h('div', { class: 'session' }, hud, tbar, stageEl, dock);
  root.append(el);

  let st = S.state;
  let centerKey = null, center = null, panelKey = null, panel = null;
  let raf = 0;

  const remaining = () => (st.stage ? (st.stage.endsAt - S.net.now()) / 1000 : 0);

  function tick() {
    const s = st.stage;
    const showBar = s && !['say'].includes(s.type) && !(st.view?.kind === 'hold' && st.view.mode === 'target') && s.endsAt > s.startedAt;
    tbar.classList.toggle('on', Boolean(showBar));
    if (showBar) {
      const k = Math.max(0, Math.min(1, (s.endsAt - S.net.now()) / (s.endsAt - s.startedAt)));
      tbar.firstChild.style.transform = `scaleX(${k})`;
      tbar.firstChild.style.filter = k < 0.2 ? 'hue-rotate(-90deg) brightness(1.4)' : '';
    }
    center?.tick?.();
    panel?.tick?.();
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  function renderHud() {
    clear(hud);
    const p = st.persona;
    hud.append(
      h('div', { class: 'l' }, h('span', { class: 'pill' }, `${p.glyph} ${st.code}`)),
      h('div', { class: 'mid' }, st.phase === 'event' || st.phase === 'intro' ? st.stage?.title || '' : ''),
      h('div', { class: 'r' },
        h('button', { class: 'icon-btn', 'aria-label': 'Menu', onclick: () => A.openMenu() }, '☰')),
    );
  }

  // ---- center builders ----------------------------------------------------------------------------
  function buildSay(s) {
    const t = h('div', { class: `t ${sizeFor(s.text || '')}` });
    const sub = h('div', { class: 's' }, s.sub || '');
    const line = h('div', { class: 'line' }, s.line || '');
    const box = h('div', { class: 'say' }, t, sub, line);
    const cancel = typewriter(t, s.text || '', { cps: 55 });
    return { el: box, update(n) { if (n.line !== line.textContent) { line.textContent = n.line || ''; line.style.animation = 'none'; void line.offsetWidth; line.style.animation = ''; } }, destroy: cancel };
  }

  function rosterEl(s) {
    return h('div', { class: 'roster' }, st.players.filter((p) => s.targets?.includes(p.id)).map((p) => h('i', { dataset: { id: p.id }, title: p.name }, p.avatar)));
  }

  function liveEl(s) {
    const wrap = h('div', { class: 'live' });
    let meter, fill;
    if (s.type === 'sync') { fill = h('i'); meter = h('div', { class: 'meter' }, fill); wrap.append(meter, h('div', { class: 'mini', id: 'syncinfo' })); }
    return {
      el: wrap,
      update(n) {
        const L = n.live || {};
        if (n.type === 'sync' && fill) {
          fill.style.width = `${Math.round((L.progress || 0) * 100)}%`;
          wrap.querySelector('#syncinfo').textContent = `${L.holding || 0} / ${L.total || 0} fingers down`;
        } else if (L.counts) {
          const rows = Object.entries(L.counts).sort((a, b) => b[1] - a[1]);
          const max = Math.max(1, ...rows.map((r) => r[1]));
          clear(wrap);
          rows.slice(0, 6).forEach(([id, c]) => wrap.append(h('div', { class: 'bar' }, h('b', {}, byId(st, id)?.name || '?'), h('span', {}, h('i', { style: { width: `${(c / max) * 100}%` } })))));
        } else if (n.type === 'hold' && L.holding != null && n.mode === 'endurance') {
          wrap.textContent = `${L.holding} still holding`;
          wrap.className = 'live mini';
        }
      },
    };
  }

  function buildPrompt(s) {
    const t = h('div', { class: `say` }, h('div', { class: `t ${sizeFor(s.text || '')}` }));
    const text = t.firstChild;
    const cancel = typewriter(text, s.text || '', { cps: 60 });
    const sub = h('div', { class: 's' }, s.sub || '');
    const line = h('div', { class: 'line' }, s.line || '');
    const roster = rosterEl(s);
    const timer = h('div', { class: 'k' });
    const live = liveEl(s);
    const box = h('div', { class: 'prompt-box' }, timer, t, sub, line, live.el, roster);
    return {
      el: box,
      tick() { const r = Math.ceil(Math.max(0, remaining())); const hide = st.view?.kind === 'hold' && st.view.mode === 'target'; timer.textContent = hide || s.type === 'say' ? '' : `${r}s`; },
      update(n) {
        if (n.line !== line.textContent) line.textContent = n.line || '';
        const done = new Set(n.responded);
        roster.querySelectorAll('i').forEach((i) => i.classList.toggle('done', done.has(i.dataset.id)));
        live.update(n);
      },
      destroy: cancel,
    };
  }

  function buildTrap(s) {
    const field = h('div', { class: 'trapfield' });
    const planets = s.objects.map((o) => h('button', {
      class: `planet${o.trap ? ' trap' : ''}`, 'aria-label': o.trap ? s.trapName : 'planet',
      style: { left: `${o.x}%`, top: `${o.y}%`, width: `${o.r * 2}px`, height: `${o.r * 2}px`, '--h': o.hue, '--dur': `${o.dur}s`, '--delay': `${o.delay}s` },
      onpointerdown: (e) => { e.target.classList.add('pressed'); sfx.blip(); A.input({ hit: o.id }, s.key); vibrate(o.trap ? [60, 40, 200] : 15); },
    }));
    field.append(...planets);
    const hint = h('div', { class: 'trap-hint say' }, h('div', { class: 't m' }, s.text), h('div', { class: 'line' }, s.line || ''));
    const wrapper = h('div', { class: 'trapfield-wrap', style: { position: 'absolute', inset: 0 } }, field, hint);
    return {
      el: wrapper,
      update(n) {
        hint.querySelector('.line').textContent = n.exploded ? `${n.tripper} touched it.` : n.line || '';
        field.classList.toggle('exploded', Boolean(n.exploded));
      },
    };
  }

  function revealItem(it, kind, i) {
    const style = { animationDelay: `${0.25 + i * 0.5}s` };
    if (kind === 'drawings') return h('div', { class: 'item', style }, h('b', {}, it.name), h('img', { src: it.img, alt: `drawing by ${it.name}` }));
    if (kind === 'tally') return h('div', { class: 'item', style }, h('b', {}, `${it.count} vote${it.count === 1 ? '' : 's'}`), it.label);
    if (kind === 'scores') return h('div', { class: `item${it.win ? ' win' : ''}${it.lose ? ' lose' : ''}`, style }, h('b', {}, `${it.win ? '👑 ' : ''}${it.name}`), it.text);
    if (kind === 'roster') return h('div', { class: 'item', style }, h('b', {}, it.name), it.text || '—');
    if (kind === 'lines') return h('div', { class: 'item', style }, it.text);
    return h('div', { class: 'item', style }, h('b', {}, it.name), it.text);
  }

  function buildReveal(s) {
    const list = h('div', { class: s.kind === 'drawings' ? 'grid2' : '' }, s.items.map((it, i) => revealItem(it, s.kind, i)));
    return { el: h('div', { class: 'reveal' }, h('h2', {}, s.heading), list) };
  }

  function buildVerdict(s) {
    const box = h('div', { class: 'reveal' }, h('h2', {}, s.heading));
    let cancel;
    if (s.lines) s.lines.forEach((l, i) => box.append(h('div', { class: 'item', style: { animationDelay: `${0.3 + i * 0.9}s` } }, h('b', {}, l.name), l.text)));
    else { const p = h('div', { class: 'verdict-text' }); box.append(p); cancel = typewriter(p, s.text, { cps: 34 }); }
    return { el: box, destroy: cancel };
  }

  function buildComment(c) {
    const box = h('div', { class: 'comment' }, h('div', { class: 'glyph' }, st.persona.glyph));
    const cancels = [];
    c.lines.forEach((line, i) => {
      const p = h('p', { style: { opacity: 0 } });
      box.append(p);
      const t = setTimeout(() => { p.style.opacity = 1; cancels.push(typewriter(p, line, { cps: 36 })); }, i * 2300);
      cancels.push(() => clearTimeout(t));
    });
    return { el: box, destroy: () => cancels.forEach((f) => f()) };
  }

  function buildAmbient() {
    const whisper = h('div', { class: 'whisper' });
    let wid = null;
    const box = h('div', { class: 'ambient' }, whisper, h('div', { class: 'dot' }), h('div', { class: 'tiny' }, `${st.persona.name} IS WATCHING`));
    return {
      el: box,
      update(n) {
        const w = n.ambient?.whisper;
        if (w && w.id !== wid) { wid = w.id; whisper.textContent = w.text; whisper.style.animation = 'none'; void whisper.offsetWidth; whisper.style.animation = ''; sfx.whisper(); }
        if (!w) { whisper.textContent = ''; wid = null; }
      },
    };
  }

  function mountCenter() {
    let key, build, arg;
    if (st.phase === 'ambient') { key = 'ambient'; build = buildAmbient; }
    else if (st.phase === 'commentary' && st.commentary) { key = `c:${st.commentary.id}`; build = () => buildComment(st.commentary); }
    else if (st.phase === 'ended') { key = 'ended'; build = () => ({ el: h('div', { class: 'say' }, h('div', { class: 't xl' }, 'THE SESSION HAS ENDED'), h('div', { class: 's' }, 'The entity returns to the void.'), h('button', { class: 'btn primary', onclick: () => A.leave() }, 'LEAVE')) }); }
    else if (st.stage) {
      const s = st.stage; key = s.key; arg = s;
      if (s.type === 'say') build = () => buildSay(s);
      else if (s.type === 'trap') build = () => buildTrap(s);
      else if (s.type === 'reveal') build = () => buildReveal(s);
      else if (s.type === 'verdict') build = () => buildVerdict(s);
      else build = () => buildPrompt(s);
    } else { key = 'none'; build = () => ({ el: h('div') }); }
    if (key === centerKey) { center?.update?.(st.stage || st); return; }
    center?.destroy?.();
    centerKey = key;
    center = build();
    clear(stageEl);
    stageEl.append(center.el);
    center.update?.(st.stage || st);
  }

  // ---- private panel (this phone's job) ------------------------------------------------------------
  function mountPanel() {
    const v = st.phase === 'event' || st.phase === 'intro' ? st.view : null;
    const key = v ? `${v.key}:${v.kind}` : 'none';
    if (key === panelKey) { panel?.update?.(v); return; }
    panel?.destroy?.();
    panelKey = key;
    clear(dock);
    panel = v ? buildPanel(v) : null;
    if (panel) { dock.append(panel.el); panel.update?.(v); }
  }

  function buildPanel(v) {
    const P = PANELS[v.kind];
    const bound = { ...A, input: (o) => A.input(o, v.key) };
    return P ? P(v, { A: bound, S, st: () => st, remaining }) : null;
  }

  function update(S2) {
    st = S2.state;
    renderHud();
    mountCenter();
    mountPanel();
  }
  update(S);

  return { update, destroy() { cancelAnimationFrame(raf); center?.destroy?.(); panel?.destroy?.(); el.remove(); } };
}

// =====================================================================================================
// Private panels. Each returns {el, update(view), destroy?, tick?}
// =====================================================================================================
const locked = (text) => h('div', { class: 'locked' }, text);

const PANELS = {
  wait(v) {
    const msgs = ['The entity is processing the others.', 'Look at the main screen.', 'Your turn is elsewhere.'];
    return { el: h('div', { class: 'wait' }, msgs[Math.abs((v.key || '').length) % msgs.length]) };
  },

  point(v, { A }) {
    const box = h('div', { class: 'card' });
    const opts = h('div', { class: 'opts two' });
    const q = h('div', { class: 'q' }, 'Point at one.');
    v.options.forEach((o) => opts.append(h('button', { class: 'opt', onclick: () => { sfx.lock(); vibrate(20); A.input({ target: o.id }); mark(o.id); } }, o.avatar, ' ', o.name)));
    box.append(q, opts);
    const mark = (id) => { opts.querySelectorAll('.opt').forEach((b, i) => b.classList.toggle('sel', v.options[i].id === id)); };
    return { el: box, update(n) { if (n.done) { clear(box); box.append(locked('LOCKED IN. WAIT FOR THE OTHERS.')); } } };
  },

  choose(v, { A }) {
    const box = h('div', { class: 'card' }, h('div', { class: 'q' }, 'Choose.'));
    const opts = h('div', { class: 'opts' });
    v.options.forEach((o, i) => opts.append(h('button', { class: 'opt', onclick: (e) => { sfx.lock(); vibrate(20); e.currentTarget.classList.add('sel'); A.input({ option: i }); } }, o)));
    box.append(opts);
    return { el: box, update(n) { if (n.done) { opts.querySelectorAll('.opt').forEach((b) => (b.disabled = true)); if (!box.querySelector('.locked')) box.append(locked('LOCKED IN.')); } } };
  },

  type(v, { A }) {
    const input = h('input', { class: 'field', maxlength: v.maxLen, placeholder: v.placeholder || '...', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'send' });
    const send = () => { const t = input.value.trim(); if (!t) return; sfx.lock(); A.input({ text: t }); input.blur(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    const btn = h('button', { class: 'btn primary', onclick: send }, 'SEND');
    const box = h('div', { class: 'card' }, h('div', { class: 'q' }, 'Type your answer.'), input, h('div', { style: { height: '10px' } }), btn);
    return { el: box, update(n) { if (n.done) { clear(box); box.append(locked('SENT. THE ENTITY HAS IT.')); } } };
  },

  secret(v, { A }) {
    const card = h('div', { class: 'secret-card veil' }, 'HOLD TO READ');
    const show = () => { card.classList.remove('veil'); card.textContent = v.text; };
    const hide = () => { card.classList.add('veil'); card.textContent = 'HOLD TO READ'; };
    card.addEventListener('pointerdown', (e) => { e.preventDefault(); show(); vibrate(15); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => card.addEventListener(ev, hide));
    card.addEventListener('contextmenu', (e) => e.preventDefault());
    const done = h('button', { class: 'btn ghost', onclick: () => { A.input({ done: true }); } }, 'I DID IT');
    const box = h('div', { class: 'card' }, h('div', { class: 'q' }, v.label || 'SECRET'), card, h('div', { style: { height: '10px' } }), done);
    return { el: box, update(n) { if (n.done) done.disabled = true; } };
  },

  tap(v, { A }) {
    let pending = 0, count = 0, timer;
    const btn = h('button', { class: 'big-btn' }, v.label || 'TAP');
    const counter = h('div', { class: 'locked' }, '');
    if (v.mode === 'timing') {
      btn.addEventListener('pointerdown', () => { sfx.blip(); vibrate(30); A.input({ tap: true }); btn.disabled = true; counter.textContent = 'TOUCHED. NOW WAIT.'; });
    } else {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('down'); pending++; count++; counter.textContent = `${count}`; sfx.blip(); vibrate(8); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, () => btn.classList.remove('down')));
      timer = setInterval(() => { if (pending) { A.input({ n: pending }); pending = 0; } }, 100);
    }
    return { el: h('div', { class: 'card', style: { display: 'grid', gap: '8px' } }, btn, counter), destroy() { clearInterval(timer); if (pending) A.input({ n: pending }); } };
  },

  hold(v, { A }) {
    const btn = h('button', { class: 'big-btn' }, v.label || 'HOLD');
    const msg = h('div', { class: 'locked' }, v.mode === 'target' ? '' : 'PRESS AND KEEP PRESSING');
    let isDown = false, released = false;
    const down = (e) => { e.preventDefault(); if (isDown || released) return; isDown = true; btn.classList.add('down'); msg.textContent = v.mode === 'target' ? 'HOLDING...' : 'DO NOT LET GO'; A.input({ down: true }); vibrate(25); };
    const up = () => { if (!isDown) return; isDown = false; released = true; btn.classList.remove('down'); btn.disabled = true; msg.textContent = v.mode === 'target' ? 'RELEASED. LOCKED.' : v.mode === 'fixed' ? 'YOU RELEASED EARLY.' : 'YOU LET GO.'; A.input({ up: true }); };
    btn.addEventListener('pointerdown', down);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, up));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    return { el: h('div', { class: 'card', style: { display: 'grid', gap: '8px' } }, btn, msg), destroy() { if (isDown) A.input({ up: true }); } };
  },

  shake(v, { A }) {
    let pending = 0, count = 0, last = 0, lastT = 0;
    const counter = h('div', { class: 'locked' }, '0');
    const bump = () => { pending++; count++; counter.textContent = `${count}`; };
    const onMotion = (e) => {
      const a = e.accelerationIncludingGravity; if (!a) return;
      const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
      const d = Math.abs(mag - last); last = mag;
      const now = performance.now();
      if (d > 13 && now - lastT > 90) { lastT = now; bump(); vibrate(10); }
    };
    const needsPerm = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
    const enable = h('button', { class: 'btn sm', onclick: async () => { try { const r = await DeviceMotionEvent.requestPermission(); if (r === 'granted') { addEventListener('devicemotion', onMotion); enable.remove(); } } catch { /* denied */ } } }, 'ENABLE MOTION');
    if (!needsPerm) addEventListener('devicemotion', onMotion);
    const btn = h('button', { class: 'big-btn', onpointerdown: (e) => { e.preventDefault(); bump(); sfx.blip(); } }, 'SHAKE');
    const timer = setInterval(() => { if (pending) { A.input({ n: pending }); pending = 0; } }, 120);
    return {
      el: h('div', { class: 'card', style: { display: 'grid', gap: '8px' } }, h('div', { class: 'q' }, 'Shake the phone. Or mash the button.'), btn, counter, needsPerm ? enable : ''),
      destroy() { clearInterval(timer); removeEventListener('devicemotion', onMotion); if (pending) A.input({ n: pending }); },
    };
  },

  trap() {
    return { el: h('div', { class: 'wait' }, 'Touch the cosmos.') };
  },

  sync(v, { A }) {
    const btn = h('button', { class: 'big-btn' }, v.label || 'HOLD');
    const msg = h('div', { class: 'locked' }, 'ALL FINGERS. AT ONCE.');
    const set = (on) => { btn.classList.toggle('down', on); A.input({ holding: on }); if (on) vibrate(15); };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, () => btn.classList.contains('down') && set(false)));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    return { el: h('div', { class: 'card', style: { display: 'grid', gap: '8px' } }, btn, msg), destroy() { A.input({ holding: false }); } };
  },

  draw(v, { A, remaining }) {
    const cv = h('canvas', { width: 300, height: 300 });
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0a0614'; ctx.fillRect(0, 0, 300, 300);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 7;
    const colors = ['#4fffa8', '#ff4fd8', '#ffd24f', '#4fb8ff', '#ffffff'];
    let color = colors[0], drawing = false, sent = false, inked = false;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 300, ((e.clientY - r.top) / r.height) * 300]; };
    cv.addEventListener('pointerdown', (e) => { e.preventDefault(); drawing = true; inked = true; cv.setPointerCapture(e.pointerId); ctx.strokeStyle = color; ctx.beginPath(); const [x, y] = pos(e); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y); ctx.stroke(); });
    cv.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); });
    ['pointerup', 'pointercancel'].forEach((ev) => cv.addEventListener(ev, () => { drawing = false; }));
    const sw = h('div', { class: 'swatches' }, colors.map((c, i) => h('button', { class: i === 0 ? 'on' : '', style: { background: c }, onclick: (e) => { color = c; sw.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
    const submit = () => {
      if (sent) return; sent = true;
      let img = cv.toDataURL('image/webp', 0.6);
      if (!img.startsWith('data:image/webp')) img = cv.toDataURL('image/jpeg', 0.6);
      if (img.length > 80000) { const s = document.createElement('canvas'); s.width = s.height = 180; s.getContext('2d').drawImage(cv, 0, 0, 180, 180); img = s.toDataURL('image/jpeg', 0.5); }
      A.input({ img }); sfx.lock();
    };
    const box = h('div', { class: 'card draw-wrap' }, cv, sw, h('button', { class: 'btn primary', onclick: submit }, 'SUBMIT SPECIMEN'));
    return { el: box, tick() { if (!sent && remaining() < 1.4) submit(); }, update(n) { if (n.done) { clear(box); box.append(locked('SPECIMEN SUBMITTED.')); } }, destroy() { if (!sent && inked) submit(); } };
  },
};
