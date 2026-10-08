import test from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY } from '../server/events/library.js';
import { scoreEvent, MIN_SCORE, clicheHits } from '../server/originality.js';
import { isSafe } from '../server/safety.js';
import { FALLBACKS } from '../server/content.js';
import { normalizeEvent } from '../server/schema.js';
import { STEP_SPECS } from '../server/schema.js';

test('library has 20-100 events with unique ids', () => {
  assert.ok(LIBRARY.length >= 20 && LIBRARY.length <= 100, `got ${LIBRARY.length}`);
  assert.equal(new Set(LIBRARY.map((e) => e.id)).size, LIBRARY.length);
});

test('every library event clears the anti-cliche bar', () => {
  for (const ev of LIBRARY) {
    const { score, reasons } = scoreEvent(ev, []);
    assert.ok(score >= MIN_SCORE + 2, `${ev.id} scored ${score}: ${reasons}`);
  }
});

test('every library event uses only known primitives and ends well-formed', () => {
  for (const ev of LIBRARY) for (const s of ev.steps) assert.ok(STEP_SPECS[s.t], `${ev.id}: ${s.t}`);
});

test('library text and fallback content pass the safety filter', () => {
  for (const ev of LIBRARY) {
    const blob = JSON.stringify([ev.title, ev.intro, ev.steps.map((s) => [s.text, s.prompt, s.options, s.taunts, s.pool])]);
    assert.ok(isSafe(blob), `${ev.id} unsafe: ${blob.slice(0, 200)}`);
  }
  for (const [slot, fn] of Object.entries(FALLBACKS)) {
    for (let i = 0; i < 40; i++) {
      const out = fn({ vars: { leader: 'Rahul', words: ['moth', 'tuba'], last_text: 'ate a sandwich' }, rng: Math.random, mem: {}, players: ['Rahul', 'Mia'] });
      assert.ok(isSafe(out), `${slot}: ${out}`);
      assert.equal(clicheHits(out).length, 0, `${slot} cliche: ${out}`);
    }
  }
});

test('clichés are rejected', () => {
  const bad = (title, prompt) => normalizeEvent({ title, world: 'nebula', steps: [{ t: 'choose', prompt, options: ['a', 'b'] }, { t: 'say', text: 'x' }] });
  for (const [t, p] of [['WOULD YOU RATHER', 'Would you rather fly or be invisible?'], ['TRUTH OR DARE', 'Truth or dare?'], ['FAVE', "What's your favorite movie?"], ['NHIE', 'Never have I ever...']]) {
    assert.ok(scoreEvent(bad(t, p)).score < MIN_SCORE, t);
  }
});

test('normalizeEvent clamps and rejects junk', () => {
  assert.throws(() => normalizeEvent({ title: 'X', steps: [{ t: 'say', text: 'hi' }] })); // no interactive step
  assert.throws(() => normalizeEvent({ title: 'X', steps: [{ t: 'rm_rf' }, { t: 'tap' }] }));
  const ev = normalizeEvent({ title: 'ok', world: 'nope', steps: [{ t: 'tap', duration: 9999 }, { t: 'say', text: 'a' }] });
  assert.equal(ev.steps[0].duration, 40);
  assert.equal(ev.world, 'nebula');
  assert.throws(() => normalizeEvent({ title: 'x', steps: [{ t: 'tap' }, { t: 'say', text: 'go smoke a joint' }] }, { strict: true }));
});
