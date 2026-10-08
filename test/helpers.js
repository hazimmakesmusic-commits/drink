import { WebSocket } from 'ws';
import { createAccount } from '../server/accounts.js';

export function makeBot(port, name) {
  const acct = createAccount({ name, avatar: '👽', ageOk: true });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const bot = { acct, ws, state: null, log: [], errors: [], types: new Set(), seen: [] };
  const ready = new Promise((res) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', token: acct.token })); res(); }));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'error') bot.errors.push(m.message);
    if (m.t !== 'state') return;
    bot.state = m;
    const v = m.view;
    if (v && v.key && !bot.seen.includes(v.key + v.kind)) {
      bot.seen.push(v.key + v.kind);
      bot.types.add(v.kind);
      bot.react(v);
    }
  });
  // Simple behaviours for every private view type.
  bot.react = (v) => {
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'input', key: v.key, ...o }));
    const players = bot.state.players;
    const delay = 30 + Math.random() * 120;
    setTimeout(() => {
      switch (v.kind) {
        case 'point': send({ target: v.options[Math.floor(Math.random() * v.options.length)].id }); break;
        case 'choose': send({ option: Math.floor(Math.random() * v.options.length) }); break;
        case 'type': send({ text: `${name} says ${Math.random().toString(36).slice(2, 6)}` }); break;
        case 'secret': send({ done: true }); break;
        case 'tap': if (v.mode === 'timing') send({ tap: true }); else for (let i = 0; i < 5; i++) setTimeout(() => send({ n: 3 }), i * 80); break;
        case 'hold': send({ down: true }); setTimeout(() => send({ up: true }), v.mode === 'target' ? 600 + Math.random() * 400 : v.mode === 'endurance' ? 200 + Math.random() * 800 : 99999); break;
        case 'shake': for (let i = 0; i < 4; i++) setTimeout(() => send({ n: 5 }), i * 100); break;
        case 'trap': if (Math.random() < 0.5) send({ hit: v.objects.find((o) => o.trap).id }); else send({ hit: v.objects.find((o) => !o.trap).id }); break;
        case 'draw': send({ img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }); break;
        case 'sync': send({ holding: true }); break;
        default: break;
      }
    }, delay);
  };
  bot.send = (o) => ws.send(JSON.stringify(o));
  bot.ready = ready;
  bot.close = () => ws.close();
  return bot;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, timeout = 20000, step = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = fn(); if (v) return v; await sleep(step); }
  throw new Error('waitFor timed out');
}
