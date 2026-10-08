// The living background. One full-screen canvas renders "worlds" (planet, portal, eye, glitch…).
// The environment is part of the game: worlds crossfade, explode, glitch, and react to FX.
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

export class World {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.name = 'alien_planet';
    this.prev = null;
    this.fade = 1;
    this.hue = 150;
    this.targetHue = 150;
    this.intensity = 3;
    this.t = 0;
    this.fxs = [];
    this.pointer = { x: 0.5, y: 0.5 };
    this.stars = Array.from({ length: 170 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), s: rnd(0.4, 1.6) }));
    this.blobs = Array.from({ length: 7 }, (_, i) => ({ a: Math.random() * TAU, r: rnd(0.25, 0.6), sp: rnd(0.02, 0.07) * (i % 2 ? 1 : -1), hue: rnd(-50, 50), size: rnd(0.35, 0.8) }));
    this.quality = 0; // 0 = full, 1/2 = cheaper (adaptive: phones that can't keep up render fewer pixels)
    this.lowPower = false; // ambient moments run at ~30fps to save battery
    this.frames = 0; this.acc = 0; this.lastDraw = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('pointermove', (e) => { this.pointer.x = e.clientX / innerWidth; this.pointer.y = e.clientY / innerHeight; });
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.25) * [1, 0.7, 0.5][this.quality];
    this.W = this.c.width = Math.floor(innerWidth * dpr);
    this.H = this.c.height = Math.floor(innerHeight * dpr);
    this.dpr = dpr;
  }

  setWorld(name) {
    if (!name || name === this.name) return;
    this.prev = this.name;
    this.name = name;
    this.fade = 0;
  }
  setHue(h) { this.targetHue = h; }
  setIntensity(i) { this.intensity = i; }
  setLowPower(v) { this.lowPower = v; }

  fx(kind) {
    const f = { kind, t: 0, dur: { explode: 1.6, alert: 1.1, glitch: 0.9, calm: 2.2, scan: 1.6 }[kind] || 1 };
    if (kind === 'explode') { f.x = rnd(0.3, 0.7); f.y = rnd(0.35, 0.65); }
    this.fxs.push(f);
    const el = document.getElementById('flash');
    if (el) { el.dataset.kind = kind; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
    document.body.classList.remove('shake'); void document.body.offsetWidth;
    if (kind === 'explode' || kind === 'alert' || kind === 'glitch') document.body.classList.add('shake');
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    if (this.lowPower && now - this.lastDraw < 30) return;
    this.lastDraw = now;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    // adaptive quality: sample frame cost, step down fast / step up slowly
    this.acc += dt; this.frames++;
    if (this.frames >= 45) {
      const avg = this.acc / this.frames;
      const target = this.lowPower ? 0.045 : 0.03;
      if (avg > target * 1.15 && this.quality < 2) { this.quality++; this.resize(); }
      this.frames = 0; this.acc = 0;
    }
    this.hue += (((this.targetHue - this.hue + 540) % 360) - 180) * Math.min(1, dt * 1.4);
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / 0.7);
    this.draw(dt);
  }

  draw(dt) {
    const { ctx, W, H } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05020d';
    ctx.fillRect(0, 0, W, H);
    if (this.prev && this.fade < 1) this.layer(this.prev, 1 - this.fade, dt);
    this.layer(this.name, this.fade, dt);
    this.drawFx(dt);
  }

  layer(name, alpha, dt) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    const p = WORLDS[name] || WORLDS.alien_planet;
    const hue = this.hue + (p.hue ?? 0);
    if (!p.noNebula) this.nebula(hue + (p.nebulaHue ?? 0), p.nebula ?? 1);
    this.starfield(hue, p.warp ?? 0.05, dt);
    p.draw?.(this, ctx, this.W, this.H, this.t, hue);
    ctx.restore();
  }

  nebula(hue, strength) {
    const { ctx, W, H, t } = this;
    ctx.globalCompositeOperation = 'lighter';
    const m = Math.max(W, H);
    for (const b of this.blobs) {
      b.a += b.sp * 0.016;
      const x = W / 2 + Math.cos(b.a + t * b.sp) * W * b.r * 0.6;
      const y = H / 2 + Math.sin(b.a * 1.3 + t * b.sp) * H * b.r * 0.55;
      const r = m * b.size * (0.8 + 0.2 * Math.sin(t * 0.3 + b.a));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hsl(hue + b.hue, 85, 52, 0.17 * strength));
      g.addColorStop(1, hsl(hue + b.hue, 85, 40, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  starfield(hue, warp, dt) {
    const { ctx, W, H } = this;
    const cx = W / 2, cy = H / 2;
    const k = (0.6 + this.intensity * 0.18);
    for (const s of this.stars) {
      s.z -= dt * (0.015 + warp * 0.6) * k;
      if (s.z <= 0.02) { s.z = 1; s.x = Math.random(); s.y = Math.random(); }
      const px = cx + (s.x - 0.5) * W * (1 / s.z) * 0.35, py = cy + (s.y - 0.5) * H * (1 / s.z) * 0.35;
      if (px < 0 || px > W || py < 0 || py > H) { s.z = 1; continue; }
      const size = s.s * (1.4 - s.z) * this.dpr;
      ctx.fillStyle = hsl(hue + 60, 40, 88, 0.35 + (1 - s.z) * 0.6);
      if (warp > 0.2) {
        const px2 = cx + (s.x - 0.5) * W * (1 / (s.z + warp * 0.2)) * 0.35, py2 = cy + (s.y - 0.5) * H * (1 / (s.z + warp * 0.2)) * 0.35;
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = size; ctx.beginPath(); ctx.moveTo(px2, py2); ctx.lineTo(px, py); ctx.stroke();
      } else ctx.fillRect(px, py, size, size);
    }
  }

  drawFx(dt) {
    const { ctx, W, H } = this;
    this.fxs = this.fxs.filter((f) => (f.t += dt) < f.dur);
    for (const f of this.fxs) {
      const k = f.t / f.dur;
      if (f.kind === 'explode') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const r = k * Math.max(W, H) * 1.2;
        ctx.strokeStyle = hsl(this.hue + 20, 100, 70, 1 - k); ctx.lineWidth = 30 * (1 - k) * this.dpr;
        ctx.beginPath(); ctx.arc(W * f.x, H * f.y, r, 0, TAU); ctx.stroke();
        ctx.fillStyle = hsl(40, 100, 80, Math.max(0, 0.7 - k * 2)); ctx.fillRect(0, 0, W, H);
        ctx.restore();
      } else if (f.kind === 'scan') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const y = (k * 1.2 - 0.1) * H;
        const g = ctx.createLinearGradient(0, y - 60, 0, y + 60);
        g.addColorStop(0, 'rgba(0,255,170,0)'); g.addColorStop(0.5, 'rgba(120,255,210,0.55)'); g.addColorStop(1, 'rgba(0,255,170,0)');
        ctx.fillStyle = g; ctx.fillRect(0, y - 60, W, 120);
        ctx.restore();
      } else if (f.kind === 'glitch') {
        this.glitchSlices(0.5 + (1 - k) * 0.8);
      } else if (f.kind === 'alert') {
        ctx.save();
        ctx.strokeStyle = `rgba(255,60,90,${(1 - k) * (0.5 + 0.5 * Math.sin(k * 30))})`; ctx.lineWidth = 16 * this.dpr;
        ctx.strokeRect(8, 8, W - 16, H - 16);
        ctx.restore();
      } else if (f.kind === 'calm') {
        ctx.save(); ctx.fillStyle = `rgba(5,2,13,${Math.max(0, 0.45 * (1 - k))})`; ctx.fillRect(0, 0, W, H); ctx.restore();
      }
    }
  }

  glitchSlices(amount) {
    const { ctx, c, W, H } = this;
    const n = Math.floor(4 + amount * 8);
    for (let i = 0; i < n; i++) {
      const y = Math.random() * H, h = rnd(4, 40) * this.dpr, dx = rnd(-60, 60) * amount * this.dpr;
      ctx.drawImage(c, 0, y, W, h, dx, y, W, h);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,0,80,0.07)'; ctx.fillRect(rnd(-8, 8), 0, W, H);
    ctx.fillStyle = 'rgba(0,255,255,0.07)'; ctx.fillRect(rnd(-8, 8), 0, W, H);
    ctx.restore();
  }
}

