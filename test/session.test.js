import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.PORT = '0';
process.env.TIME_SCALE = '0.04';
process.env.PACE = 'fast';
process.env.DEV_TOOLS = '1';
process.env.ACCOUNTS_FILE = path.join(os.tmpdir(), `accts-${process.pid}.json`);

const { server, sessions } = await import('../server/index.js');
const { LIBRARY } = await import('../server/events/library.js');
const { makeBot, waitFor, sleep } = await import('./helpers.js');
await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
const port = server.address().port;

test('full session: lobby -> intro -> every library event completes with 5 bots', async () => {
  const names = ['Rahul', 'Mia', 'Jo', 'Sam', 'Kai'];
  const bots = names.map((n) => makeBot(port, n));
  await Promise.all(bots.map((b) => b.ready));
  const [host, ...rest] = bots;
  await sleep(100);
  host.send({ t: 'create', settings: { persona: 'alien', vibes: ['chaos', 'trippy'], intensity: 5, roast: 2, maxPlayers: 6 } });
  const code = (await waitFor(() => host.state?.code && host.state)).code;
  for (const b of rest) b.send({ t: 'join', code });
  await waitFor(() => host.state.players.length === 5);
  assert.equal(host.state.phase, 'lobby');
  host.send({ t: 'start' });
  await waitFor(() => host.state.phase === 'intro');
  await waitFor(() => host.state.phase === 'ambient', 30000);

  for (const ev of LIBRARY) {
    if (ev.requires) continue; // exercised separately
    const before = host.state.eventCount;
    host.send({ t: 'summon', eventId: ev.id });
    await waitFor(() => host.state.phase === 'event', 5000);
    await waitFor(() => host.state.phase === 'ambient' && host.state.eventCount === before + 1, 60000);
  }
  for (const b of bots) assert.deepEqual(b.errors, []);
  // primitives were really exercised
  const seen = new Set(bots.flatMap((b) => [...b.types]));
  for (const k of ['point', 'choose', 'type', 'secret', 'tap', 'hold', 'shake', 'trap', 'draw', 'sync']) assert.ok(seen.has(k), `primitive never seen: ${k}`);
  // session memory accumulated
  const s = sessions.get(code);
  assert.ok(s.mem.eventCount >= LIBRARY.length - 2);
  assert.ok(s.mem.mostChosen());
  host.send({ t: 'end' });
  await waitFor(() => host.state.phase === 'ended');
  bots.forEach((b) => b.close());
});

test('memory callbacks: council fires after one player is chosen 3x; prophecy audit follows a prophecy', async () => {
  const bots = ['A', 'B', 'C'].map((n) => makeBot(port, n));
  await Promise.all(bots.map((b) => b.ready));
  const [host, ...rest] = bots;
  host.send({ t: 'create', settings: { intensity: 3 } });
  const code = (await waitFor(() => host.state?.code && host.state)).code;
  rest.forEach((b) => b.send({ t: 'join', code }));
  await waitFor(() => host.state.players.length === 3);
  host.send({ t: 'start' });
  await waitFor(() => host.state.phase === 'ambient', 30000);
  const s = sessions.get(code);
  // Rig memory so the director believes B was chosen 3 times and a prophecy is old.
  const bId = bots[1].acct.id;
  s.mem.p(bId).chosen = 3;
  s.mem.prophecies.push({ pid: bId, name: 'B', text: 'a moth will land on the lamp', atEvent: -5 });
  s.mem.events.push({ id: 'x', title: 'X', mechanics: [] }, { id: 'y', title: 'Y', mechanics: [] }, { id: 'z', title: 'Z', mechanics: [] });
  const { eligible } = await import('../server/director.js');
  const ids = eligible(s).map((e) => e.id);
  assert.ok(ids.includes('the_council'), 'council should be eligible');
  assert.ok(ids.includes('prophecy_audit'), 'audit should be eligible');
  host.send({ t: 'summon', eventId: 'the_council' });
  await waitFor(() => host.state.phase === 'event', 5000);
  await waitFor(() => host.state.phase === 'ambient', 60000);
  assert.ok(s.mem.done.size === 1, 'council marked done');
  assert.ok(!eligible(s).some((e) => e.id === 'the_council'), 'council does not repeat');
  host.send({ t: 'end' });
  bots.forEach((b) => b.close());
});

test('only the host can steer; late inputs and bad keys are ignored', async () => {
  const [h, p] = ['H', 'P'].map((n) => makeBot(port, n));
  await Promise.all([h.ready, p.ready]);
  h.send({ t: 'create', settings: {} });
  const code = (await waitFor(() => h.state?.code && h.state)).code;
  p.send({ t: 'join', code });
  await waitFor(() => h.state.players.length === 2);
  p.send({ t: 'start' });
  p.send({ t: 'settings', patch: { intensity: 1 } });
  await sleep(200);
  assert.equal(h.state.phase, 'lobby');
  assert.equal(h.state.settings.intensity, 3);
  h.send({ t: 'settings', patch: { intensity: 5, roast: 0 } });
  await waitFor(() => h.state.settings.intensity === 5);
  p.send({ t: 'input', key: 'nope', target: 'x' });
  p.send({ t: 'join', code: 'ZZZZ' });
  await waitFor(() => p.errors.length);
  h.close(); p.close();
});

test.after(() => { server.close(); setTimeout(() => process.exit(0), 100); });
