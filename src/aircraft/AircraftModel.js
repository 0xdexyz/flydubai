// Fictional narrow-body airliner, built procedurally in low poly.
//
// Model space: nose toward -Z, +Y up, +X right wing; the origin sits at the
// bottom of the main wheels (gear down), which is also the physics contact
// point. Static parts are merged into one mesh; moving parts (flaps,
// ailerons, elevators, rudder, spoilers, gear, fans) are separate so they can
// animate. If an external GLB is configured it replaces the visual model.

import * as THREE from 'three';
import { DEG, clamp } from '../core/MathUtil.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { merge, paint } from '../world/Geometry.js';
import { LightPoints } from '../world/Lights.js';
import { ASSETS } from '../core/AssetConfig.js';

export const FC = 3.3; // fuselage centre height
const R = 2.0; // fuselage radius
export const EYE = new THREE.Vector3(-0.48, FC + 1.22, -15.7); // captain's seat

const COL = {
  white: 0xf3f5f8,
  belly: 0xc3cad3,
  glass: 0x1c2733,
  livery: 0x14518f, // flydubai dark blue
  sky: 0x52a9e2, // flydubai light blue
  accent: 0xff8200, // flydubai orange
  grey: 0x9aa3ad,
  dark: 0x2c3138,
  engine: 0xe9edf1,
  wing: 0xd5dbe2,
  tyre: 0x1d1f22,
  metal: 0xb8bec6,
};

// --- wing geometry helpers ---------------------------------------------------
const ROOT_X = 1.2;
const TIP_X = 16.8;
const teZ = (x) => 3.6 + ((x - ROOT_X) * 1.9) / (TIP_X - ROOT_X);
const wingY = (x) => 2.25 + (x - ROOT_X) * Math.tan(5 * DEG);
const wingT = (x) => 0.65 + ((0.16 - 0.65) * (x - ROOT_X)) / (TIP_X - ROOT_X);
const FLAP = { x0: 1.7, x1: 10.2, chord: 1.5 };
const AIL = { x0: 11, x1: 15.8, chord: 0.9 };

/**
 * Extrude a 2D outline [[u, v], ...] into a slab. `thick(u, v)` gives the
 * thickness and `map(u, v, w)` maps to model space.
 */
function slab(outline, thick, map, color) {
  const contour = outline.map(([u, v]) => new THREE.Vector2(u, v));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = [];
  const push = (i, sign) => {
    const [u, v] = outline[i];
    pos.push(...map(u, v, (sign * thick(u, v)) / 2));
  };
  for (const [a, b, c] of tris) {
    push(a, 1); push(b, 1); push(c, 1);
    push(a, -1); push(c, -1); push(b, -1);
  }
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    push(i, 1); push(i, -1); push(j, -1);
    push(i, 1); push(j, -1); push(j, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return paint(g, color);
}

const mirrorX = (outline) => outline.map(([u, v]) => [-u, v]);
const wingMap = (side) => (u, v, w) => [u, wingY(Math.abs(u)) + w, v];
const wingThick = (u) => wingT(Math.abs(u));

/** Moving surface: geometry re-expressed around a hinge line (local X axis). */
function hingedSurface(geo, hingeA, hingeB, material) {
  const pivot = new THREE.Object3D();
  pivot.position.copy(hingeA);
  pivot.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), hingeB.clone().sub(hingeA).normalize());
  pivot.updateMatrix();
  geo.applyMatrix4(pivot.matrix.clone().invert());
  const mesh = new THREE.Mesh(geo, material);
  pivot.add(mesh);
  return { pivot, mesh };
}

// Fuselage profile [radius, z]: rounded nose cone, constant-section cabin, upswept tail cone.
const PROFILE = [
  [0, -19.3], [0.34, -19.2], [0.64, -19.02], [0.9, -18.8], [1.12, -18.52], [1.32, -18.18],
  [1.5, -17.78], [1.66, -17.27], [1.79, -16.67], [1.89, -16.0], [1.96, -15.2], [2.0, -14.2],
  [2.0, 8], [1.96, 9.2], [1.86, 10.5], [1.68, 12.0], [1.45, 13.6], [1.18, 15.1], [0.88, 16.6],
  [0.56, 17.9], [0.3, 18.8], [0.12, 19.2], [0, 19.3],
];

