// Session memory. Lives only as long as the session (nothing is persisted between sessions in V1).

export class Memory {
  constructor() {
    this.events = []; // {id,title,at,mechanics,summary}
    this.players = new Map(); // pid -> stats
    this.jokes = [];
    this.prophecies = []; // {pid,name,text,atEvent}
    this.mechanics = {};
    this.done = new Set(); // one-shot event ids (e.g. council)
    this.suns = [];
  }

  get eventCount() { return this.events.length; }

  p(pid, name) {
    let s = this.players.get(pid);
    if (!s) {
      s = { name: name || pid, chosen: 0, wins: 0, losses: 0, participated: 0, missed: 0, alias: null, aliasUntil: 0, lastRoasted: -9 };
      this.players.set(pid, s);
    }
    if (name) s.name = name;
    return s;
  }

  alias(pid) {
    const s = this.players.get(pid);
    return s && s.alias && this.eventCount <= s.aliasUntil ? s.alias : null;
  }

  setAlias(pid, alias, forEvents = 3) {
    const s = this.p(pid);
    s.alias = alias;
    s.aliasUntil = this.eventCount + forEvents;
  }

  noteChosen(pid) { this.p(pid).chosen++; }
  noteWin(pid) { this.p(pid).wins++; }
  noteLoss(pid) { this.p(pid).losses++; }
  noteParticipation(pid, did) { const s = this.p(pid); did ? s.participated++ : s.missed++; }
  addJoke(text) { if (text && !this.jokes.includes(text)) this.jokes.push(text); if (this.jokes.length > 8) this.jokes.shift(); }
  noteMechanic(m) { this.mechanics[m] = (this.mechanics[m] || 0) + 1; }

  mostChosen() {
    let best = null;
    for (const [pid, s] of this.players) if (!best || s.chosen > best.s.chosen) best = { pid, s };
    return best && best.s.chosen > 0 ? { pid: best.pid, name: best.s.name, count: best.s.chosen } : null;
  }

  quietest() {
    let best = null;
    for (const [pid, s] of this.players) {
      const ratio = s.missed - s.participated;
      if (!best || ratio > best.ratio) best = { pid, name: s.name, ratio };
    }
    return best;
  }

  /** Compact digest handed to the LLM so it can make callbacks. */
  digest() {
    const lines = [];
    lines.push(`Events so far (${this.eventCount}): ${this.events.slice(-6).map((e) => `${e.title}${e.summary ? ` [${e.summary}]` : ''}`).join(' | ') || 'none yet'}`);
    const ps = [...this.players.values()].map((s) => `${s.name}: chosen ${s.chosen}x, wins ${s.wins}, losses ${s.losses}, ignored-event ${s.missed}x${s.alias && this.eventCount <= s.aliasUntil ? `, currently called "${s.alias}"` : ''}`);
    if (ps.length) lines.push('Players -> ' + ps.join('; '));
    if (this.jokes.length) lines.push('Running jokes: ' + this.jokes.join(' / '));
    if (this.prophecies.length) lines.push('Prophecies on record: ' + this.prophecies.map((x) => `${x.name} said "${x.text}"`).join(' / '));
    return lines.join('\n');
  }
}
