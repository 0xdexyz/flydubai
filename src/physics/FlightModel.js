// Simplified arcade flight model (point mass + attitude).
//
// State: position, airspeed V, flight-path angle gamma, heading psi,
// pitch theta, bank phi, throttle / engine spool, gear, flaps, spoilers.
//
// Controls command pitch / roll *rates* (fly-by-wire feel: release the stick
// and the attitude holds). Lift depends on angle of attack (theta - gamma)
// and V^2, so the aircraft naturally trades speed and altitude, stalls when
// slow, and turns when banked. Bank up to 33 degrees is auto-compensated, so
// turns do not cost altitude — friendly, but still physical in feel.

import * as THREE from 'three';
import { DEG, approach, clamp, damp, lerp, wrapPi } from '../core/MathUtil.js';

export const G = 9.81;
export const MS_TO_KT = 1.943844;
export const KT_TO_MS = 1 / MS_TO_KT;
export const MS_TO_FPM = 196.850394;

export const FLAP_LABELS = ['UP', '1', '2', 'FULL'];

export const SPEC = Object.freeze({
  thrust: 3.3, // m/s^2 at full throttle
  liftK: 0.00668,
  alpha0Clean: 0.026,
  alpha0Flaps: [0, 0.055, 0.1, 0.145],
  alphaCrit: 0.26, // ~15 degrees
  dragBase: 7.5e-5,
  dragGear: 6e-5,
  dragFlaps: [0, 2.5e-5, 5.5e-5, 9.7e-5],
  dragSpoiler: 1.5e-4,
  dragGroundSpoiler: 3.2e-4,
  dragInduced: 0.0018,
  maxPitchRate: 5.5 * DEG,
  maxRollRate: 16 * DEG,
  maxYawRate: 2.5 * DEG,
  pitchMin: -20 * DEG,
  pitchMax: 25 * DEG,
  bankLimit: 67 * DEG,
  bankProtect: 33 * DEG,
  flapLimitKt: [999, 230, 200, 185],
  gearLimitKt: 260,
  gearTime: 4.5,
  flapRate: 0.55, // notches per second
  bellyClearance: 1.3,
  spoolTime: 1.4,
  brakeDecel: 3.4,
  rollingDecel: 0.12,
});

function interpTable(table, pos) {
  const i = Math.min(table.length - 2, Math.floor(pos));
  return lerp(table[i], table[i + 1], clamp(pos - i, 0, 1));
}

