// Non-session screens: onboarding, landing, join, setup, lobby, and the control sheet.
import { h, clear, toast, vibrate } from './ui.js';
import { sfx, isMuted, setMuted } from './audio.js';

const AVATARS = ['👽', '👾', '🛸', '🪐', '🌙', '🔮', '🧿', '🍄', '🦑', '🐙', '🦠', '👁', '🧠', '🫠', '🥴', '😈', '🤖', '🧌', '🦎', '🐸', '🐌', '🦋', '🌀', '🌚'];

const section = (label, ...kids) => h('div', {}, h('div', { class: 'label' }, label), ...kids);

export function Onboard(root, S, A) {
  let avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  const name = h('input', { class: 'field', maxlength: 16, placeholder: 'your name', autocomplete: 'nickname', autocapitalize: 'words' });
  const age = h('input', { type: 'checkbox', id: 'age' });
  const err = h('div', { class: 'err' });
  const grid = h('div', { class: 'avatars' }, AVATARS.map((a) => h('button', { class: a === avatar ? 'on' : '', onclick: (e) => { avatar = a; grid.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); sfx.blip(); } }, a)));
  const go = h('button', { class: 'btn primary', onclick: async () => {
    err.textContent = '';
    if (!name.value.trim()) return (err.textContent = 'The void needs a name.');
    if (!age.checked) return (err.textContent = 'You must be 18 or older to enter.');
    go.disabled = true;
    try { await A.createAccount({ name: name.value, avatar, ageOk: true }); } catch (e) { err.textContent = e.message; go.disabled = false; }
  } }, 'ENTER');
  root.append(h('div', { class: 'screen' },
    h('div', { class: 'center-col' },
      h('div', { class: 'logo' }, 'WHO ARE', h('br'), 'YOU?'),
      h('div', { class: 'tag' }, 'Name + face. That is all it wants.'),
      name,
      section('Pick a face', grid),
      h('label', { class: 'check' }, age, 'I am 18 or older.'),
      err, go,
      h('div', { class: 'mini' }, 'Nothing is remembered between sessions. The entity forgets you when the night ends.'),
    )));
  return { destroy() { root.innerHTML = ''; } };
}

export function Landing(root, S, A) {
  root.append(h('div', { class: 'screen' },
    h('div', { style: { height: '4vh' } }),
    h('div', { class: 'logo' }, 'THE', h('br'), 'SIXTH', h('br'), 'FRIEND'),
    h('div', { class: 'tag' }, 'it lives in your phones. it interrupts.'),
    h('div', { class: 'enter' }, 'ENTER THE VOID'),
    h('div', { class: 'center-col', style: { margin: '0' } },
      h('button', { class: 'btn primary', onclick: () => { sfx.blip(); A.go('setup'); } }, 'CREATE SESSION'),
      h('button', { class: 'btn', onclick: () => { sfx.blip(); A.go('join'); } }, 'JOIN SESSION'),
      h('div', { class: 'row', style: { alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' } },
        h('div', { class: 'pill' }, `${S.account.avatar} ${S.account.name}`),
        h('button', { class: 'btn sm ghost', onclick: (e) => { setMuted(!isMuted()); e.currentTarget.textContent = isMuted() ? '🔇 SOUND OFF' : '🔊 SOUND ON'; } }, isMuted() ? '🔇 SOUND OFF' : '🔊 SOUND ON'),
        h('button', { class: 'btn sm ghost', onclick: () => A.signOut() }, 'NOT YOU?')),
    )));
  return { destroy() { root.innerHTML = ''; } };
}

export function Join(root, S, A) {
  const code = h('input', { class: 'field code-input', maxlength: 4, placeholder: 'CODE', autocapitalize: 'characters', autocomplete: 'off', inputmode: 'text', value: S.pendingJoin || '' });
  code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ''); if (code.value.length === 4) go.click(); });
  const go = h('button', { class: 'btn primary', onclick: () => { if (code.value.length === 4) { A.join(code.value); } else toast('Four letters.'); } }, 'ENTER');
  root.append(h('div', { class: 'screen' },
    h('div', { class: 'center-col' },
      h('div', { class: 'logo' }, 'WHERE?'),
      h('div', { class: 'tag' }, 'Scan the QR on a friend\'s phone, or type their code.'),
      code, go,
      h('button', { class: 'btn ghost sm', onclick: () => A.go('landing') }, 'BACK'))));
  setTimeout(() => !S.pendingJoin && code.focus(), 300);
  if (S.pendingJoin) { setTimeout(() => go.click(), 400); S.pendingJoin = null; }
  return { destroy() { root.innerHTML = ''; } };
}

