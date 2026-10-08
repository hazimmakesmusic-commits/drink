import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../server/session.js';
import { nextDelayMs, chooseLibraryEvent, eligible } from '../server/director.js';
import { Memory } from '../server/memory.js';

const acct = (n) => ({ id: n, name: n, avatar: '👽' });
const ws = () => ({ readyState: 1, send() {} });
function session(intensity = 3, n = 5) {
  const s = new Session('DIRX', acct('p0'), { intensity });
  for (let i = 0; i < n; i++) s.addPlayer(acct(`p${i}`), ws());
  return s;
}
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('quiet gaps are intensity-scaled and genuinely irregular (bursts + long silences)', () => {
  const sample = (i) => Array.from({ length: 600 }, () => nextDelayMs(session(i, 2)) / 1000);
  const mild = sample(1), insane = sample(5);
  assert.ok(avg(mild) > avg(insane) * 1.8, `mild ${avg(mild)} vs insane ${avg(insane)}`);
  const mid = sample(3);
  assert.ok(mid.some((x) => x < 40), 'has sudden bursts');
  assert.ok(mid.some((x) => x > 220), 'has long silences');
  assert.ok(Math.max(...mid) / Math.min(...mid) > 8, 'wide spread');
  const first = Array.from({ length: 100 }, () => nextDelayMs(session(3, 2), { first: true }) / 1000);
  assert.ok(first.every((x) => x >= 35 && x <= 70), 'first interruption arrives after ~35-70s');
});

test('director never repeats an event inside its cooldown and varies primitives', () => {
  const s = session(4);
  const seq = [];
  for (let i = 0; i < 60; i++) {
    const ev = chooseLibraryEvent(s);
    const back = s.mem.events.map((e) => e.id).slice(-ev.cooldown);
    assert.ok(!back.includes(ev.id), `${ev.id} repeated within cooldown`);
    s.mem.events.push({ id: ev.id, title: ev.title, mechanics: ev.steps.map((x) => x.t), def: ev });
    seq.push(ev);
  }
  assert.ok(new Set(seq.map((e) => e.id)).size >= 15, 'wide variety across a long night');
  let sameMechanic = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = new Set(seq[i - 1].steps.map((x) => x.t).filter((t) => !['say', 'reveal', 'verdict'].includes(t)));
    if (seq[i].steps.some((x) => a.has(x.t))) sameMechanic++;
  }
  assert.ok(sameMechanic < seq.length * 0.75, `primitives repeated back-to-back too often: ${sameMechanic}/${seq.length}`);
});

test('player-count gating: 4-player events are not offered to a duo', () => {
  const duo = session(3, 2);
  const ids = eligible(duo).map((e) => e.id);
  assert.ok(!ids.includes('identity_leak') && !ids.includes('cosmic_court'));
  assert.ok(ids.includes('time_sense'));
});

test('memory: most-chosen / quietest tracking and alias expiry', () => {
  const m = new Memory();
  m.p('a', 'Ana'); m.p('b', 'Bo');
  m.noteChosen('a'); m.noteChosen('a'); m.noteChosen('b');
  assert.deepEqual({ name: m.mostChosen().name, n: m.mostChosen().count }, { name: 'Ana', n: 2 });
  m.noteParticipation('a', true); m.noteParticipation('b', false); m.noteParticipation('b', false);
  assert.equal(m.quietest().name, 'Bo');
  m.setAlias('a', 'Lord Moth', 2);
  assert.equal(m.alias('a'), 'Lord Moth');
  m.events.push({}, {}, {});
  assert.equal(m.alias('a'), null, 'alias expires after N events');
  assert.match(m.digest(), /Ana: chosen 2x/);
});
