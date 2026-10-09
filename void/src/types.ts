import type * as THREE from 'three';
import type { AudioEngine } from './audio';

export interface Quality {
  tier: 'high' | 'mid' | 'low';
  detail: number; // geometry subdivision budget
  particles: number; // 0..1 particle multiplier
}

export interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  quality: Quality;
  audio: AudioEngine;
  /** 1 = full intensity, ~0.45 = calm mode (smoothed). */
  intensity: () => number;
  /** screen-space shockwave at NDC position */
  shock: (x: number, y: number, strength: number) => void;
  aspect: () => number;
}

export interface Frame {
  x: number; // smoothed pointer, NDC
  y: number;
  down: boolean;
  holding: boolean;
  energy: number; // 0..1 hold charge
}

export interface World {
  id: string;
  name: string;
  accent: string; // css colour used by UI
  accentVec: [number, number, number]; // linear-ish rgb for portal tint
  root: THREE.Group;
  enter(): void;
  update(dt: number, t: number, f: Frame): void;
  tap(x: number, y: number): void;
  double(x: number, y: number): void;
  holdStart(x: number, y: number): void;
  holdEnd(x: number, y: number, energy: number): void;
  drag(dx: number, dy: number): void; // NDC deltas
  swipe(vx: number, vy: number): void; // NDC / second
  /** Active particle fraction when adaptive quality degrades. */
  setParticleScale(s: number): void;
  dispose(): void;
}
