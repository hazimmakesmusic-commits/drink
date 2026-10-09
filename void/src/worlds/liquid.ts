import * as THREE from 'three';
import { NOISE } from '../glsl';
import type { Ctx, Frame, World } from '../types';
import { Motes, RingPool, Sparks, clamp, col, damp, fitDistance, makeRay, rayToSphere, smooth } from '../fx';

// Four "temperaments" of the organism. Double-tap glides to the next one.
interface Morph {
  horn: number; sharp: number;
  amp: number; freq: number; ridge: number; twist: number; elong: number; flow: number; glow: number;
  pal: string[]; // 4 film colours: thin-film iridescence is built from these
  bg: [string, string];
}
const MORPHS: Morph[] = [
  { horn: 0.62, sharp: 7, amp: 0.2, freq: 1.0, ridge: 0.0, twist: 0.0, elong: 1.0, flow: 0.11, glow: 0.8,
    pal: ['#6a3dff', '#17e0ff', '#ff3db4', '#efe9ff'], bg: ['#02010a', '#0a0732'] },
  { horn: 0.85, sharp: 22, amp: 0.2, freq: 1.9, ridge: 0.8, twist: 0.5, elong: 1.0, flow: 0.16, glow: 0.9,
    pal: ['#12d8ff', '#2b43ff', '#f2f6ff', '#b8ff3d'], bg: ['#010710', '#05123a'] },
  { horn: 0.4, sharp: 4, amp: 0.26, freq: 0.85, ridge: 0.15, twist: 2.3, elong: 1.4, flow: 0.09, glow: 0.8,
    pal: ['#ff2fa0', '#ff7a5c', '#7c3cff', '#fff0f6'], bg: ['#0a0210', '#220826'] },
  { horn: 0.7, sharp: 11, amp: 0.24, freq: 1.45, ridge: 0.5, twist: -1.3, elong: 0.82, flow: 0.14, glow: 0.9,
    pal: ['#ff6a4a', '#c5ff3a', '#16dcff', '#ff3db4'], bg: ['#050208', '#12062a'] },
];