export class FlightModel {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.inputs = { pitch: 0, roll: 0, yaw: 0 };
    this.disturb = { pitchRate: 0, rollRate: 0 };
    this.events = [];
    this.reset({ x: 0, y: 1000, z: 0, speed: 120, gamma: 0, pitch: 0, bank: 0, heading: 0, throttle: 0.5 });
  }

  reset(init) {
    this.pos.set(init.x, init.y, init.z);
    this.vel.set(0, 0, 0);
    this.V = init.speed;
    this.gamma = init.gamma;
    this.theta = init.pitch;
    this.phi = init.bank;
    this.psi = init.heading;
    this.throttle = init.throttle;
    this.n1 = init.throttle;
    this.gearCmd = false;
    this.gearPos = 0;
    this.flapsCmd = 0;
    this.flapsPos = 0;
    this.spoilers = 0;
    this.braking = false;
    this.onGround = false;
    this.alpha = 0;
    this.cl = 0;
    this.stalled = false;
    this.gLoad = 1;
    this.vy = 0;
    this.frozen = false;
    this.inputs.pitch = this.inputs.roll = this.inputs.yaw = 0;
    this.disturb.pitchRate = this.disturb.rollRate = 0;
    this.events.length = 0;
  }

  get speedKt() {
    return this.V * MS_TO_KT;
  }
  get gearDown() {
    return this.gearPos > 0.995;
  }
  get alpha0() {
    return SPEC.alpha0Clean + interpTable(SPEC.alpha0Flaps, this.flapsPos);
  }
  /** Stall speed (m/s) in the current configuration, wings level. */
  get stallSpeed() {
    return Math.sqrt(G / (SPEC.liftK * (SPEC.alphaCrit + this.alpha0)));
  }

  setThrottle(v) {
    this.throttle = clamp(v, 0, 1);
  }
  toggleGear() {
    this.gearCmd = !this.gearCmd;
    return this.gearCmd;
  }
  flapsDown() {
    const prev = this.flapsCmd;
    this.flapsCmd = Math.min(3, this.flapsCmd + 1);
    return this.flapsCmd !== prev;
  }
  flapsUp() {
    const prev = this.flapsCmd;
    this.flapsCmd = Math.max(0, this.flapsCmd - 1);
    return this.flapsCmd !== prev;
  }

  liftCoefficient(alpha, a0) {
    if (alpha <= SPEC.alphaCrit) return Math.max(alpha + a0, -0.25);
    const peak = SPEC.alphaCrit + a0;
    return peak * Math.max(0.5, 1 - (alpha - SPEC.alphaCrit) * 3.5);
  }

  /**
   * Advance the simulation.
   * @param input  { pitch, roll, yaw, brake } in [-1, 1]
   * @param env    { pitchRate, rollRate, vertical, windX, windZ, groundHeight(x,z), surfaceAt(x,z) }
   */
  step(dt, input, env) {
    if (this.frozen) return;
    const I = this.inputs;
    I.pitch = damp(I.pitch, input.pitch, 5, dt);
    I.roll = damp(I.roll, input.roll, 6, dt);
    I.yaw = damp(I.yaw, input.yaw, 5, dt);
    this.braking = !!input.brake;

    this.n1 = damp(this.n1, this.throttle, 1 / SPEC.spoolTime, dt);
    this.gearPos = approach(this.gearPos, this.gearCmd ? 1 : 0, dt / SPEC.gearTime);
    this.flapsPos = approach(this.flapsPos, this.flapsCmd, dt * SPEC.flapRate);

    if (this.onGround) this.stepGround(dt, env);
    else this.stepAir(dt, env);
  }

  stepAir(dt, env) {
    const s = SPEC;
    const I = this.inputs;
    const V = Math.max(this.V, 1);
    const authority = clamp(V / 85, 0.3, 1);

    // Speed brakes in the air when the brake key is held.
    this.spoilers = approach(this.spoilers, this.braking ? 1 : 0, dt * 1.5);

    // --- pitch (rate command, attitude hold)
    const a0 = this.alpha0;
    let q = I.pitch * s.maxPitchRate * authority + env.pitchRate + this.disturb.pitchRate;
    const alphaNow = this.theta - this.gamma;
    this.stalled = alphaNow > s.alphaCrit;
    if (this.stalled) q -= (alphaNow - s.alphaCrit) * 2.2 + 0.035; // nose drops in a stall
    if (this.theta > s.pitchMax && q > 0) q *= 0.1;
    if (this.theta < s.pitchMin && q < 0) q *= 0.1;
    this.theta = clamp(this.theta + q * dt, -35 * DEG, 35 * DEG);

    // --- roll (rate command, bank hold with protection beyond 33 deg)
    let p = I.roll * s.maxRollRate * authority + env.rollRate + this.disturb.rollRate;
    if (Math.abs(I.roll) < 0.05) {
      const ab = Math.abs(this.phi);
      if (ab > s.bankProtect) p -= Math.sign(this.phi) * (4 * DEG + (ab - s.bankProtect) * 0.6);
      else p -= this.phi * 0.05; // very gentle wings-level tendency
    }
    this.phi = clamp(this.phi + p * dt, -s.bankLimit, s.bankLimit);

    // --- aerodynamics
    const alpha = this.theta - this.gamma;
    const cl = this.liftCoefficient(alpha, a0);
    const comp = 1 / Math.cos(Math.min(Math.abs(this.phi), s.bankProtect));
    // Ground effect: within ~half a wingspan of the surface the wing makes
    // extra lift, which cushions the flare (a forgiving, real phenomenon).
    const agl = this.pos.y - env.groundHeight(this.pos.x, this.pos.z);
    const ge = agl < 20 ? 1 + 0.16 * (1 - Math.max(0, agl) / 20) ** 2 : 1;
    const lift = s.liftK * V * V * cl * comp * ge;
    this.alpha = alpha;
    this.cl = cl;
    this.gLoad = lift / G;

    const gammaDot = (lift * Math.cos(this.phi) - G * Math.cos(this.gamma)) / V;
    this.gamma = clamp(this.gamma + gammaDot * dt, -1.2, 1.2);

    const drag = V * V * (
      s.dragBase +
      s.dragGear * this.gearPos +
      interpTable(s.dragFlaps, this.flapsPos) +
      s.dragSpoiler * this.spoilers +
      s.dragInduced * cl * cl * comp * comp
    );
    const vDot = s.thrust * this.n1 - drag - G * Math.sin(this.gamma);
    this.V = Math.max(25, V + vDot * dt);

    const psiDot = (lift * Math.sin(this.phi)) / (V * Math.max(0.2, Math.cos(this.gamma))) +
      I.yaw * s.maxYawRate * authority;
    this.psi = wrapPi(this.psi + psiDot * dt);

    // --- integrate position (air mass moves with the wind)
    const hv = this.V * Math.cos(this.gamma);
    const vx = hv * Math.sin(this.psi) + env.windX;
    const vz = -hv * Math.cos(this.psi) + env.windZ;
    const vy = this.V * Math.sin(this.gamma) + env.vertical;
    this.pos.x += vx * dt;
    this.pos.y += vy * dt;
    this.pos.z += vz * dt;
    this.vel.set(vx, vy, vz);
    this.vy = vy;

    // --- ground contact
    const h = env.groundHeight(this.pos.x, this.pos.z);
    const lowest = this.gearDown ? 0 : s.bellyClearance * (1 - this.gearPos * 0.6);
    if (this.pos.y + lowest <= h) {
      this.pos.y = h - lowest;
      this.onGround = true;
      this.events.push({
        type: 'contact',
        vsFpm: vy * MS_TO_FPM,
        speedKt: this.V * MS_TO_KT,
        pitch: this.theta,
        bank: this.phi,
        x: this.pos.x,
        z: this.pos.z,
        psi: this.psi,
        surface: env.surfaceAt(this.pos.x, this.pos.z),
        gearDown: this.gearDown,
      });
      this.gamma = 0;
      this.vy = 0;
    }
  }

  stepGround(dt, env) {
    const s = SPEC;
    const I = this.inputs;
    const V = this.V;

    // Ground spoilers deploy automatically once thrust is near idle.
    this.spoilers = approach(this.spoilers, this.throttle < 0.3 ? 1 : 0, dt * 2.5);
    this.gamma = 0;
    this.stalled = false;

    // De-rotation: the nose settles onto the nose gear unless held up.
    if (I.pitch > 0.2 && V > 45) this.theta = Math.min(this.theta + 1.5 * DEG * dt, 9 * DEG);
    else this.theta = damp(this.theta, 0, 1.6, dt);
    this.theta = Math.max(0, this.theta);
    this.phi = damp(this.phi, 0, 6, dt);

    // Nose-wheel steering + rudder.
    const steer = clamp(I.yaw + I.roll * 0.6, -1, 1);
    const steerRate = lerp(12 * DEG, 2.2 * DEG, clamp(V / 70, 0, 1));
    this.psi = wrapPi(this.psi + steer * steerRate * dt);

    const drag = V * V * (
      s.dragBase + s.dragGear * this.gearPos + interpTable(s.dragFlaps, this.flapsPos) +
      s.dragGroundSpoiler * this.spoilers
    );
    const brake = this.braking ? s.brakeDecel : 0;
    const vDot = s.thrust * this.n1 - drag - (V > 0.05 ? s.rollingDecel + brake : 0);
    this.V = Math.max(0, V + vDot * dt);

    const vx = this.V * Math.sin(this.psi);
    const vz = -this.V * Math.cos(this.psi);
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;
    const lowest = this.gearDown ? 0 : s.bellyClearance * (1 - this.gearPos * 0.6);
    this.pos.y = env.groundHeight(this.pos.x, this.pos.z) - lowest;
    this.vel.set(vx, 0, vz);
    this.vy = 0;
    this.gLoad = 1;
  }
}
