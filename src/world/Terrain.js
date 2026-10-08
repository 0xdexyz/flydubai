// Low-poly desert terrain around Tabuk plus a distant mountain backdrop.
//
// The terrain is a single indexed grid whose vertices are packed densely
// around the airport and spread out toward the edges (power-warped grid), so
// ~22k vertices cover 156 x 156 km. One analytic height function feeds both
// the mesh and collision queries — no raycasts against geometry.
//
// Landscape: a high desert plateau with dry wadis and flat-topped mesas, and
// the Hejaz mountains rising to the west and south-west.

import * as THREE from 'three';
import { clamp, fbm2, lerp, mulberry32, ridge2, smoothstep, valueNoise2 } from '../core/MathUtil.js';
import { AIRPORT_ELEV, RUNWAY, compassDir, onRunway } from './Route.js';
import { merge, paint } from './Geometry.js';

// Area flattened for the airport (runway, apron, approach lights).
const APT = { x0: -1000, x1: 450, z0: -2600, z1: 2750, blend: 900 };
const WEST = compassDir(270);
const SOUTHWEST = compassDir(225);

const C = (hex) => new THREE.Color(hex);
const COL = {
  sandLight: C(0xe4cc9f),
  sand: C(0xd3af7e),
  gravel: C(0xbda886),
  ochre: C(0xc4935b),
  red: C(0xa66a43),
  rock: C(0x8b6a4e),
  dark: C(0x6c5545),
  wadi: C(0xb79d73),
  scrub: C(0x8e8a55),
  airport: C(0xd8c299),
};

const S = { h: 0, mesa: 0, mtn: 0, wadi: 0 };

export class Terrain {
  constructor({ segments = 150 } = {}) {
    this.mesh = this.buildMesh(segments);
    this.backdrop = this.buildBackdrop();
  }

  /** Terrain height and its components (for colouring). */
  sample(x, z, out) {
    const d = Math.sqrt(x * x + z * z);
    let h = AIRPORT_ELEV;
    // Broad plateau undulation and gravel ripples.
    h += fbm2(x / 11000, z / 11000, 3, 11) * 55 * smoothstep(1500, 9000, d);
    h += fbm2(x / 2300, z / 2300, 3, 12) * 9 * smoothstep(1200, 4500, d);
    // Dry wadis carved along noise valleys.
    const wn = Math.abs(valueNoise2(x / 7000, z / 7000, 21) + 0.35 * valueNoise2(x / 2600, z / 2600, 22));
    const wadi = (1 - smoothstep(0.02, 0.1, wn)) * smoothstep(3000, 9000, d);
    h -= wadi * 16;
    // Flat-topped mesas with steep sides.
    const mn = fbm2(x / 6500 + 13.1, z / 6500 - 7.7, 3, 31);
    let mesa = 0;
    if (mn > 0.22) {
      mesa = smoothstep(0.22, 0.27, mn) * (110 + 220 * smoothstep(0.3, 0.55, mn)) * smoothstep(5000, 16000, d);
      h += mesa;
    }
    // Hejaz mountains to the west / south-west.
    const w = x * WEST.x + z * WEST.z;
    const sw = x * SOUTHWEST.x + z * SOUTHWEST.z;
    const mask = Math.max(smoothstep(15000, 30000, w), smoothstep(22000, 36000, sw));
    let mtn = 0;
    if (mask > 0) {
      mtn = ridge2(x / 9000, z / 9000, 4, 23) * 1600 * mask;
      h += mtn;
    }
    // Flatten the airport.
    const dx = x < APT.x0 ? APT.x0 - x : x > APT.x1 ? x - APT.x1 : 0;
    const dz = z < APT.z0 ? APT.z0 - z : z > APT.z1 ? z - APT.z1 : 0;
    const da = Math.sqrt(dx * dx + dz * dz);
    if (da < APT.blend) {
      const k = smoothstep(0, APT.blend, da);
      h = lerp(AIRPORT_ELEV, h, k);
      mesa *= k;
      mtn *= k;
    }
    out.h = h;
    out.mesa = mesa;
    out.mtn = mtn;
    out.wadi = wadi;
    return out;
  }

