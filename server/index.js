import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { SessionManager } from './session.js';
import { createAccount, byToken, updateAccount, publicView } from './accounts.js';
import { personaList, INTENSITY_LABELS, ROAST_LABELS, VIBES } from './personas.js';
import { llmEnabled } from './llm.js';
import { LIBRARY } from './events/library.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT != null ? Number(process.env.PORT) : 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const sessions = new SessionManager();

const readBody = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 20000) { reject(new Error('too big')); req.destroy(); } });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
});
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/config') return json(res, 200, { personas: personaList(), vibes: VIBES, intensity: INTENSITY_LABELS, roast: ROAST_LABELS, ai: llmEnabled(), dev: process.env.DEV_TOOLS === '1', events: process.env.DEV_TOOLS === '1' ? LIBRARY.map((e) => ({ id: e.id, title: e.title })) : [] });
    if (url.pathname === '/api/account' && req.method === 'POST') {
      const b = await readBody(req);
      try { const a = createAccount(b); return json(res, 200, { token: a.token, account: publicView(a) }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (url.pathname === '/api/account' && req.method === 'PATCH') {
      const b = await readBody(req);
      const a = updateAccount(b.token, b);
      return a ? json(res, 200, { account: publicView(a) }) : json(res, 401, { error: 'unknown account' });
    }
    if (url.pathname === '/api/me') {
      const a = byToken(url.searchParams.get('token'));
      return a ? json(res, 200, { account: publicView(a) }) : json(res, 401, { error: 'unknown account' });
    }
    if (url.pathname === '/api/qr') {
      const code = (url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      const svg = await QRCode.toString(`${origin}/?join=${code}`, { type: 'svg', margin: 1, color: { dark: '#0a0614', light: '#e9fff4' } });
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      return res.end(svg);
    }
    // static files
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: 'server error' });
  }
});

// ---- realtime ------------------------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 150 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.bucket = { tokens: 60, at: Date.now() };
  ws.on('pong', () => { ws.isAlive = true; });
  const reply = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const err = (message) => reply({ t: 'error', message });
  const sess = () => (ws.sessionCode ? sessions.get(ws.sessionCode) : null);

  ws.on('message', (raw) => {
    // token bucket: 60 msgs burst, 40/s sustained
    const nowMs = Date.now();
    ws.bucket.tokens = Math.min(60, ws.bucket.tokens + ((nowMs - ws.bucket.at) / 1000) * 40);
    ws.bucket.at = nowMs;
    if (ws.bucket.tokens < 1) return;
    ws.bucket.tokens--;

    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      const a = byToken(m.token);
      if (!a) return reply({ t: 'hello_fail' });
      ws.user = a;
      reply({ t: 'hello_ok', account: publicView(a), serverNow: Date.now() });
      // resume a live session if this account was in one (phone woke up / page reload)
      try {
        const code = m.code && sessions.get(m.code) ? m.code : null;
        const s = code ? sessions.get(code) : [...sessions.sessions.values()].find((x) => x.players.has(a.id) && x.phase !== 'ended');
        if (s && s.players.has(a.id)) s.addPlayer(a, ws);
      } catch (e) { err(e.message); }
      return;
    }
    if (!ws.user) return err('Not signed in.');
    const a = ws.user;
    const s = sess();
    try {
      switch (m.t) {
        case 'create': {
          if (s) s.dropSocket(ws);
          const ns = sessions.create(a, m.settings || {});
          ns.addPlayer(a, ws);
          break;
        }
        case 'join': {
          const target = sessions.get(m.code);
          if (!target) return err('No session with that code.');
          if (s && s !== target) s.dropSocket(ws);
          target.addPlayer(a, ws);
          break;
        }
        case 'leave': if (s) { s.removePlayer(a.id); } break;
        case 'settings': s?.updateSettings(a.id, m.patch || {}); break;
        case 'start': s?.start(a.id).catch((e) => err(e.message)); break;
        case 'summon': s?.summon(a.id, m.eventId); break;
        case 'skip': s?.skip(a.id); break;
        case 'end': s?.end(a.id); break;
        case 'input': s?.input(a.id, m); break;
        case 'ping': reply({ t: 'pong', serverNow: Date.now() }); break;
        default: break;
      }
    } catch (e) {
      err(e.message);
    }
  });

  ws.on('close', () => { const s = sess(); s?.dropSocket(ws); });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000).unref();

server.listen(PORT, () => console.log(`The Sixth Friend listening on :${PORT}  (AI: ${llmEnabled() ? 'LLM' : 'built-in content engine'}${process.env.PACE === 'fast' ? ', FAST pace' : ''})`));
export { server, sessions };
