// Realtime connection with auto-reconnect and server-clock estimation.
export class Net {
  constructor({ onState, onOpen, onClose, onMessage }) {
    Object.assign(this, { onState, onOpen, onClose, onMessage });
    this.ws = null; this.queue = []; this.retry = 0; this.token = null; this.code = null;
    this.offset = 0; // serverNow - Date.now()
    this.closedByUs = false;
  }

  connect(token) {
    this.token = token;
    this.closedByUs = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'hello', token: this.token, code: this.code }));
      this.onOpen?.();
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.serverNow) this.offset = m.serverNow - Date.now();
      if (m.t === 'hello_ok') {
        const q = this.queue; this.queue = [];
        q.forEach((x) => ws.send(JSON.stringify(x)));
      }
      if (m.t === 'state') { this.code = m.code; this.onState(m); }
      this.onMessage?.(m);
    };
    ws.onclose = () => {
      this.onClose?.();
      if (this.closedByUs) return;
      const delay = Math.min(8000, 400 * 2 ** this.retry++);
      setTimeout(() => this.connect(this.token), delay);
    };
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  now() { return Date.now() + this.offset; }
  forgetSession() { this.code = null; }
}
