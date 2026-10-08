// Event definitions are plain JSON. The application owns the UI (primitives); the AI (or a
// human) only supplies content. This module validates + normalises any event before it runs.
import { isSafe } from './safety.js';
import { POOLS } from './content.js';

export const WORLDS = ['alien_planet', 'alien_lab', 'portal', 'tunnel', 'eye', 'blackhole', 'glitch', 'nebula', 'court', 'dream', 'void', 'red_planet', 'storm', 'sun'];

// Allowed step types and the parameters each accepts (name -> [type, min, max] | 'string').
export const STEP_SPECS = {
  say:     { text: 'string', ms: [1200, 20000] },
  secret:  { assign: ['distinct', 'same', 'identity'], pool: 'strings', label: 'string', text: 'string', duration: [10, 120], who: 'who' },
  point:   { prompt: 'string', duration: [8, 60], allowSelf: 'bool', track: 'bool', who: 'who' },
  choose:  { prompt: 'string', pool: 'poolname', options: 'strings', count: [2, 5], shared: 'bool', duration: [8, 60], who: 'who' },
  type:    { prompt: 'string', placeholder: 'string', maxLen: [3, 120], duration: [10, 90], who: 'who', remember: ['prophecy'] },
  tap:     { prompt: 'string', mode: ['mash', 'timing'], duration: [4, 40], label: 'string' },
  hold:    { prompt: 'string', mode: ['target', 'endurance', 'fixed'], targetMs: [3000, 40000], duration: [4, 60], label: 'string' },
  shake:   { prompt: 'string', duration: [5, 30] },
  trap:    { prompt: 'string', duration: [8, 40], taunts: 'strings', trapName: 'string' },
  draw:    { prompt: 'string', duration: [15, 90], who: 'who' },
  sync:    { prompt: 'string', duration: [10, 60], holdSeconds: [2, 10], label: 'string' },
  reveal:  { title: 'string', kind: ['secrets', 'texts', 'drawings', 'tally', 'scores', 'roster', 'lines'], from: 'string', lines: 'strings', ms: [3000, 30000] },
  verdict: { title: 'string', slot: 'string', per: ['player'], text: 'string', ms: [3000, 20000], apply: ['alias'] },
};

export const INTERACTIVE = new Set(['secret', 'point', 'choose', 'type', 'tap', 'hold', 'shake', 'trap', 'draw', 'sync']);
const COMMON = ['id', 'world', 'fx', 'taunts', 'note'];

const str = (v, max = 220) => String(v).slice(0, max);

function normStep(raw, i) {
  if (!raw || typeof raw !== 'object') throw new Error(`step ${i}: not an object`);
  const spec = STEP_SPECS[raw.t];
  if (!spec) throw new Error(`step ${i}: unknown type ${raw.t}`);
  if (raw.t === 'choose' && Array.isArray(raw.pool)) raw = { ...raw, options: raw.pool, pool: undefined };
  const out = { t: raw.t, id: raw.id ? String(raw.id).replace(/[^a-z0-9_]/gi, '').slice(0, 16) : `s${i}` };
  if (raw.world && WORLDS.includes(raw.world)) out.world = raw.world;
  if (raw.fx) out.fx = str(raw.fx, 20);
  if (raw.when && /^[a-z0-9_.]+=[a-z0-9_]+$/i.test(raw.when)) out.when = raw.when;
  for (const [k, rule] of Object.entries(spec)) {
    const v = raw[k];
    if (v == null) continue;
    if (rule === 'string') out[k] = str(v);
    else if (rule === 'bool') out[k] = Boolean(v);
    else if (rule === 'strings') out[k] = (Array.isArray(v) ? v : []).slice(0, 24).map((s) => str(s, 140));
    else if (rule === 'who') out[k] = ['all', 'subject', 'others', 'leader'].includes(v) ? v : 'all';
    else if (rule === 'poolname') out[k] = POOLS[v] ? v : undefined;
    else if (Array.isArray(rule) && typeof rule[0] === 'string') {
      if (rule.includes(v)) out[k] = v;
    } else if (Array.isArray(rule)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = Math.min(rule[1], Math.max(rule[0], n));
    }
  }
  if (Array.isArray(raw.taunts)) out.taunts = raw.taunts.slice(0, 6).map((s) => str(s, 90));
  // required fields per type
  if (out.t === 'say' && !out.text) throw new Error(`step ${i}: say needs text`);
  if (out.t === 'choose' && !out.pool && !(out.options?.length >= 2)) throw new Error(`step ${i}: choose needs options or pool`);
  if (out.t === 'verdict' && !out.slot && !out.text) throw new Error(`step ${i}: verdict needs slot or text`);
  return out;
}

