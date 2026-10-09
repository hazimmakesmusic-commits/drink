import * as THREE from 'three';
import { NOISE } from '../glsl';
import type { Ctx, Frame, World } from '../types';
import { Motes, RingPool, Sparks, col, damp, fitDistance, makeRay, rayAtDepth } from '../fx';

const BONE = '#e4d8c0', EMBER = '#ff5a1f', DEEP = '#b81e0c', LIME = '#c8ff3d';

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
const OBJ_VERT = /* glsl */ `
attribute vec4 aOrb;   // radius, orbit speed, phase, orbit-plane tilt
attribute vec3 aSc;    // scale
attribute vec4 aMisc;  // base height, spin, seed, twist
uniform float uTime, uOrbT, uMelt, uSize;
uniform vec3 uG;
uniform vec4 uWell[4];
varying vec3 vN, vWP;
varying vec2 vUv;
varying float vDd;
varying float vSeed;
mat3 rotY(float a){float c=cos(a),s=sin(a);return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c);}
mat3 rotX(float a){float c=cos(a),s=sin(a);return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c);}
mat3 rotZ(float a){float c=cos(a),s=sin(a);return mat3(c,s,0.0, -s,c,0.0, 0.0,0.0,1.0);}
void main(){
  float a=aOrb.z+uOrbT*aOrb.y;
  vec3 ip=vec3(cos(a)*aOrb.x, aMisc.x+sin(uTime*0.3+aMisc.z*6.0)*0.35, sin(a)*aOrb.x*0.45);
  ip=rotZ(aOrb.w)*ip;
  // gravity wells drag whole trajectories toward (or away from) the touch
  for(int i=0;i<4;i++){
    vec3 dl=uWell[i].xyz-ip;
    float d2=dot(dl,dl);
    float f=uWell[i].w/(1.0+d2*0.22);
    ip+=dl*clamp(f*0.55,-0.9,0.8);
  }
  vec3 v=position*aSc*uSize;
  float tw=position.y*aMisc.w*(1.0+0.25*sin(uTime*0.2+aMisc.z*5.0));
  float c=cos(tw),s=sin(tw);
  v.xz=mat2(c,-s,s,c)*v.xz;
  mat3 R=rotY(uTime*aMisc.y+aMisc.z*6.28)*rotX(aMisc.z*3.0+uTime*0.06*aMisc.y);
  vec3 w=R*v;
  vec3 nn=R*normal;
  // melting: the part furthest along gravity stretches and sags, with a lazy lateral wobble
  float sz=max(aSc.x,max(aSc.y,aSc.z))*0.5*uSize;
  float dd=dot(w,uG)/sz;
  float ext=smoothstep(-0.25,1.0,dd);
  w+=uG*ext*ext*uMelt*sz*(1.1+0.7*sin(aMisc.z*20.0+uTime*0.6+w.x*1.7));
  vec3 side=normalize(cross(uG,vec3(0.0,0.0,1.0))+vec3(0.001));
  w+=side*sin(dd*2.4-uTime*0.8+aMisc.z*9.0)*ext*0.28*sz*uMelt;
  nn=normalize(nn+uG*ext*0.35*uMelt);
  vec4 wp=modelMatrix*vec4(ip+w,1.0);
  vWP=wp.xyz;
  vN=normalize(mat3(modelMatrix)*nn);
  vUv=uv;
  vDd=ext;
  vSeed=aMisc.z;
  vec4 mvPosition=viewMatrix*wp;
  gl_Position=projectionMatrix*mvPosition;
}`;

