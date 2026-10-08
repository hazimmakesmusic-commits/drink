import test from 'node:test';
import assert from 'node:assert/strict';

// Stub the Anthropic API so we can exercise the LLM paths (gen slots, commentary, novel events,
// safety/anti-cliché rejection and fallbacks) without a key or network.
process.env.ANTHROPIC_API_KEY = 'test-key';
const { Session } = await import('../server/session.js');

const acct = (n) => ({ id: n, name: n, avatar: '👽' });
const fakeWs = () => ({ readyState: 1, send() {} });
function makeSession() {
  const s = new Session('TEST', acct('a'), { intensity: 3 });
  s.addPlayer(acct('a'), fakeWs());
  s.addPlayer(acct('b'), fakeWs());
  s.addPlayer(acct('c'), fakeWs());
  return s;
}
const reply = (content) => ({ ok: true, status: 200, json: async () => ({ content }) });
const textReply = (t) => reply([{ type: 'text', text: t }]);
const toolReply = (input) => reply([{ type: 'tool_use', name: 'create_event', input }]);
let calls = [];
const realFetch = globalThis.fetch;
const stub = (fn) => { globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return fn(JSON.parse(init.body)); }; };
test.afterEach(() => { globalThis.fetch = realFetch; calls = []; });

test('gen slot uses the model output and sends persona + session memory', async () => {
  const s = makeSession();
  s.mem.addJoke('the sun was replaced with a damp sock');
  stub(() => textReply('"Impersonating a lighthouse at a funeral"'));
  const out = await s.host.gen('crime', { vars: { subject: 'a' } });
  assert.equal(out, 'Impersonating a lighthouse at a funeral');
  assert.match(calls[0].system, /extraterrestrial/i);
  assert.match(calls[0].system, /damp sock/);
  assert.match(calls[0].system, /Intensity 3\/5/);
});

test('unsafe or cliché model output falls back to the built-in content engine', async () => {
  const s = makeSession();
  for (const bad of ['Chug your drink and jump off the balcony', 'Would you rather fly or be invisible?', 'x'.repeat(400)]) {
    stub(() => textReply(bad));
    const out = await s.host.gen('crime', { vars: {} });
    assert.notEqual(out, bad);
    assert.ok(out.length > 5 && out.length < 200);
  }
});

test('network failure and HTTP errors fall back silently', async () => {
  const s = makeSession();
  stub(() => { throw new Error('offline'); });
  assert.ok((await s.host.gen('species', { vars: {} })).length > 2);
  stub(() => ({ ok: false, status: 529, json: async () => ({}) }));
  assert.ok((await s.host.commentary({ title: 'X', bullets: ['y'], leader: 'a', last: 'b', subject: 'c' })).length >= 1);
});

test('commentary: model lines are used when safe', async () => {
  const s = makeSession();
  stub(() => textReply('Interesting. You keep selecting a.\nThe council is watching.'));
  const lines = await s.host.commentary({ title: 'COSMIC COURT', bullets: ['a was guilty'], leader: null, last: 'a', subject: 'a' });
  assert.deepEqual(lines, ['Interesting. You keep selecting a.', 'The council is watching.']);
  assert.match(calls[0].system, /Roast level 1\/3/);
});

const goodEvent = {
  title: 'The Moon Audit', intro: 'Your moon has been flagged.', world: 'court', intensity: 3, originality: 9,
  steps: [
    { t: 'say', text: '{subject} has been selected for a moon audit.', ms: 4000 },
    { t: 'tap', mode: 'mash', prompt: 'Polish the moon. Tap.', duration: 8 },
    { t: 'point', prompt: 'Who polished it suspiciously? Point.', duration: 15 },
    { t: 'verdict', slot: 'conclusion', title: 'AUDIT RESULT' },
  ],
};

test('novel AI events are validated, scored and accepted when good', async () => {
  const s = makeSession();
  stub(() => toolReply(goodEvent));
  const ev = await s.host.novelEvent([]);
  assert.ok(ev, 'event accepted');
  assert.equal(ev.title, 'THE MOON AUDIT');
  assert.equal(ev.source, 'ai');
  assert.ok(ev.steps.every((x) => ['say', 'tap', 'point', 'verdict'].includes(x.t)));
  assert.equal(calls[0].tool_choice.name, 'create_event');
});

test('novel AI events that are clichés, unsafe, malformed or self-scored low are rejected', async () => {
  const s = makeSession();
  const cases = [
    { ...goodEvent, title: 'Truth or Dare', steps: [{ t: 'choose', prompt: 'Truth or dare?', options: ['truth', 'dare'] }, { t: 'say', text: 'ok' }] },
    { ...goodEvent, steps: [...goodEvent.steps, { t: 'say', text: 'Everyone take a shot and smoke a joint' }] },
    { ...goodEvent, steps: [{ t: 'say', text: 'only talking' }] },
    { ...goodEvent, steps: [{ t: 'format_disk' }, { t: 'tap' }] },
    { ...goodEvent, originality: 3 },
  ];
  for (const c of cases) {
    stub(() => toolReply(c));
    assert.equal(await s.host.novelEvent([]), null, JSON.stringify(c).slice(0, 80));
  }
});