/** Validate + normalise. Throws on anything unusable. `strict` also enforces content safety (AI-made events). */
export function normalizeEvent(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('event: not an object');
  if (!raw.title) throw new Error('event: missing title');
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 8).map(normStep);
  if (!steps.some((s) => INTERACTIVE.has(s.t))) throw new Error('event: needs at least one interactive step');
  const ev = {
    id: String(raw.id || raw.title).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40),
    title: str(raw.title, 48).toUpperCase(),
    intro: raw.intro ? str(raw.intro) : undefined,
    world: WORLDS.includes(raw.world) ? raw.world : 'nebula',
    vibes: (raw.vibes || []).filter((v) => ['chaos', 'trippy', 'absurd', 'dark', 'deep', 'party'].includes(v)),
    intensity: [Math.max(1, Math.min(5, Number(raw.intensity?.[0] ?? raw.intensity ?? 1) || 1)), Math.max(1, Math.min(5, Number(raw.intensity?.[1] ?? 5) || 5))],
    minPlayers: Math.max(2, Number(raw.minPlayers) || 2),
    maxPlayers: Math.min(10, Number(raw.maxPlayers) || 10),
    cooldown: Number(raw.cooldown) || 6, // events before this may repeat
    weight: Number(raw.weight) || 1,
    joke: raw.joke ? str(raw.joke) : undefined,
    requires: raw.requires,
    steps,
    source: raw.source || 'library',
  };
  if (strict) {
    const blob = JSON.stringify([ev.title, ev.intro, steps]);
    if (!isSafe(blob)) throw new Error('event: failed safety filter');
  }
  return ev;
}

/** JSON schema handed to the model for novel event generation (structured output). */
export const LLM_EVENT_SCHEMA = {
  type: 'object',
  required: ['title', 'world', 'intro', 'steps', 'originality', 'intensity'],
  properties: {
    title: { type: 'string', description: 'Short ALL-CAPS event title, e.g. "THE MOON AUDIT".' },
    intro: { type: 'string', description: 'The host\'s opening stinger line. In persona.' },
    world: { type: 'string', enum: WORLDS },
    intensity: { type: 'integer', minimum: 1, maximum: 5 },
    originality: { type: 'integer', minimum: 0, maximum: 10, description: 'Honest self-score. Anything resembling a classic party game scores below 6.' },
    joke: { type: 'string', description: 'Optional running joke to remember, may use {leader}/{last}/{subject}.' },
    steps: {
      type: 'array', minItems: 2, maxItems: 7,
      items: {
        type: 'object',
        required: ['t'],
        properties: {
          t: { type: 'string', enum: Object.keys(STEP_SPECS) },
          id: { type: 'string' }, world: { type: 'string', enum: WORLDS }, text: { type: 'string' }, prompt: { type: 'string' },
          ms: { type: 'integer' }, duration: { type: 'integer' }, assign: { type: 'string', enum: ['distinct', 'same', 'identity'] },
          pool: { description: 'secret: array of strings. choose: one of ' + Object.keys(POOLS).join('|'), anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
          options: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, shared: { type: 'boolean' },
          mode: { type: 'string' }, targetMs: { type: 'integer' }, taunts: { type: 'array', items: { type: 'string' } },
          kind: { type: 'string' }, from: { type: 'string' }, title: { type: 'string' }, slot: { type: 'string' }, per: { type: 'string' },
          who: { type: 'string', enum: ['all', 'subject', 'others', 'leader'] }, label: { type: 'string' }, holdSeconds: { type: 'integer' },
          allowSelf: { type: 'boolean' }, placeholder: { type: 'string' }, maxLen: { type: 'integer' }, lines: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};