const VERT = /* glsl */ `
${NOISE}
uniform float uTime, uAmp, uFreq, uRidge, uTwist, uElong, uHold, uFlow, uPunch;
uniform vec3 uHoldDir, uStretch;
uniform float uHorn, uSharp;
uniform vec4 uHornDir[5];
uniform vec4 uRip[5];
uniform float uRipS[5];
varying vec3 vN, vWP, vDir;
varying float vH;
#include <fog_pars_vertex>

float heightAt(vec3 d){
  float a=uTwist*d.y+uTime*0.04;
  float c=cos(a), s=sin(a);
  vec3 q=vec3(c*d.x-s*d.z, d.y, s*d.x+c*d.z);
  vec3 o=vec3(0.0,uTime*uFlow,uTime*uFlow*0.6);
  float n1=snoise(q*uFreq+o);
  float n2=snoise(q*uFreq*2.07-o*1.3+7.1);
  float rid=1.0-abs(snoise(q*uFreq*1.4+o*0.7+3.3)); rid*=rid;
  float base=mix(n1*0.62+n2*0.22, rid*1.15-0.5+n2*0.12, uRidge);
  float h=base*uAmp;
  for(int i=0;i<5;i++){
    float c=max(dot(d,uHornDir[i].xyz),0.0);
    h+=uHorn*uHornDir[i].w*(pow(c,uSharp)*0.85+pow(c,uSharp*4.0)*0.55);
  }
  for(int i=0;i<5;i++){
    float age=uTime-uRip[i].w;
    if(age>0.0 && age<7.0){
      float ang=acos(clamp(dot(d,uRip[i].xyz),-1.0,1.0));
      float x=ang-age*1.05;
      h+=uRipS[i]*0.2*cos(x*13.0)*exp(-x*x*4.5)*exp(-age*0.5);
    }
  }
  float hd=acos(clamp(dot(d,uHoldDir),-1.0,1.0));
  float hf=exp(-hd*hd*5.5)*uHold;
  h+=hf*(0.26+0.1*snoise(d*8.0+uTime*1.6));
  return h+uPunch;
}
vec3 disp(vec3 d){
  vec3 p=d*(1.0+heightAt(d));
  p.y*=uElong;
  float tr=max(0.0,dot(d,-normalize(uStretch+vec3(1e-5))));
  p-=uStretch*tr*tr;
  return p;
}
void main(){
  vec3 d=normalize(position);
  vec3 p=disp(d);
  vec3 t=normalize(cross(d,abs(d.y)<0.99?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0)));
  vec3 b=cross(d,t);
  float e=0.014;
  vec3 pt=disp(normalize(d+t*e));
  vec3 pb=disp(normalize(d+b*e));
  vec3 n=normalize(cross(pt-p,pb-p));
  if(dot(n,d)<0.0) n=-n;
  vec4 wp=modelMatrix*vec4(p,1.0);
  vWP=wp.xyz;
  vN=normalize(mat3(modelMatrix)*n);
  vDir=d;
  vH=length(p)-1.0;
  vec4 mvPosition=viewMatrix*wp;
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
${NOISE}
uniform float uTime, uHold, uGlow, uHue, uSheen;
uniform vec3 uPal[4];
uniform vec3 uEnvLo, uEnvHi;
varying vec3 vN, vWP, vDir;
varying float vH;
#include <fog_pars_fragment>

vec3 film(float t){
  t=fract(t)*4.0;
  vec3 c=mix(uPal[0],uPal[1],smoothstep(0.0,1.0,t));
  c=mix(c,uPal[2],smoothstep(1.0,2.0,t));
  c=mix(c,uPal[3],smoothstep(2.0,3.0,t));
  c=mix(c,uPal[0],smoothstep(3.0,4.0,t));
  return c;
}
// A tiny procedural "studio": soft boxes + horizon bands, tinted by the palette.
vec3 env(vec3 d){
  float tt=uTime*0.05;
  float c=cos(tt), s=sin(tt);
  d=vec3(c*d.x-s*d.z, d.y, s*d.x+c*d.z);
  vec3 col=mix(uEnvLo,uEnvHi,smoothstep(-0.9,0.9,d.y));
  col+=uPal[3]*pow(max(dot(d,normalize(vec3(0.55,0.75,0.35))),0.0),40.0)*3.2;
  col+=uPal[1]*pow(max(dot(d,normalize(vec3(-0.8,0.15,0.5))),0.0),10.0)*1.9;
  col+=uPal[2]*pow(max(dot(d,normalize(vec3(0.15,-0.7,-0.7))),0.0),7.0)*1.7;
  col+=uPal[0]*pow(max(dot(d,normalize(vec3(0.0,0.2,-1.0))),0.0),6.0)*1.6;
  float band=smoothstep(0.93,1.0,sin(d.y*7.0+snoise(d*1.7)*1.6));
  col+=uPal[3]*band*0.22;
  col+=uPal[1]*smoothstep(0.88,1.0,sin(d.y*3.0-1.2+d.x*1.5))*0.25;
  return col;
}
void main(){
  vec3 N=normalize(vN);
  vec3 V=normalize(cameraPosition-vWP);
  float ndv=clamp(dot(N,V),0.0,1.0);
  float fres=pow(1.0-ndv,3.0);
  vec3 R=reflect(-V,N);
  float phase=ndv*1.5+vH*2.4+uHue+snoise(vDir*1.6+uTime*0.04)*0.3;
  vec3 irid=film(phase);
  vec3 e0=env(R);
  e0=pow(e0,vec3(1.5))*1.3;
  vec3 chrome=e0*mix(vec3(0.8),irid*2.2,0.75);
  vec3 Rf=refract(-V,N,0.78);
  vec3 inner=env(Rf)*film(phase+0.4)*0.2+film(phase+0.15)*0.015;
  float k=smoothstep(0.0,0.5,1.0-ndv)*0.45+0.55;
  vec3 c=mix(inner,chrome,k);
  // living veins glowing from within
  float v=abs(snoise(vDir*2.3+vec3(0.0,uTime*0.07,uTime*0.03)));
  float vein=smoothstep(0.075,0.0,v);
  float pulse=0.5+0.5*sin(uTime*0.8+vDir.y*3.0+vH*9.0);
  vec3 glow=film(phase+0.55)*vein*(0.4+0.75*pulse)*(1.0-fres*0.8);
  float cloud=smoothstep(0.2,0.9,snoise(vDir*1.2-uTime*0.05)*0.5+0.5);
  glow+=film(phase+0.7)*cloud*0.05*(1.0-fres);
  c+=glow*uGlow*(1.0+uHold*2.2);
  c+=fres*(uPal[3]*0.14+film(phase+0.2)*0.4)*uSheen;
  c+=uHold*film(phase+0.1)*smoothstep(0.1,0.45,vH)*1.6;
  gl_FragColor=vec4(c,1.0);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SKY_FRAG = /* glsl */ `