// ---- world definitions -------------------------------------------------------------------------------
function planet(ctx, cx, cy, r, hue, t, { ring = true, bands = 7, spin = 0.04, lit = 1 } = {}) {
  if (ring) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(-0.35); ctx.scale(1, 0.28);
    ctx.strokeStyle = hsl(hue + 40, 60, 70, 0.35 * lit); ctx.lineWidth = r * 0.22;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.6, Math.PI, TAU); ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
  const base = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  base.addColorStop(0, hsl(hue, 70, 55)); base.addColorStop(1, hsl(hue + 50, 70, 25));
  ctx.fillStyle = base; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  for (let i = 0; i < bands; i++) {
    const y = cy - r + ((i / bands + t * spin) % 1) * r * 2;
    ctx.fillStyle = hsl(hue + 25 * Math.sin(i * 2.3), 70, 60, 0.28);
    ctx.fillRect(cx - r, y, r * 2, r * 2 / bands * (0.5 + 0.5 * Math.sin(i * 1.7 + t * 0.3)));
  }
  const sh = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.4, r * 0.1, cx, cy, r * 1.1);
  sh.addColorStop(0, 'rgba(255,255,255,0.28)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = sh; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  if (ring) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(-0.35); ctx.scale(1, 0.28);
    ctx.strokeStyle = hsl(hue + 40, 60, 75, 0.55 * lit); ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI); ctx.stroke();
    ctx.restore();
  }
  const glow = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.6);
  glow.addColorStop(0, hsl(hue, 90, 60, 0.25)); glow.addColorStop(1, hsl(hue, 90, 60, 0));
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, r * 1.6, 0, TAU); ctx.fill();
}

