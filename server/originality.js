// Anti-cliché engine. Every event (library or AI-generated) is scored before it runs.
// Score 0-10; anything under MIN_SCORE is rejected unless it was transformed into something stranger.

export const MIN_SCORE = 6;

const CLICHES = [
  [/would you rather/i, 'would-you-rather'],
  [/truth\s*(or|and|&)\s*dare|\bdare\b.*\btruth\b/i, 'truth-or-dare'],
  [/never have i ever/i, 'never-have-i-ever'],
  [/(what'?s|what is) your (favou?rite|biggest|worst|dream)/i, 'favorite-question'],
  [/most likely to/i, 'most-likely-to'],
  [/two truths/i, 'two-truths'],
  [/\bice[- ]?breaker\b|tell us about yourself|fun fact about/i, 'icebreaker'],
  [/\b(charades|pictionary|trivia|quiz|pop quiz|mafia|werewolf|spin the bottle|kings cup|beer pong|flip cup)\b/i, 'classic-party-game'],
  [/\b(take a (sip|drink|shot)|drink (if|when)|finish your drink)\b/i, 'drinking-game'],
  [/\bwho (here )?(is|has|would|can|did)\b.*\?$/i, 'generic-who-question'],
  [/\b(rate|rank) (your|the) /i, 'rating-question'],
  [/\bguess (the|who|what)\b/i, 'generic-guessing'],
];

const SURREAL = /(alien|cosmic|void|portal|moon|planet|galaxy|reality|glitch|creature|council|court|dream|universe|oracle|eye|anomal|black hole|storm|nebula|sun|specimen|experiment|ritual|prophe|summon|quantum|dimension|orbit|signal|machine|ghost|door|floor|species)/i;

const tokens = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));

export function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function eventText(ev) {
  const parts = [ev.title, ev.intro];
  for (const s of ev.steps || []) parts.push(s.text, s.prompt, s.sub, ...(s.pool || []), ...(s.options || []), ...(s.assign || []));
  return parts.filter(Boolean).join(' ');
}

/** @returns {{score:number, reasons:string[]}} */
export function scoreEvent(ev, recent = []) {
  const reasons = [];
  let score = 10;
  const text = eventText(ev);

  for (const [re, label] of CLICHES) {
    if (re.test(text)) {
      score -= 6;
      reasons.push(`cliche:${label}`);
    }
  }

  const steps = ev.steps || [];
  const interactive = steps.filter((s) => !['say', 'reveal', 'verdict'].includes(s.t));
  if (interactive.length === 1 && ['choose', 'point', 'type'].includes(interactive[0].t) && !(ev.world && ev.world !== 'plain')) {
    score -= 4;
    reasons.push('bare-vote');
  }
  if (!SURREAL.test(text)) {
    score -= 2;
    reasons.push('not-surreal');
  }
  if (!ev.world && !steps.some((s) => s.world)) {
    score -= 2;
    reasons.push('no-visual-world');
  }
  for (const r of recent) {
    const sim = Math.max(jaccard(text, eventText(r)), r.id === ev.id ? 1 : 0);
    if (sim > 0.55) {
      score -= 3;
      reasons.push(`too-similar-to:${r.id}`);
      break;
    }
  }
  return { score: Math.max(0, score), reasons };
}

export function isOriginal(ev, recent) {
  const r = scoreEvent(ev, recent);
  return { ok: r.score >= MIN_SCORE, ...r };
}

/** Plain-text check used for AI-written lines (prompts, commentary). */
export function clicheHits(text) {
  return CLICHES.filter(([re]) => re.test(text)).map(([, l]) => l);
}
