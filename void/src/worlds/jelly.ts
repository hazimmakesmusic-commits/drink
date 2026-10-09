import * as THREE from 'three';
import { NOISE } from '../glsl';
import type { Ctx, Frame, World } from '../types';
import { Motes, RingPool, Sparks, col, damp, fitDistance, makeRay } from '../fx';

const MOODS = [
  ['#19e8ff', '#7a45ff', '#f4f0ff'],
  ['#62a8ff', '#d04bff', '#ffe3f1'],
  ['#14ffc8', '#3a52ff', '#efffd0'],
];

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
const BELL_VERT = /* glsl */ `
${NOISE}
uniform float uTime, uC, uWaveFront, uLayer, uPh, uHold;
varying vec3 vWN, vWP;
varying float vTheta, vPhi;
float lobeAt(float ph){ return pow(max(0.0,cos(5.0*ph)),2.0); }
vec3 bellPt(float th, float ph){
  float c=uC;
  float s=sin(th), k=cos(th);
  float rim=smoothstep(0.9,1.5708,th);
  float scallop=0.5+0.5*sin(ph*12.0+uTime*0.5+uPh);
  float lobe=lobeAt(ph);
  float rr=pow(s,0.92);
  float hh=k*1.0;
  // contraction squeezes the skirt hard and lifts the crown a little
  rr*=1.0-0.34*c*smoothstep(0.1,1.45,th);
  hh*=1.0+0.1*c;
  // five lobes stretch the skirt into a star; it flares open as it relaxes
  rr*=1.0+rim*(0.1*(1.0-c)+0.2*lobe)+rim*0.025*sin(ph*12.0+uTime*1.1+uPh)*(1.0-c*0.4);
  hh-=rim*(0.05+0.08*scallop+0.26*lobe)*(1.0+0.6*c);
  // a ripple of muscle travels down the bell after every beat
  float w=exp(-pow((th-uWaveFront)*3.0,2.0));
  rr*=1.0+0.035*w*sin(th*10.0-uWaveFront*8.0);
  float n=snoise(vec3(vec2(cos(ph),sin(ph))*1.4*s,k*1.6)+vec3(uTime*0.16+uPh,0.0,0.0));
  rr*=1.0+0.03*n;
  hh*=1.0+0.02*n;
  return vec3(rr*cos(ph),hh,rr*sin(ph))*uLayer;
}
void main(){
  float th=acos(clamp(position.y,-1.0,1.0));
  float ph=atan(position.z,position.x);
  vec3 p=bellPt(th,ph);
  float e=0.012;
  vec3 pa=bellPt(th+e,ph);
  vec3 pb=bellPt(th,ph+e);
  vec3 n=normalize(cross(pb-p,pa-p));
  if(th<0.02) n=vec3(0.0,1.0,0.0);
  if(dot(n,vec3(cos(ph),0.35,sin(ph)))<0.0 && th>0.02) n=-n;
  vec4 wp=modelMatrix*vec4(p,1.0);
  vWP=wp.xyz;
  vWN=normalize(mat3(modelMatrix)*n);
  vTheta=th; vPhi=ph;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;

const BELL_FRAG = /* glsl */ `
uniform float uTime, uWaveAmt, uWaveFront, uLayer, uHold, uBright, uKind;
uniform vec3 uC0, uC1, uC2;
varying vec3 vWN, vWP;
varying float vTheta, vPhi;
void main(){
  vec3 N=normalize(vWN);
  if(!gl_FrontFacing) N=-N;
  vec3 V=normalize(cameraPosition-vWP);
  float ndv=clamp(dot(N,V),0.0,1.0);
  float fres=pow(1.0-ndv,2.4);
  float inner=step(uLayer,0.95);   // 1 for inner layers
  float core=step(uLayer,0.6);
  // body: pearl crown melting to cyan skirt, violet in the depths
  vec3 body=mix(uC1,uC0,smoothstep(0.2,1.5,vTheta));
  body=mix(body,uC2,smoothstep(0.5,0.0,vTheta)*0.35);
  vec3 irid=mix(uC0,uC1,0.5+0.5*sin(ndv*6.0+vTheta*3.0+vPhi*2.0+uTime*0.1));
  float alpha=(0.05+0.5*fres)*(1.0-0.35*inner);
  // radial canals with a pulse running down them
  float a=vPhi/6.2831853*10.0;
  float canal=1.0-smoothstep(0.0,0.08,abs(fract(a)-0.5));
  canal*=smoothstep(0.12,0.4,vTheta)*(1.0-smoothstep(1.35,1.57,vTheta));
  float wv=exp(-pow((vTheta-uWaveFront)*3.2,2.0))*uWaveAmt;
  float ring=smoothstep(0.93,1.0,0.5+0.5*sin(vTheta*30.0-uTime*0.3))*0.5;
  vec3 glow=mix(uC0,uC2,0.4)*canal*(0.25+2.3*wv+0.5*uHold)*(1.0-core*0.6);
  glow+=uC1*ring*0.18*smoothstep(0.4,1.4,vTheta);
  // four-petal gonads glowing inside (only on the mid layer)
  float petal=pow(abs(cos(vPhi*2.5)),3.0)*smoothstep(0.3,0.5,vTheta)*(1.0-smoothstep(0.75,1.0,vTheta));
  glow+=mix(uC1,uC2,0.5)*petal*inner*(1.0-core)*(0.7+1.4*wv+uHold);
  // heart of light
  float heart=exp(-vTheta*vTheta*2.2);
  glow+=uC2*heart*core*(0.5+0.8*wv+uHold*1.2);
  // a faint constellation glittering inside the body: slow, soft, never a strobe
  vec2 g=vec2(vPhi*7.0,vTheta*14.0)*vec2(1.0,1.0);
  vec2 gi=floor(g), gf=fract(g)-0.5;
  float hsh=fract(sin(dot(gi,vec2(127.1,311.7)))*43758.5453);
  float star=step(0.93,hsh)*smoothstep(0.22,0.0,length(gf))*(0.5+0.5*sin(uTime*0.5+hsh*60.0));
  glow+=mix(uC2,uC0,hsh)*star*0.9*inner*(1.0-core)*smoothstep(0.1,0.5,vTheta);
  vec3 rimc=mix(irid,uC2,0.3)*fres*(0.55+0.5*wv)*(1.0-0.55*inner);
  vec3 c=body*alpha*1.2+glow*0.55+rimc*0.5;
  float aa=clamp(alpha+fres*0.15+length(glow)*0.1,0.0,1.0);
  gl_FragColor=vec4(c*uBright,aa*uBright);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const TENT_VERT = /* glsl */ `
attribute vec4 aSeed;   // angle, length, phase, thickness
attribute vec2 aTR;     // t along, ring angle (kind 2: side index 0..2)
uniform float uTime, uC, uCl, uKind, uPullAmt, uPh;
uniform vec3 uFlow, uPull;
varying vec3 vN, vWP;
varying float vT, vPh, vSide;
float lobeAt(float ph){ return pow(max(0.0,cos(5.0*ph)),2.0); }
void main(){
  float t=aTR.x, a=aSeed.x, L=aSeed.y, ph=aSeed.z, th=aSeed.w;
  float kind=uKind;
  float lobe=lobeAt(a);
  float scallop=0.5+0.5*sin(a*12.0+uTime*0.5+uPh);
  float rimR=(1.0-0.34*uC)*(1.0+0.1*(1.0-uC)+0.2*lobe);
  float rimY=-(0.05+0.08*scallop+0.26*lobe)*(1.0+0.6*uC);
  vec3 root=vec3(cos(a)*rimR*0.985, rimY, sin(a)*rimR*0.985);
  if(kind>0.5 && kind<1.5){ // oral arms: from the centre of the underside
    root=vec3(cos(a)*0.2,-0.02,sin(a)*0.2);
  }
  float s1=sin(uTime*0.9-t*4.2+ph)*0.16*t;
  float s2=sin(uTime*0.37-t*2.2+ph*2.1)*0.28*t*t;
  float sway=s1+s2;
  vec3 c=root+vec3(0.0,-L*t,0.0);
  // lagging recoil: strands gather in after each squeeze, then trail back out
  c.xz*=1.0-0.38*t*uCl+0.1*t*t;
  // ribbons take a slow corkscrew so they feel like drifting silk, not hanging cord
  float corkscrew=kind>1.5?1.0:0.0;
  c.x+=sway*cos(ph*3.0+1.0)+corkscrew*sin(t*5.0-uTime*0.6+ph)*0.22*t;
  c.z+=sway*sin(ph*3.0+1.0)+corkscrew*cos(t*5.0-uTime*0.6+ph)*0.22*t;
  c+=uFlow*t*t;
  c+=uPull*t*t*uPullAmt;
  vec3 p; vec3 nrm;
  if(kind>1.5){
    // flat veil: three verts across, edges ruffle
    float side=aTR.y-1.0;
    float w=th*(0.55+0.45*sin(t*9.0-uTime*0.7+ph*3.0))*(1.0-0.35*t)*smoothstep(0.0,0.06,t);
    vec3 tang=normalize(vec3(-sin(a),0.0,cos(a)));
    // keep the veil facing outward as it twists
    float tw=sin(t*5.0-uTime*0.6+ph)*0.9;
    tang=normalize(vec3(tang.x*cos(tw)-tang.z*0.0, 0.0, tang.z*cos(tw))+vec3(0.0,sin(tw),0.0)*0.0+vec3(cos(a),0.0,sin(a))*sin(tw));
    p=c+tang*side*w;
    nrm=normalize(cross(tang,vec3(0.0,1.0,0.0)));
    vSide=abs(side);
  } else {
    float rad=th*(1.0-0.88*t);
    float frill=1.0+kind*(0.35*sin(t*16.0-uTime*1.2+ph*4.0)*t);
    vec3 dir=vec3(cos(aTR.y),0.0,sin(aTR.y));
    p=c+dir*rad*frill*mix(1.0,2.0,kind*smoothstep(0.0,0.4,t));
    nrm=dir;
    vSide=0.0;
  }
  vec4 wp=modelMatrix*vec4(p,1.0);
  vWP=wp.xyz;
  vN=normalize(mat3(modelMatrix)*nrm);
  vT=t; vPh=ph;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;

const TENT_FRAG = /* glsl */ `
uniform float uTime, uWaveAmt, uWaveFront, uHold, uBright, uKind;
uniform vec3 uC0, uC1, uC2;
varying vec3 vN, vWP;
varying float vT, vPh, vSide;
void main(){
  vec3 V=normalize(cameraPosition-vWP);
  float ndv=abs(dot(normalize(vN),V));
  float fres=pow(1.0-ndv,1.5);
  vec3 base=mix(uC0,uC1,smoothstep(0.0,0.8,vT));
  if(uKind>0.5 && uKind<1.5) base=mix(uC2,uC1,0.45+0.4*vT);
  if(uKind>1.5) base=mix(mix(uC1,uC0,0.35),uC1,smoothstep(0.0,1.0,vT));
  float fade=pow(1.0-vT,0.75)*smoothstep(0.0,0.03,vT);
  float bead=smoothstep(0.82,1.0,sin(vT*46.0-uTime*(1.1+0.4*fract(vPh*7.0))+vPh*20.0));
  float wv=exp(-pow((vT*1.7-uWaveFront*0.8)*2.4,2.0))*uWaveAmt;
  float lum=0.28+0.5*fres+bead*1.2*(1.0-vT*0.5)+wv*1.5+uHold*0.5;
  vec3 c=base*lum;
  float a=fade*(0.28+0.5*fres)*(0.7+0.6*bead);
  if(uKind>1.5){
    // silk veil: luminous edges, a clear soft middle, slow light travelling along it
    float edge=smoothstep(0.35,1.0,vSide);
    float travel=smoothstep(0.7,1.0,sin(vT*18.0-uTime*0.9+vPh*5.0));
    c=base*(0.06+edge*0.42+travel*0.45*(1.0-vT)+wv*1.0+uHold*0.3);
    a=fade*(0.03+edge*0.16+travel*0.1);
  }
  if(uKind>0.5 && uKind<1.5){ c=base*(0.22+0.5*fres+wv*1.1+uHold*0.4); a=fade*(0.18+0.35*fres); }
  gl_FragColor=vec4(c*fade*uBright,a*uBright);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SKY_FRAG = /* glsl */ `
${NOISE}
varying vec3 vDir;
uniform float uTime, uPulse;
uniform vec3 uA, uB;
void main(){
  vec3 d=normalize(vDir);
  float t=uTime;
  vec3 col=mix(vec3(0.0,0.0,0.012),vec3(0.01,0.025,0.085),smoothstep(-0.8,0.9,d.y));
  // slanted light shafts pouring from a surface far above
  float u=d.x*2.6+d.z*0.8+d.y*0.9;
  float sh=snoise(vec3(u*2.2,t*0.03,0.0))*0.5+0.5;
  float sh2=snoise(vec3(u*5.5+4.0,t*0.05,2.0))*0.5+0.5;
  float shaft=smoothstep(0.5,1.0,sh)*(0.5+0.5*sh2)*smoothstep(-0.5,0.85,d.y);
  col+=mix(uA,uB,0.5+0.5*sin(u+t*0.04))*shaft*0.09;
  float haze=snoise(d*1.4+vec3(0.0,t*0.015,0.0))*0.5+0.5;
  col+=uB*haze*smoothstep(0.0,0.9,-d.y+0.2)*0.035;
  col*=1.0+uPulse*0.5;
  gl_FragColor=vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------
function tentacleGeometry(count: number, segs: number, sides: number, lenRange: [number, number], thick: number, seed: number, angles?: number[]) {
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const vc = count * (segs + 1) * sides;
  const seedA = new Float32Array(vc * 4), tr = new Float32Array(vc * 2), pos = new Float32Array(vc * 3);
  const idx: number[] = [];
  let v = 0;
  for (let i = 0; i < count; i++) {
    const a = angles ? angles[i] : (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
    const L = lenRange[0] + rnd() * (lenRange[1] - lenRange[0]);
    const ph = rnd() * 6.283;
    const th = thick * (0.7 + rnd() * 0.6);
    const base = v;
    for (let j = 0; j <= segs; j++) {
      for (let k = 0; k < sides; k++) {
        seedA.set([a, L, ph, th], v * 4);
        tr.set([j / segs, (k / sides) * Math.PI * 2], v * 2);
        v++;
      }
    }
    for (let j = 0; j < segs; j++) {
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        const a0 = base + j * sides + k, b0 = base + j * sides + k2;
        const a1 = base + (j + 1) * sides + k, b1 = base + (j + 1) * sides + k2;
        idx.push(a0, a1, b0, b0, a1, b1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 4));
  g.setAttribute('aTR', new THREE.BufferAttribute(tr, 2));
  g.setIndex(idx);
  return g;
}

function ribbonGeometry(count: number, segs: number, lenRange: [number, number], width: number, seed: number, angles: number[]) {
  let s = seed * 6151 + 29;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const vc = count * (segs + 1) * 3;
  const seedA = new Float32Array(vc * 4), tr = new Float32Array(vc * 2), pos = new Float32Array(vc * 3);
  const idx: number[] = [];
  let v = 0;
  for (let i = 0; i < count; i++) {
    const a = angles[i];
    const L = lenRange[0] + rnd() * (lenRange[1] - lenRange[0]);
    const ph = rnd() * 6.283;
    const base = v;
    for (let j = 0; j <= segs; j++) for (let k = 0; k < 3; k++) { seedA.set([a, L, ph, width], v * 4); tr.set([j / segs, k], v * 2); v++; }
    for (let j = 0; j < segs; j++) for (let k = 0; k < 2; k++) {
      const a0 = base + j * 3 + k, b0 = a0 + 1, a1 = a0 + 3, b1 = a0 + 4;
      idx.push(a0, a1, b0, b0, a1, b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 4));
  g.setAttribute('aTR', new THREE.BufferAttribute(tr, 2));
  g.setIndex(idx);
  return g;
}

interface Shared {
  uTime: { value: number };
  uC0: { value: THREE.Color }; uC1: { value: THREE.Color }; uC2: { value: THREE.Color };
}

const premult = {
  transparent: true, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
};

// ---------------------------------------------------------------------------
// One jellyfish (physics + meshes). The hero and the far-off ones share it.
// ---------------------------------------------------------------------------
class Jelly {
  group = new THREE.Group();
  inner = new THREE.Group();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  home = new THREE.Vector3();
  c = 0; cv = 0; cl = 0;
  beatAt = 0; waveT = 9; hold = 0;
  yaw = 0; yawV = 0; tiltX = 0; tiltZ = 0; tiltVX = 0; tiltVZ = 0;
  flow = new THREE.Vector3();
  pullDir = new THREE.Vector3(); pullAmt = 0;
  danceQueue: number[] = [];
  onBeat?: (strength: number) => void;
  private U: Record<string, { value: unknown }>;
  private mats: THREE.ShaderMaterial[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private tmpV = new THREE.Vector3();
  period: number;

  constructor(shared: Shared, o: { bellSeg: number; tents: number; tentSeg: number; scale: number; bright: number; seed: number }) {
    this.period = 2.8 + (o.seed % 7) * 0.13;
    this.U = {
      uTime: shared.uTime, uC0: shared.uC0, uC1: shared.uC1, uC2: shared.uC2,
      uC: { value: 0 }, uCl: { value: 0 }, uWaveFront: { value: 2 }, uWaveAmt: { value: 0 },
      uHold: { value: 0 }, uBright: { value: o.bright }, uPh: { value: o.seed },
      uFlow: { value: new THREE.Vector3() }, uPull: { value: new THREE.Vector3() }, uPullAmt: { value: 0 },
    };
    const bellGeo = new THREE.SphereGeometry(1, o.bellSeg, Math.max(12, Math.round(o.bellSeg / 2.4)), 0, Math.PI * 2, 0, Math.PI / 2);
    this.geos.push(bellGeo);
    const layers = [{ s: 1.0, order: 3 }, { s: 0.8, order: 2 }, { s: 0.5, order: 1 }];
    for (const l of layers) {
      const m = new THREE.ShaderMaterial({
        ...premult, side: THREE.DoubleSide, vertexShader: BELL_VERT, fragmentShader: BELL_FRAG,
        uniforms: { ...this.U, uLayer: { value: l.s }, uKind: { value: 0 } },
      });
      this.mats.push(m);
      const mesh = new THREE.Mesh(bellGeo, m);
      mesh.renderOrder = 5 + l.order;
      mesh.frustumCulled = false;
      this.inner.add(mesh);
    }
    const lobeA = [0, 1, 2, 3, 4].map((i) => (i / 5) * Math.PI * 2);
    const fr = tentacleGeometry(o.tents, o.tentSeg, 4, [0.9, 2.0], 0.011, o.seed);
    const ag = tentacleGeometry(5, Math.round(o.tentSeg * 0.7), 6, [1.1, 1.6], 0.032, o.seed + 3, lobeA.map((a) => a + 0.63));
    const vg = ribbonGeometry(5, o.tentSeg, [2.6, 3.4], 0.13, o.seed + 5, lobeA);
    this.geos.push(fr, ag, vg);
    for (const [g, kind, order] of [[fr, 0, 4], [ag, 1, 5], [vg, 2, 4]] as const) {
      const m = new THREE.ShaderMaterial({
        ...premult, side: THREE.DoubleSide, vertexShader: TENT_VERT, fragmentShader: TENT_FRAG,
        uniforms: { ...this.U, uKind: { value: kind } },
      });
      this.mats.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.inner.add(mesh);
    }
    this.group.add(this.inner);
    this.group.scale.setScalar(o.scale);
  }

  contract(strength: number) {
    this.cv += strength;
    this.waveT = 0;
    this.vel.y += strength * 0.075;
    // swim a touch along the facing direction so it never just bobs in place
    this.vel.x += Math.sin(this.yaw) * strength * 0.012;
    this.vel.z += Math.cos(this.yaw) * strength * 0.012;
    this.onBeat?.(strength);
  }

  update(dt: number, t: number, intensity: number) {
    // heartbeat
    if (t > this.beatAt && this.danceQueue.length === 0) {
      this.contract(6.4 * (0.85 + 0.3 * Math.sin(t)));
      this.beatAt = t + this.period * (0.9 + 0.25 * Math.sin(t * 0.3));
    }
    for (let i = this.danceQueue.length - 1; i >= 0; i--) {
      if (t >= this.danceQueue[i]) { this.danceQueue.splice(i, 1); this.contract(7); this.yawV += 0.8; if (!this.danceQueue.length) this.beatAt = t + 1.4; }
    }
    // spring: elastic squeeze with overshoot (it "wobbles" back like jelly)
    const holdBias = this.hold * 0.42;
    this.cv += (-(this.c - holdBias) * 40 - this.cv * 5.2) * dt;
    this.c += this.cv * dt;
    this.cl = damp(this.cl, this.c, 3.2, dt);
    this.waveT += dt;

    // body: buoyant swimming
    this.vel.y -= 0.22 * dt;
    this.vel.addScaledVector(this.tmpV.copy(this.home).sub(this.pos), 0.45 * dt);
    this.vel.multiplyScalar(Math.exp(-0.85 * dt));
    this.pos.addScaledVector(this.vel, dt);
    this.pos.x += Math.sin(t * 0.21 + this.period) * 0.12 * dt * intensity;

    // yaw and tilt: elastic, they always settle back upright
    this.yawV = damp(this.yawV, 0.07, 1.4, dt);
    this.yaw += this.yawV * dt;
    this.tiltVX += (-this.tiltX * 14 - this.tiltVX * 2.6 + this.vel.z * 3.0) * dt;
    this.tiltVZ += (-this.tiltZ * 14 - this.tiltVZ * 2.6 - this.vel.x * 3.0) * dt;
    this.tiltX += this.tiltVX * dt;
    this.tiltZ += this.tiltVZ * dt;

    this.group.position.copy(this.pos);
    this.group.rotation.set(this.tiltX, this.yaw, this.tiltZ, 'YXZ');

    // trailing strands lag the motion of the body
    this.flow.lerp(this.tmpV.copy(this.vel).multiplyScalar(-0.55), 1 - Math.exp(-3 * dt));
    this.flow.y *= 0.4;

    const U = this.U;
    (U.uC.value as number) = this.c;
    (U.uCl.value as number) = this.cl;
    (U.uWaveFront.value as number) = Math.min(2, this.waveT * 1.5);
    (U.uWaveAmt.value as number) = Math.exp(-this.waveT * 1.6) * Math.min(1, 0.4 + Math.abs(this.cv) * 0.02 + 0.6);
    (U.uHold.value as number) = this.hold;
    // flow is expressed in the jelly's local frame (the mesh rotates with it)
    const lf = this.tmpV.copy(this.flow).applyEuler(new THREE.Euler(-this.tiltX, -this.yaw, -this.tiltZ, 'ZXY')).divideScalar(this.group.scale.x);
    (U.uFlow.value as THREE.Vector3).copy(lf);
    (U.uPull.value as THREE.Vector3).copy(this.pullDir);
    (U.uPullAmt.value as number) = this.pullAmt;
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
  }
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
export class CosmicJelly implements World {
  id = 'jelly';
  name = 'Cosmic Jelly';
  accent = '#53e0ff';
  accentVec: [number, number, number] = [0.2, 0.75, 1.0];
  root = new THREE.Group();

  private shared: Shared & { uPulse: { value: number } } = {
    uTime: { value: 0 },
    uC0: { value: col(MOODS[0][0]) }, uC1: { value: col(MOODS[0][1]) }, uC2: { value: col(MOODS[0][2]) },
    uPulse: { value: 0 },
  };
  private hero: Jelly;
  private others: Jelly[] = [];
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private skyGeo: THREE.SphereGeometry;
  private motes: Motes;
  private spores = new Sparks(220);
  private rings = new RingPool(6);
  private mood = 0;
  private flowOff = new THREE.Vector3();
  private flowVel = new THREE.Vector3();
  private holdActive = false;
  private holdPt = new THREE.Vector3();
  private pulse = 0;
  private tmp = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private nextWhisper = 7;

  constructor(private ctx: Ctx) {
    const q = ctx.quality;
    const seg = Math.round(40 + q.detail * 1.1);
    this.hero = new Jelly(this.shared, { bellSeg: seg, tents: q.tier === 'low' ? 24 : q.tier === 'mid' ? 34 : 46, tentSeg: q.tier === 'low' ? 36 : 56, scale: 1.0, bright: 1.0, seed: 1 });
    this.hero.home.set(0, 0.45, 0);
    this.hero.pos.copy(this.hero.home);
    this.hero.onBeat = (s) => { this.ctx.audio.pulse(Math.min(1, s / 7)); };
    this.root.add(this.hero.group);

    // far-off cousins: same creature, a fraction of the cost, deep in the dark
    const far = [
      { p: [-5.2, 1.5, -9], s: 0.55, b: 0.42, seed: 3 },
      { p: [5.6, -0.8, -12], s: 0.7, b: 0.34, seed: 5 },
      { p: [2.0, 3.4, -17], s: 0.9, b: 0.22, seed: 9 },
    ];
    for (const f of far) {
      const j = new Jelly(this.shared, { bellSeg: 28, tents: q.tier === 'low' ? 6 : 12, tentSeg: 22, scale: f.s, bright: f.b, seed: f.seed });
      j.home.set(f.p[0], f.p[1], f.p[2]);
      j.pos.copy(j.home);
      j.beatAt = f.seed * 0.7;
      this.others.push(j);
      this.root.add(j.group);
    }

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: `varying vec3 vDir; void main(){vDir=position; gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0);}`,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime: this.shared.uTime, uPulse: this.shared.uPulse, uA: { value: this.shared.uC0.value }, uB: { value: this.shared.uC1.value } },
    });
    this.skyGeo = new THREE.SphereGeometry(80, 32, 20);
    this.sky = new THREE.Mesh(this.skyGeo, this.skyMat);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.root.add(this.sky);

    this.motes = new Motes({
      count: 260, inner: 1.5, outer: 14, size: 0.05, drift: 0.7,
      colors: [col('#8fe9ff'), col('#a58bff'), col('#f4f0ff')], stretch: new THREE.Vector3(1.2, 1.0, 0.9), seed: 21,
    });
    this.motes.uniforms.uTime = this.shared.uTime;
    this.motes.setScale(q.particles);
    this.root.add(this.motes.points);
    this.spores.drag = 0.9; this.spores.swirl = 1.1;
    this.root.add(this.spores.points);
    this.root.add(this.rings.group);
  }

  enter() {
    this.ctx.scene.fog = new THREE.FogExp2(0x01030c, 0.02);
    this.ctx.scene.background = null;
    this.ctx.camera.fov = 40;
    this.ctx.camera.updateProjectionMatrix();
  }

  setParticleScale(s: number) { this.motes.setScale(this.ctx.quality.particles * s); }

  private jellyCenter() { return this.hero.pos; }

  // --- gestures ------------------------------------------------------------
  private worldAt(x: number, y: number, depth = 0) {
    const ray = makeRay(this.ctx, x, y);
    const d = (this.hero.pos.z + depth - ray.origin.z) / ray.direction.z;
    return ray.origin.clone().addScaledVector(ray.direction, d);
  }

  tap(x: number, y: number) {
    const k = this.ctx.intensity();
    this.hero.contract(8.5 * (0.7 + 0.3 * k));
    this.pulse = 0.7 * k;
    this.ctx.shock(x, y, 0.7 * k);
    const c = this.hero.pos.clone();
    this.rings.emit(c.clone().add(new THREE.Vector3(0, -0.2, 0)), 3.4, 2.2, this.shared.uC0.value, this.shared.uTime.value, undefined, 0.035);
    this.rings.emit(c.clone().add(new THREE.Vector3(0, 0.4, 0)), 2.2, 1.8, this.shared.uC1.value, this.shared.uTime.value - 0.12, undefined, 0.03);
    this.release(c.add(new THREE.Vector3(0, -0.5, 0)), 20, 0.9);
    // a tap away from the creature nudges it away, as if the water were pushed
    const tp = this.worldAt(x, y);
    const away = this.tmp.copy(this.hero.pos).sub(tp);
    away.z = 0;
    if (away.lengthSq() > 1e-4) this.hero.vel.addScaledVector(away.normalize(), 0.6 * k);
    this.flowVel.addScaledVector(away.set(Math.sign(away.x) * 0.2, 0, 0), 1);
  }

  /** Tiny luminous organisms drift out of the bell. */
  private release(from: THREE.Vector3, n: number, speed: number) {
    const count = Math.ceil(n * this.ctx.quality.particles);
    const v = new THREE.Vector3(), p = new THREE.Vector3();
    const pal = [this.shared.uC0.value, this.shared.uC1.value, this.shared.uC2.value];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      p.set(from.x + Math.cos(a) * 0.7 * Math.random(), from.y + (Math.random() - 0.5) * 0.4, from.z + Math.sin(a) * 0.7 * Math.random());
      v.set(Math.cos(a) * speed * Math.random(), (Math.random() - 0.3) * speed * 0.7, Math.sin(a) * speed * Math.random());
      this.tmpC.copy(pal[(Math.random() * 3) | 0]).multiplyScalar(1.7);
      this.spores.emit(p, v, 3 + Math.random() * 3, 0.05 + Math.random() * 0.07, this.tmpC);
    }
  }

  double(x: number, y: number) {
    this.mood = (this.mood + 1) % MOODS.length;
    const now = this.shared.uTime.value;
    // a little dance: three pulses, ~1.9 Hz at most (well below any flicker threshold)
    this.hero.danceQueue = [now, now + 0.55, now + 1.1];
    this.hero.yawV += 3.2;
    this.pulse = 1;
    this.ctx.shock(x, y, 0.95);
    this.rings.emit(this.hero.pos, 5, 2.6, this.shared.uC2.value, now, undefined, 0.04);
    this.release(this.hero.pos, 60, 1.6);
    this.ctx.audio.double();
  }

  holdStart(x: number, y: number) {
    this.holdActive = true;
    this.holdPt.copy(this.worldAt(x, y));
    this.ctx.audio.holdStart();
  }

  holdEnd(x: number, y: number, e: number) {
    this.holdActive = false;
    this.spores.attractor = null; this.spores.attract = 0;
    this.hero.hold = 0; this.hero.pullAmt = 0;
    if (e < 0.04) { this.ctx.audio.holdEnd(0); return; }
    const k = this.ctx.intensity();
    this.hero.contract((9 + 9 * e) * (0.7 + 0.3 * k));
    // propelled away from where it was held, like a startled animal
    const away = this.tmp.copy(this.hero.pos).sub(this.holdPt); away.z = 0;
    if (away.lengthSq() > 1e-4) this.hero.vel.addScaledVector(away.normalize(), 1.1 * e * k);
    this.pulse = 0.5 + e * 0.7;
    this.ctx.shock(x, y, 0.6 + e * 0.9 * k);
    const t = this.shared.uTime.value;
    this.rings.emit(this.hero.pos, 3 + e * 4, 2.6, this.shared.uC0.value, t, undefined, 0.035);
    this.rings.emit(this.hero.pos, 2 + e * 5, 3.0, this.shared.uC1.value, t - 0.2, undefined, 0.03);
    this.release(this.hero.pos, 40 + e * 120, 1.2 + e * 1.6);
    this.ctx.audio.holdEnd(e);
  }

  drag(dx: number, dy: number) {
    // grabbing the water: tilt and turn the creature, which springs back
    this.hero.tiltVZ -= dx * 9;
    this.hero.tiltVX += dy * 6;
    this.hero.yawV += dx * 3.5;
    this.flowVel.x += dx * 0.5; this.flowVel.y += dy * 0.35;
  }

  swipe(vx: number, vy: number) {
    const k = this.ctx.intensity();
    this.hero.vel.x += vx * 0.45 * k; this.hero.vel.y += vy * 0.4 * k;
    this.hero.contract(5.5);
    this.flowVel.x += vx * 0.9; this.flowVel.y += vy * 0.7;
    this.pulse = Math.max(this.pulse, 0.3);
  }

  // --- frame ------------------------------------------------------------------
  update(dt: number, t: number, f: Frame) {
    const ctx = this.ctx;
    const k = ctx.intensity();
    this.shared.uTime.value = t;

    // mood glide (cyan/violet/pearl  <->  ice/rose  <->  teal/ultramarine/lime)
    const m = MOODS[this.mood], r = 1 - Math.exp(-dt * 1.3);
    this.shared.uC0.value.lerp(col(m[0]), r);
    this.shared.uC1.value.lerp(col(m[1]), r);
    this.shared.uC2.value.lerp(col(m[2]), r);

    // hold: creature gathers toward the finger, bell glows, plankton streams in
    if (this.holdActive) {
      this.holdPt.copy(this.worldAt(f.x, f.y));
      this.hero.hold = damp(this.hero.hold, f.energy, 5, dt);
      this.tmp.copy(this.holdPt).sub(this.hero.pos);
      this.hero.pullDir.copy(this.tmp).clampLength(0, 2.2).applyEuler(new THREE.Euler(-this.hero.tiltX, -this.hero.yaw, -this.hero.tiltZ, 'ZXY'));
      this.hero.pullAmt = f.energy * 0.9;
      this.hero.vel.addScaledVector(this.tmp.clampLength(0, 1.5), 0.25 * f.energy * dt);
      this.spores.attractor = this.holdPt;
      this.spores.attract = 5 + 18 * f.energy;
      const n = Math.floor((14 + 55 * f.energy) * ctx.quality.particles * dt + Math.random());
      const p = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        p.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1.4 + Math.random() * 1.5).add(this.holdPt);
        this.tmpC.copy(this.shared.uC0.value).lerp(this.shared.uC2.value, Math.random()).multiplyScalar(1.7);
        this.spores.emit(p, this.tmp.set(0, 0, 0), 1.2 + Math.random(), 0.05, this.tmpC);
      }
      ctx.audio.holdUpdate(f.energy);
      this.pulse = Math.max(this.pulse, f.energy * 0.35);
    }

    this.hero.update(dt, t, k);
    for (const j of this.others) j.update(dt, t, k);

    // plankton sway with swipes, then settle
    this.flowVel.addScaledVector(this.flowOff, -3 * dt).multiplyScalar(Math.exp(-1.5 * dt));
    this.flowOff.addScaledVector(this.flowVel, dt);
    this.flowOff.clampLength(0, 3);
    this.motes.uniforms.uFlow.value.copy(this.flowOff);

    // idle whisper: the creature beckons with an unprompted extra pulse and a spore
    if (t > this.nextWhisper) {
      this.nextWhisper = t + 9 + Math.random() * 9;
      this.release(this.hero.pos.clone().add(new THREE.Vector3(0, -0.4, 0)), 6, 0.5);
    }

    this.pulse = damp(this.pulse, 0, 1.7, dt);
    this.shared.uPulse.value = this.pulse * 0.4;
    this.spores.update(dt, t);
    this.rings.update(t, ctx.camera);

    this.sky.position.copy(ctx.camera.position);
    const fog = ctx.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.color.setRGB(0.004, 0.012, 0.04);

    // camera: slow breathing dolly, gentle pointer parallax
    const dist = fitDistance(9.0, ctx.aspect(), 40);
    const cam = ctx.camera;
    cam.position.x = damp(cam.position.x, Math.sin(t * 0.06) * 0.5 + f.x * 0.6, 1.3, dt);
    cam.position.y = damp(cam.position.y, 0.2 + f.y * 0.35 + Math.sin(t * 0.05) * 0.2, 1.3, dt);
    cam.position.z = damp(cam.position.z, dist + Math.sin(t * 0.04) * 0.3, 1.5, dt);
    cam.lookAt(0, -0.2 + this.hero.pos.y * 0.2, 0);
  }

  dispose() {
    this.hero.dispose();
    this.others.forEach((j) => j.dispose());
    this.skyGeo.dispose(); this.skyMat.dispose();
    this.motes.dispose(); this.spores.dispose(); this.rings.dispose();
  }
}
