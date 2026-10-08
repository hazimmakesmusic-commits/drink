// The AI host: personality, generated content slots, commentary, whispers, and novel-event creation.
// Everything has a built-in fallback so the room is never left waiting on a network call.
import { getPersona, INTENSITY_LABELS, ROAST_LABELS } from './personas.js';
import { FALLBACKS, SLOT_BRIEFS, pick } from './content.js';
import * as llm from './llm.js';
import { isSafe } from './safety.js';
import { clicheHits, isOriginal } from './originality.js';
import { LLM_EVENT_SCHEMA, normalizeEvent, STEP_SPECS } from './schema.js';

export const fill = (tpl, vars = {}) =>
  String(tpl).replace(/\{([a-z0-9_.]+)\}/gi, (_, k) => (vars[k] ?? vars[k.split('.').pop()] ?? 'someone'));

const INTENSITY_NOTES = [
  '',
  'Gentle weirdness. Soft surrealism. Barely any roasting.',
  'Clearly weird, still cozy.',
  'Properly chaotic. Confident non-sequiturs.',
  'Unhinged. Escalating absurdity, rapid tonal shifts.',
  'Absolutely insane. Maximum surreal. Reality is a suggestion. Still harmless.',
];

export class Host {
  constructor(session) {
    this.s = session;
    this.last = {}; // anti-repeat for banks
  }

  get persona() { return getPersona(this.s.settings.persona); }
  get intensity() { return this.s.settings.intensity; }

  systemPrompt(extra = '') {
    const { settings: st, mem } = this.s;
    return [
      this.persona.voice,
      `You live inside a room of ${this.s.players.size} friends (18+) hanging out; you speak through their phones.`,
      `Intensity ${st.intensity}/5 (${INTENSITY_LABELS[st.intensity]}): ${INTENSITY_NOTES[st.intensity]}`,
      `Vibes requested: ${st.vibes.join(', ') || 'chaos'}.`,
      `Roast level ${st.roast}/3 (${ROAST_LABELS[st.roast]}). Roast only harmless choices/reflexes/vibes. NEVER target bodies, identity, relationships, or anything cruel.`,
      'HARD RULES: absurd but never dangerous. No instructions involving alcohol, drugs, smoking, driving, climbing, fire, sharp objects, stunts, holding breath, or anything illegal or sexual. No violence or self-harm. No slurs. Never ask people to do anything physically risky.',
      'NEVER produce classic party-game formats: no Would You Rather, Truth or Dare, Never Have I Ever, favourite-x questions, trivia, icebreakers, charades, or drinking-game rules.',
      'Do not sound like a helpful assistant. No emojis unless it fits. Output only the requested text.',
      'Session memory:\n' + mem.digest(),
      extra,
    ].filter(Boolean).join('\n');
  }

  // ---- banks (offline personality) -----------------------------------------------------------
  line(bank, vars = {}) {
    const arr = this.persona[bank] || [];
    if (!arr.length) return '';
    let tries = 0, choice;
    do { choice = pick(arr); } while (choice === this.last[bank] && arr.length > 1 && ++tries < 4);
    this.last[bank] = choice;
    return fill(choice, { n: this.s.players.size, ...vars });
  }

  intro() { return this.persona.intro.map((l) => fill(l, { n: this.s.players.size })); }
  stinger() { return this.line('stinger'); }
  outro() { return this.line('outro'); }
  whisper() { return this.line('whisper'); }