/** Shared settings editor used by Setup (create) and the in-session control sheet. */
export function settingsEditor(S, settings, onChange, { lobby = false } = {}) {
  const cfg = S.config;
  const box = h('div', { style: { display: 'grid', gap: '16px', gridTemplateColumns: 'minmax(0, 1fr)' } });
  const rebuild = () => {
    clear(box);
    box.append(
      section('Choose your entity', h('div', { class: 'persona-row' }, cfg.personas.map((p) => h('button', { class: `persona${settings.persona === p.id ? ' on' : ''}`, onclick: () => { settings.persona = p.id; onChange({ persona: p.id }); rebuild(); sfx.blip(); } },
        h('div', { class: 'g' }, p.glyph), h('b', {}, p.name), h('span', {}, p.blurb))))),
      section('Select vibe (any mix)', h('div', { class: 'chips' }, cfg.vibes.map((v) => h('button', { class: `chip${settings.vibes.includes(v) ? ' on' : ''}`, onclick: () => {
        const on = settings.vibes.includes(v);
        const next = on ? settings.vibes.filter((x) => x !== v) : [...settings.vibes, v];
        if (!next.length) return;
        settings.vibes = next; onChange({ vibes: next }); rebuild(); sfx.blip();
      } }, v)))),
      section(`Intensity — ${cfg.intensity[settings.intensity]}`, h('div', { class: 'seg' }, [1, 2, 3, 4, 5].map((i) => h('button', { class: settings.intensity === i ? 'on' : '', onclick: () => { settings.intensity = i; onChange({ intensity: i }); rebuild(); vibrate(10); sfx.blip(); } }, i)))),
      section(`Roast level — ${cfg.roast[settings.roast]}`, h('div', { class: 'seg' }, [0, 1, 2, 3].map((i) => h('button', { class: settings.roast === i ? 'on' : '', onclick: () => { settings.roast = i; onChange({ roast: i }); rebuild(); sfx.blip(); } }, i)))),
    );
    if (!lobby) return;
  };
  rebuild();
  return box;
}

export function Setup(root, S, A) {
  const settings = { maxPlayers: 6, persona: 'alien', vibes: ['chaos'], intensity: 3, roast: 1 };
  const num = h('b', {}, '6');
  const set = (d) => { settings.maxPlayers = Math.min(10, Math.max(2, settings.maxPlayers + d)); num.textContent = settings.maxPlayers; };
  const create = h('button', { class: 'btn primary', onclick: () => { create.disabled = true; A.create(settings); } }, 'OPEN THE PORTAL');
  root.append(h('div', { class: 'screen' },
    h('div', { class: 'center-col' },
      h('h2', { class: 'logo', style: { fontSize: '30px' } }, 'SUMMON'),
      section('Number of players (5–6 recommended)', h('div', { class: 'stepper' }, h('button', { onclick: () => set(-1) }, '−'), num, h('button', { onclick: () => set(1) }, '+'))),
      settingsEditor(S, settings, () => {}),
      create,
      h('button', { class: 'btn ghost sm', onclick: () => A.go('landing') }, 'BACK'))));
  return { destroy() { root.innerHTML = ''; } };
}

