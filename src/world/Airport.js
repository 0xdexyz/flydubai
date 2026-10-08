// Low-poly stand-in for Tabuk airport: runway 24/06 (3,350 m), parallel
// taxiway, apron, terminal, tower, hangars, parked aircraft, runway lighting
// and a desert town. Buildings are generic and fictional, not a replica.
// All static parts are merged into a handful of draw calls.

import * as THREE from 'three';
import { DEG, mulberry32 } from '../core/MathUtil.js';
import { AIRPORT_ELEV, GLIDE_DEG, RUNWAY } from './Route.js';
import { block, box, cone, cylinder, merge, paint, quad, worldMaterial } from './Geometry.js';
import { LightPoints } from './Lights.js';

const E = AIRPORT_ELEV;
const HW = RUNWAY.halfWidth;
const HL = RUNWAY.halfLength;

const COLORS = {
  asphalt: 0x474c53,
  shoulder: 0x60646a,
  taxi: 0x4a4e54,
  apron: 0x8d9196,
  marking: 0xf2f2ee,
  taxiLine: 0xe8c547,
};

// PAPI unit thresholds (outermost -> innermost) in degrees.
const PAPI_ANGLES = [2.5, 2.83, 3.17, 3.5];
const PAPI_X = [-67, -58, -49, -40];
const PAPI_Z = RUNWAY.thresholdZ - 330;

/** 7-segment style digits built from rectangles (no textures needed). */
const SEGMENTS = {
  0: 'abcfed', 2: 'abged', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc',
};
function digitQuads(ch, cx, cz, w, h, y, flip, out) {
  const t = w * 0.2;
  const segs = SEGMENTS[ch] || '';
  // Segment rectangles in local digit space (x right, z "down" the page).
  const rects = {
    a: [-w / 2, -h / 2, w / 2, -h / 2 + t],
    d: [-w / 2, h / 2 - t, w / 2, h / 2],
    g: [-w / 2, -t / 2, w / 2, t / 2],
    f: [-w / 2, -h / 2, -w / 2 + t, 0],
    e: [-w / 2, 0, -w / 2 + t, h / 2],
    b: [w / 2 - t, -h / 2, w / 2, 0],
    c: [w / 2 - t, 0, w / 2, h / 2],
  };
  for (const s of segs) {
    const [x0, z0, x1, z1] = rects[s];
    // Text reads correctly for a pilot approaching from +Z: page "top" faces -Z.
    const sgn = flip ? -1 : 1;
    const ax = cx + sgn * x0;
    const bx = cx + sgn * x1;
    const az = cz + sgn * z0;
    const bz = cz + sgn * z1;
    out.push(quad(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), y, COLORS.marking));
  }
}

export class Airport {
  constructor({ treeDensity = 1, terrain }) {
    this.group = new THREE.Group();
    this.terrain = terrain;
    this.buildPavement();
    this.buildMarkings();
    this.buildBuildings();
    this.buildLights();
    this.buildTrees(treeDensity);
    this.buildTown();
  }

