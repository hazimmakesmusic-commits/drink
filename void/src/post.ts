import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const WarpShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uShock: { value: [new THREE.Vector4(0, 0, -1, 0), new THREE.Vector4(0, 0, -1, 0), new THREE.Vector4(0, 0, -1, 0), new THREE.Vector4(0, 0, -1, 0)] },
    uPortal: { value: 0 }, // 0..1 transition progress, 0 = off
    uPortalDir: { value: 1 },
    uTint: { value: new THREE.Color(0.4, 0.5, 1) },
    uAberr: { value: 0.0015 },
    uVignette: { value: 0.75 },
    uGrain: { value: 0.025 },
    uCalm: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uPortal, uPortalDir, uAberr, uVignette, uGrain, uCalm;
    uniform vec4 uShock[4];
    uniform vec3 uTint;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec2 uv=vUv;
      vec2 ctr=vec2(0.5);
      vec2 q=(uv-ctr)*vec2(uAspect,1.0);
      float r=length(q);
      // tap shockwaves: ring-shaped refractive distortion through the whole scene
      vec2 off=vec2(0.0);
      float ab=uAberr;
      for(int i=0;i<4;i++){
        vec4 s=uShock[i];
        if(s.z>=0.0){
          vec2 sc=(s.xy*0.5+0.5);
          vec2 dq=(uv-sc)*vec2(uAspect,1.0);
          float d=length(dq);
          float rad=s.z*0.75;
          float x=d-rad;
          float env=exp(-x*x*70.0)*exp(-s.z*1.6)*s.w;
          vec2 dir=dq/(d+1e-4);
          off+=dir*vec2(1.0/uAspect,1.0)*sin(x*55.0)*env*0.022;
          ab+=env*0.004;
        }
      }
      // portal: swirling zoom tunnel with a dark dip at the midpoint (never a white flash)
      float dip=0.0; float ringGlow=0.0;
      if(uPortal>0.0){
        float p=uPortal;
        float strength=sin(p*3.14159265);
        float swirl=strength*1.5*uPortalDir*exp(-r*1.8);
        float c=cos(swirl), s2=sin(swirl);
        q=mat2(c,-s2,s2,c)*q;
        q*=1.0-strength*0.55*(1.0-0.6*r);
        uv=q/vec2(uAspect,1.0)+ctr;
        ab+=strength*0.012;
        dip=smoothstep(0.28,0.5,p)*(1.0-smoothstep(0.5,0.72,p));
        float rr=mix(1.1,0.0,smoothstep(0.1,0.9,p));
        ringGlow=exp(-pow((r-rr)*5.0,2.0))*strength;
      }
      uv+=off;
      vec2 dirv=normalize(uv-ctr+1e-5);
      float rl=length(uv-ctr);
      vec3 col;
      col.r=texture2D(tDiffuse,uv+dirv*ab*rl*2.0).r;
      col.g=texture2D(tDiffuse,uv).g;
      col.b=texture2D(tDiffuse,uv-dirv*ab*rl*2.0).b;
      if(uPortal>0.0){
        float st=sin(uPortal*3.14159265)*0.05;
        for(int i=1;i<4;i++){ col+=texture2D(tDiffuse,(uv-ctr)*(1.0-st*float(i))+ctr).rgb*0.28; }
        col/=1.84;
      }
      col*=1.0-dip*0.97;
      col+=uTint*ringGlow*0.5*(1.0-uCalm*0.5);
      float v=smoothstep(1.25,0.25,r*(0.95+uVignette*0.25));
      col*=mix(1.0,v,0.85);
      float ign=fract(52.9829189*fract(dot(gl_FragCoord.xy+floor(uTime*24.0)*vec2(13.7,5.3),vec2(0.06711056,0.00583715))));
      col+=(ign-0.5)*uGrain;
      gl_FragColor=vec4(max(col,0.0),1.0);
    }`,
};

export class PostStack {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  warp: ShaderPass;
  private shocks: { x: number; y: number; t0: number; s: number }[] = [];
  private bloomOn = true;
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, size: THREE.Vector2, bloomOn: boolean, samples: number) {
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size.clone().multiplyScalar(0.5), 0.55, 0.7, 0.8);
    this.composer.addPass(this.bloom);
    this.warp = new ShaderPass(WarpShader);
    this.composer.addPass(this.warp);
    this.composer.addPass(new OutputPass());
    this.setBloom(bloomOn);
  }
  setBloom(on: boolean) {
    this.bloomOn = on;
    this.bloom.enabled = on;
  }
  get bloomEnabled() { return this.bloomOn; }
  setSize(w: number, h: number, pr: number) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    this.warp.uniforms.uAspect.value = w / h;
  }
  shock(x: number, y: number, s: number, t: number) {
    this.shocks.push({ x, y, t0: t, s });
    if (this.shocks.length > 4) this.shocks.shift();
  }
  update(t: number, calm: number) {
    const u = this.warp.uniforms;
    u.uTime.value = t % 100;
    u.uCalm.value = calm;
    const arr = u.uShock.value as THREE.Vector4[];
    this.shocks = this.shocks.filter((s) => t - s.t0 < 3);
    for (let i = 0; i < 4; i++) {
      const s = this.shocks[i];
      if (s) arr[i].set(s.x, s.y, t - s.t0, s.s);
      else arr[i].set(0, 0, -1, 0);
    }
  }
  render() {
    this.composer.render();
  }
  dispose() {
    this.composer.dispose();
  }
}
