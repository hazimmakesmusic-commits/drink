import * as THREE from 'three';
import type { Ctx } from './types';

export const damp = (cur: number, target: number, rate: number, dt: number) =>
  target + (cur - target) * Math.exp(-rate * dt);
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const _v = new THREE.Vector3();
export function makeRay(ctx: Ctx, x: number, y: number, out = new THREE.Ray()) {
  ctx.camera.updateMatrixWorld();
  _v.set(x, y, 0.5).unproject(ctx.camera).sub(ctx.camera.position).normalize();
  out.origin.copy(ctx.camera.position);
  out.direction.copy(_v);
  return out;
}

/** Point on (or nearest to) a sphere for a ray; always returns something. */
export function rayToSphere(ray: THREE.Ray, c: THREE.Vector3, r: number, out = new THREE.Vector3()) {
  const oc = new THREE.Vector3().subVectors(ray.origin, c);
  const b = oc.dot(ray.direction);
  const cc = oc.dot(oc) - r * r;
  const disc = b * b - cc;
  if (disc >= 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 0) return out.copy(ray.origin).addScaledVector(ray.direction, t);
  }
  // miss: closest approach, pushed onto the sphere
  const t = Math.max(0, -b);
  const p = new THREE.Vector3().copy(ray.origin).addScaledVector(ray.direction, t).sub(c);
  if (p.lengthSq() < 1e-6) p.set(0, 0, 1);
  return out.copy(p.normalize().multiplyScalar(r)).add(c);
}

/** Point where the ray crosses the plane through `through` facing the camera. */
export function rayAtDepth(ctx: Ctx, x: number, y: number, through: THREE.Vector3, out = new THREE.Vector3()) {
  const ray = makeRay(ctx, x, y);
  const n = new THREE.Vector3();
  ctx.camera.getWorldDirection(n);
  const denom = ray.direction.dot(n);
  const t = denom > 1e-4 ? through.clone().sub(ray.origin).dot(n) / denom : 5;
  return out.copy(ray.origin).addScaledVector(ray.direction, t);
}

export function fitDistance(base: number, aspect: number, fov = 45) {
  // keep the hero comfortably framed in tall (phone portrait) viewports
  const k = aspect < 1 ? 1 / Math.max(0.55, aspect * 1.15) : 1;
  return base * k * (fov / 45);
}