function rings(ctx, cx, cy, n, maxR, hue, t, { speed = 0.35, width = 5, spiral = 0.4 } = {}) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const k = ((i / n + t * speed) % 1);
    const r = k * maxR;
    ctx.strokeStyle = hsl(hue + k * 120, 95, 60, (1 - k) * 0.9);
    ctx.lineWidth = Math.max(1, width * (1 - k * 0.6));
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.92 + 0.08 * Math.sin(t + i)), t * spiral + i * 0.3, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

const WORLDS = {
  alien_planet: {
    warp: 0.03,
    draw(w, ctx, W, H, t, hue) {
      planet(ctx, W * 0.5, H * 0.58 + Math.sin(t * 0.4) * H * 0.01, Math.min(W, H) * 0.34, hue, t);
      planet(ctx, W * 0.12, H * 0.18, Math.min(W, H) * 0.06, hue + 140, t * 2, { ring: false, bands: 4 });
    },
  },
  alien_lab: {
    hue: -30, warp: 0.02,
    draw(w, ctx, W, H, t, hue) {
      ctx.save();
      ctx.strokeStyle = hsl(hue + 20, 90, 55, 0.35); ctx.lineWidth = 1 * w.dpr;
      const hor = H * 0.5;
      for (let i = 0; i < 18; i++) { const y = hor + Math.pow(((i / 18 + t * 0.08) % 1), 2.2) * (H - hor); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 8, hor); ctx.lineTo(W / 2 + i * W * 0.14, H); ctx.stroke(); }
      for (let i = 0; i < 5; i++) {
        const x = W * (0.12 + i * 0.19), y = H * (0.2 + 0.1 * Math.sin(t * 0.6 + i)), r = Math.min(W, H) * 0.045;
        ctx.strokeStyle = hsl(hue + 40, 90, 70, 0.6); ctx.beginPath();
        for (let k = 0; k < 6; k++) ctx.lineTo(x + Math.cos(k * TAU / 6 + t * 0.3) * r, y + Math.sin(k * TAU / 6 + t * 0.3) * r);
        ctx.closePath(); ctx.stroke();
      }
      const sy = ((t * 0.18) % 1) * H;
      const g = ctx.createLinearGradient(0, sy - 30, 0, sy + 30);
      g.addColorStop(0, hsl(hue, 100, 60, 0)); g.addColorStop(0.5, hsl(hue, 100, 70, 0.18)); g.addColorStop(1, hsl(hue, 100, 60, 0));
      ctx.fillStyle = g; ctx.fillRect(0, sy - 30, W, 60);
      ctx.restore();
    },
  },
  portal: {
    warp: 0.25,
    draw(w, ctx, W, H, t, hue) {
      const cx = W / 2, cy = H * 0.46, R = Math.min(W, H) * 0.62;
      rings(ctx, cx, cy, 16, R, hue, t, { speed: 0.12 + w.intensity * 0.02, width: 7 });
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.28);
      g.addColorStop(0, hsl(hue + 30, 100, 92, 0.95)); g.addColorStop(0.35, hsl(hue + 60, 100, 60, 0.45)); g.addColorStop(1, hsl(hue, 100, 40, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    },
  },
  tunnel: {
    warp: 0.5,
    draw(w, ctx, W, H, t, hue) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 22; i++) {
        const k = (i / 22 + t * 0.18) % 1, s = Math.pow(k, 2.4) * Math.max(W, H) * 0.95;
        ctx.strokeStyle = hsl(hue + k * 160, 90, 58, 1 - k); ctx.lineWidth = 2 + k * 5;
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(t * 0.2 + k * 1.3);
        ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.restore();
      }
      ctx.restore();
    },
  },
  eye: {
    hue: -60, warp: 0.02,
    draw(w, ctx, W, H, t, hue) {
      const cx = W / 2, cy = H * 0.44, rx = Math.min(W * 0.46, H * 0.4), ry = rx * 0.52;
      const look = { x: (w.pointer.x - 0.5) * rx * 0.5 + Math.sin(t * 0.7) * rx * 0.18, y: (w.pointer.y - 0.5) * ry * 0.4 + Math.cos(t * 0.5) * ry * 0.1 };
      const blink = Math.max(0, 1 - Math.pow(Math.max(0, Math.sin(t * 0.37)), 60) * 1.0);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry * blink + 2, 0, 0, TAU); ctx.clip();
      const sc = ctx.createRadialGradient(cx, cy, ry * 0.2, cx, cy, rx);
      sc.addColorStop(0, '#f6ffe8'); sc.addColorStop(1, hsl(hue + 20, 60, 70)); ctx.fillStyle = sc; ctx.fillRect(0, 0, W, H);
      const ir = ry * 0.88, ix = cx + look.x, iy = cy + look.y;
      const ig = ctx.createRadialGradient(ix, iy, ir * 0.1, ix, iy, ir);
      ig.addColorStop(0, hsl(hue + 120, 100, 55)); ig.addColorStop(0.7, hsl(hue + 180, 100, 35)); ig.addColorStop(1, hsl(hue + 220, 100, 15));
      ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(ix, iy, ir, 0, TAU); ctx.fill();
      ctx.strokeStyle = hsl(hue + 100, 100, 70, 0.35); ctx.lineWidth = 1.5 * w.dpr;
      for (let i = 0; i < 48; i++) { const a = i / 48 * TAU + t * 0.05; ctx.beginPath(); ctx.moveTo(ix + Math.cos(a) * ir * 0.3, iy + Math.sin(a) * ir * 0.3); ctx.lineTo(ix + Math.cos(a) * ir, iy + Math.sin(a) * ir); ctx.stroke(); }
      const pw = ir * (0.16 + 0.08 * Math.sin(t * 1.3));
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(ix, iy, pw, ir * 0.82, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(ix - ir * 0.3, iy - ir * 0.3, ir * 0.09, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = hsl(hue, 80, 60, 0.8); ctx.lineWidth = 4 * w.dpr; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry * blink + 2, 0, 0, TAU); ctx.stroke();
    },
  },
  blackhole: {
    hue: 30, warp: 0.08,
    draw(w, ctx, W, H, t, hue) {
      const cx = W / 2, cy = H * 0.45, r = Math.min(W, H) * 0.2;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.3); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 28; i++) {
        const k = i / 28, rr = r * (1.3 + k * 2.4);
        ctx.strokeStyle = hsl(hue + k * 40, 100, 55 + k * 15, (1 - k) * 0.6); ctx.lineWidth = r * 0.07;
        ctx.save(); ctx.scale(1, 0.26); ctx.beginPath(); ctx.arc(0, 0, rr, t * (2 - k) + k * 6, t * (2 - k) + k * 6 + TAU * 0.78); ctx.stroke(); ctx.restore();
      }
      ctx.restore();
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.3);
      g.addColorStop(0, '#000'); g.addColorStop(0.75, '#000'); g.addColorStop(1, hsl(hue, 100, 60, 0.0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 1.3, 0, TAU); ctx.fill();
      ctx.strokeStyle = hsl(hue, 100, 80, 0.8); ctx.lineWidth = 2 * w.dpr; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    },
  },
  glitch: {
    warp: 0.1,
    draw(w, ctx, W, H, t, hue) {
      ctx.save();
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = hsl(hue + rnd(0, 360), 100, 55, rnd(0.05, 0.3));
        ctx.fillRect(rnd(0, W), rnd(0, H), rnd(20, W * 0.5), rnd(2, 30) * w.dpr);
      }
      ctx.restore();
      if (Math.random() < 0.7) w.glitchSlices(0.6 + w.intensity * 0.1);
    },
  },
  nebula: { warp: 0.06, nebula: 1.8, draw() {} },
  court: {
    hue: 150, warp: 0.01, nebula: 0.8,
    draw(w, ctx, W, H, t, hue) {
      for (let i = 0; i < 6; i++) {
        const x = W * (0.08 + i * 0.17), top = H * 0.12;
        const g = ctx.createLinearGradient(x, 0, x + W * 0.06, 0);
        g.addColorStop(0, hsl(hue, 60, 8, 0.9)); g.addColorStop(0.5, hsl(hue + 10, 70, 24, 0.9)); g.addColorStop(1, hsl(hue, 60, 6, 0.9));
        ctx.fillStyle = g; ctx.fillRect(x, top, W * 0.06, H - top);
      }
      const mr = Math.min(W, H) * 0.14, mx = W / 2, my = H * 0.24 + Math.sin(t * 0.4) * 6;
      const g = ctx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 2);
      g.addColorStop(0, hsl(hue + 40, 100, 70, 0.9)); g.addColorStop(0.4, hsl(hue + 30, 100, 50, 0.35)); g.addColorStop(1, hsl(hue, 100, 30, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, mr * 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#05020d'; ctx.beginPath(); ctx.arc(mx + mr * 0.35, my - mr * 0.1, mr * 0.95, 0, TAU); ctx.fill();
    },
  },
  dream: {
    hue: 40, warp: 0.02, nebula: 1.5,
    draw(w, ctx, W, H, t, hue) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i++) {
        const x = W * (0.5 + 0.38 * Math.sin(t * 0.17 + i * 1.7)), y = H * (0.5 + 0.34 * Math.cos(t * 0.13 + i * 2.3)), r = Math.min(W, H) * (0.18 + 0.08 * Math.sin(t * 0.4 + i));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, hsl(hue + i * 38, 90, 70, 0.28)); g.addColorStop(1, hsl(hue + i * 38, 90, 60, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
      ctx.restore();
      planet(ctx, W * 0.72, H * 0.3, Math.min(W, H) * 0.09, hue + 90, t, { ring: false, bands: 5, spin: 0.1 });
    },
  },
  void: {
    noNebula: true, warp: 0.0,
    draw(w, ctx, W, H, t, hue) {
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.9)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(t * 2)})`; ctx.beginPath(); ctx.arc(W / 2, H * 0.42, 3 * w.dpr, 0, TAU); ctx.fill();
      ctx.strokeStyle = hsl(hue, 60, 60, 0.12 + 0.08 * Math.sin(t)); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(W / 2, H * 0.42, 40 * w.dpr + Math.sin(t * 0.8) * 8, 0, TAU); ctx.stroke();
    },
  },
  red_planet: {
    hue: -160, warp: 0.04,
    draw(w, ctx, W, H, t) {
      planet(ctx, W * 0.5, H * 0.5, Math.min(W, H) * 0.3, 355, t, { ring: false, bands: 6, spin: 0.03 });
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.min(W, H) * (0.6 + 0.04 * Math.sin(t * 3)));
      g.addColorStop(0, 'rgba(255,40,60,0.18)'); g.addColorStop(1, 'rgba(255,40,60,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    },
  },
  storm: {
    hue: 20, warp: 0.35, nebula: 1.2,
    draw(w, ctx, W, H, t, hue) {
      if (Math.random() < 0.06 + w.intensity * 0.02) {
        ctx.save(); ctx.strokeStyle = 'rgba(230,240,255,0.95)'; ctx.shadowColor = hsl(hue + 200, 100, 70); ctx.shadowBlur = 20; ctx.lineWidth = 3 * w.dpr;
        let x = rnd(0.1, 0.9) * W, y = 0; ctx.beginPath(); ctx.moveTo(x, y);
        while (y < H * rnd(0.5, 1)) { x += rnd(-60, 60) * w.dpr; y += rnd(30, 70) * w.dpr; ctx.lineTo(x, y); }
        ctx.stroke(); ctx.restore();
        ctx.fillStyle = 'rgba(200,220,255,0.08)'; ctx.fillRect(0, 0, W, H);
      }
    },
  },
  sun: {
    hue: 70, warp: 0.02,
    draw(w, ctx, W, H, t, hue) {
      const cx = W / 2, cy = H * 0.42, r = Math.min(W, H) * 0.2;
      ctx.save(); ctx.translate(cx, cy); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 36; i++) {
        const a = i / 36 * TAU + t * 0.1, len = r * (1.6 + 0.6 * Math.sin(t * 2 + i));
        ctx.strokeStyle = hsl(hue + 10, 100, 65, 0.25); ctx.lineWidth = 6 * w.dpr; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a) * len * 1.8, Math.sin(a) * len * 1.8); ctx.stroke();
      }
      ctx.restore();
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2);
      g.addColorStop(0, hsl(hue, 100, 90)); g.addColorStop(0.35, hsl(hue, 100, 60, 0.9)); g.addColorStop(1, hsl(hue - 20, 100, 50, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 2.2, 0, TAU); ctx.fill();
    },
  },
};
