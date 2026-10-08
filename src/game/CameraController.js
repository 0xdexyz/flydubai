// Camera modes:
//  cockpit   – first-person from the captain's seat (overlay interior on)
//  chase     – third-person behind the aircraft, smoothed in aircraft space
//  orbit     – slow orbit for the menu and result screens
//  cinematic – a pose supplied each frame by the cinematic director, either
//              exterior (relative to the aircraft) or interior (aircraft-local)
//
// The overlay (cockpit/cabin) scene is authored in aircraft-local
// coordinates. For any interior pose the overlay camera sits at that local
// pose and the world camera at aircraft-matrix x local pose, so the world
// seen through the windshield always matches the interior.

import * as THREE from 'three';
import { clamp, damp, noise1 } from '../core/MathUtil.js';
import { EYE } from '../aircraft/AircraftModel.js';
import { VIEW_PITCH } from '../aircraft/Cockpit.js';

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const chaseQ = new THREE.Quaternion();
const frameQ = new THREE.Quaternion();
const lookM = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
export const COCKPIT_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), VIEW_PITCH);

/** Quaternion that looks from `eye` to `target` (both in the same frame). */
export function lookQuat(eye, target, out = new THREE.Quaternion(), up = UP) {
  lookM.lookAt(eye, target, up);
  return out.setFromRotationMatrix(lookM);
}

export class CameraController {
  constructor(renderer, aircraft) {
    this.renderer = renderer;
    this.camera = renderer.camera;
    this.overlayCamera = renderer.overlayCamera;
    this.aircraft = aircraft;
    this.mode = 'cockpit';
    this.offset = new THREE.Vector3(0, 9, 42);
    this.orbitAngle = 0.6;
    this.orbitTarget = new THREE.Vector3();
    this.orbitRadius = 60;
    this.orbitHeight = 12;
    this.impulse = 0;
    this.time = 0;
    this.near = 1;
    this.cine = {
      interior: false,
      frame: 'aircraft', // exterior reference frame: aircraft | yaw | chase
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      shake: 0,
    };
    this.onModeChange = null;
  }

  setMode(mode) {
    this.mode = mode;
    this.applyVisibility();
  }

  applyVisibility() {
    const interior = this.mode === 'cockpit' || (this.mode === 'cinematic' && this.cine.interior);
    this.renderer.overlayVisible = interior;
    this.aircraft.setVisible(!interior);
    this.onModeChange?.(interior);
  }

  /** Cinematic pose for this frame. `pos`/`quat` are in the chosen frame. */
  setCinematicPose(interior, frame, pos, quat, shake = 0) {
    const c = this.cine;
    const changed = c.interior !== interior;
    c.interior = interior;
    c.frame = frame;
    c.pos.copy(pos);
    c.quat.copy(quat);
    c.shake = shake;
    if (changed && this.mode === 'cinematic') this.applyVisibility();
  }

  reset() {
    this.offset.set(0, 9, 42);
    this.impulse = 0;
  }

  /** One-off camera kick (touchdown, crash). */
  kick(amount) {
    this.impulse = Math.max(this.impulse, amount);
  }

  setOrbit(target, radius = 60, height = 12) {
    this.orbitTarget.copy(target);
    this.orbitRadius = radius;
    this.orbitHeight = height;
  }

  update(dt, fm, { shake = 0, groundHeight }) {
    this.time += dt;
    this.impulse = Math.max(0, this.impulse - dt * 2.2);
    const s = (shake + (this.mode === 'cinematic' ? this.cine.shake : 0)) * 0.0035 + this.impulse * 0.02;
    const t = this.time;
    tmpQ.setFromEuler(tmpE.set(noise1(t * 14, 1) * s, noise1(t * 13, 2) * s, noise1(t * 11, 3) * s * 0.6));

    const cam = this.camera;
    const g = this.aircraft.group;
    g.updateMatrixWorld();

    if (this.mode === 'cockpit' || (this.mode === 'cinematic' && this.cine.interior)) {
      const localPos = this.mode === 'cockpit' ? EYE : this.cine.pos;
      const localQuat = this.mode === 'cockpit' ? COCKPIT_QUAT : this.cine.quat;
      cam.position.copy(localPos).applyMatrix4(g.matrixWorld);
      cam.quaternion.copy(g.quaternion).multiply(localQuat).multiply(tmpQ);
      this.overlayCamera.position.copy(localPos);
      this.overlayCamera.quaternion.copy(localQuat).multiply(tmpQ);
      const far = this.mode === 'cockpit' ? 8 : 40;
      if (this.overlayCamera.far !== far) {
        this.overlayCamera.far = far;
        this.overlayCamera.updateProjectionMatrix();
      }
      this.setNear(clamp((fm.pos.y - groundHeight(cam.position.x, cam.position.z)) * 0.04, 0.5, 12));
    } else if (this.mode === 'cinematic') {
      const c = this.cine;
      if (c.frame === 'yaw') frameQ.setFromEuler(tmpE.set(0, -fm.psi, 0, 'YXZ'));
      else if (c.frame === 'chase') frameQ.setFromEuler(tmpE.set(fm.theta * 0.5, -fm.psi, -fm.phi * 0.35, 'YXZ'));
      else frameQ.copy(g.quaternion);
      cam.position.copy(c.pos).applyQuaternion(frameQ).add(fm.pos);
      cam.quaternion.copy(frameQ).multiply(c.quat).multiply(tmpQ);
      this.setNear(1.5);
    } else if (this.mode === 'chase') {
      // Follow yaw fully, pitch partially; never roll the camera.
      tmpE.set(fm.theta * 0.35, -fm.psi, 0, 'YXZ');
      const q = chaseQ.setFromEuler(tmpE);
      tmpV.set(0, 9, 42).applyQuaternion(q);
      this.offset.x = damp(this.offset.x, tmpV.x, 4, dt);
      this.offset.y = damp(this.offset.y, tmpV.y, 4, dt);
      this.offset.z = damp(this.offset.z, tmpV.z, 4, dt);
      cam.position.copy(fm.pos).add(this.offset);
      const gh = groundHeight(cam.position.x, cam.position.z) + 2.5;
      if (cam.position.y < gh) cam.position.y = gh;
      tmpV.set(0, 3, -18).applyQuaternion(q).add(fm.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(tmpV);
      cam.quaternion.multiply(tmpQ);
      this.setNear(2);
    } else {
      this.orbitAngle += dt * 0.07;
      const r = this.orbitRadius;
      cam.position.set(
        this.orbitTarget.x + Math.sin(this.orbitAngle) * r,
        this.orbitTarget.y + this.orbitHeight,
        this.orbitTarget.z + Math.cos(this.orbitAngle) * r
      );
      const gh = groundHeight(cam.position.x, cam.position.z) + 3;
      if (cam.position.y < gh) cam.position.y = gh;
      cam.up.set(0, 1, 0);
      cam.lookAt(this.orbitTarget);
      this.setNear(2);
    }
  }

  setNear(n) {
    if (Math.abs(n - this.near) / this.near < 0.1) return;
    this.near = n;
    this.camera.near = n;
    this.camera.updateProjectionMatrix();
  }
}