export function Lobby(root, S, A) {
  let st = S.state;
  const codeEl = h('div', { class: 'code' });
  const players = h('div', { class: 'players' });
  const actions = h('div', { style: { display: 'grid', gap: '10px' } });
  const info = h('div', { class: 'mini' });
  const qr = h('div', { class: 'qr' }, h('img', { alt: 'QR code to join', src: `/api/qr?code=${st.code}` }));
  const link = `${location.origin}/?join=${st.code}`;
  root.append(h('div', { class: 'screen' },
    h('div', { class: 'center-col' },
      h('div', { class: 'tag' }, 'The portal is open'),
      codeEl, qr,
      h('button', { class: 'btn sm ghost', onclick: async () => { try { if (navigator.share) await navigator.share({ title: 'The Sixth Friend', text: `Join my session: ${st.code}`, url: link }); else { await navigator.clipboard.writeText(link); toast('Link copied.'); } } catch { /* cancelled */ } } }, 'SHARE LINK'),
      players, info, actions)));

  function update(S2) {
    st = S2.state;
    if (codeEl.dataset.c !== st.code) { codeEl.dataset.c = st.code; clear(codeEl); [...st.code].forEach((c) => codeEl.append(h('span', {}, c))); }
    const known = new Set([...players.children].map((c) => c.dataset.id));
    const ids = st.players.map((p) => p.id);
    [...players.children].forEach((c) => !ids.includes(c.dataset.id) && c.remove());
    st.players.forEach((p) => {
      let chip = [...players.children].find((c) => c.dataset.id === p.id);
      if (!chip) { chip = h('div', { class: 'pchip', dataset: { id: p.id } }); players.append(chip); if (known.size) sfx.blip(); }
      chip.className = `pchip${p.connected ? '' : ' off'}`;
      clear(chip); chip.append(h('i', {}, p.avatar), p.name, p.id === st.hostId ? h('small', {}, 'HOST') : '');
    });
    const n = st.players.filter((p) => p.connected).length;
    const persona = st.persona;
    info.textContent = `${persona.glyph} ${persona.name} · ${S.config.intensity[st.settings.intensity]} · ${st.settings.vibes.join(' + ')} — ${n}/${st.settings.maxPlayers} here. Sit close. It prefers an audience.`;
    clear(actions);
    if (st.me.isHost) {
      actions.append(
        h('button', { class: 'btn primary', disabled: n < 2, onclick: () => { sfx.alert(); A.start(); } }, n < 2 ? 'WAITING FOR HUMANS...' : 'WAKE THE ENTITY'),
        h('button', { class: 'btn', onclick: () => A.openMenu() }, 'ENTITY & VIBE SETTINGS'));
    } else actions.append(h('div', { class: 'locked' }, 'WAITING FOR THE HOST TO WAKE IT...'));
    actions.append(h('button', { class: 'btn ghost sm', onclick: () => A.leave() }, 'LEAVE'));
  }
  update(S);
  return { update, destroy() { root.innerHTML = ''; } };
}

/** Bottom sheet: host controls, dev tools, mute, leave. */
export function openMenu(S, A) {
  const st = S.state;
  const isHost = st?.me.isHost;
  const bg = h('div', { class: 'sheet-bg', onclick: (e) => e.target === bg && close() });
  const close = () => bg.remove();
  const sheet = h('div', { class: 'sheet' });
  const mute = h('button', { class: 'btn sm ghost', onclick: (e) => { setMuted(!isMuted()); e.currentTarget.textContent = isMuted() ? '🔇 SOUND OFF' : '🔊 SOUND ON'; } }, isMuted() ? '🔇 SOUND OFF' : '🔊 SOUND ON');
  sheet.append(h('h3', {}, isHost ? 'HOST CONTROLS' : 'MENU'));
  if (isHost && st) {
    const live = { ...st.settings };
    sheet.append(settingsEditor(S, live, (patch) => A.settings(patch), { lobby: st.phase === 'lobby' }));
    if (st.phase === 'ambient') sheet.append(h('button', { class: 'btn', onclick: () => { A.summon(); close(); } }, 'SUMMON NOW'));
    if (st.phase === 'event') sheet.append(h('button', { class: 'btn', onclick: () => { A.skip(); close(); } }, 'SKIP THIS EVENT'));
    if (S.config.dev && (st.phase === 'ambient')) {
      sheet.append(section('Dev: force event', h('div', { class: 'chips' }, S.config.events.map((e) => h('button', { class: 'chip', onclick: () => { A.summon(e.id); close(); } }, e.title)))));
    }
  } else if (st) {
    sheet.append(h('div', { class: 'mini' }, `Entity: ${st.persona.glyph} ${st.persona.name} · Intensity: ${S.config.intensity[st.settings.intensity]}. The host steers.`));
  }
  sheet.append(h('div', { class: 'row' }, mute, h('button', { class: 'btn sm danger', onclick: () => { close(); A.leave(); } }, 'LEAVE SESSION')));
  if (isHost && st && st.phase !== 'lobby') sheet.append(h('button', { class: 'btn danger', onclick: () => { A.end(); close(); } }, 'END SESSION FOR EVERYONE'));
  sheet.append(h('button', { class: 'btn ghost sm', onclick: close }, 'CLOSE'));
  bg.append(sheet);
  document.body.append(bg);
}
