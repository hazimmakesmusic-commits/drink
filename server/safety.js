// Guard rails for anything the AI generates or players type.
// Content rules: absurd, never dangerous. No drug/alcohol instructions, no stunts,
// no violence/self-harm, no sexual content, no slurs/harassment.
import leo from 'leo-profanity';

const DANGEROUS = [
  /\b(kill|murder|stab|shoot|strangle|choke|hang)\s+(yourself|him|her|them|someone|somebody|each other)\b/i,
  /\bsuicide\b|\bself[- ]?harm\b|\bcut (yourself|your wrists?)\b|\bkys\b/i,
  /\b(rape|molest|grope|nude|naked|strip|sexual|sex)\b/i,
  /\b(jump|leap|dive|climb|hang)\s+(off|from|out of|onto)\b/i,
  /\b(balcony|rooftop|roof|window ledge|ledge|traffic|highway|knife|knives|blade|gun|lighter|flame|fire ?work|stove|oven)\b/i,
  /\b(drive|driving|behind the wheel)\b/i,
  /\b(chug|shotgun|do a shot|take a shot|bottoms up|finish your drink|smoke|vape|inhale|snort|inject|swallow (pills?|a pill)|weed|joint|blunt|bong|edible|cocaine|molly|lsd|acid trip|get (drunk|high|wasted))\b/i,
  /\b(steal|shoplift|trespass|break into|vandalize|spray[- ]?paint)\b/i,
  /\b(hold your breath|faint|pass out|choke|suffocate)\b/i,
];

const ENV_THREATS = /ignore (all|any|previous) instructions|system prompt|as an ai language model/i;

export function isSafe(text) {
  if (typeof text !== 'string') return false;
  if (DANGEROUS.some((r) => r.test(text))) return false;
  if (ENV_THREATS.test(text)) return false;
  if (leo.check(text)) return false;
  return true;
}

// Player-typed text is shown to the whole room. Strip junk and mask profanity (don't reject).
export function cleanUserText(text, max = 80) {
  let t = String(text ?? '').replace(/[\u0000-\u001f\u007f<>{}]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max).trim();
  return leo.clean(t);
}

export function cleanName(text, max = 16) {
  return cleanUserText(text, max).replace(/[{}]/g, '');
}