const OBJ_FRAG = /* glsl */ `
uniform vec3 uBone, uEmber, uLime, uDeep;
uniform float uMode, uInv, uTime, uFlash;
varying vec3 vN, vWP;
varying vec2 vUv;
varying float vDd;
varying float vSeed;
void main(){
  vec3 N=normalize(vN);
  vec3 V=normalize(cameraPosition-vWP);
  if(!gl_FrontFacing) N=-N;
  float ndv=clamp(dot(N,V),0.0,1.0);
  vec3 L1=normalize(vec3(-0.5,0.8,0.6));
  float d1=max(dot(N,L1),0.0);
  vec3 L2=normalize(vec3(0.3,0.1,-1.0));
  float d2=pow(max(dot(N,L2),0.0),1.4);
  vec3 col=uBone*(0.02+0.5*d1*d1);
  col+=uDeep*0.2*(1.0-d1);
  col+=uEmber*d2*0.9;
  float heat=smoothstep(0.1,1.15,vDd);
  col=mix(col,uEmber*1.5,heat*0.7);
  col+=uEmber*pow(1.0-ndv,3.0)*0.45;
  // architectural edge lines
  float m;
  if(uMode<0.5){ vec2 e=min(vUv,1.0-vUv); m=min(e.x,e.y); }
  else { vec2 f=fract(vUv*vec2(40.0,7.0)); vec2 g=min(f,1.0-f)/vec2(40.0,7.0)*1.3; m=min(g.x,g.y); }
  float line=1.0-smoothstep(0.012,0.012+fwidth(m)*1.6,m);
  vec3 lc=mix(mix(uEmber*1.3,uLime,step(0.72,vSeed)),uEmber*1.2,uInv);
  col+=lc*line*(1.0+uFlash);
  float fogF=1.0-exp(-pow(length(cameraPosition-vWP)*0.05,2.0));
  col=mix(col,vec3(0.03,0.006,0.01),fogF);
  gl_FragColor=vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FLOOR_VERT = /* glsl */ `
