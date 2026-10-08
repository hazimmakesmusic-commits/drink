// Thin Anthropic Messages API client (fetch only, no SDK). Returns null on any failure so
// callers can fall back to the built-in content engine — the app is fully playable offline.

const API = 'https://api.anthropic.com/v1/messages';

export const llmEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
const model = () => process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

async function call(body, timeoutMs) {
  if (!llmEnabled()) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(API, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: model(), ...body }),
    });
    if (!res.ok) {
      console.warn('[llm] http', res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('[llm] error', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Free-text generation. */
export async function text({ system, prompt, maxTokens = 160, timeoutMs = 4500 }) {
  const j = await call({ max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }, timeoutMs);
  const out = j?.content?.find((b) => b.type === 'text')?.text?.trim();
  return out || null;
}

/** Structured generation: the model must call `tool` with input matching `schema`. */
export async function structured({ system, prompt, name, description, schema, maxTokens = 1400, timeoutMs = 12000 }) {
  const j = await call(
    {
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ name, description, input_schema: schema }],
      tool_choice: { type: 'tool', name },
    },
    timeoutMs,
  );
  return j?.content?.find((b) => b.type === 'tool_use')?.input ?? null;
}