function radiusAt(z) {
  if (z <= PROFILE[0][1]) return 0;
  for (let i = 1; i < PROFILE.length; i++) {
    const [r1, z1] = PROFILE[i];
    if (z <= z1) {
      const [r0, z0] = PROFILE[i - 1];
      return r0 + ((r1 - r0) * (z - z0)) / (z1 - z0);
    }
  }
  return 0;
}

/** Vertical offset of the fuselage centreline: tail cone sweeps up, nose droops. */
const lift = (z) => (z > 8 ? ((z - 8) / 11.25) ** 2 * 1.55 : 0) - (z < -15 ? ((-15 - z) / 4.25) ** 2 * 0.45 : 0);

/** Point on the fuselage skin: theta from the crown (0) toward the right side (+). */
function skin(theta, z, off = 0) {
  const r = radiusAt(z) + off;
  return [r * Math.sin(theta), FC + lift(z) + r * Math.cos(theta), z];
}

/**
 * Smooth patch laid on the fuselage skin between z0..z1 and theta th0..th1
 * (numbers or functions of z): windows, livery stripes, door outlines.
 */
function skinPatch(z0, z1, th0, th1, color, { nz = 2, nt = 2, off = 0.018 } = {}) {
  const T0 = typeof th0 === 'function' ? th0 : () => th0;
  const T1 = typeof th1 === 'function' ? th1 : () => th1;
  const pos = [];
  for (let i = 0; i <= nz; i++) {
    const z = z0 + ((z1 - z0) * i) / nz;
    for (let j = 0; j <= nt; j++) {
      const th = T0(z) + ((T1(z) - T0(z)) * j) / nt;
      pos.push(...skin(th, z, off));
    }
  }
  const idx = [];
  for (let i = 0; i < nz; i++) {
    for (let j = 0; j < nt; j++) {
      const a = i * (nt + 1) + j;
      const b = a + nt + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return paint(g, color);
}

function fuselageGeometry() {
  const pts = PROFILE.map(([r, z]) => new THREE.Vector2(r, -z));
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + FC + lift(p.getZ(i)));
  // Weld the seam and the nose / tail tips so the skin shades smoothly.
  const welded = mergeVertices(g, 1e-4);
  g.dispose();
  welded.computeVertexNormals();
  const gg = welded.toNonIndexed();
  welded.dispose();
  // Paint: white crown, light grey belly.
  const pp = gg.attributes.position;
  const cc = new Float32Array(pp.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pp.count; i++) {
    const yl = pp.getY(i) - FC - lift(pp.getZ(i));
    c.set(yl < -1.05 ? COL.belly : COL.white);
    cc[i * 3] = c.r;
    cc[i * 3 + 1] = c.g;
    cc[i * 3 + 2] = c.b;
  }
  gg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  return gg;
}

/** Flight-deck windows: windscreen + two side windows per side, with pillars between. */
function cockpitWindows() {
  const parts = [];
  const win = (z0, z1, top, bot) => {
    for (const s of [1, -1]) {
      const f = (fn) => (typeof fn === 'function' ? (z) => s * fn(z) : s * fn);
      parts.push(skinPatch(z0, z1, f(top), f(bot), COL.glass, { nz: 4, nt: 4, off: 0.02 }));
    }
  };
  const along = (a, b, z0, z1) => (z) => a + ((b - a) * (z - z0)) / (z1 - z0);
  win(-18.28, -17.56, 0.06, 0.74); // windscreen
  win(-17.46, -16.86, along(0.6, 0.64, -17.46, -16.86), along(1.0, 1.08, -17.46, -16.86));
  win(-16.76, -16.3, along(0.7, 0.8, -16.76, -16.3), along(1.06, 1.08, -16.76, -16.3));
  return parts;
}

/** LEAP-1B style serrated exhaust: a ring of chevrons on the fan-cowl trailing edge. */
function chevrons(x, y, n = 14, r = 0.745, z0 = -1.4, z1 = -1.16) {
  const pos = [];
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    pos.push(
      x + r * Math.cos(a0), y + r * Math.sin(a0), z0,
      x + r * Math.cos(a1), y + r * Math.sin(a1), z0,
      x + (r - 0.05) * Math.cos(am), y + (r - 0.05) * Math.sin(am), z1,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return paint(g, COL.engine);
}

function cylZ(rFront, rBack, len, seg, color, x, y, z, open = false) {
  const g = new THREE.CylinderGeometry(rFront, rBack, len, seg, 1, open);
  g.rotateX(-Math.PI / 2); // +Y (top/front radius) -> -Z
  g.translate(x, y, z);
  return paint(g, color);
}

function boxAt(w, h, d, color, x, y, z) {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
}

export class AircraftModel {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'aircraft';
    this.visual = new THREE.Group();
    this.group.add(this.visual);

    // Smooth shading: curved parts (fuselage, nacelles) carry smooth normals,
    // flat parts (wings, boxes) carry face normals.
    this.material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 55,
      specular: 0x3a424c,
      side: THREE.DoubleSide,
    });

    this.staticParts = []; // geometries for the merged parked-aircraft version
    this.buildBody();
    this.buildTitles();
    this.buildSurfaces();
    this.buildEngines();
    this.buildGear();
    this.buildLights();
    this.blink = 0;
    this.loadExternal();
  }

  addStatic(geo) {
    this.staticParts.push(geo.clone());
    return geo;
  }

  buildBody() {
    const parts = [];
    parts.push(fuselageGeometry());
    parts.push(...cockpitWindows());
    // flydubai livery as photographed on their 737 MAX 8s: white fuselage,
    // the rear fuselage turning dark blue from below, edged by light-blue,
    // white and orange ribbons that wrap round the lower fuselage and carry
    // on up into the tail.
    const sm = (u) => {
      const k = Math.min(1, Math.max(0, u));
      return k * k * (3 - 2 * k);
    };
    const wrap = (z) => 0.95 + 1.3 * sm((z - 11.2) / 6.5); // half-angle round the belly
    parts.push(skinPatch(11.2, 19.25, (z) => Math.PI - wrap(z), (z) => Math.PI + wrap(z), COL.livery, { nz: 40, nt: 20, off: 0.012 }));
    const ribbon = (z0, z1, ext, color) =>
      parts.push(skinPatch(z0, z1, () => Math.PI - 0.95 - ext, () => Math.PI + 0.95 + ext, color, { nz: 2, nt: 20, off: 0.014 }));
    ribbon(10.55, 11.2, 0.1, COL.sky);
    ribbon(9.95, 10.3, 0.2, COL.accent);
    // Passenger windows, sitting on the skin
    const wTh = Math.acos(0.52 / R);
    for (let z = -13.2; z < 8.5; z += 0.62) {
      if (Math.abs(z + 11.6) < 0.5 || Math.abs(z - 6.6) < 0.5) continue; // door gaps
      for (const s of [1, -1]) parts.push(skinPatch(z - 0.12, z + 0.12, s * (wTh - 0.09), s * (wTh + 0.09), COL.glass, { nz: 1, nt: 2, off: 0.022 }));
    }
    // Door outlines (L1/R1 and the rear doors)
    const dTop = Math.acos(0.95 / R);
    const dBot = Math.acos(-0.75 / R);
    for (const s of [1, -1]) {
      for (const zc of [-11.6, 6.6]) {
        const frame = 0x9aa3ad;
        parts.push(skinPatch(zc - 0.43, zc + 0.43, s * dTop, s * (dTop + 0.022), frame, { nz: 2, nt: 1, off: 0.02 }));
        parts.push(skinPatch(zc - 0.43, zc + 0.43, s * (dBot - 0.022), s * dBot, frame, { nz: 2, nt: 1, off: 0.02 }));
        parts.push(skinPatch(zc - 0.43, zc - 0.4, s * dTop, s * dBot, frame, { nz: 1, nt: 6, off: 0.02 }));
        parts.push(skinPatch(zc + 0.4, zc + 0.43, s * dTop, s * dBot, frame, { nz: 1, nt: 6, off: 0.02 }));
      }
    }
    // Wing-body fairing
    parts.push(paint(new THREE.SphereGeometry(1, 24, 12).scale(1.75, 0.78, 6.2).translate(0, FC - 1.32, 0.8), COL.belly));

    // Wings (fixed part ends at the flap / aileron hinge lines)
    const outlineR = [
      [ROOT_X, -3.4], [TIP_X, 3.9], [TIP_X, teZ(TIP_X)],
      [AIL.x1, teZ(AIL.x1)], [AIL.x1, teZ(AIL.x1) - AIL.chord], [AIL.x0, teZ(AIL.x0) - AIL.chord], [AIL.x0, teZ(AIL.x0)],
      [FLAP.x1, teZ(FLAP.x1)], [FLAP.x1, teZ(FLAP.x1) - FLAP.chord], [FLAP.x0, teZ(FLAP.x0) - FLAP.chord],
      [FLAP.x0, teZ(FLAP.x0)], [ROOT_X, teZ(ROOT_X)],
    ];
    parts.push(slab(outlineR, wingThick, wingMap(1), COL.wing));
    parts.push(slab(mirrorX(outlineR), wingThick, wingMap(-1), COL.wing));
    // Winglets
    for (const s of [1, -1]) {
      const yb = wingY(TIP_X);
      parts.push(slab([[3.9, 0], [teZ(TIP_X), 0], [5.75, 2.3], [5.05, 2.3]], () => 0.14,
        (u, v, w) => [s * TIP_X + w, yb + v, u], COL.accent));
      // 737 MAX split winglet: a smaller lower feather
      parts.push(slab([[4.3, 0], [teZ(TIP_X), 0], [5.45, -0.85], [5.15, -0.85]], () => 0.12,
        (u, v, w) => [s * TIP_X + w, yb + v, u], COL.accent));
    }

    // Vertical fin (fixed part) + horizontal stabilisers. Light blue, with the
    // dark-blue sweep rising from the root to the rudder hinge, edged white
    // and orange, as on the real tail.
    const finTop = 11.6;
    const finT = (u, v) => 0.48 - ((v - 5) / (finTop - 5)) * 0.32;
    const overT = (u, v) => finT(u, v) + 0.02;
    const finMap = (u, v, w) => [w, v, u];
    const uLE = (v) => 10.4 + (v - 5) * (6.2 / 6.6);
    const uTE = (v) => 16.2 + (v - 5) * (2.4 / 6.6);
    parts.push(slab([[10.4, 5.0], [16.6, finTop], [18.6, finTop], [16.2, 5.0]], finT, finMap, COL.sky));
    const sweep = (dv, n = 14) => {
      const a = [Math.max(11.3, uLE(5 + dv) + 0.12), 5 + dv];
      const c = [15.2, 5.6 + dv];
      const q = [uTE(8.6 + dv), 8.6 + dv];
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const k0 = (1 - t) * (1 - t);
        const k1 = 2 * (1 - t) * t;
        const k2 = t * t;
        pts.push([k0 * a[0] + k1 * c[0] + k2 * q[0], k0 * a[1] + k1 * c[1] + k2 * q[1]]);
      }
      return pts;
    };
    const band = (d0, d1, color) => parts.push(slab([...sweep(d0), ...sweep(d1).reverse()], overT, finMap, color));
    parts.push(slab([...sweep(0), [16.2, 5.0]], overT, finMap, COL.livery)); // dark lower-rear sweep
    band(0.0, 0.12, COL.white);
    band(0.12, 0.42, COL.accent);
    band(0.42, 0.52, COL.white);
    // Dorsal fin fillet ahead of the fin root
    parts.push(slab([[8.2, 5.05], [10.75, 5.05], [10.75, 5.75]], () => 0.22, finMap, COL.sky));
    // APU exhaust at the tail tip
    parts.push(cylZ(0.13, 0.15, 0.3, 12, COL.dark, 0, FC + lift(19.25), 19.35));
    const stabY = (x) => 4.1 + Math.abs(x) * Math.tan(6 * DEG);
    const stabOutline = [[0.4, 14.0], [6.4, 17.5], [6.4, 18.25], [0.4, 17.45]];
    const stabMap = (u, v, w) => [u, stabY(u) + w, v];
    parts.push(slab(stabOutline, () => 0.3, stabMap, COL.wing));
    parts.push(slab(mirrorX(stabOutline), () => 0.3, stabMap, COL.wing));

    const geo = merge(parts);
    this.staticParts.push(geo.clone());
    this.body = new THREE.Mesh(geo, this.material);
    this.visual.add(this.body);
    this.stabY = stabY;
  }

  /** "flydubai" titles on the forward fuselage: a canvas texture on a skin-hugging strip. */
  buildTitles() {
    const cv = document.createElement('canvas');
    cv.width = 2048;
    cv.height = 512;
    const ctx = cv.getContext('2d');
    const font = (px) => `700 ${px}px "Arial Rounded MT Bold", "Nunito", "Varela Round", "Segoe UI", Arial, sans-serif`;
    let px = 470;
    ctx.font = font(px);
    const fit = () => ctx.measureText('fly').width + ctx.measureText('dubai').width;
    while (fit() > 1960 && px > 60) ctx.font = font((px -= 6));
    const w1 = ctx.measureText('fly').width;
    const x0 = (cv.width - fit()) / 2;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ff8200';
    ctx.fillText('fly', x0, 390);
    ctx.fillStyle = '#14518f';
    ctx.fillText('dubai', x0 + w1, 390);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshPhongMaterial({
      map: tex, transparent: true, depthWrite: false, shininess: 55, specular: 0x3a424c,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide,
    });
    const strip = (side) => {
      const z0 = -12.3;
      const z1 = -1.9;
      const tTop = Math.acos(1.62 / R);
      const tBot = Math.acos(-0.62 / R);
      const nz = 40;
      const nt = 10;
      const pos = [];
      const uv = [];
      for (let i = 0; i <= nz; i++) {
        const z = z0 + ((z1 - z0) * i) / nz;
        const u = side > 0 ? 1 - i / nz : i / nz; // reads nose-to-tail on the left, tail-to-nose on the right
        for (let j = 0; j <= nt; j++) {
          const th = tTop + ((tBot - tTop) * j) / nt;
          pos.push(...skin(side * th, z, 0.017));
          uv.push(u, 1 - j / nt);
        }
      }
      const idx = [];
      for (let i = 0; i < nz; i++) {
        for (let j = 0; j < nt; j++) {
          const a = i * (nt + 1) + j;
          const b = a + nt + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(strip(side), mat);
      m.renderOrder = 1;
      this.visual.add(m);
    }
  }

  buildSurfaces() {
    const m = this.material;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    this.surfaces = {};

    const flapOutline = [
      [FLAP.x0, teZ(FLAP.x0) - FLAP.chord], [FLAP.x1, teZ(FLAP.x1) - FLAP.chord],
      [FLAP.x1, teZ(FLAP.x1)], [FLAP.x0, teZ(FLAP.x0)],
    ];
    const ailOutline = [
      [AIL.x0, teZ(AIL.x0) - AIL.chord], [AIL.x1, teZ(AIL.x1) - AIL.chord],
      [AIL.x1, teZ(AIL.x1)], [AIL.x0, teZ(AIL.x0)],
    ];
    const thinT = (u) => wingT(Math.abs(u)) * 0.55;
    const make = (outline, side, a, b, name, color) => {
      const o = side > 0 ? outline : mirrorX(outline);
      const geo = slab(o, thinT, wingMap(side), color);
      this.staticParts.push(geo.clone());
      const A = V(side * a[0], wingY(a[0]), a[1]);
      const B = V(side * b[0], wingY(b[0]), b[1]);
      const s = side > 0 ? hingedSurface(geo, A, B, m) : hingedSurface(geo, B, A, m);
      this.visual.add(s.pivot);
      this.surfaces[name] = s.mesh;
    };
    for (const side of [1, -1]) {
      const tag = side > 0 ? 'R' : 'L';
      make(flapOutline, side, [FLAP.x0, teZ(FLAP.x0) - FLAP.chord], [FLAP.x1, teZ(FLAP.x1) - FLAP.chord], 'flap' + tag, COL.metal);
      make(ailOutline, side, [AIL.x0, teZ(AIL.x0) - AIL.chord], [AIL.x1, teZ(AIL.x1) - AIL.chord], 'ail' + tag, COL.wing);
      // Spoiler panel on the upper surface ahead of the flap
      const zf = (x) => teZ(x) - FLAP.chord;
      const spOutline = [[3.2, zf(3.2) - 1.0], [9.8, zf(9.8) - 1.0], [9.8, zf(9.8) - 0.05], [3.2, zf(3.2) - 0.05]];
      const o = side > 0 ? spOutline : mirrorX(spOutline);
      const geo = slab(o, () => 0.06, (u, v, w) => [u, wingY(Math.abs(u)) + wingT(Math.abs(u)) / 2 + 0.03 + w, v], 0xc4cbd3);
      this.staticParts.push(geo.clone());
      const A = V(side * 3.2, wingY(3.2) + wingT(3.2) / 2, zf(3.2) - 1.0);
      const B = V(side * 9.8, wingY(9.8) + wingT(9.8) / 2, zf(9.8) - 1.0);
      const s = side > 0 ? hingedSurface(geo, A, B, m) : hingedSurface(geo, B, A, m);
      this.visual.add(s.pivot);
      this.surfaces['spoiler' + tag] = s.mesh;

      // Elevators
      const elOutline = [[0.4, 17.45], [6.4, 18.25], [6.4, 18.8], [0.4, 18.5]];
      const eo = side > 0 ? elOutline : mirrorX(elOutline);
      const eg = slab(eo, () => 0.2, (u, v, w) => [u, this.stabY(u) + w, v], COL.wing);
      this.staticParts.push(eg.clone());
      const EA = V(side * 0.4, this.stabY(0.4), 17.45);
      const EB = V(side * 6.4, this.stabY(6.4), 18.25);
      const es = side > 0 ? hingedSurface(eg, EA, EB, m) : hingedSurface(eg, EB, EA, m);
      this.visual.add(es.pivot);
      this.surfaces['elev' + tag] = es.mesh;
    }
    // Rudder
    const rudLE = (v) => 16.2 + (v - 5) * (2.4 / 6.6);
    const rudTE = (v) => 18.95 + (v - 5) * (0.6 / 6.6);
    const rudT = (u, v) => 0.3 - ((v - 5) / 6.6) * 0.18;
    const rBand = (a, b, color) => slab([[rudLE(a), a], [rudLE(b), b], [rudTE(b), b], [rudTE(a), a]], rudT, (u, v, w) => [w, v, u], color);
    const rg = merge([
      rBand(5.0, 8.6, COL.livery), rBand(8.6, 8.72, COL.white), rBand(8.72, 9.02, COL.accent),
      rBand(9.02, 9.12, COL.white), rBand(9.12, 11.6, COL.sky),
    ]);
    this.staticParts.push(rg.clone());
    const rs = hingedSurface(rg, V(0, 5.0, 16.2), V(0, 11.6, 18.6), m);
    this.visual.add(rs.pivot);
    this.surfaces.rudder = rs.mesh;
  }

  buildEngines() {
    this.fans = [];
    const fanParts = () => {
      const spinner = new THREE.LatheGeometry([[0, -0.42], [0.12, -0.36], [0.22, -0.22], [0.29, -0.05], [0.31, 0.06]]
        .map(([r, z]) => new THREE.Vector2(r, -z)), 18).rotateX(-Math.PI / 2);
      const parts = [paint(spinner, 0xe8ebee)];
      for (let i = 0; i < 20; i++) {
        const b = new THREE.BoxGeometry(0.075, 0.56, 0.03);
        b.rotateY(0.45);
        b.translate(0, 0.56, 0);
        b.rotateZ((i / 20) * Math.PI * 2);
        parts.push(paint(b, 0x3a3f46));
      }
      return merge(parts);
    };
    // Rounded nacelle profile [radius, z], from the intake lip back to the fan cowl.
    const lathe = (prof, seg, color, x, y) => {
      const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, -z)), seg);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y, 0);
      return paint(g, color);
    };
    const LIP = [[0.84, -5.88], [0.93, -5.92], [1.0, -5.84], [1.04, -5.66], [1.055, -5.45]];
    const COWL = [[1.055, -5.45], [1.06, -4.9], [1.04, -4.0], [0.99, -3.1], [0.91, -2.25], [0.8, -1.6], [0.74, -1.38]];
    const CORE = [[0.66, -1.5], [0.64, -1.1], [0.56, -0.6], [0.47, -0.25]];
    const PLUG = [[0.32, -0.3], [0.26, -0.05], [0.14, 0.25], [0, 0.42]];
    for (const s of [1, -1]) {
      const x = s * 5.8;
      const y = 1.45;
      const parts = [
        lathe(LIP, 28, COL.metal, x, y),
        lathe(COWL, 28, COL.engine, x, y),
        chevrons(x, y),
        lathe(CORE, 20, 0x8a9199, x, y),
        lathe(PLUG, 14, COL.dark, x, y),
        cylZ(0.84, 0.84, 0.5, 28, 0x30353c, x, y, -5.62, true), // intake duct
        cylZ(0.84, 0.84, 0.04, 28, 0x24282d, x, y, -5.36), // fan face
        // Pylon: slender, tapered, faired into the wing
        slab([[-5.0, 2.36], [-3.6, 2.4], [0.6, 2.75], [-0.4, 2.86], [-4.4, 2.66]], () => 0.3, (u, v, w) => [x + w, v, u], COL.wing),
      ];
      const g = merge(parts);
      this.staticParts.push(g.clone());
      this.visual.add(new THREE.Mesh(g, this.material));
      const fan = new THREE.Mesh(fanParts(), this.material);
      fan.position.set(x, 1.45, -5.42);
      this.staticParts.push(fan.geometry.clone().translate(x, 1.45, -5.42));
      this.visual.add(fan);
      this.fans.push(fan);
    }
  }

  buildGear() {
    const wheel = (x, y, z, r, w) => {
      const g = new THREE.CylinderGeometry(r, r, w, 10);
      g.rotateZ(Math.PI / 2);
      g.translate(x, y, z);
      return paint(g, COL.tyre);
    };
    const strut = (x, y0, y1, z, r) => paint(new THREE.CylinderGeometry(r, r, y1 - y0, 6).translate(x, (y0 + y1) / 2, z), COL.metal);

    // Nose gear (pivot at the top of the strut, retracts forward)
    const nosePivot = new THREE.Vector3(0, 1.45, -12.6);
    const noseParts = [
      strut(0, 0.42, 1.45, -12.6, 0.11),
      wheel(0.24, 0.42, -12.6, 0.42, 0.28),
      wheel(-0.24, 0.42, -12.6, 0.42, 0.28),
    ];
    const noseGeo = merge(noseParts);
    this.staticParts.push(noseGeo.clone());
    noseGeo.translate(-nosePivot.x, -nosePivot.y, -nosePivot.z);
    this.noseGear = new THREE.Mesh(noseGeo, this.material);
    this.noseGear.position.copy(nosePivot);
    this.visual.add(this.noseGear);

    this.mainGear = [];
    for (const s of [1, -1]) {
      const px = s * 3.6;
      const pivot = new THREE.Vector3(px, 2.15, 1.2);
      const parts = [
        strut(px, 0.6, 2.15, 1.2, 0.16),
        wheel(px + 0.38, 0.6, 1.2, 0.6, 0.38),
        wheel(px - 0.38, 0.6, 1.2, 0.6, 0.38),
        boxAt(1.1, 0.12, 0.25, COL.metal, px, 0.6, 1.2),
      ];
      const geo = merge(parts);
      this.staticParts.push(geo.clone());
      geo.translate(-pivot.x, -pivot.y, -pivot.z);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.copy(pivot);
      mesh.userData.side = s;
      this.visual.add(mesh);
      this.mainGear.push(mesh);
    }
  }

  buildLights() {
    const tipY = wingY(TIP_X);
    this.lights = new LightPoints([
      { x: -TIP_X - 0.1, y: tipY, z: 4.4, color: 0xff2a2a, size: 0.9 }, // nav left
      { x: TIP_X + 0.1, y: tipY, z: 4.4, color: 0x2aff6a, size: 0.9 }, // nav right
      { x: 0, y: FC + 1.4, z: 19.3, color: 0xffffff, size: 0.7 }, // tail
      { x: 0, y: FC + R + 0.05, z: -1, color: 0x000000, size: 1.2 }, // beacon top
      { x: 0, y: FC - R - 0.15, z: 2, color: 0x000000, size: 1.2 }, // beacon bottom
      { x: -TIP_X - 0.1, y: tipY, z: 5.0, color: 0x000000, size: 1.6 }, // strobe L
      { x: TIP_X + 0.1, y: tipY, z: 5.0, color: 0x000000, size: 1.6 }, // strobe R
    ], { minPx: 1, maxPx: 18 });
    this.visual.add(this.lights.points);
    this.blinkState = { beacon: false, strobe: false };
  }

  setLightScale(ppu) {
    this.lights.setScale(ppu);
  }

  /** Merged, gear-down copy for parked aircraft (single draw call per instance batch). */
  createStaticGeometry() {
    return merge(this.staticParts.map((g) => g.clone()));
  }

  async loadExternal() {
    if (!ASSETS.aircraft) return;
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(ASSETS.aircraft);
      this.visual.visible = false;
      this.group.add(gltf.scene);
      this.external = gltf.scene;
    } catch (err) {
      console.warn('[aircraft] external model unavailable, using procedural model', err);
    }
  }

  /** Apply physics state + control animation. */
  sync(fm, dt) {
    const g = this.group;
    g.position.copy(fm.pos);
    g.rotation.set(fm.theta, -fm.psi, -fm.phi, 'YXZ');

    const S = this.surfaces;
    const roll = fm.inputs.roll;
    S.ailR.rotation.x = -roll * 18 * DEG;
    S.ailL.rotation.x = roll * 18 * DEG;
    const elev = -fm.inputs.pitch * 16 * DEG;
    S.elevR.rotation.x = elev;
    S.elevL.rotation.x = elev;
    S.rudder.rotation.x = -fm.inputs.yaw * 22 * DEG;
    const flap = (fm.flapsPos / 3) * 34 * DEG;
    S.flapR.rotation.x = flap;
    S.flapL.rotation.x = flap;
    const sp = -fm.spoilers * 42 * DEG;
    S.spoilerR.rotation.x = sp;
    S.spoilerL.rotation.x = sp;

    const up = 1 - fm.gearPos;
    this.noseGear.rotation.x = up * 1.65;
    this.noseGear.visible = fm.gearPos > 0.02;
    for (const m of this.mainGear) {
      m.rotation.z = -m.userData.side * up * 1.55;
      m.visible = fm.gearPos > 0.02;
    }

    const spin = (2 + fm.n1 * 38) * dt;
    for (const f of this.fans) f.rotation.z += spin;

    // Beacon ~1 Hz, strobes double flash.
    this.blink += dt;
    const beacon = this.blink % 1.1 < 0.12;
    const t = this.blink % 1.4;
    const strobe = t < 0.05 || (t > 0.14 && t < 0.19);
    if (beacon !== this.blinkState.beacon) {
      this.blinkState.beacon = beacon;
      this.lights.setColor(3, beacon ? 0xff2020 : 0x000000);
      this.lights.setColor(4, beacon ? 0xff2020 : 0x000000);
    }
    if (strobe !== this.blinkState.strobe) {
      this.blinkState.strobe = strobe;
      this.lights.setColor(5, strobe ? 0xffffff : 0x000000);
      this.lights.setColor(6, strobe ? 0xffffff : 0x000000);
    }
  }

  setVisible(v) {
    this.group.visible = v;
  }
}

export { clamp };