  // ---- slots (generated text embedded in event steps) ---------------------------------------
  async gen(slot, ctx = {}) {
    const vars = ctx.vars || {};
    const fb = FALLBACKS[slot];
    const fallback = () => (fb ? fb({ ...ctx, vars, rng: ctx.rng || Math.random, mem: this.s.memoryFacts(), players: this.s.playerNames() }) : FALLBACKS.free());
    if (ctx.fallbackOnly || !llm.llmEnabled() || !SLOT_BRIEFS[slot]) return fallback();
    const brief = fill(SLOT_BRIEFS[slot], { ...vars, words: (vars.words || []).join(', ') });
    const out = await llm.text({
      system: this.systemPrompt(),
      prompt: `${brief}\nContext: ${JSON.stringify({ event: ctx.event, subject: vars.subject, leader: vars.leader, last: vars.last, players: this.s.playerNames() })}\nReturn only the text, nothing else.`,
      maxTokens: 120,
      timeoutMs: 3500,
    });
    const clean = out?.replace(/^["'\s]+|["'\s]+$/g, '');
    if (!clean || clean.length > 240 || !isSafe(clean) || clicheHits(clean).length) return fallback();
    return clean;
  }

  // ---- commentary after an event --------------------------------------------------------------
  async commentary(summary) {
    const fallback = () => this.fallbackCommentary(summary);
    if (!llm.llmEnabled()) return fallback();
    const out = await llm.text({
      system: this.systemPrompt('You just finished running an event. React in 1-2 short lines. Make a callback to earlier events/running jokes when it fits. If roast level > 0 you may playfully roast the loser/subject.'),
      prompt: `Event: ${summary.title}\nWhat happened: ${summary.bullets.join(' ')}\nLeader: ${summary.leader || 'n/a'}. Last: ${summary.last || 'n/a'}. Subject: ${summary.subject || 'n/a'}.\nMax 40 words total. Output only your lines, separated by a newline.`,
      maxTokens: 140,
      timeoutMs: 4000,
    });
    const lines = out?.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);
    if (!lines?.length || !lines.every((l) => l.length < 200 && isSafe(l))) return fallback();
    return lines;
  }

  fallbackCommentary(sm) {
    const v = { leader: sm.leader, last: sm.last, subject: sm.subject, event: sm.title };
    const lines = [];
    if (sm.leader && sm.last && sm.leader !== sm.last) lines.push(this.line('win', v));
    else if (sm.last) lines.push(this.line('lose', v));
    else if (sm.leader) lines.push(this.line('win', v));
    else lines.push(this.line('generic', v));
    const m = this.s.mem.mostChosen();
    if (m && m.count >= 2 && Math.random() < 0.5) lines.push(`Note: ${m.name} has now been chosen ${m.count} times. This is not a coincidence. It is a pattern.`);
    else if (this.s.settings.roast > 0 && sm.last && Math.random() < 0.18 * this.s.settings.roast) lines.push(this.line('roast', { subject: sm.last }));
    else if (Math.random() < 0.5) lines.push(this.line('generic', v));
    return lines.slice(0, 2);
  }

  // ---- novel event generation (LLM only) ------------------------------------------------------
  async novelEvent(recent) {
    if (!llm.llmEnabled()) return null;
    const stepDocs = Object.entries(STEP_SPECS).map(([t, spec]) => `${t}(${Object.keys(spec).join(', ')})`).join('; ');
    const raw = await llm.structured({
      system: this.systemPrompt(),
      name: 'create_event',
      description: 'Create one brand-new surreal interactive event built ONLY from the available step primitives.',
      schema: LLM_EVENT_SCHEMA,
      prompt: [
        'Invent a NEW event the group has not seen. Combine primitives in a surprising way: ' + stepDocs + '.',
        'Players: ' + this.s.playerNames().join(', ') + '. Use {subject}, {leader}, {last}, {p1}..{p3} placeholders for names and {{crime}}-style slots (crime, evidence, sentence, species, ritual, creature, readout, cosmic_name, door_result, dream_line, conclusion, law) for generated text.',
        'Recent events (do NOT resemble): ' + recent.slice(-6).map((e) => e.title).join(', '),
        'Rules: 3-6 steps, at least one interactive, must end with a reveal or verdict. Be genuinely strange. Honest originality self-score.',
      ].join('\n'),
    });
    if (!raw || (raw.originality ?? 0) < 7) return null;
    try {
      const ev = normalizeEvent({ ...raw, source: 'ai', id: `ai_${Date.now().toString(36)}` }, { strict: true });
      const verdict = isOriginal(ev, recent);
      if (!verdict.ok) {
        console.warn('[host] rejected AI event', ev.title, verdict.reasons);
        return null;
      }
      return ev;
    } catch (e) {
      console.warn('[host] invalid AI event:', e.message);
      return null;
    }
  }
}
