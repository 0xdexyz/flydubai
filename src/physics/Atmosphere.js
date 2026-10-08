// Wind and turbulence. Turbulence is built from layered smooth noise so it
// feels organic but costs only a few multiplications per step.

import { DEG, clamp, damp, lerp, noise1, smoothstep } from '../core/MathUtil.js';
import { HEADING_OFFSET } from '../world/Route.js';

const KT = 0.514444;

export class Atmosphere {
  constructor() {
    this.reset();
  }

  reset(seed = 1 + Math.floor(Math.random() * 1000)) {
    this.seed = seed;
    this.time = 0;
    this.turbulence = 0;
    this.turbTarget = 0;
    this.windFrom = 300; // displayed degrees
    this.windAloft = 0; // kt
    this.windSurface = 0; // kt
    this.windScale = 0; // 0..1 ramp so wind fades in
    this.windScaleTarget = 0;
    this.cloudBoost = 0;
    this.jolt = 0;
    this.joltTimer = 6;
    this.joltsEnabled = false;
    // outputs
    this.pitchRate = 0;
    this.rollRate = 0;
    this.vertical = 0;
    this.windX = 0;
    this.windZ = 0;
    this.shake = 0;
  }

  setTurbulence(level) {
    this.turbTarget = level;
  }

  setWind(fromDeg, aloftKt, surfaceKt) {
    this.windFrom = fromDeg;
    this.windAloft = aloftKt;
    this.windSurface = surfaceKt;
    this.windScaleTarget = 1;
  }

  /** Wind speed (kt) at world height y. */
  windKtAt(y) {
    return lerp(this.windSurface, this.windAloft, smoothstep(0, 1600, y)) * this.windScale;
  }

  update(dt, y, inCloud) {
    this.time += dt;
    const t = this.time;
    const s = this.seed;

    this.cloudBoost = damp(this.cloudBoost, inCloud ? 0.45 : 0, 3, dt);
    this.turbulence = damp(this.turbulence, this.turbTarget, 0.8, dt);
    // Turbulence weakens close to the ground so the flare stays controllable.
    const k = (this.turbulence + this.cloudBoost) * lerp(0.35, 1, smoothstep(10, 300, y));

    // Occasional sharp bumps during the stabilisation phase.
    if (this.joltsEnabled) {
      this.joltTimer -= dt;
      if (this.joltTimer <= 0) {
        this.jolt = 1;
        this.joltTimer = 7 + ((Math.sin(t * 12.9898 + s) * 43758.5453) % 1 + 1) % 1 * 9;
      }
    }
    this.jolt = Math.max(0, this.jolt - dt * 1.6);
    const j = this.jolt * this.jolt;

    this.pitchRate = k * (noise1(t * 0.8, s) * 0.9 + noise1(t * 2.6, s + 1) * 0.45) * DEG +
      j * noise1(t * 9, s + 9) * 2.2 * DEG;
    this.rollRate = k * (noise1(t * 0.6, s + 2) * 2.4 + noise1(t * 3.1, s + 3) * 1.1) * DEG +
      j * noise1(t * 7, s + 10) * 5 * DEG;
    this.vertical = k * (noise1(t * 0.5, s + 4) * 1.4 + noise1(t * 1.7, s + 5) * 0.7) - j * 3.5;
    this.shake = clamp(k * 0.7 + j * 1.2, 0, 1.5);

    this.windScale = damp(this.windScale, this.windScaleTarget, 0.25, dt);
    const speed = this.windKtAt(y) * KT;
    // Wind blows FROM windFrom, so it moves air toward windFrom + 180.
    const toWorld = (this.windFrom + 180 - HEADING_OFFSET) * DEG;
    this.windX = Math.sin(toWorld) * speed;
    this.windZ = -Math.cos(toWorld) * speed;
  }
}
