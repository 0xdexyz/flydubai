// First-person cockpit: dashboard, glareshield, window posts and live
// instrument screens. Rendered as an overlay scene (see Renderer.js).
// Instruments are drawn into a single 1024x224 canvas atlas (four screens)
// and re-uploaded ~12 times per second — one texture, one material.

import * as THREE from 'three';
import { DEG, RAD, clamp, formatInt, wrap360 } from '../core/MathUtil.js';
import { paint, merge } from '../world/Geometry.js';
import { FLAP_LABELS } from '../physics/FlightModel.js';
import { APPROACH_FIX, GATE, HEADING_OFFSET, RUNWAY } from '../world/Route.js';
import { EYE } from './AircraftModel.js';

const SLOT_W = 256;
const SLOT_H = 224;
export const VIEW_PITCH = -4 * DEG; // look slightly down over the nose
// The pilot sits in the left seat: cockpit geometry is shifted right of the eye,
// so the centre window post is off to the side instead of over the runway.
export const SEAT_OFFSET = 0.48;

function beam(a, b, w, d, color) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.BoxGeometry(w, len, d);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return paint(g, color);
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Cockpit {
  constructor(scene) {
    this.scene = scene;
    // The overlay scene is in aircraft-local coordinates; the cockpit geometry
    // is authored relative to the captain's eye, then placed there.
    this.group = new THREE.Group();
    this.group.position.set(EYE.x + SEAT_OFFSET, EYE.y, EYE.z);
    scene.add(this.group);

    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x2a2622, 1.1);
    this.sun = new THREE.DirectionalLight(0xfff2e0, 1.4);
    scene.add(this.hemi, this.sun, this.sun.target);

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.buildShell();
    this.buildScreens();
    this.buildIndicators();
    this.timer = 0;
  }

  buildShell() {
    const panel = 0x2c3238;
    const frame = 0x3a4048;
    const dark = 0x1d2126;
    const parts = [];

    // Main instrument panel, tilted toward the pilot (top edge y=-0.25, z=-0.74).
    const p = new THREE.PlaneGeometry(2.64, 0.56);
    p.rotateX(-14 * DEG);
    p.translate(0, -0.25 - 0.28 * Math.cos(14 * DEG), -0.74 + 0.28 * Math.sin(14 * DEG));
    parts.push(paint(p, panel));
    // Lower knee panel
    parts.push(paint(new THREE.BoxGeometry(2.64, 0.3, 0.05).translate(0, -0.92, -0.6), dark));

    // Glareshield (kept shallow so the view over the nose stays open) + FCU strip
    parts.push(paint(new THREE.BoxGeometry(2.64, 0.05, 0.24).translate(0, -0.225, -0.835), dark));
    parts.push(paint(new THREE.BoxGeometry(2.64, 0.05, 0.02).translate(0, -0.225, -0.715), frame));
    parts.push(paint(new THREE.BoxGeometry(0.86, 0.036, 0.01).translate(0, -0.226, -0.703), 0x23282e));
    for (let i = 0; i < 6; i++) {
      const knob = new THREE.CylinderGeometry(0.009, 0.011, 0.014, 8);
      knob.rotateX(Math.PI / 2);
      knob.translate(-0.33 + i * 0.13, -0.226, -0.694);
      parts.push(paint(knob, 0x8d949c));
    }

    // Window posts (windshield + side windows) — slim so the view stays open.
    for (const s of [1, -1]) {
      parts.push(beam(V(s * 0.98, -0.215, -0.93), V(s * 0.86, 0.5, -0.6), 0.045, 0.035, frame));
      parts.push(beam(V(s * 0.98, -0.215, -0.93), V(s * 1.4, -0.2, -0.55), 0.03, 0.03, frame));
      // Side consoles
      parts.push(paint(new THREE.BoxGeometry(0.2, 0.2, 0.9).translate(s * 1.18, -0.36, -0.45), panel));
    }
    parts.push(beam(V(0, -0.215, -1.02), V(0, 0.5, -0.66), 0.028, 0.025, frame));
    // Roof / overhead panel edge
    parts.push(paint(new THREE.BoxGeometry(2.64, 0.08, 1.2).translate(0, 0.52, -0.05), 0x2f353c));
    parts.push(beam(V(-0.55, 0.47, -0.6), V(0.55, 0.47, -0.6), 0.06, 0.06, frame));

    // Gear lever housing
    parts.push(paint(new THREE.BoxGeometry(0.06, 0.1, 0.03).translate(0.28, -0.39, -0.712), 0x23282e));

    const mesh = new THREE.Mesh(merge(parts), this.material);
    this.group.add(mesh);
  }

  buildScreens() {
    const canvas = document.createElement('canvas');
    canvas.width = SLOT_W * 4;
    canvas.height = SLOT_H;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });

    const screens = [
      { slot: 0, x: -0.63 },
      { slot: 1, x: -0.395 },
      { slot: 2, x: -0.125 },
      { slot: 3, x: 0.145 },
      { slot: 1, x: 0.415 },
      { slot: 0, x: 0.65 },
    ];
    const w = 0.2;
    const h = (w * SLOT_H) / SLOT_W;
    const sy = -0.258 - h / 2; // screen centre height, just under the glareshield
    const geos = [];
    for (const s of screens) {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (s.slot + uv.getX(i)) / 4);
      g.rotateX(-14 * DEG);
      g.translate(s.x, sy, -0.706);
      geos.push(g);
      // Bezel
      const b = new THREE.BoxGeometry(w + 0.016, h + 0.016, 0.01);
      b.rotateX(-14 * DEG);
      b.translate(s.x, sy, -0.713);
      geos.bezel = geos.bezel || [];
      geos.bezel.push(paint(b, 0x15181c));
    }
    this.group.add(new THREE.Mesh(merge(geos.bezel), this.material));
    const screenGeo = geos.length > 1 ? merge(geos.map((g) => {
      g.deleteAttribute('normal');
      return g;
    })) : geos[0];
    this.group.add(new THREE.Mesh(screenGeo, mat));
  }

  buildIndicators() {
    // Master warning / caution annunciators on the glareshield.
    this.warnMat = new THREE.MeshBasicMaterial({ color: 0x3a1010, toneMapped: false });
    this.cautionMat = new THREE.MeshBasicMaterial({ color: 0x3a2a08, toneMapped: false });
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.03), this.warnMat);
      w.position.set(s * 0.52, -0.226, -0.7035);
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.03), this.cautionMat);
      c.position.set(s * 0.6, -0.226, -0.7035);
      this.group.add(w, c);
    }
    // Gear lever (animated) + three gear lights
    this.gearLever = new THREE.Group();
    const handle = new THREE.Mesh(
      paint(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6).translate(0, 0.035, 0), 0xb9c0c8),
      this.material
    );
    const knob = new THREE.Mesh(paint(new THREE.CylinderGeometry(0.018, 0.018, 0.016, 10).rotateX(Math.PI / 2).translate(0, 0.07, 0), 0xe8ecef), this.material);
    this.gearLever.add(handle, knob);
    this.gearLever.position.set(0.28, -0.415, -0.7);
    this.group.add(this.gearLever);
    this.gearLightMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: 0x0b1a0e, toneMapped: false }));
    this.gearLightMats.forEach((m, i) => {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.014), m);
      l.position.set(0.268 + (i % 2) * 0.024 + (i === 2 ? 0.012 : 0), -0.3 - (i === 2 ? 0.018 : 0), -0.722);
      l.rotation.x = -14 * DEG;
      this.group.add(l);
    });
  }

  /** Point cockpit lighting from the real sun direction (in aircraft space). */
  updateLighting(worldSunDir, aircraftQuat) {
    const inv = aircraftQuat.clone().invert();
    this.sun.position.copy(worldSunDir).applyQuaternion(inv).multiplyScalar(10);
  }

  update(dt, tele, warnings) {
    // Annunciators
    const crit = warnings.some((w) => w.level === 'critical');
    const caut = warnings.some((w) => w.level === 'caution');
    const blink = (performance.now() % 600) < 380;
    this.warnMat.color.setHex(crit && blink ? 0xff2d2d : 0x3a1010);
    this.cautionMat.color.setHex(caut ? 0xffb020 : 0x3a2a08);

    // Gear lever and lights
    this.gearLever.rotation.x = tele.gearCmd ? 0.9 : -0.6;
    const moving = tele.gearPos > 0.01 && tele.gearPos < 0.99;
    for (const m of this.gearLightMats) m.color.setHex(tele.gearPos >= 0.99 ? 0x2bff62 : moving ? 0xff3030 : 0x0b1a0e);

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 12;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawPFD(ctx, 0, tele);
    this.drawND(ctx, SLOT_W, tele);
    this.drawEICAS(ctx, SLOT_W * 2, tele, warnings);
    this.drawStatus(ctx, SLOT_W * 3, tele);
    this.texture.needsUpdate = true;
  }

  drawPFD(ctx, ox, t) {
    const W = SLOT_W;
    const H = SLOT_H;
    const cx = ox + W / 2;
    const cy = H / 2 - 6;
    const ppd = 4.2; // pixels per degree of pitch
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox + 40, 14, W - 80, H - 44);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-t.bankDeg * DEG);
    ctx.translate(0, t.pitchDeg * ppd);
    ctx.fillStyle = '#2a7fd0';
    ctx.fillRect(-300, -600, 600, 600);
    ctx.fillStyle = '#7a4f2a';
    ctx.fillRect(-300, 0, 600, 600);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-300, 0);
    ctx.lineTo(300, 0);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.font = '10px monospace';
    ctx.fillStyle = '#fff';
    for (let p = -30; p <= 30; p += 5) {
      if (p === 0) continue;
      const y = -p * ppd;
      const w = p % 10 === 0 ? 34 : 16;
      ctx.beginPath();
      ctx.moveTo(-w, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      if (p % 10 === 0) ctx.fillText(String(Math.abs(p)), w + 3, y + 3);
    }
    ctx.restore();

    // Aircraft symbol
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - 44, cy);
    ctx.lineTo(cx - 16, cy);
    ctx.lineTo(cx - 10, cy + 7);
    ctx.moveTo(cx + 44, cy);
    ctx.lineTo(cx + 16, cy);
    ctx.lineTo(cx + 10, cy + 7);
    ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(cx - 3, cy - 3, 6, 6);

    // Speed and altitude tapes (simplified boxes)
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(ox, 14, 40, H - 44);
    ctx.fillRect(ox + W - 40, 14, 40, H - 44);
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + 2, cy - 11, 36, 22);
    ctx.strokeRect(ox + W - 42, cy - 11, 40, 22);
    ctx.fillStyle = t.speedKt > 340 || t.stalled ? '#ff4d4d' : '#ffffff';
    ctx.fillText(String(Math.round(t.speedKt)), ox + 20, cy + 5);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(String(Math.round(t.altFt / 10) * 10), ox + W - 21, cy + 5);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#5fe3ff';
    if (t.targets?.spd) ctx.fillText(String(t.targets.spd), ox + 20, 26);
    if (t.targets?.alt) ctx.fillText(String(t.targets.alt), ox + W - 21, 26);
    ctx.fillStyle = t.vsFpm < -3000 ? '#ffd23f' : '#9fe8a8';
    ctx.fillText(`${t.vsFpm >= 0 ? '+' : ''}${Math.round(t.vsFpm / 100) * 100}`, ox + W - 21, H - 36);

    // Heading strip
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(ox, H - 30, W, 30);
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    for (let d = -30; d <= 30; d += 10) {
      const hd = wrap360(Math.round(t.hdg / 10) * 10 + d);
      const x = cx + (hd - t.hdg + (Math.abs(hd - t.hdg) > 180 ? (hd > t.hdg ? -360 : 360) : 0)) * 3;
      ctx.fillText(String(Math.round(hd / 10)).padStart(2, '0'), x, H - 12);
    }
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(cx - 1, H - 30, 2, 8);
    ctx.textAlign = 'start';
  }

  drawND(ctx, ox, t) {
    const W = SLOT_W;
    const H = SLOT_H;
    ctx.fillStyle = '#05080c';
    ctx.fillRect(ox, 0, W, H);
    const cx = ox + W / 2;
    const cy = H - 34;
    const rangeNm = t.phase >= 3 ? 5 : t.phase === 2 ? 12 : 20;
    const ppm = (H - 50) / (rangeNm * 1852);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, 0, W, H);
    ctx.clip();
    // Compass arc
    ctx.strokeStyle = '#d7dde4';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, H - 50, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, (H - 50) / 2, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.setLineDash([]);

    const psi = (t.hdg - HEADING_OFFSET) * DEG;
    const project = (x, z) => {
      const dx = x - t.x;
      const dz = z - t.z;
      // rotate world into heading-up frame
      const right = dx * Math.cos(psi) + dz * Math.sin(psi);
      const fwd = dx * Math.sin(psi) - dz * Math.cos(psi);
      return [cx + right * ppm, cy - fwd * ppm];
    };
    // Route
    ctx.strokeStyle = '#ff5fd2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let first = true;
    const pts = [[APPROACH_FIX.x, APPROACH_FIX.z], [GATE.x, GATE.z], [0, RUNWAY.thresholdZ]];
    for (const [x, z] of pts) {
      const [sx, sy] = project(x, z);
      if (first) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
      first = false;
    }
    ctx.stroke();
    ctx.font = '10px monospace';
    [['APCH', APPROACH_FIX], ['GATE', GATE]].forEach(([label, w]) => {
      const [sx, sy] = project(w.x, w.z);
      ctx.fillStyle = '#e8edf2';
      ctx.fillRect(sx - 3, sy - 3, 6, 6);
      ctx.fillText(label, sx + 6, sy + 3);
    });
    const [tx, ty] = project(0, 0);
    ctx.fillStyle = '#5fe3ff';
    ctx.fillText('TABUK', tx + 8, ty - 6);
    // Runway
    const [ax, ay] = project(0, RUNWAY.thresholdZ);
    const [bx, by] = project(0, RUNWAY.endZ);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();

    // Own ship
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx - 7, cy + 8);
    ctx.lineTo(cx + 7, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8edf2';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`HDG ${String(Math.round(t.hdg)).padStart(3, '0')}`, ox + 8, 16);
    ctx.fillStyle = '#5fe3ff';
    ctx.fillText(`${rangeNm} NM`, ox + W - 52, 16);
    if (t.navName) {
      ctx.fillStyle = '#ff5fd2';
      ctx.fillText(`${t.navName} ${t.navDistNm.toFixed(1)}`, ox + 8, H - 8);
    }
  }

  drawEICAS(ctx, ox, t, warnings) {
    const W = SLOT_W;
    const H = SLOT_H;
    ctx.fillStyle = '#05080c';
    ctx.fillRect(ox, 0, W, H);
    // N1 gauges
    for (let e = 0; e < 2; e++) {
      const cx = ox + 64 + e * 128;
      const cy = 56;
      const r = 34;
      ctx.strokeStyle = '#3c4650';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 2.2);
      ctx.stroke();
      const n1 = clamp(t.n1, 0, 1);
      ctx.strokeStyle = n1 > 0.95 ? '#ffd23f' : '#3ee08f';
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * n1));
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText((22 + n1 * 78).toFixed(1), cx, cy + 6);
      ctx.font = '9px monospace';
      ctx.fillStyle = '#8a96a3';
      ctx.fillText(`N1 ENG ${e + 1}`, cx, cy + 46);
    }
    ctx.textAlign = 'start';
    // Gear + flaps
    ctx.font = 'bold 11px monospace';
    const gy = 128;
    ctx.fillStyle = '#8a96a3';
    ctx.fillText('GEAR', ox + 12, gy);
    const gearColor = t.gearPos >= 0.99 ? '#3ee08f' : t.gearPos > 0.01 ? '#ff4d4d' : '#55606b';
    const gearText = t.gearPos >= 0.99 ? 'DN' : t.gearPos > 0.01 ? '...' : 'UP';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = gearColor;
      ctx.strokeRect(ox + 56 + i * 32, gy - 12, 26, 16);
      ctx.fillStyle = gearColor;
      ctx.fillText(gearText, ox + 60 + i * 32, gy);
    }
    ctx.fillStyle = '#8a96a3';
    ctx.fillText('FLAPS', ox + 12, gy + 24);
    ctx.fillStyle = '#5fe3ff';
    ctx.fillText(FLAP_LABELS[t.flapsCmd] + (Math.abs(t.flapsPos - t.flapsCmd) > 0.02 ? ' ▸' : ''), ox + 64, gy + 24);
    ctx.fillStyle = '#8a96a3';
    ctx.fillText('SPD BRK', ox + 132, gy + 24);
    ctx.fillStyle = t.spoilers > 0.05 ? '#3ee08f' : '#55606b';
    ctx.fillText(t.spoilers > 0.05 ? 'EXT' : 'RET', ox + 196, gy + 24);
    // Warnings
    let y = gy + 50;
    for (const w of warnings.slice(0, 3)) {
      ctx.fillStyle = w.level === 'critical' ? '#ff4d4d' : '#ffb020';
      ctx.fillText(w.text, ox + 12, y);
      y += 15;
    }
  }

  drawStatus(ctx, ox, t) {
    const W = SLOT_W;
    const H = SLOT_H;
    ctx.fillStyle = '#05080c';
    ctx.fillRect(ox, 0, W, H);
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#5fe3ff';
    ctx.fillText(t.phaseName || '', ox + 12, 22);
    ctx.fillStyle = '#e8edf2';
    ctx.font = '11px monospace';
    const lines = [
      'FLT    FDB1073',
      'SQWK   7500',
      `ALT    ${formatInt(t.altFt)}`,
      `SPD    ${Math.round(t.speedKt)} KT`,
      `THR    ${Math.round(t.throttle * 100)}%`,
      `G      ${t.gLoad.toFixed(2)}`,
    ];
    if (t.targets?.alt) lines.push(`TGT ALT ${formatInt(t.targets.alt)}`);
    if (t.targets?.spd) lines.push(`TGT SPD ${t.targets.spd}`);
    lines.forEach((l, i) => ctx.fillText(l, ox + 12, 46 + i * 18));
  }
}

export { RAD };