  buildPavement() {
    const y = E + 0.3;
    const parts = [
      quad(-HW - 7, -HL - 60, HW + 7, HL + 60, y - 0.05, COLORS.shoulder),
      quad(-HW, -HL - 60, HW, HL + 60, y, COLORS.asphalt),
      // Parallel taxiway + connectors
      quad(-195, -HL + 40, -172, HL - 40, E + 0.18, COLORS.taxi),
    ];
    for (const z of [-HL + 60, -700, 0, 700, HL - 60]) parts.push(quad(-185, z - 12, -HW, z + 12, E + 0.17, COLORS.taxi));
    // Apron
    parts.push(quad(-520, -760, -195, 520, E + 0.15, COLORS.apron));
    // Roads / car park
    parts.push(quad(-700, -400, -640, 300, E + 0.12, 0x5f6368));
    parts.push(quad(-2400, -80, -700, -40, E + 0.1, 0x5f6368));
    const mat = worldMaterial({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(merge(parts), mat);
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
  }

  buildMarkings() {
    const y = E + 0.32;
    const parts = [];
    // Centreline dashes
    for (let z = -HL + 200; z < HL - 200; z += 50) parts.push(quad(-0.45, z, 0.45, z + 30, y, COLORS.marking));
    // Edge lines
    parts.push(quad(-HW + 0.3, -HL, -HW + 1.2, HL, y, COLORS.marking));
    parts.push(quad(HW - 1.2, -HL, HW - 0.3, HL, y, COLORS.marking));
    // Threshold "piano keys" at both ends
    for (const end of [1, -1]) {
      const zEdge = end * HL;
      for (let i = 0; i < 8; i++) {
        const x = 2.5 + i * 2.4;
        const z0 = end > 0 ? zEdge - 36 : zEdge + 6;
        parts.push(quad(x, z0, x + 1.6, z0 + 30, y, COLORS.marking));
        parts.push(quad(-x - 1.6, z0, -x, z0 + 30, y, COLORS.marking));
      }
      // Aiming point blocks (~300 m in) and touchdown zone bars
      const zAim = end > 0 ? zEdge - 340 : zEdge + 300;
      parts.push(quad(-11, zAim, -6.5, zAim + 45, y, COLORS.marking));
      parts.push(quad(6.5, zAim, 11, zAim + 45, y, COLORS.marking));
      for (const dz of [150, 450, 600]) {
        const z = end > 0 ? zEdge - dz - 22 : zEdge + dz;
        parts.push(quad(-12, z, -9.5, z + 22, y, COLORS.marking));
        parts.push(quad(9.5, z, 12, z + 22, y, COLORS.marking));
        parts.push(quad(-7.5, z, -5, z + 22, y, COLORS.marking));
        parts.push(quad(5, z, 7.5, z + 22, y, COLORS.marking));
      }
    }
    // Runway designators: "24" read on approach from +Z, "06" from -Z.
    const [a, b] = RUNWAY.name;
    const [c, d] = RUNWAY.oppositeName;
    digitQuads(a, -4.5, HL - 62, 6, 15, y, false, parts);
    digitQuads(b, 4.5, HL - 62, 6, 15, y, false, parts);
    digitQuads(c, 4.5, -HL + 62, 6, 15, y, true, parts);
    digitQuads(d, -4.5, -HL + 62, 6, 15, y, true, parts);
    // Taxiway centre lines
    parts.push(quad(-184, -HL + 40, -183, HL - 40, E + 0.2, COLORS.taxiLine));

    const mat = worldMaterial({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    const mesh = new THREE.Mesh(merge(parts), mat);
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
  }

  buildBuildings() {
    const parts = [];
    // Terminal with a glass band
    parts.push(block(70, 18, 560, 0xe6dccb, -585, E, -120));
    parts.push(box(71, 6, 540, 0x4d6f8f, -585, E + 11, -120));
    parts.push(block(74, 1.5, 566, 0xf0f2f4, -585, E + 18, -120));
    // Jet bridges
    for (const z of [-360, -230, -100, 30]) parts.push(block(42, 4, 4, 0xbfc5cc, -530, E + 4, z));
    // Control tower
    parts.push(cylinder(3.6, 4.6, 42, 10, 0xe4e7ea, -430, E, 680));
    parts.push(cylinder(8, 6, 7, 8, 0x3d5a78, -430, E + 42, 680));
    parts.push(cylinder(8.8, 8.8, 1.6, 8, 0xf2f4f6, -430, E + 49, 680));
    parts.push(cylinder(0.25, 0.25, 6, 4, 0x9aa3ad, -430, E + 50.6, 680));
    // Hangars with curved roofs
    for (let i = 0; i < 3; i++) {
      const z = -1000 - i * 110;
      parts.push(block(70, 16, 85, 0xd8d0c2, -470, E, z));
      const roof = new THREE.CylinderGeometry(43, 43, 70, 12, 1, false, 0, Math.PI);
      roof.rotateZ(Math.PI / 2); // axis along X, arch on top
      roof.scale(1, 0.28, 1);
      roof.translate(-470, E + 16, z);
      parts.push(paint(roof, 0x8e98a4));
      parts.push(block(2, 13, 60, 0x5d6670, -434.5, E, z));
    }
    // Fuel farm + misc
    for (let i = 0; i < 4; i++) parts.push(cylinder(9, 9, 10, 12, 0xeceff1, -820 + (i % 2) * 26, E, 620 + Math.floor(i / 2) * 26));
    parts.push(block(40, 9, 30, 0xb7a58c, -760, E, -620));
    parts.push(block(26, 6, 22, 0xd4d8dc, -330, E, 900));
    // Windsock near the threshold
    parts.push(cylinder(0.2, 0.2, 9, 4, 0xdddddd, -70, E, 1260));
    const sock = new THREE.ConeGeometry(1.1, 6, 8, 1, true);
    sock.rotateZ(Math.PI / 2);
    sock.translate(-73, E + 8.5, 1260);
    parts.push(paint(sock, 0xff7a1a));
    // Glide-path antenna shed + PAPI housings
    parts.push(block(4, 3, 4, 0xd0d4d8, -120, E, 1100));
    for (const x of PAPI_X) parts.push(block(2.2, 1, 1.2, 0x30343a, x, E, PAPI_Z));
    // Approach light gantry poles
    for (let z = RUNWAY.thresholdZ + 60; z <= RUNWAY.thresholdZ + 900; z += 60) {
      parts.push(block(0.4, 1.2, 0.4, 0x5a5f66, 0, E, z));
    }

    const mesh = new THREE.Mesh(merge(parts), worldMaterial());
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
  }

  /** Parked aircraft use the merged airliner geometry, instanced. */
  addParkedAircraft(geometry, material) {
    const spots = [
      [-480, -380], [-480, -250], [-480, -120], [-480, 10], [-300, -640],
    ];
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    spots.forEach(([x, z], i) => {
      const yaw = i === 4 ? 0.2 : Math.PI / 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      p.set(x, E + 0.15, z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  buildLights() {
    const ly = E + 0.7;
    const lights = [];
    // Edge lights (yellow on the last 600 m)
    for (let z = -HL; z <= HL; z += 60) {
      const color = z < -HL + 600 ? 0xffd966 : 0xfff6e0;
      lights.push({ x: -HW - 1.5, y: ly, z, color, size: 3.4 });
      lights.push({ x: HW + 1.5, y: ly, z, color, size: 3.4 });
    }
    // Centreline lights (red near the far end)
    for (let z = -HL + 30; z < HL; z += 30) {
      const color = z < -HL + 300 ? 0xff4040 : z < -HL + 900 && Math.round(z / 30) % 2 ? 0xff4040 : 0xffffff;
      lights.push({ x: 0, y: E + 0.45, z, color, size: 2 });
    }
    // Threshold (green) and runway end (red)
    for (let x = -HW; x <= HW; x += 3) {
      lights.push({ x, y: ly, z: HL + 1, color: 0x3dff7a, size: 3.6 });
      lights.push({ x, y: ly, z: -HL - 1, color: 0xff3030, size: 3.2 });
    }
    // Approach lighting system: centre barrettes + crossbar
    for (let z = RUNWAY.thresholdZ + 60; z <= RUNWAY.thresholdZ + 900; z += 30) {
      for (let k = -2; k <= 2; k++) lights.push({ x: k * 1.1, y: E + 1.3, z, color: 0xfffbe8, size: 3.6 });
    }
    for (let x = -15; x <= 15; x += 1.5) lights.push({ x, y: E + 1.3, z: RUNWAY.thresholdZ + 300, color: 0xfffbe8, size: 3.6 });

    this.runwayLights = new LightPoints(lights, { minPx: 2.2, maxPx: 26, intensity: 1.15 });
    this.group.add(this.runwayLights.points);

    this.papi = new LightPoints(
      PAPI_X.map((x) => ({ x, y: E + 1.2, z: PAPI_Z, color: 0xffffff, size: 8 })),
      { minPx: 3.2, maxPx: 38, intensity: 1.3 }
    );
    this.group.add(this.papi.points);
    this.papiState = [-1, -1, -1, -1];
  }

  /** Update PAPI colours from the aircraft's elevation angle. */
  updatePapi(px, py, pz) {
    const dist = Math.hypot(pz - PAPI_Z, px - PAPI_X[0]);
    const angle = Math.atan2(py - (E + 1.2), Math.max(1, dist)) / DEG;
    for (let i = 0; i < 4; i++) {
      const white = angle > PAPI_ANGLES[i] ? 1 : 0;
      if (this.papiState[i] !== white) {
        this.papiState[i] = white;
        this.papi.setColor(i, white ? 0xffffff : 0xff2a2a);
      }
    }
    return this.papiState.reduce((a, b) => a + b, 0); // whites count (2 = on path)
  }

  setLightScale(ppu) {
    this.runwayLights.setScale(ppu);
    this.papi.setScale(ppu);
  }

  /** Instanced acacia-style desert trees, clustered near the town and airport. */
  buildTrees(density) {
    const rand = mulberry32(99);
    const trunk = paint(new THREE.CylinderGeometry(0.35, 0.5, 3.2, 5).translate(0, 1.6, 0), 0x6e5338);
    const canopy = new THREE.IcosahedronGeometry(3.4, 0);
    canopy.scale(1.25, 0.42, 1.25);
    canopy.translate(0, 3.9, 0);
    const geo = merge([trunk, paint(canopy, 0x7b7a46)]);
    const placements = [];
    let tries = 0;
    while (placements.length < 420 && tries++ < 8000) {
      // Mostly around the town (south-east), some along the airport fence.
      const nearTown = rand() < 0.65;
      const cx = nearTown ? -3000 : -300;
      const cz = nearTown ? 600 : 0;
      const a = rand() * Math.PI * 2;
      const r = (nearTown ? 300 : 900) + Math.pow(rand(), 0.8) * (nearTown ? 2600 : 4000);
      const x = cx + Math.sin(a) * r;
      const z = cz - Math.cos(a) * r;
      if (x > -1100 && x < 300 && z > -2700 && z < 2800) continue; // airport
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const tx = x + (rand() - 0.5) * 60;
        const tz = z + (rand() - 0.5) * 60;
        placements.push([tx, this.terrain.rawHeight(tx, tz), tz, 0.7 + rand() * 0.7, rand() * 6]);
      }
    }
    const mesh = new THREE.InstancedMesh(geo, worldMaterial(), placements.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    placements.forEach(([x, y, z, sc, rot], i) => {
      q.setFromAxisAngle(up, rot);
      s.set(sc, sc * (0.8 + (i % 4) * 0.12), sc);
      p.set(x, y - 0.5, z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.total = placements.length;
    this.trees = mesh;
    this.setTreeDensity(density);
    this.group.add(mesh);
  }

  setTreeDensity(d) {
    this.trees.count = Math.max(1, Math.round(this.trees.userData.total * d));
  }

  /** Small town west of the airport: instanced boxes with per-instance colour. */
  buildTown() {
    const rand = mulberry32(2024);
    const geo = paint(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), 0xffffff);
    const palette = [0xece2cf, 0xdccfb6, 0xe8dcc4, 0xf2ece0, 0xc9b291, 0xd6bd98, 0xbfa985];
    const items = [];
    const centers = [[-3300, -500, 1400], [-2600, 1500, 800], [-4600, 2400, 700]];
    for (const [cx, cz, rad] of centers) {
      for (let i = 0; i < 120; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * rad;
        const x = Math.round((cx + Math.sin(a) * r) / 40) * 40;
        const z = Math.round((cz + Math.cos(a) * r) / 40) * 40;
        const y = this.terrain.rawHeight(x, z);
        if (y < 2) continue;
        const centerBoost = 1 - r / rad;
        const h = 6 + rand() * 10 + centerBoost * centerBoost * rand() * 45;
        items.push([x, y, z, 14 + rand() * 18, h, 14 + rand() * 18, palette[Math.floor(rand() * palette.length)]]);
      }
    }
    const mesh = new THREE.InstancedMesh(geo, worldMaterial(), items.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    items.forEach(([x, y, z, w, h, d, col], i) => {
      m.makeScale(w, h, d);
      m.setPosition(x, y - 1, z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(col));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }
}

export { GLIDE_DEG };
