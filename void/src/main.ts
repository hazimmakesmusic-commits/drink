import * as THREE from 'three';
import { AudioEngine } from './audio';
import { Gestures } from './input';
import { PostStack } from './post';
import { UI, store } from './ui';
import { damp } from './fx';
import type { Ctx, Quality, World } from './types';
import { LiquidDream } from './worlds/liquid';
import { CosmicJelly } from './worlds/jelly';

const FACTORIES: ((ctx: Ctx) => World)[] = [
  (c) => new LiquidDream(c),
  (c) => new CosmicJelly(c),
];

function fail(msg: string) {
  document.getElementById('veil')?.classList.add('gone');
  const n = document.getElementById('nogl')!;
  document.getElementById('noglmsg')!.textContent = msg;
  n.hidden = false;
}

function boot() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer;
  try {
    const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    if (!gl) throw new Error('no webgl2');
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, powerPreference: 'high-performance' });
  } catch {
    fail("This browser can't run WebGL 2, which VOID needs. Try a recent Chrome, Safari, Edge or Firefox.");
    return;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  // --- quality tier ------------------------------------------------------
  const coarse = matchMedia('(pointer:coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
  const dbg = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(renderer.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const software = /swiftshader|llvmpipe|software/i.test(gpu);
  const forced = new URLSearchParams(location.search).get('q');
  let tier: Quality['tier'] = software ? 'low' : coarse ? 'mid' : 'high';
  if (forced === 'low' || forced === 'mid' || forced === 'high') tier = forced;
  const quality: Quality = {
    tier,
    detail: tier === 'high' ? 52 : tier === 'mid' ? 34 : 22,
    particles: tier === 'high' ? 1 : tier === 'mid' ? 0.65 : 0.35,
  };
  const dprCap = tier === 'high' ? 2 : tier === 'mid' ? 1.6 : 1;
  let resScale = 1;

  // --- scene / camera / post ----------------------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 0, 6);
  const size = new THREE.Vector2(innerWidth, innerHeight);
  const post = new PostStack(renderer, scene, camera, size, tier !== 'low', tier === 'high' && devicePixelRatio < 2 ? 4 : 0);

  // --- state ---------------------------------------------------------------
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const savedCalm = store('void.calm');
  let calm = savedCalm !== null ? savedCalm === '1' : prefersReduced;
  let calmK = calm ? 0.45 : 1; // smoothed

  const audio = new AudioEngine();
  const ctx: Ctx = {
    renderer, scene, camera, quality, audio,
    intensity: () => calmK,
    shock: (x, y, s) => post.shock(x, y, s * (0.4 + 0.6 * calmK), T),
    aspect: () => innerWidth / innerHeight,
  };

  const worlds: (World | null)[] = FACTORIES.map(() => null);
  const ensure = (i: number) => (worlds[i] ??= FACTORIES[i](ctx));

  let T = 0; // scaled clock
  const startIdx = Math.min(FACTORIES.length - 1, Math.max(0, Number(new URLSearchParams(location.search).get('w')) || 0));
  let cur = startIdx;
  let active: World = ensure(startIdx);
  scene.add(active.root);
  active.enter();

  let transition: { t0: number; to: number; swapped: boolean; dir: number; dur: number } | null = null;

  // --- UI ---------------------------------------------------------------------
  const ui = new UI({
    onWorld: (i) => switchTo(i),
    onSound: () => toggleSound(),
    onVolume: (v) => { audio.setVolume(v); store('void.vol', String(v)); },
    onCalm: () => setCalm(!calm),
  });
  ui.setWorld(cur, active, false);
  const vol = parseFloat(store('void.vol') ?? '0.6');
  ui.setVolumeValue(vol); audio.setVolume(vol);
  ui.setCalm(calm);
  if (!audio.available) ui.hideSound();
  let userMuted = store('void.sound') === 'off';

  function setCalm(v: boolean) {
    calm = v; ui.setCalm(v); store('void.calm', v ? '1' : '0');
  }
  async function toggleSound() {
    if (audio.on) {
      audio.disable(); ui.setSound(false); userMuted = true; store('void.sound', 'off');
    } else {
      const ok = await audio.enable();
      if (ok) { audio.setWorld(cur); ui.setSound(true); userMuted = false; store('void.sound', 'on'); }
    }
  }

  function switchTo(i: number, dir = i > cur ? 1 : -1) {
    const n = FACTORIES.length;
    i = ((i % n) + n) % n;
    if (transition || i === cur) return;
    ensure(i);
    transition = { t0: T, to: i, swapped: false, dir, dur: calm ? 2.3 : 1.7 };
    audio.portal();
  }

  // --- gestures -----------------------------------------------------------------
  const gate = () => !transition;
  const gestures = new Gestures(canvas, {
    tap: (x, y) => { ui.dismissHint(); gate() && active.tap(x, y); },
    double: (x, y) => { ui.dismissHint(); gate() && active.double(x, y); },
    holdStart: (x, y) => { ui.touching(true); gate() && active.holdStart(x, y); },
    holdEnd: (x, y, e) => { ui.touching(false); active.holdEnd(x, y, e); },
    drag: (dx, dy) => { ui.dismissHint(); gate() && active.drag(dx, dy); },
    swipe: (vx, vy) => { gate() && active.swipe(vx, vy); },
    worldSwipe: (d) => switchTo(cur + d, d),
    firstTouch: () => { ui.dismissHint(); },
  });
  canvas.addEventListener('pointerdown', () => ui.touching(true));
  const release = () => { if (!gestures.holding) ui.touching(false); };
  window.addEventListener('pointerup', () => {
    release();
    // first completed gesture unlocks audio (browser rule) unless the visitor muted it
    if (!audio.on && !userMuted && audio.available && !autoTried) {
      autoTried = true;
      audio.enable().then((ok) => { if (ok) { audio.setWorld(cur); ui.setSound(true); } });
    }
  });
  let autoTried = false;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') switchTo(cur + 1, 1);
    else if (e.key === 'ArrowLeft') switchTo(cur - 1, -1);
    else if (e.key >= '1' && e.key <= String(FACTORIES.length)) switchTo(Number(e.key) - 1);
    else if (e.key === 'm' || e.key === 'M') toggleSound();
  });

  // --- resize ---------------------------------------------------------------------
  let pr = 1;
  function resize() {
    const w = innerWidth, h = innerHeight;
    pr = Math.min(devicePixelRatio || 1, dprCap) * resScale;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const s of [active]) s.setParticleScale(particleScale);
  }
  let particleScale = 1;
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();

  // --- adaptive quality: protect smoothness, keep the composition -------------------
  let ema = 1 / 60, stage = 0, lastAdapt = 0, frames = 0;
  function adapt(dt: number, now: number) {
    ema += (dt - ema) * 0.05;
    frames++;
    if (frames < 120 || now - lastAdapt < 2500 || transition) return;
    if (ema > 1 / 38 && stage < 4) {
      stage++; lastAdapt = now;
      if (stage === 1) { resScale = 0.8; resize(); }
      else if (stage === 2) { post.setBloom(false); }
      else if (stage === 3) { particleScale = 0.5; worlds.forEach((w) => w?.setParticleScale(particleScale)); }
      else if (stage === 4) { resScale = 0.62; resize(); }
    }
  }

  // --- main loop --------------------------------------------------------------------
  let raf = 0, last = performance.now(), first = true;
  let revealed = false;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const rawDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    calmK = damp(calmK, calm ? 0.45 : 1, 2.5, rawDt);
    const dt = rawDt * (0.55 + 0.45 * calmK / 1);
    T += dt;
    adapt(rawDt, now);

    gestures.update(rawDt);
    const f = { x: gestures.x, y: gestures.y, down: gestures.down, holding: gestures.holding, energy: gestures.energy };

    if (transition) {
      const p = (T - transition.t0) / transition.dur;
      if (p >= 0.5 && !transition.swapped) {
        scene.remove(active.root);
        cur = transition.to;
        active = ensure(cur);
        scene.add(active.root);
        active.enter();
        active.setParticleScale(particleScale);
        ui.setWorld(cur, active);
        audio.setWorld(cur);
        const u = post.warp.uniforms;
        (u.uTint.value as THREE.Color).setRGB(...active.accentVec);
        transition.swapped = true;
      }
      if (p >= 1) { post.warp.uniforms.uPortal.value = 0; transition = null; }
      else {
        post.warp.uniforms.uPortal.value = Math.max(0.0001, p);
        post.warp.uniforms.uPortalDir.value = transition.dir;
      }
    }

    active.update(dt, T, f);
    post.update(T, 1 - calmK);
    post.bloom.strength = (tier === 'high' ? 0.4 : 0.34) * (0.6 + 0.4 * calmK);
    post.render();

    if (first) { first = false; }
    else if (!revealed && frames > 3) {
      revealed = true;
      setTimeout(() => {
        document.getElementById('veil')?.classList.add('gone');
        ui.setWorld(cur, active, true);
        ui.showHint();
      }, 500);
      // warm up the other worlds while the visitor is busy with the first one
      let k = 0;
      const warm = () => {
        if (k >= FACTORIES.length) return;
        const w = ensure(k++);
        // never touch a world that is on screen (or mid-transition): only pre-compile idle ones
        if (!w.root.parent && w !== active && !transition) {
          const tmp = new THREE.Scene();
          tmp.fog = new THREE.FogExp2(0x000000, 0.01);
          tmp.add(w.root);
          try { renderer.compile(tmp, camera); } catch { /* compiled lazily instead */ }
          tmp.remove(w.root);
        }
        setTimeout(warm, 600);
      };
      setTimeout(warm, 2500);
    }
  }

  // --- tab visibility, context loss, cleanup ------------------------------------------
  function start() { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(frame); }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); audio.pause(); }
    else { start(); audio.resume(); }
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
  });
  canvas.addEventListener('webglcontextrestored', () => location.reload());
  addEventListener('pagehide', () => {
    cancelAnimationFrame(raf);
    worlds.forEach((w) => w?.dispose());
    post.dispose();
    renderer.dispose();
  });

  (window as unknown as { __void: unknown }).__void = {
    get world() { return active.id; },
    get tier() { return quality.tier; },
    get fps() { return Math.round(1 / ema); },
    get stage() { return stage; },
    get transitioning() { return !!transition; },
    switchTo,
    get active() { return active; },
    ctx,
  };

  start();
}

try {
  boot();
} catch (e) {
  console.error(e);
  fail('Something went wrong while opening the void. Reloading the page may help.');
}
