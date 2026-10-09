import type { World } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function store(key: string, val?: string): string | null {
  try {
    if (val !== undefined) localStorage.setItem(key, val);
    return localStorage.getItem(key);
  } catch {
    return null; // private mode etc.: everything still works, just not remembered
  }
}

export class UI {
  root = $('ui');
  private mark = $('mark');
  private name = $('worldname');
  private hint = $('hint');
  private snd = $<HTMLButtonElement>('snd');
  private vol = $<HTMLInputElement>('vol');
  private calm = $<HTMLButtonElement>('calm');
  private tools = $('tools');
  private buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#worlds button'));
  private idleTimer = 0;
  private nameTimer = 0;
  private hintTimer = 0;
  private hintShown = false;

  constructor(h: {
    onWorld(i: number): void;
    onSound(): void;
    onVolume(v: number): void;
    onCalm(): void;
  }) {
    this.buttons.forEach((b, i) => b.addEventListener('click', () => h.onWorld(i)));
    this.snd.addEventListener('click', h.onSound);
    this.vol.addEventListener('input', () => h.onVolume(parseFloat(this.vol.value)));
    this.calm.addEventListener('click', h.onCalm);
    const wake = () => this.wake();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('keydown', wake);
    this.wake();
  }

  /** Controls drift back out of sight after a few seconds. */
  wake() {
    this.root.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.root.classList.add('idle'), 3800);
  }

  touching(on: boolean) {
    this.root.classList.toggle('touching', on);
    if (!on) this.wake();
  }

  setWorld(i: number, w: World, announce = true) {
    this.buttons.forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
    document.documentElement.style.setProperty('--accent', w.accent);
    if (announce) {
      this.name.textContent = w.name;
      this.name.classList.add('show');
      clearTimeout(this.nameTimer);
      this.nameTimer = window.setTimeout(() => this.name.classList.remove('show'), 3600);
    }
  }

  setSound(on: boolean) {
    this.snd.setAttribute('aria-pressed', String(on));
    this.snd.title = on ? 'Sound on' : 'Sound off';
    this.tools.classList.toggle('snd-on', on);
  }
  setVolumeValue(v: number) { this.vol.value = String(v); }
  hideSound() { this.snd.hidden = true; this.vol.hidden = true; }
  setCalm(on: boolean) {
    this.calm.setAttribute('aria-pressed', String(on));
    this.calm.title = on ? 'Intensity reduced' : 'Reduce intensity';
  }

  /** One-time, quiet hint. Never shown again after the first real touch. */
  showHint() {
    if (store('void.seen') === '1' || this.hintShown) return;
    this.hintShown = true;
    this.hintTimer = window.setTimeout(() => {
      this.hint.classList.add('show');
      this.hintTimer = window.setTimeout(() => this.hint.classList.remove('show'), 8000);
    }, 2600);
  }
  dismissHint() {
    clearTimeout(this.hintTimer);
    this.hint.classList.remove('show');
    store('void.seen', '1');
  }

  fadeMark(v: number) { this.mark.style.opacity = String(v); }
}
