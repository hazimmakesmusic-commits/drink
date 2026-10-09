// Lightweight gesture system: tap, double-tap, drag, press-and-hold, swipe, two-finger swipe.
// All via Pointer Events so mouse, touch and pen behave the same.

interface P { id: number; sx: number; sy: number; x: number; y: number }

export interface GestureHandlers {
  tap(x: number, y: number): void;
  double(x: number, y: number): void;
  holdStart(x: number, y: number): void;
  holdEnd(x: number, y: number, energy: number): void;
  drag(dx: number, dy: number): void;
  swipe(vx: number, vy: number): void;
  worldSwipe(dir: number): void;
  firstTouch(): void;
}

const HOLD_MS = 260;
const MOVE_PX = 10;

export class Gestures {
  x = 0; y = 0; // smoothed NDC
  private tx = 0; private ty = 0;
  down = false;
  holding = false;
  energy = 0;
  private pts = new Map<number, P>();
  private t0 = 0;
  private moved = false;
  private multi = false;
  private multiStart = { x: 0, y: 0 };
  private lastTap = { t: -1e9, x: 0, y: 0 };
  private vx = 0; private vy = 0; private lastMoveT = 0;
  private holdPos = { x: 0, y: 0 };
  private touched = false;

  constructor(private el: HTMLElement, private h: GestureHandlers) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private ndc(px: number, py: number) {
    const r = this.el.getBoundingClientRect();
    return { x: ((px - r.left) / r.width) * 2 - 1, y: -(((py - r.top) / r.height) * 2 - 1) };
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!this.touched) { this.touched = true; this.h.firstTouch(); }
    this.pts.set(e.pointerId, { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY });
    if (this.pts.size === 1) {
      this.t0 = performance.now();
      this.moved = false; this.multi = false; this.down = true;
      this.vx = this.vy = 0;
      this.lastMoveT = this.t0;
      const n = this.ndc(e.clientX, e.clientY);
      this.tx = n.x; this.ty = n.y;
      this.holdPos = n;
    } else if (this.pts.size === 2) {
      // a second finger cancels any single-finger gesture and starts a world-swipe
      if (this.holding) this.endHold(true);
      this.multi = true;
      this.multiStart = this.centroid();
    }
  };

  private centroid() {
    let x = 0, y = 0;
    this.pts.forEach((p) => { x += p.x; y += p.y; });
    return { x: x / this.pts.size, y: y / this.pts.size };
  }

  private onMove = (e: PointerEvent) => {
    const p = this.pts.get(e.pointerId);
    const n = this.ndc(e.clientX, e.clientY);
    if (!p) { // mouse hover: gently steer the camera
      if (!this.down) { this.tx = n.x; this.ty = n.y; }
      return;
    }
    e.preventDefault();
    const dxp = e.clientX - p.x, dyp = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.multi) return;
    this.tx = n.x; this.ty = n.y;
    const dist = Math.hypot(p.x - p.sx, p.y - p.sy);
    if (!this.moved && dist > MOVE_PX) this.moved = true;
    const now = performance.now();
    const dtm = Math.max(1, now - this.lastMoveT);
    this.lastMoveT = now;
    this.vx = this.vx * 0.6 + (dxp / dtm) * 0.4;
    this.vy = this.vy * 0.6 + (dyp / dtm) * 0.4;
    if (this.holding) { this.holdPos = n; return; }
    if (this.moved) {
      const r = this.el.getBoundingClientRect();
      this.h.drag((dxp / r.width) * 2, -(dyp / r.height) * 2);
    }
  };

  private onUp = (e: PointerEvent) => {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    this.pts.delete(e.pointerId);
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this.multi) {
      if (this.pts.size === 0) {
        const dx = p.x - this.multiStart.x, dy = p.y - this.multiStart.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) this.h.worldSwipe(dx < 0 ? 1 : -1);
        this.multi = false; this.down = false;
      }
      return;
    }
    this.down = false;
    const n = this.ndc(e.clientX, e.clientY);
    const dur = performance.now() - this.t0;
    if (this.holding) { this.endHold(false); return; }
    if (!this.moved && dur < 420) {
      const now = performance.now();
      const dd = Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y);
      if (now - this.lastTap.t < 340 && dd < 48) {
        this.lastTap.t = -1e9;
        this.h.double(n.x, n.y);
      } else {
        this.lastTap = { t: now, x: e.clientX, y: e.clientY };
        this.h.tap(n.x, n.y);
      }
    } else if (this.moved) {
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 0.8 && performance.now() - this.lastMoveT < 90) {
        const r = this.el.getBoundingClientRect();
        // px/ms -> NDC/s
        this.h.swipe((this.vx * 1000 / r.width) * 2, -(this.vy * 1000 / r.height) * 2);
      }
    }
  };

  private onCancel = (e: PointerEvent) => {
    this.pts.delete(e.pointerId);
    if (this.holding) this.endHold(true);
    if (this.pts.size === 0) { this.down = false; this.multi = false; }
  };

  private endHold(cancel: boolean) {
    const e = this.energy;
    this.holding = false;
    this.energy = 0;
    this.h.holdEnd(this.holdPos.x, this.holdPos.y, cancel ? 0 : e);
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 6);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    if (this.down && !this.multi && !this.holding && !this.moved && performance.now() - this.t0 > HOLD_MS) {
      this.holding = true;
      this.h.holdStart(this.holdPos.x, this.holdPos.y);
    }
    if (this.holding) {
      // ease-out accumulation over ~2s
      this.energy = Math.min(1, this.energy + dt / 2.0 * (1.2 - this.energy * 0.6));
    }
  }
  get holdPoint() { return this.holdPos; }
}