${NOISE}
uniform float uTime, uSag;
uniform vec4 uWellW[4];
varying vec3 vWP;
varying float vDip;
void main(){
  vec3 p=position;
  float r=length(p.xz);
  float n=snoise(vec3(p.xz*0.1,uTime*0.035))*0.5+0.5;
  float sag=-n*n*n*2.8*uSag;
  float dip=0.0;
  for(int i=0;i<4;i++){
    vec2 dl=p.xz-uWellW[i].xz;
    dip+=uWellW[i].w*exp(-dot(dl,dl)*0.14);
  }
  p.y+=sag-dip*1.6+sin(r*0.35-uTime*0.35)*0.18+r*r*0.0022;
  vDip=dip;
  vec4 wp=modelMatrix*vec4(p,1.0);
  vWP=wp.xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;

const FLOOR_FRAG = /* glsl */ `
uniform vec3 uEmber, uLime;
uniform float uInv;
varying vec3 vWP;
varying float vDip;
float grid(vec2 c,float w){
  vec2 g=abs(fract(c-0.5)-0.5)/fwidth(c);
  return 1.0-min(min(g.x,g.y)/w,1.0);
}
void main(){
  vec2 c=vWP.xz*0.5;
  float minor=grid(c,1.0);
  float major=grid(c*0.2,1.4);
  float dist=length(vWP.xz-cameraPosition.xz);
  float fade=exp(-dist*0.045);
  vec3 lc=mix(uLime,uEmber,uInv);
  vec3 col=uEmber*minor*0.28*fade+mix(uEmber,lc,0.5)*major*0.5*fade;
  col+=uEmber*smoothstep(0.1,1.0,abs(vDip))*0.35*fade;
  gl_FragColor=vec4(col+vec3(0.012,0.003,0.005),1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// A black sun, eclipsed, its lower edge dripping like wax.
const SKY_FRAG = /* glsl */ `
${NOISE}
varying vec3 vDir;
uniform float uTime, uInv, uPulse;
uniform vec3 uEmber, uBone, uLime;
void main(){
  vec3 d=normalize(vDir);
  vec3 ec=mix(uEmber,vec3(0.5,0.78,1.0),uInv); // gravity inverted: the sun goes cold
  vec3 col=mix(vec3(0.004,0.001,0.003),vec3(0.07,0.012,0.016),smoothstep(-0.25,0.55,d.y));
  float smoke=snoise(d*2.2+vec3(0.0,uTime*0.015,0.0))*0.5+0.5;
  col+=vec3(0.05,0.008,0.01)*smoke*smoke*smoothstep(-0.2,0.5,d.y);
  float front=smoothstep(-0.02,-0.3,d.z);
  vec2 p=d.xy/max(-d.z,0.05);
  vec2 c=vec2(0.0,0.13);
  float R=0.27;
  float dx=p.x-c.x;
  float drip=pow(snoise(vec3(dx*8.0,uTime*0.04,1.0))*0.5+0.5,3.0)*1.1
            +pow(snoise(vec3(dx*19.0,uTime*0.07,7.0))*0.5+0.5,5.0)*0.6;
  float below=smoothstep(c.y+0.05,c.y-R*0.9,p.y);
  vec2 q=vec2(p.x,p.y+drip*below);
  float sd=length(q-c)-R;
  float disc=smoothstep(0.006,-0.006,sd);
  float edge=exp(-abs(sd)*42.0);
  float glow=exp(-max(sd,0.0)*4.5);
  col+=ec*glow*0.34*front*(1.0+uPulse);
  col=mix(col,vec3(0.0),disc*front);
  col+=mix(ec,uBone,0.3)*edge*1.5*front*(1.0+uPulse*1.5);
  gl_FragColor=vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface Well { p: THREE.Vector3; s: number; decay: number }

// ---------------------------------------------------------------------------
export class MeltingDimension implements World {
  id = 'melt';
  name = 'Melting Dimension';
  accent = '#ff6a2a';
  accentVec: [number, number, number] = [1.0, 0.38, 0.1];
  root = new THREE.Group();

  private pivot = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.ShaderMaterial[] = [];
  private objU = {
    uTime: { value: 0 }, uOrbT: { value: 0 }, uMelt: { value: 0.6 }, uG: { value: new THREE.Vector3(0, -1, 0) },
    uWell: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uBone: { value: col(BONE) }, uEmber: { value: col(EMBER) }, uLime: { value: col(LIME) }, uDeep: { value: col(DEEP) },
    uInv: { value: 0 }, uFlash: { value: 0 },
  };
  private floor: THREE.Mesh;
  private floorMat: THREE.ShaderMaterial;
  private floorFlip = 1; // +1 floor below, -1 ceiling above
  private floorFlipT = 1;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private motes: Motes;
  private sparks = new Sparks(240);
  private rings = new RingPool(5, false);
  private wells: Well[] = Array.from({ length: 4 }, () => ({ p: new THREE.Vector3(), s: 0, decay: 1.6 }));
  private wellHead = 0;
  private holdActive = false;
  private holdP = new THREE.Vector3();
  private orbT = 0;
  private boost = 0;
  private spinDir = 1;
  private angVel = new THREE.Vector2(0.04, 0.0);
  private gravOff = new THREE.Vector2();
  private gravVel = new THREE.Vector2();
  private inv = 0; private invT = 0;
  private pulse = 0;
  private tmp = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private tmpQ = new THREE.Quaternion();
  private nextIdle = 8;
  private pitch = 0.0;

  constructor(private ctx: Ctx) {
    const q = ctx.quality;
    const nSlab = q.tier === 'high' ? 22 : q.tier === 'mid' ? 17 : 12;
    const nRing = q.tier === 'low' ? 4 : 6;
    let s = 424242;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);

    // slabs + the twisted tower at index 0
    const boxG = new THREE.BoxGeometry(1, 1, 1, 5, 14, 5);
    this.geos.push(boxG);
    const orb = new Float32Array((nSlab + 1) * 4), sc = new Float32Array((nSlab + 1) * 3), misc = new Float32Array((nSlab + 1) * 4);
    orb.set([0, 0, 0, 0], 0); sc.set([1.2, 3.4, 1.2], 0); misc.set([0.2, 0.06, 0.93, 2.6], 0);
    for (let i = 1; i <= nSlab; i++) {
      const sign = rnd() < 0.5 ? -1 : 1;
      const flat = rnd() < 0.3;
      orb.set([3.6 + rnd() * 5.2, sign * (0.05 + rnd() * 0.17), rnd() * 6.283, (rnd() - 0.5) * 0.9], i * 4);
      sc.set(flat ? [0.8 + rnd() * 1.0, 0.07 + rnd() * 0.06, 0.6 + rnd() * 0.8] : [0.12 + rnd() * 0.32, 0.8 + rnd() * 1.9, 0.12 + rnd() * 0.32], i * 3);
      misc.set([(rnd() - 0.45) * 5, (rnd() - 0.5) * 0.5, rnd(), (rnd() - 0.5) * 2.2], i * 4);
    }
    boxG.setAttribute('aOrb', new THREE.InstancedBufferAttribute(orb, 4));
    boxG.setAttribute('aSc', new THREE.InstancedBufferAttribute(sc, 3));
    boxG.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 4));
    const mk = (mode: number, size: number) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: OBJ_VERT, fragmentShader: OBJ_FRAG,
        uniforms: { ...this.objU, uMode: { value: mode }, uSize: { value: size } },
      });
      this.mats.push(m);
      return m;
    };
    const slabs = new THREE.InstancedMesh(boxG, mk(0, 1), nSlab + 1);
    slabs.frustumCulled = false;
    this.pivot.add(slabs);

    // impossible orbits: tilted rings
    const ringG = new THREE.TorusGeometry(0.5, 0.012, 8, 96);
    this.geos.push(ringG);
    const o2 = new Float32Array(nRing * 4), s2 = new Float32Array(nRing * 3), m2 = new Float32Array(nRing * 4);
    for (let i = 0; i < nRing; i++) {
      const sign = rnd() < 0.5 ? -1 : 1;
      o2.set([i === 0 ? 0 : 3.2 + rnd() * 4.5, sign * (0.03 + rnd() * 0.1), rnd() * 6.283, (rnd() - 0.5) * 1.6], i * 4);
      const k = i === 0 ? 5.4 : 1.2 + rnd() * 2.4;
      s2.set([k, k, k], i * 3);
      m2.set([i === 0 ? 0.2 : (rnd() - 0.5) * 4, (rnd() - 0.5) * 0.9 + (i === 0 ? 0.1 : 0), rnd(), (rnd() - 0.5) * 1.2], i * 4);
    }
    ringG.setAttribute('aOrb', new THREE.InstancedBufferAttribute(o2, 4));
    ringG.setAttribute('aSc', new THREE.InstancedBufferAttribute(s2, 3));
    ringG.setAttribute('aMisc', new THREE.InstancedBufferAttribute(m2, 4));
    const rings = new THREE.InstancedMesh(ringG, mk(1, 1), nRing);
    rings.frustumCulled = false;
    this.pivot.add(rings);
    this.root.add(this.pivot);

    // floor that sags and curls up at the horizon
    const fg = new THREE.PlaneGeometry(90, 90, q.tier === 'low' ? 90 : 170, q.tier === 'low' ? 90 : 170);
    fg.rotateX(-Math.PI / 2);
    this.geos.push(fg);
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG,
      uniforms: { uTime: this.objU.uTime, uSag: { value: 0.7 }, uWellW: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
        uEmber: this.objU.uEmber, uLime: this.objU.uLime, uInv: this.objU.uInv },
    });
    this.floor = new THREE.Mesh(fg, this.floorMat);
    this.floor.position.y = -3.4;
    this.floor.frustumCulled = false;
    this.root.add(this.floor);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: `varying vec3 vDir; void main(){vDir=position; gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0);}`,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime: this.objU.uTime, uInv: this.objU.uInv, uPulse: { value: 0 }, uEmber: this.objU.uEmber, uBone: this.objU.uBone, uLime: this.objU.uLime },
    });
    const skyG = new THREE.SphereGeometry(80, 32, 20);
    this.geos.push(skyG);
    this.sky = new THREE.Mesh(skyG, this.skyMat);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.root.add(this.sky);

    this.motes = new Motes({
      count: 110, inner: 2.5, outer: 14, size: 0.05, drift: 0.35,
      colors: [col('#ff8a4a'), col('#e4d8c0'), col('#c8ff3d')], stretch: new THREE.Vector3(1.4, 0.9, 1), seed: 33,
    });
    this.motes.uniforms.uTime = this.objU.uTime;
    this.motes.setScale(q.particles);
    this.root.add(this.motes.points);
    this.sparks.drag = 0.8;
    this.root.add(this.sparks.points);
    this.root.add(this.rings.group);
  }

  enter() {
    this.ctx.scene.fog = new THREE.FogExp2(0x0a0306, 0.01);
    this.ctx.scene.background = null;
    this.ctx.camera.fov = 46;
    this.ctx.camera.updateProjectionMatrix();
  }
  setParticleScale(s: number) { this.motes.setScale(this.ctx.quality.particles * s); }

  // ---- gestures --------------------------------------------------------------
  private worldPoint(x: number, y: number) {
    return rayAtDepth(this.ctx, x, y, this.tmp.set(0, 0.2, 0), new THREE.Vector3());
  }
  private addWell(p: THREE.Vector3, s: number, decay: number) {
    const w = this.wells[this.wellHead];
    this.wellHead = (this.wellHead + 1) % 3; // slot 3 is reserved for the finger
    w.p.copy(p); w.s = s; w.decay = decay;
  }
  private floorHit(x: number, y: number) {
    const ray = makeRay(this.ctx, x, y);
    const fy = this.floor.position.y;
    if (Math.abs(ray.direction.y) < 1e-3) return null;
    const t = (fy - ray.origin.y) / ray.direction.y;
    return t > 0 && t < 80 ? ray.origin.clone().addScaledVector(ray.direction, t) : null;
  }
  private embers(at: THREE.Vector3, n: number, speed: number) {
    const count = Math.ceil(n * this.ctx.quality.particles);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      this.tmpC.set(Math.random() < 0.2 ? LIME : Math.random() < 0.5 ? EMBER : BONE).multiplyScalar(1.6);
      this.sparks.emit(at, v, 1.4 + Math.random() * 1.8, 0.05 + Math.random() * 0.06, this.tmpC);
    }
  }

  tap(x: number, y: number) {
    const k = this.ctx.intensity();
    const p = this.worldPoint(x, y);
    this.addWell(p, 1.1 * (0.6 + 0.4 * k), 1.5);
    this.pulse = 0.5 * k;
    this.ctx.shock(x, y, 0.6 * k);
    this.embers(p, 18, 1.8);
    const fh = this.floorHit(x, y);
    const t = this.objU.uTime.value;
    if (fh) {
      this.rings.emit(fh.setY(fh.y + 0.05), 6, 2.2, this.objU.uEmber.value, t, new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 * this.floorFlip, 0, 0)), 0.04);
    }
    this.objU.uFlash.value = 0.9;
    this.ctx.audio.tap(x);
  }

  double(x: number, y: number) {
    this.invT = this.invT > 0.5 ? 0 : 1;
    this.floorFlipT = -this.floorFlipT;
    this.pulse = 1;
    this.boost += 1.2;
    this.ctx.shock(x, y, 0.95);
    this.embers(this.worldPoint(x, y), 50, 3);
    this.ctx.audio.double();
  }

  holdStart(x: number, y: number) {
    this.holdActive = true;
    this.holdP.copy(this.worldPoint(x, y));
    this.ctx.audio.holdStart();
  }

  holdEnd(x: number, y: number, e: number) {
    this.holdActive = false;
    this.wells[3].s = 0;
    if (e < 0.04) { this.ctx.audio.holdEnd(0); return; }
    const k = this.ctx.intensity();
    const p = this.worldPoint(x, y);
    // the collapse becomes a blast: everything it gathered is thrown back out
    this.addWell(p, -(1.4 + 2.4 * e) * (0.6 + 0.4 * k), 2.2);
    this.boost += 1.5 * e;
    this.pulse = 0.6 + e * 0.8;
    this.ctx.shock(x, y, 0.6 + e * 0.9 * k);
    this.embers(p, 40 + 120 * e, 2.5 + e * 3);
    const t = this.objU.uTime.value;
    const fh = this.floorHit(x, y);
    if (fh) {
      const qn = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 * this.floorFlip, 0, 0));
      this.rings.emit(fh.setY(fh.y + 0.05), 7 + 9 * e, 2.8, this.objU.uEmber.value, t, qn, 0.035);
      this.rings.emit(fh, 4 + 7 * e, 2.4, this.objU.uLime.value, t - 0.2, qn, 0.03);
    }
    this.objU.uFlash.value = 1.2;
    this.ctx.audio.holdEnd(e);
  }

  drag(dx: number, dy: number) {
    this.angVel.x += dy * -2.4;  // pitch
    this.angVel.y += dx * 2.8;   // yaw
    this.angVel.clampLength(0, 5);
    // gravity leans the way you pull the world
    this.gravVel.x += dx * 2.2;
    this.gravVel.y -= dy * 2.2;
  }

  swipe(vx: number, vy: number) {
    this.boost += Math.min(2.2, Math.hypot(vx, vy) * 0.35);
    this.spinDir = vx >= 0 ? 1 : -1;
    this.gravVel.x += vx * 0.8; this.gravVel.y += vy * 0.6;
  }

  // ---- frame -----------------------------------------------------------------
  update(dt: number, t: number, f: Frame) {
    const ctx = this.ctx;
    const k = ctx.intensity();
    const U = this.objU;
    U.uTime.value = t;

    // wells decay; the finger's well follows the touch and grows as energy builds
    for (let i = 0; i < 3; i++) this.wells[i].s *= Math.exp(-dt / this.wells[i].decay);
    if (this.holdActive) {
      this.holdP.copy(this.worldPoint(f.x, f.y));
      this.wells[3].p.copy(this.holdP);
      this.wells[3].s = damp(this.wells[3].s, 0.5 + 2.2 * f.energy, 4, dt);
      this.boost += dt * 0.6 * f.energy;
      this.sparks.attractor = this.holdP;
      this.sparks.attract = 6 + 20 * f.energy;
      const n = Math.floor((10 + 50 * f.energy) * ctx.quality.particles * dt + Math.random());
      for (let i = 0; i < n; i++) {
        this.tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 2).add(this.holdP);
        this.tmpC.set(Math.random() < 0.3 ? LIME : EMBER).multiplyScalar(1.7);
        this.sparks.emit(this.tmp, new THREE.Vector3(), 0.9 + Math.random() * 0.6, 0.05, this.tmpC);
      }
      ctx.audio.holdUpdate(f.energy);
      this.pulse = Math.max(this.pulse, f.energy * 0.3);
    } else {
      this.sparks.attractor = null; this.sparks.attract = 0;
    }

    // structure orientation (drag) with inertia
    this.angVel.x = damp(this.angVel.x, 0, 1.3, dt);
    this.angVel.y = damp(this.angVel.y, 0.05 * k, 0.8, dt);
    this.pitch = Math.max(-0.6, Math.min(0.6, this.pitch + this.angVel.x * dt));
    this.pitch = damp(this.pitch, 0, 0.25, dt);
    this.pivot.rotation.y += this.angVel.y * dt;
    this.pivot.rotation.x = this.pitch;

    // time itself is unreliable: orbits speed up, stall, and run backwards on their own
    const speed = (0.55 + 0.9 * Math.sin(t * 0.11) + this.boost * 1.3 * this.spinDir) * (0.5 + 0.5 * k);
    this.orbT += dt * speed;
    U.uOrbT.value = this.orbT;
    this.boost = damp(this.boost, 0, 0.8, dt);

    // gravity vector: leans with drags, relaxes, flips on double-tap
    this.gravVel.addScaledVector(this.gravOff, -3 * dt).multiplyScalar(Math.exp(-1.2 * dt));
    this.gravOff.addScaledVector(this.gravVel, dt);
    this.gravOff.clampLength(0, 1.4);
    this.inv = damp(this.inv, this.invT, 1.8, dt);
    const gy = -1 + 2 * this.inv; // -1 (down) .. +1 (up), passing through weightlessness
    const gWorld = this.tmp.set(this.gravOff.x, gy, this.gravOff.y);
    if (gWorld.lengthSq() < 0.05) gWorld.y = 0.2 * Math.sign(gy || 1);
    gWorld.normalize();
    this.tmpQ.setFromEuler(this.pivot.rotation).invert();
    (U.uG.value as THREE.Vector3).copy(gWorld).applyQuaternion(this.tmpQ);
    U.uInv.value = this.inv;
    U.uMelt.value = (0.55 + 0.25 * Math.sin(t * 0.17)) * (0.6 + 0.4 * k) * (1 - 0.5 * Math.sin(this.inv * Math.PI));
    U.uFlash.value = damp(U.uFlash.value as number, 0, 2.5, dt);

    // wells -> shader uniforms (structure space for objects, world space for the floor)
    const wl = U.uWell.value as THREE.Vector4[];
    const ww = this.floorMat.uniforms.uWellW.value as THREE.Vector4[];
    for (let i = 0; i < 4; i++) {
      const w = this.wells[i];
      ww[i].set(w.p.x, w.p.y, w.p.z, w.s);
      this.tmp.copy(w.p).applyQuaternion(this.tmpQ);
      wl[i].set(this.tmp.x, this.tmp.y, this.tmp.z, w.s);
    }

    // the floor folds over into a ceiling when gravity flips
    this.floorFlip = damp(this.floorFlip, this.floorFlipT, 2.2, dt);
    this.floor.scale.y = this.floorFlip;
    this.floor.position.y = -3.0 * this.floorFlip;
    this.floorMat.uniforms.uSag.value = 0.7 * (0.6 + 0.4 * k);

    this.sparks.gravity.set(0, -gy * 0.2, 0); // hot embers rise against whatever gravity is doing
    this.pulse = damp(this.pulse, 0, 1.8, dt);
    this.skyMat.uniforms.uPulse.value = this.pulse * 0.5;
    if (t > this.nextIdle) { // idle: an ember wanders loose
      this.nextIdle = t + 6 + Math.random() * 8;
      this.embers(this.tmp.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3), 5, 0.6);
    }
    this.sparks.update(dt, t);
    this.rings.update(t, ctx.camera);
    this.sky.position.copy(ctx.camera.position);
    const fog = ctx.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.color.setRGB(0.03, 0.006, 0.01);

    // camera: low and wide so the floor curls up toward the sun
    const dist = fitDistance(13.5, ctx.aspect(), 46);
    const cam = ctx.camera;
    cam.position.x = damp(cam.position.x, Math.sin(t * 0.05) * 0.7 + f.x * 0.8, 1.3, dt);
    cam.position.y = damp(cam.position.y, 0.4 + f.y * 0.4, 1.3, dt);
    cam.position.z = damp(cam.position.z, dist, 1.6, dt);
    cam.lookAt(0, 0.1, 0);
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
    this.floorMat.dispose(); this.skyMat.dispose();
    this.motes.dispose(); this.sparks.dispose(); this.rings.dispose();
  }
}
