// Tiny DOM helpers (no framework, no build step).
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

/** Types text into `el` with a glitchy reveal. Returns a cancel fn. */
export function typewriter(el, text, { cps = 38, onDone } = {}) {
  el.textContent = '';
  const chars = [...String(text)];
  let i = 0, stopped = false;
  const step = () => {
    if (stopped) return;
    i = Math.min(chars.length, i + Math.max(1, Math.round(cps / 30)));
    el.textContent = chars.slice(0, i).join('');
    if (i < chars.length) timer = setTimeout(step, 1000 / 30);
    else onDone?.();
  };
  let timer = setTimeout(step, 30);
  return () => { stopped = true; clearTimeout(timer); el.textContent = chars.join(''); };
}

export const vibrate = (p) => { try { navigator.vibrate?.(p); } catch { /* unsupported */ } };

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