${NOISE}
varying vec3 vDir;
uniform float uTime, uPulse;
uniform vec3 uBg0, uBg1, uC0, uC1, uC2;
void main(){
  vec3 d=normalize(vDir);
  float t=uTime*0.018;
  vec3 w=d*1.3+vec3(0.0,t,0.0);
  w+=0.55*vec3(snoise(d*1.9+t),snoise(d*1.9+5.2-t),snoise(d*1.9-t*0.7));
  float n=snoise(w*1.25)*0.5+0.5;
  float n2=snoise(w*3.0+9.0)*0.5+0.5;
  float sheet=smoothstep(0.52,0.95,n)*(0.35+0.65*n2);
  vec3 col=mix(uBg0,uBg1,smoothstep(-0.7,0.9,d.y));
  col+=mix(uC0,uC2,n2)*sheet*0.11;
  col+=uC1*pow(n2,7.0)*0.05;
  float hz=exp(-pow((d.y+0.04)*3.4,2.0));
  col+=mix(uC0,uC1,n)*hz*hz*0.09;
  col*=1.0+uPulse*0.5;
  gl_FragColor=vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ARC_VERT = /* glsl */ `
varying vec2 vUv; varying float vF;
void main(){
  vUv=uv;
  vec4 mv=modelViewMatrix*vec4(position,1.0);
  vec3 n=normalize(normalMatrix*normal);
  vF=pow(abs(dot(n,normalize(-mv.xyz))),1.8);
  gl_Position=projectionMatrix*mv;
}`;
const ARC_FRAG = /* glsl */ `
varying vec2 vUv; varying float vF;
uniform float uTime, uSeed, uAlpha;
uniform vec3 uA, uB;
void main(){
  float e=pow(sin(vUv.x*3.14159265),1.4);
  float dash=0.6+0.4*sin(vUv.x*26.0-uTime*0.3+uSeed*9.0);
  vec3 c=mix(uA,uB,vUv.x);
  float a=e*dash*vF*uAlpha;
  gl_FragColor=vec4(c*a,a);
  #include <colorspace_fragment>
}`;

const HALO_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uA, uB; uniform float uAmt;
void main(){
  vec2 p=vUv*2.0-1.0; float r=length(p);
  float g=exp(-r*r*3.2);
  vec3 c=mix(uB,uA,smoothstep(0.0,0.9,r));
  gl_FragColor=vec4(c*g*uAmt,g*uAmt);
  #include <colorspace_fragment>
}`;

interface Satellite {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  a: number; r: number; h: number; sp: number; s: number; ph: number; tilt: number;
  off: THREE.Vector3; vel: THREE.Vector3; punch: number; punchV: number;
}

export class LiquidDream implements World {
  id = 'liquid';
  name = 'Liquid Dream';
  accent = '#8d6bff';
  accentVec: [number, number, number] = [0.45, 0.35, 1.0];
  root = new THREE.Group();

  private hero: THREE.Mesh;
  private heroMat: THREE.ShaderMaterial;
  private heroGroup = new THREE.Group();
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private halo: THREE.Mesh;
  private haloMat: THREE.ShaderMaterial;
  private sats: Satellite[] = [];
  private arcs: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; spin: number }[] = [];
  private motes: Motes;
  private sparks = new Sparks(260);
  private rings = new RingPool(6);
  private charge = new RingPool(1);
  private geos: THREE.BufferGeometry[] = [];

  // shared uniforms (palette, time) so every blob drinks the same light
  private shared = {
    uTime: { value: 0 },
    uHue: { value: 0 },
    uPal: { value: [col('#6a3dff'), col('#17e0ff'), col('#ff3db4'), col('#efe9ff')] },
    uEnvLo: { value: col('#02010a') },
    uEnvHi: { value: col('#0a0732') },
    uSheen: { value: 1 },
    ...THREE.UniformsLib.fog,
  } as Record<string, { value: unknown }>;

  private morphIdx = 0;
  private cur = { ...MORPHS[0] };
  private rip: { dir: THREE.Vector3; t0: number; s: number }[] = [];
  private ripHead = 0;
  private rot = new THREE.Quaternion();
  private angVel = new THREE.Vector3(0.0, 0.05, 0);
  private holdE = 0;
  private holdDir = new THREE.Vector3(0, 0, 1);
  private holdWorld = new THREE.Vector3();
  private holdActive = false;
  private punch = 0; private punchV = 0;
  private stretch = new THREE.Vector3();
  private nextIdle = 9;
  private pulseSky = 0;
  private morphKick = 0;
  private lastT = 0;
  private skyCols = { c0: col('#6a3dff'), c1: col('#17e0ff'), c2: col('#ff3db4') };
  private tmp = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private heroR = 1.25;

  constructor(private ctx: Ctx) {
    const q = ctx.quality;
    // --- hero organism
    const detail = Math.round(q.detail);
    const geo = new THREE.IcosahedronGeometry(1, detail);
    this.geos.push(geo);
    const local = () => ({
      uAmp: { value: 0.36 }, uFreq: { value: 1.0 }, uRidge: { value: 0 }, uTwist: { value: 0 },
      uElong: { value: 1 }, uHorn: { value: 0.6 }, uSharp: { value: 7 }, uHold: { value: 0 },
      uHornDir: { value: Array.from({ length: 5 }, () => new THREE.Vector4(0, 1, 0, 1)) }, uFlow: { value: 0.11 }, uPunch: { value: 0 },
      uGlow: { value: 0.9 }, uHoldDir: { value: new THREE.Vector3(0, 0, 1) }, uStretch: { value: new THREE.Vector3() },
      uRip: { value: Array.from({ length: 5 }, () => new THREE.Vector4(0, 0, 1, -100)) },
      uRipS: { value: [0, 0, 0, 0, 0] },
    });
    const mkMat = () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { ...this.shared, ...local() },
        fog: true,
      });
    this.heroMat = mkMat();
    this.hero = new THREE.Mesh(geo, this.heroMat);
    this.hero.scale.setScalar(0.95);
    this.hero.frustumCulled = false;
    this.heroGroup.add(this.hero);
    this.root.add(this.heroGroup);

    // --- satellites: smaller, calmer cousins of the hero
    const satGeo = new THREE.IcosahedronGeometry(1, Math.max(10, Math.round(detail * 0.45)));
    this.geos.push(satGeo);
    const defs = [
      { r: 3.1, h: 0.9, s: 0.34, sp: 0.11, a: 0.6, amp: 0.14, f: 0.9, pal: 0 },
      { r: 4.4, h: -0.9, s: 0.5, sp: -0.07, a: 2.4, amp: 0.12, f: 0.7, pal: 0 },
      { r: 2.6, h: -1.3, s: 0.2, sp: 0.16, a: 4.3, amp: 0.18, f: 1.1, pal: 0 },
      { r: 5.6, h: 1.8, s: 0.28, sp: 0.05, a: 5.4, amp: 0.14, f: 0.8, pal: 0 },
    ];
    for (const d of defs) {
      const mat = mkMat();
      mat.uniforms.uAmp.value = d.amp; mat.uniforms.uFreq.value = d.f; mat.uniforms.uGlow.value = 0.6;
      const mesh = new THREE.Mesh(satGeo, mat);
      mesh.scale.setScalar(d.s); mesh.frustumCulled = false;
      this.root.add(mesh);
      this.sats.push({ mesh, mat, a: d.a, r: d.r, h: d.h, sp: d.sp, s: d.s, ph: d.a * 3, tilt: d.h * 0.1,
        off: new THREE.Vector3(), vel: new THREE.Vector3(), punch: 0, punchV: 0 });
    }

    // --- sky
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: `varying vec3 vDir; void main(){vDir=position; gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0);}`,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTime: this.shared.uTime, uPulse: { value: 0 },
        uBg0: { value: col('#02010a') }, uBg1: { value: col('#0a0732') },
        uC0: { value: this.skyCols.c0 }, uC1: { value: this.skyCols.c1 }, uC2: { value: this.skyCols.c2 },
      },
    });
    const skyGeo = new THREE.SphereGeometry(80, 32, 20);
    this.geos.push(skyGeo);
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.root.add(this.sky);

    // --- halo behind the hero (soft pooled light, not a lens-flare)
    this.haloMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: HALO_FRAG,
      uniforms: { uA: { value: col('#6a3dff') }, uB: { value: col('#17e0ff') }, uAmt: { value: 0.07 } },
    });
    const haloGeo = new THREE.PlaneGeometry(9, 9);
    this.geos.push(haloGeo);
    this.halo = new THREE.Mesh(haloGeo, this.haloMat);
    this.halo.position.z = -2.5;
    this.halo.renderOrder = -50;
    this.root.add(this.halo);

    // --- distant luminous structures: ghost arches in the haze
    const arcDefs = [
      { R: 16, tube: 0.22, arc: 2.4, pos: [-9, 3, -30], rot: [0.3, 0.5, 0.2], spin: 0.012, seed: 0.1 },
      { R: 26, tube: 0.5, arc: 3.4, pos: [9, -5, -44], rot: [1.2, -0.4, 0.8], spin: -0.008, seed: 0.5 },
      { R: 11, tube: 0.12, arc: 1.5, pos: [8, 6, -26], rot: [-0.4, 0.3, 1.9], spin: 0.02, seed: 0.9 },
    ];
    for (const a of arcDefs) {
      const g = new THREE.TorusGeometry(a.R, a.tube, 12, 220, a.arc);
      this.geos.push(g);
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: ARC_VERT,
        fragmentShader: ARC_FRAG,
        uniforms: { uTime: this.shared.uTime, uSeed: { value: a.seed }, uAlpha: { value: 0.6 },
          uA: { value: col('#6a3dff') }, uB: { value: col('#17e0ff') } },
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(a.pos[0], a.pos[1], a.pos[2]);
      mesh.rotation.set(a.rot[0], a.rot[1], a.rot[2]);
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.arcs.push({ mesh, mat: m, spin: a.spin });
    }

    // --- motes
    this.motes = new Motes({
      count: 150, inner: 3.2, outer: 14, size: 0.065, drift: 0.5,
      colors: [col('#9d7bff'), col('#4fe8ff'), col('#efe9ff'), col('#ff6cc4')], stretch: new THREE.Vector3(1.3, 0.8, 1), seed: 7,
    });
    this.motes.uniforms.uTime = this.shared.uTime as { value: number };
    this.motes.setScale(q.particles);
    this.root.add(this.motes.points);
    this.sparks.drag = 1.6;
    this.root.add(this.sparks.points);
    this.root.add(this.rings.group);
    this.root.add(this.charge.group);

    for (let i = 0; i < 5; i++) this.rip.push({ dir: new THREE.Vector3(0, 0, 1), t0: -100, s: 0 });
    this.applyMorphInstant();
  }

  private applyMorphInstant() {
    const m = MORPHS[this.morphIdx];
    Object.assign(this.cur, m);
  }

  enter() {
    const s = this.ctx.scene;
    s.fog = new THREE.FogExp2(0x05031a, 0.018);
    s.background = null;
    this.ctx.camera.fov = 42;
    this.ctx.camera.updateProjectionMatrix();
  }

  setParticleScale(s: number) {
    this.motes.setScale(this.ctx.quality.particles * s);
  }

  // ---- interaction ----------------------------------------------------
  private worldToHero(p: THREE.Vector3) {
    return this.tmp.copy(p).sub(this.heroGroup.position).applyQuaternion(this.tmpQ.copy(this.heroGroup.quaternion).invert()).normalize().clone();
  }

  private addRipple(dirObj: THREE.Vector3, strength: number) {
    const r = this.rip[this.ripHead];
    this.ripHead = (this.ripHead + 1) % this.rip.length;
    r.dir.copy(dirObj); r.t0 = this.shared.uTime.value as number; r.s = strength;
  }

  private heroHit(x: number, y: number) {
    const ray = makeRay(this.ctx, x, y);
    return rayToSphere(ray, this.heroGroup.position, this.heroR);
  }

  private emitBurst(at: THREE.Vector3, n: number, speed: number, size = 0.07) {
    const k = this.ctx.quality.particles;
    const count = Math.ceil(n * k);
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    const pal = this.shared.uPal.value as THREE.Color[];
    for (let i = 0; i < count; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      c.copy(pal[(Math.random() * 4) | 0]).multiplyScalar(1.5);
      this.sparks.emit(at, v, 1.2 + Math.random() * 1.6, size * (0.6 + Math.random() * 1.2), c);
    }
  }

  tap(x: number, y: number) {
    const k = this.ctx.intensity();
    const hit = this.heroHit(x, y);
    this.addRipple(this.worldToHero(hit), 0.8 + 0.4 * k);
    this.ctx.shock(x, y, 0.55 + 0.45 * k);
    this.punchV += 1.4 * k;
    this.pulseSky = 0.6 * k;
    this.emitBurst(hit, 16, 1.6);
    const p = (this.shared.uPal.value as THREE.Color[])[1];
    this.rings.emit(hit, 1.3, 1.5, p, this.shared.uTime.value as number, undefined, 0.05);
    // everything nearby shivers away from the touch
    for (const s of this.sats) {
      const d = this.tmp.copy(s.mesh.position).sub(hit);
      const f = 2.2 / (1 + d.lengthSq() * 0.5);
      s.vel.addScaledVector(d.normalize(), f * 0.9 * k);
      s.punchV += 2.5 * k;
    }
    this.ctx.audio.tap(x);
  }

  double(x: number, y: number) {
    this.morphIdx = (this.morphIdx + 1) % MORPHS.length;
    this.morphKick = 1;
    const hit = this.heroHit(x, y);
    const d = this.worldToHero(hit);
    this.addRipple(d, 1.5);
    this.addRipple(d.clone().negate(), 1.0);
    this.ctx.shock(x, y, 0.9);
    this.punchV += 3;
    this.pulseSky = 1;
    this.emitBurst(this.heroGroup.position, 46, 3.1, 0.09);
    this.angVel.y += 1.4;
    this.ctx.audio.double();
  }

  holdStart(x: number, y: number) {
    this.holdActive = true;
    this.holdWorld.copy(this.heroHit(x, y));
    this.ctx.audio.holdStart();
  }

  holdEnd(x: number, y: number, energy: number) {
    this.holdActive = false;
    this.sparks.attractor = null;
    this.sparks.attract = 0;
    if (energy < 0.04) { this.ctx.audio.holdEnd(0); return; }
    const hit = this.heroHit(x, y);
    const d = this.worldToHero(hit);
    const k = this.ctx.intensity();
    this.addRipple(d, 1.2 + 2.2 * energy * k);
    this.ctx.shock(x, y, 0.6 + energy * 0.9 * k);
    this.punchV += 2 + 5 * energy * k;
    this.pulseSky = 0.5 + energy * 0.8;
    this.emitBurst(hit, 30 + 90 * energy, 2.2 + energy * 3.2, 0.085);
    const pal = this.shared.uPal.value as THREE.Color[];
    this.rings.emit(hit, 1.6 + energy * 2.4, 2.0, pal[0], this.shared.uTime.value as number, undefined, 0.06);
    this.rings.emit(hit, 1.0 + energy * 3.4, 2.6, pal[2], this.shared.uTime.value as number - 0.15, undefined, 0.04);
    for (const s of this.sats) {
      const dd = this.tmp.copy(s.mesh.position).sub(hit);
      s.vel.addScaledVector(dd.normalize(), 2.2 * energy * k);
      s.punchV += 4 * energy * k;
    }
    this.ctx.audio.holdEnd(energy);
  }

  drag(dx: number, dy: number) {
    const k = 2.4;
    this.angVel.y += dx * k * 2.2;
    this.angVel.x -= dy * k * 2.2;
    this.angVel.clampLength(0, 9);
  }

  swipe(vx: number, vy: number) {
    this.angVel.y += vx * 0.55;
    this.angVel.x -= vy * 0.55;
    this.angVel.clampLength(0, 9);
    this.stretch.set(vx * 0.02, vy * 0.02, 0);
  }

  // ---- frame ------------------------------------------------------------
  update(dt: number, t: number, f: Frame) {
    const ctx = this.ctx;
    const k = ctx.intensity();
    this.shared.uTime.value = t;
    this.lastT = t;
    const u = this.heroMat.uniforms;

    // temperament glide
    const target = MORPHS[this.morphIdx];
    const rate = 1.6;
    const c = this.cur;
    c.amp = damp(c.amp, target.amp, rate, dt);
    c.freq = damp(c.freq, target.freq, rate, dt);
    c.ridge = damp(c.ridge, target.ridge, rate, dt);
    c.twist = damp(c.twist, target.twist, rate, dt);
    c.elong = damp(c.elong, target.elong, rate, dt);
    c.flow = damp(c.flow, target.flow, rate, dt);
    c.glow = damp(c.glow, target.glow, rate, dt);
    c.horn = damp(c.horn, target.horn, rate, dt);
    c.sharp = damp(c.sharp, target.sharp, rate, dt);
    const pal = this.shared.uPal.value as THREE.Color[];
    for (let i = 0; i < 4; i++) pal[i].lerp(col(target.pal[i]), 1 - Math.exp(-dt * 1.4));
    (this.shared.uEnvLo.value as THREE.Color).lerp(col(target.bg[0]), 1 - Math.exp(-dt * 1.4));
    (this.shared.uEnvHi.value as THREE.Color).lerp(col(target.bg[1]), 1 - Math.exp(-dt * 1.4));
    this.morphKick = damp(this.morphKick, 0, 1.5, dt);

    // idle life: slow breathing + a spontaneous soft ripple now and then
    const breathe = 1 + Math.sin(t * 0.42) * 0.07 + Math.sin(t * 0.17 + 1.3) * 0.05;
    if (t > this.nextIdle) {
      this.nextIdle = t + 11 + Math.random() * 12;
      this.tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.addRipple(this.tmp.clone(), 0.55);
    }
    this.shared.uHue.value = t * 0.004 + this.morphIdx * 0.13 + Math.sin(t * 0.05) * 0.08;

    // spring for the "punch" (tap squish with overshoot)
    this.punchV += (-this.punch * 70 - this.punchV * 7) * dt;
    this.punch += this.punchV * dt;

    // hold energy follows the finger onto the surface
    if (this.holdActive) {
      this.holdWorld.copy(this.heroHit(f.x, f.y));
      this.holdE = damp(this.holdE, f.energy, 6, dt);
      this.holdDir.copy(this.worldToHero(this.holdWorld));
      // inflow of motes toward the touch point
      this.sparks.attractor = this.holdWorld;
      this.sparks.attract = 14 + 40 * f.energy;
      const rate = (20 + 70 * f.energy) * ctx.quality.particles;
      const n = Math.floor(rate * dt + Math.random());
      const cc = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        const p = this.holdWorld.clone().addScaledVector(dir, 0.9 + Math.random() * 1.3);
        cc.copy(pal[(Math.random() * 4) | 0]).multiplyScalar(1.6);
        this.sparks.emit(p, dir.multiplyScalar(-0.4), 0.9 + Math.random() * 0.7, 0.06, cc);
      }
      ctx.audio.holdUpdate(f.energy);
      // charge ring tightens as energy builds
      this.charge.emit(this.holdWorld, 0.55 + (1 - f.energy) * 0.5, 0.35, pal[3], t, undefined, 0.07);
    } else {
      this.holdE = damp(this.holdE, 0, 3.2, dt);
    }

    // rotation inertia: drag spins the organism, idle keeps it slowly turning
    const idleSpin = 0.06 * k;
    this.angVel.x = damp(this.angVel.x, 0.0, 1.2, dt);
    this.angVel.y = damp(this.angVel.y, idleSpin, 0.9, dt);
    this.tmpQ.setFromEuler(new THREE.Euler(this.angVel.x * dt, this.angVel.y * dt, 0, 'XYZ'));
    this.heroGroup.quaternion.premultiply(this.tmpQ).normalize();
    // the surface lags behind its own motion
    this.stretch.multiplyScalar(Math.exp(-dt * 2));
    const spinMag = Math.hypot(this.angVel.x, this.angVel.y - idleSpin);
    const st = u.uStretch.value as THREE.Vector3;
    st.set(this.angVel.y - idleSpin, -this.angVel.x, 0).multiplyScalar(0.035).add(this.stretch).clampLength(0, 0.4);
    st.applyQuaternion(this.tmpQ.copy(this.heroGroup.quaternion).invert());

    u.uAmp.value = (c.amp + this.morphKick * 0.1) * breathe * (0.55 + 0.45 * k);
    u.uFreq.value = c.freq;
    u.uRidge.value = c.ridge;
    u.uTwist.value = c.twist;
    u.uElong.value = c.elong;
    u.uFlow.value = c.flow;
    u.uGlow.value = c.glow;
    u.uHold.value = this.holdE;
    u.uHorn.value = c.horn * (0.55 + 0.45 * k);
    u.uSharp.value = c.sharp;
    const hd = u.uHornDir.value as THREE.Vector4[];
    for (let i = 0; i < 5; i++) {
      const phi = i * 2.399963 + t * 0.045 * (1 + i * 0.13);
      const y = (1 - (i + 0.5) / 2.5) * 0.85 + Math.sin(t * 0.11 + i) * 0.15;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      hd[i].set(Math.cos(phi) * r, y, Math.sin(phi) * r, 0.72 + 0.28 * Math.sin(t * 0.37 + i * 1.7));
    }
    u.uPunch.value = this.punch * 0.12;
    (u.uHoldDir.value as THREE.Vector3).copy(this.holdDir);
    const ra = u.uRip.value as THREE.Vector4[];
    const rs = u.uRipS.value as number[];
    for (let i = 0; i < 5; i++) {
      const r = this.rip[i];
      ra[i].set(r.dir.x, r.dir.y, r.dir.z, r.t0);
      rs[i] = r.s * (0.6 + 0.4 * k);
    }
    this.heroGroup.position.set(0, Math.sin(t * 0.33) * 0.12, 0);
    const sc = 1 + this.holdE * 0.06 + spinMag * 0.004;
    this.hero.scale.setScalar(0.95 * sc);

    // satellites: slow orbits + spring offsets
    for (const s of this.sats) {
      s.a += s.sp * dt * (0.6 + 0.4 * k);
      s.vel.multiplyScalar(Math.exp(-dt * 1.6));
      s.vel.addScaledVector(s.off, -4 * dt);
      s.off.addScaledVector(s.vel, dt);
      s.punchV += (-s.punch * 60 - s.punchV * 6) * dt;
      s.punch += s.punchV * dt;
      const bob = Math.sin(t * 0.3 + s.ph) * 0.25;
      s.mesh.position.set(Math.cos(s.a) * s.r, s.h + bob, Math.sin(s.a) * s.r * 0.6 - 1.2).add(s.off);
      s.mesh.scale.setScalar(s.s * (1 + s.punch * 0.12));
      const su = s.mat.uniforms;
      su.uPunch.value = s.punch * 0.1;
      su.uAmp.value = (0.15 + this.morphKick * 0.06) * (0.6 + 0.4 * k);
      su.uHorn.value = 0;
      su.uTwist.value = c.twist * 0.5;
      su.uRidge.value = c.ridge * 0.6;
      s.mesh.rotation.y += dt * 0.1; s.mesh.rotation.x += dt * 0.06;
    }

    // far structures drift imperceptibly; their tint follows the palette
    for (const a of this.arcs) {
      a.mesh.rotation.z += a.spin * dt;
      a.mat.uniforms.uA.value.copy(pal[0]);
      a.mat.uniforms.uB.value.copy(pal[1]);
      a.mat.uniforms.uAlpha.value = 0.4 + this.pulseSky * 0.45;
    }
    this.pulseSky = damp(this.pulseSky, 0, 1.8, dt);

    // sky + halo follow palette; sky always centred on the camera
    const su = this.skyMat.uniforms;
    su.uBg0.value.copy(this.shared.uEnvLo.value as THREE.Color);
    su.uBg1.value.copy(this.shared.uEnvHi.value as THREE.Color);
    this.skyCols.c0.copy(pal[0]); this.skyCols.c1.copy(pal[1]); this.skyCols.c2.copy(pal[2]);
    su.uPulse.value = this.pulseSky * 0.35;
    this.sky.position.copy(ctx.camera.position);
    this.haloMat.uniforms.uA.value.copy(pal[0]);
    this.haloMat.uniforms.uB.value.copy(pal[1]);
    this.haloMat.uniforms.uAmt.value = 0.06 + this.holdE * 0.25 + this.pulseSky * 0.1;
    this.halo.quaternion.copy(ctx.camera.quaternion);
    this.halo.position.set(0, 0, -2.5);

    // fog follows the world's darkest tone
    const fog = ctx.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.color.copy(this.shared.uEnvHi.value as THREE.Color).multiplyScalar(0.7);

    this.motes.uniforms.uBright.value = 0.9;
    this.sparks.update(dt, t);
    this.rings.update(t, ctx.camera);
    this.charge.update(t, ctx.camera);

    // camera: unhurried parallax drift, framed for portrait or landscape
    const dist = fitDistance(6.2, ctx.aspect());
    const cam = ctx.camera;
    const tx = Math.sin(t * 0.07) * 0.5 + f.x * 0.55;
    const ty = Math.sin(t * 0.05 + 1) * 0.25 + f.y * 0.35 + 0.1;
    cam.position.x = damp(cam.position.x, tx, 1.5, dt);
    cam.position.y = damp(cam.position.y, ty, 1.5, dt);
    cam.position.z = damp(cam.position.z, dist, 2.0, dt);
    cam.lookAt(0, 0, 0);
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.heroMat.dispose();
    this.sats.forEach((s) => s.mat.dispose());
    this.arcs.forEach((a) => a.mat.dispose());
    this.skyMat.dispose();
    this.haloMat.dispose();
    this.motes.dispose();
    this.sparks.dispose();
    this.rings.dispose();
    this.charge.dispose();
  }
}

void clamp; void smooth;
