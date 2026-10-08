import { h, $, clear, toast, store, vibrate } from './ui.js';
import { Net } from './net.js';
import { World } from './world.js';
import { sfx, unlock } from './audio.js';
import { Onboard, Landing, Join, Setup, Lobby, openMenu } from './screens.js';
import { SessionView } from './stage.js';

const app = $('#app');
const world = new World($('#world'));
const S = { account: null, token: store.get('token'), config: null, state: null, screen: 'landing', pendingJoin: null, net: null };
window.__S = S; // handy for debugging in devtools

const params = new URLSearchParams(location.search);
if (params.get('join')) { S.pendingJoin = params.get('join').toUpperCase().slice(0, 4); history.replaceState({}, '', location.pathname); }

// ---- actions used by screens ------------------------------------------------------------------------------
const A = {
  go(screen) { S.screen = screen; route(); },
  async createAccount(body) {
    const res = await fetch('/api/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Could not enter.');
    S.token = j.token; store.set('token', j.token);
    S.account = j.account;
    S.net.connect(S.token);
    route();
  },
  signOut() { store.del('token'); S.token = null; S.account = null; S.state = null; S.net.closedByUs = true; S.net.ws?.close(); S.net.forgetSession(); route(); },
  create(settings) { S.net.send({ t: 'create', settings }); },
  join(code) { S.net.send({ t: 'join', code }); },
  start() { S.net.send({ t: 'start' }); },
  leave() { S.net.send({ t: 'leave' }); S.state = null; S.net.forgetSession(); S.screen = 'landing'; route(); applyAmbience(); },
  settings(patch) { S.net.send({ t: 'settings', patch }); },
  summon(eventId) { S.net.send({ t: 'summon', eventId }); },
  skip() { S.net.send({ t: 'skip' }); },
  end() { S.net.send({ t: 'end' }); },
  input(payload, key) { S.net.send({ t: 'input', key: key ?? S.state?.view?.key ?? S.state?.stage?.key, ...payload }); },
  openMenu() { openMenu(S, A); },
};

// ---- networking ---------------------------------------------------------------------------------------------
S.net = new Net({
  onState(st) { const prev = S.state; S.state = st; applyAmbience(prev); route(); },
  onMessage(m) {
    if (m.t === 'hello_ok') { S.account = m.account; route(); }
    else if (m.t === 'hello_fail') { store.del('token'); S.token = null; S.account = null; route(); }
    else if (m.t === 'error') { toast(m.message); const b = document.querySelector('.btn[disabled]'); if (b) b.disabled = false; }
    else if (m.t === 'left') { S.state = null; S.net.forgetSession(); S.screen = 'landing'; route(); applyAmbience(); }
  },
});

// ---- ambience: world, hue, fx, sound -----------------------------------------------------------------------
let lastFx = null, lastPhase = null, lastWhisper = null;
function applyAmbience(prev) {
  const st = S.state;
  const root = document.documentElement;
  if (!st) { world.setWorld('alien_planet'); world.setHue(150); root.style.setProperty('--hue', 150); return; }
  const hue = (st.persona.hue + (st.ambient?.hueShift || 0)) % 360;
  let w = st.ambient?.world || 'alien_planet';
  if ((st.phase === 'event' || st.phase === 'intro') && st.stage) w = st.stage.world;
  else if (st.phase === 'commentary' && st.commentary) w = st.commentary.world;
  world.setWorld(w);
  world.setHue(hue);
  world.setIntensity(st.settings.intensity);
  world.setLowPower(st.phase === 'ambient' || st.phase === 'lobby');
  root.style.setProperty('--hue', Math.round(hue));
  const fx = st.stage?.fx;
  if (fx && fx.id !== lastFx) { lastFx = fx.id; world.fx(fx.kind); (sfx[fx.kind] || sfx.blip)(); if (['alert', 'explode', 'glitch'].includes(fx.kind)) vibrate(fx.kind === 'explode' ? [120, 40, 240] : [80, 40, 80]); }
  if (st.phase !== lastPhase) {
    if (st.phase === 'event' && lastPhase === 'ambient') vibrate([200, 80, 200, 80, 400]);
    lastPhase = st.phase;
  }
}

// ---- routing ---------------------------------------------------------------------------------------------------
let cur = { name: null, inst: null };
const SCREENS = {
  onboard: () => Onboard(app, S, A),
  landing: () => Landing(app, S, A),
  join: () => Join(app, S, A),
  setup: () => Setup(app, S, A),
  lobby: () => Lobby(app, S, A),
  session: () => SessionView(app, S, A),
};

function route() {
  if (!S.config) return;
  let name;
  if (!S.token || (!S.account && !S.net.ws)) name = 'onboard';
  else if (!S.account) return; // connecting
  else if (S.state?.phase === 'lobby') name = 'lobby';
  else if (S.state) name = 'session';
  else if (S.pendingJoin && S.screen !== 'join') { S.screen = 'join'; name = 'join'; }
  else name = S.screen;
  if (!S.token) name = 'onboard';
  if (name !== cur.name) {
    cur.inst?.destroy?.();
    clear(app);
    cur = { name, inst: SCREENS[name]() };
  }
  cur.inst?.update?.(S);
}

// ---- boot ----------------------------------------------------------------------------------------------------------
addEventListener('pointerdown', unlock, { once: false, passive: true });
let wake;
async function keepAwake() { try { wake = await navigator.wakeLock?.request('screen'); } catch { /* denied */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.state) keepAwake(); });
addEventListener('pointerdown', () => { if (!wake) keepAwake(); }, { once: true });

(async () => {
  try { S.config = await (await fetch('/api/config')).json(); } catch { document.body.textContent = 'The void is unreachable.'; return; }
  if (S.token) S.net.connect(S.token);
  route();
})();