  rawHeight(x, z) {
    return this.sample(x, z, S).h;
  }

  /** Collision height: runway pavement or terrain. */
  height(x, z) {
    if (onRunway(x, z)) return RUNWAY.surfaceY;
    return this.rawHeight(x, z);
  }

  surfaceAt(x, z) {
    return onRunway(x, z, 1.5) ? 'runway' : 'land';
  }

  colorAt(x, z, s, out) {
    const dx = x < APT.x0 ? APT.x0 - x : x > APT.x1 ? x - APT.x1 : 0;
    const dz = z < APT.z0 ? APT.z0 - z : z > APT.z1 ? z - APT.z1 : 0;
    if (dx + dz < 250) return out.copy(COL.airport);

    out.copy(COL.sand).lerp(COL.sandLight, valueNoise2(x / 3200, z / 3200, 4) * 0.5 + 0.5);
    if (valueNoise2(x / 1400, z / 1400, 8) > 0.3) out.lerp(COL.gravel, 0.7);
    if (s.wadi > 0.2) {
      out.lerp(COL.wadi, s.wadi);
      if (valueNoise2(x / 300, z / 300, 9) > 0.35) out.lerp(COL.scrub, 0.6 * s.wadi);
    }
    if (s.mesa > 15) out.lerp(COL.ochre, smoothstep(15, 80, s.mesa)).lerp(COL.red, smoothstep(160, 300, s.mesa) * 0.7);
    if (s.mtn > 60) out.lerp(COL.rock, smoothstep(60, 600, s.mtn)).lerp(COL.dark, smoothstep(700, 1300, s.mtn));
    return out;
  }

  buildMesh(segments) {
    const half = 78000;
    const warp = 1.7;
    const n = segments + 1;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const c = new THREE.Color();
    const s = { h: 0, mesa: 0, mtn: 0, wadi: 0 };
    const coord = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = -1 + (2 * i) / segments;
      coord[i] = half * Math.sign(u) * Math.pow(Math.abs(u), warp);
    }
    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = coord[i];
        const z = coord[j];
        this.sample(x, z, s);
        pos[k] = x;
        pos[k + 1] = s.h;
        pos[k + 2] = z;
        this.colorAt(x, z, s, c);
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
        k += 3;
      }
    }
    const idx = new Uint32Array(segments * segments * 6);
    k = 0;
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = j * n + i;
        const b = a + 1;
        const d = a + n;
        const e = d + 1;
        idx[k++] = a; idx[k++] = d; idx[k++] = b;
        idx[k++] = b; idx[k++] = d; idx[k++] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  /** Ring of hazy desert ranges beyond the terrain edge (fog disabled, pre-tinted). */
  buildBackdrop() {
    const rand = mulberry32(77);
    const parts = [];
    const base = new THREE.Color(0xb7a48f);
    const top = new THREE.Color(0xd9cebd);
    const cc = new THREE.Color();
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2 + rand() * 0.05;
      const r = 100000 + rand() * 25000;
      const h = 1800 + rand() * 3800;
      const w = 7000 + rand() * 9000;
      const g = new THREE.ConeGeometry(w, h, 5 + Math.floor(rand() * 3), 1);
      g.translate(Math.sin(a) * r, h / 2 - 300, -Math.cos(a) * r);
      const p = paint(g, base);
      const posAttr = p.attributes.position;
      const colAttr = p.attributes.color;
      for (let v = 0; v < posAttr.count; v++) {
        const t = clamp(posAttr.getY(v) / h, 0, 1);
        cc.copy(base).lerp(top, t);
        colAttr.setXYZ(v, cc.r, cc.g, cc.b);
      }
      parts.push(p);
    }
    const mesh = new THREE.Mesh(merge(parts), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }
}