// ---------------------------------------------------------------------------
// Sparks: CPU-simulated burst particles (taps, releases, spores, hold inflow)
// ---------------------------------------------------------------------------
export class Sparks {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private vel: Float32Array;
  private maxLife: Float32Array;
  private head = 0;
  gravity = new THREE.Vector3();
  drag = 1.2;
  swirl = 0;
  attractor: THREE.Vector3 | null = null;
  attract = 0;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  constructor(readonly max: number, additive = true) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.vel = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aLife;
        varying vec3 vCol; varying float vL;
        uniform float uScale;
        void main(){
          vCol=aColor; vL=aLife;
          vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=aSize*uScale*(320.0/-mv.z)*smoothstep(0.0,0.15,aLife);
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vL;
        void main(){
          float d=length(gl_PointCoord-0.5)*2.0;
          float a=smoothstep(1.0,0.0,d); a=a*a;
          float core=smoothstep(0.35,0.0,d);
          gl_FragColor=vec4(vCol*(a+core*1.2)*vL,a*vL);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }
  setPixelScale(s: number) {
    this.mat.uniforms.uScale.value = s;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, c: THREE.Color) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.size[i] = size;
    this.maxLife[i] = life;
    this.life[i] = 1;
  }
  update(dt: number, t: number) {
    const dragK = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt / this.maxLife[i];
      if (this.life[i] <= 0) { this.life[i] = 0; this.size[i] = 0; continue; }
      const k = i * 3;
      let vx = this.vel[k], vy = this.vel[k + 1], vz = this.vel[k + 2];
      vx += this.gravity.x * dt; vy += this.gravity.y * dt; vz += this.gravity.z * dt;
      if (this.swirl) {
        const s = this.swirl * dt;
        vx += Math.sin(t * 0.9 + i * 1.7 + this.pos[k + 1] * 1.3) * s;
        vy += Math.sin(t * 0.7 + i * 2.3 + this.pos[k + 2] * 1.1) * s;
        vz += Math.sin(t * 1.1 + i * 0.9 + this.pos[k] * 1.2) * s;
      }
      if (this.attractor && this.attract) {
        const dx = this.attractor.x - this.pos[k], dy = this.attractor.y - this.pos[k + 1], dz = this.attractor.z - this.pos[k + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.15;
        const a = this.attract * dt / d;
        vx += dx * a; vy += dy * a; vz += dz * a;
        if (d < 0.25) this.life[i] = Math.min(this.life[i], 0.12);
      }
      vx *= dragK; vy *= dragK; vz *= dragK;
      this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
      this.pos[k] += vx * dt; this.pos[k + 1] += vy * dt; this.pos[k + 2] += vz * dt;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Motes: GPU-driven ambient drifting particles (restrained, few, soft)
// ---------------------------------------------------------------------------
export interface MoteOpts {
  count: number;
  inner: number;
  outer: number;
  size: number;
  colors: THREE.Color[];
  drift?: number;
  stretch?: THREE.Vector3; // volume shaping
  seed?: number;
}
export class Motes {
  readonly points: THREE.Points;
  readonly uniforms = {
    uTime: { value: 0 },
    uFlow: { value: new THREE.Vector3() },
    uScale: { value: 1 },
    uBright: { value: 1 },
  };
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private total: number;
  constructor(o: MoteOpts) {
    let s = (o.seed ?? 1) * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const n = o.count;
    this.total = n;
    const pos = new Float32Array(n * 3), ph = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n);
    const st = o.stretch ?? new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = o.inner + (o.outer - o.inner) * Math.cbrt(rnd());
      const q = Math.sqrt(1 - u * u);
      pos.set([q * Math.cos(a) * r * st.x, u * r * st.y, q * Math.sin(a) * r * st.z], i * 3);
      ph.set([rnd() * 6.28, rnd() * 6.28, 0.3 + rnd() * 0.7], i * 3);
      const c = o.colors[Math.floor(rnd() * o.colors.length)];
      col.set([c.r, c.g, c.b], i * 3);
      sz[i] = o.size * (0.4 + Math.pow(rnd(), 3) * 1.6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    const drift = (o.drift ?? 0.35).toFixed(3);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aPh; attribute vec3 aColor; attribute float aSize;
        uniform float uTime; uniform vec3 uFlow; uniform float uScale;
        varying vec3 vCol; varying float vA;
        void main(){
          float t=uTime*aPh.z;
          vec3 p=position+vec3(sin(t*0.37+aPh.x),sin(t*0.29+aPh.y),sin(t*0.33+aPh.x+aPh.y))*${drift}*(1.0+aPh.z);
          p+=uFlow*(0.4+aPh.z);
          vec4 mv=modelViewMatrix*vec4(p,1.0);
          gl_PointSize=aSize*uScale*(300.0/-mv.z);
          gl_Position=projectionMatrix*mv;
          vCol=aColor;
          vA=0.35+0.65*(0.5+0.5*sin(uTime*0.4*aPh.z+aPh.x*3.0));
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vA; uniform float uBright;
        void main(){
          float d=length(gl_PointCoord-0.5)*2.0;
          float a=smoothstep(1.0,0.0,d); a*=a;
          gl_FragColor=vec4(vCol*a*vA*uBright,a*vA);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }
  setScale(s: number) {
    this.geo.setDrawRange(0, Math.max(8, Math.floor(this.total * s)));
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Rings: expanding luminous rings (camera-facing or flat)
// ---------------------------------------------------------------------------
export class RingPool {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t0: number; dur: number; size: number; alive: boolean }[] = [];
  private geo = new THREE.PlaneGeometry(2, 2);
  private head = 0;
  constructor(count: number, private faceCamera = true) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uAge: { value: 1 }, uColor: { value: new THREE.Color() }, uWidth: { value: 0.05 } },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv*2.0-1.0; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv; uniform float uAge; uniform vec3 uColor; uniform float uWidth;
          void main(){
            float d=length(vUv);
            float r=1.0-pow(1.0-uAge,2.2);
            float w=uWidth*(0.6+uAge*1.4);
            float ring=exp(-pow((d-r*0.96)/w,2.0));
            float fade=pow(1.0-uAge,1.6)*smoothstep(1.0,0.85,d);
            gl_FragColor=vec4(uColor*ring*fade*1.6,ring*fade);
            #include <colorspace_fragment>
          }`,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 15;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.items.push({ mesh, mat, t0: 0, dur: 1, size: 1, alive: false });
    }
  }
  emit(pos: THREE.Vector3, size: number, dur: number, color: THREE.Color, t: number, quat?: THREE.Quaternion, width = 0.05) {
    const it = this.items[this.head];
    this.head = (this.head + 1) % this.items.length;
    it.mesh.position.copy(pos);
    it.size = size; it.dur = dur; it.t0 = t; it.alive = true;
    it.mat.uniforms.uColor.value.copy(color);
    it.mat.uniforms.uWidth.value = width;
    if (quat) { it.mesh.quaternion.copy(quat); (it.mesh.userData as { flat?: boolean }).flat = true; }
    else (it.mesh.userData as { flat?: boolean }).flat = false;
    it.mesh.visible = true;
  }
  update(t: number, camera: THREE.Camera) {
    for (const it of this.items) {
      if (!it.alive) continue;
      const age = (t - it.t0) / it.dur;
      if (age >= 1) { it.alive = false; it.mesh.visible = false; continue; }
      it.mat.uniforms.uAge.value = age;
      it.mesh.scale.setScalar(it.size);
      if (this.faceCamera && !(it.mesh.userData as { flat?: boolean }).flat) it.mesh.quaternion.copy(camera.quaternion);
    }
  }
  dispose() {
    this.geo.dispose();
    this.items.forEach((i) => i.mat.dispose());
  }
}

export const col = (hex: string) => new THREE.Color(hex);
