// Cabin and flight-deck interior used by the cinematic (and the cockpit
// shell during gameplay). Everything lives in aircraft-local coordinates in
// the overlay scene, so interior shots line up exactly with the world seen
// through the windshield. Seats are instanced; passengers use the instanced
// CharacterSystem. Total: a handful of draw calls.

import * as THREE from 'three';
import { mulberry32 } from '../core/MathUtil.js';
import { merge, paint, quad, worldMaterial } from '../world/Geometry.js';
import { EYE } from './AircraftModel.js';
import { ARCHETYPE_COUNT, CharacterSystem, LOOKS, makePassenger } from './Characters.js';

export const FLOOR = EYE.y - 1.22;
export const BULKHEAD_Z = -14.25;
export const DOOR_HALF = 0.42;
export const PILOT_SEAT_Z = -15.45;
export const ROW_Z0 = -11.4;
export const ROW_PITCH = 0.82;
export const ROWS = 22;
export const SEAT_X = [-1.4, -0.95, -0.5, 0.5, 0.95, 1.4];
export const seatPos = (row, col) => ({ x: SEAT_X[col], z: ROW_Z0 + row * ROW_PITCH });

const F = FLOOR;
const box = (w, h, d, color, x, y, z) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

export class Interior {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'interior';
    scene.add(this.group);
    this.shell = new THREE.Group(); // cockpit walls/seats (also shown in gameplay)
    this.cabin = new THREE.Group(); // cabin + cast (cinematic only)
    this.group.add(this.shell, this.cabin);
    this.material = worldMaterial();
    // Cabin lighting: warm fill that also lights down-facing surfaces (ceiling, bins).
    this.cabin.add(new THREE.AmbientLight(0xfff6ea, 0.45), new THREE.HemisphereLight(0xffffff, 0xd9d1c4, 0.7));

    this.buildCockpitShell();
    this.buildCabin();
    this.buildDoor();
    this.buildCast();
    this.setCabinVisible(false);
  }

  buildCockpitShell() {
    const wall = 0x30353c;
    const dark = 0x24282d;
    const parts = [
      quad(-1.32, -16.75, 1.32, BULKHEAD_Z, F, 0x2a2e33),
      // Overhead panel / ceiling
      box(2.64, 0.08, 2.1, 0x383e45, 0, 5.14, -15.3),
      // Centre pedestal + thrust levers
      box(0.42, 0.72, 1.0, dark, 0, F + 0.36, -15.85),
      box(0.05, 0.16, 0.05, 0x9aa1a9, -0.08, F + 0.8, -15.95),
      box(0.05, 0.16, 0.05, 0x9aa1a9, 0.08, F + 0.8, -15.95),
    ];
    for (const s of [-1, 1]) {
      parts.push(box(0.08, 4.32 - F, 2.5, wall, s * 1.36, (F + 4.32) / 2, -15.5)); // lower side wall
      parts.push(box(0.06, 0.06, 2.3, 0x3a4048, s * 1.3, 5.0, -15.35)); // window top rail
      parts.push(box(0.06, 0.7, 0.06, 0x3a4048, s * 1.3, 4.66, -15.1)); // side window post
      parts.push(box(0.08, 0.85, 0.3, wall, s * 1.32, 4.72, -14.4)); // rear corner
      // Pilot seat
      const x = s * 0.48;
      parts.push(box(0.26, 0.32, 0.26, dark, x, F + 0.16, PILOT_SEAT_Z));
      parts.push(box(0.54, 0.12, 0.54, 0x4a5058, x, F + 0.4, PILOT_SEAT_Z));
      parts.push(box(0.52, 0.6, 0.1, 0x3c4249, x, F + 0.74, PILOT_SEAT_Z + 0.3));
      parts.push(box(0.28, 0.15, 0.09, 0x4a5058, x, F + 1.13, PILOT_SEAT_Z + 0.31));
      parts.push(box(0.06, 0.06, 0.4, dark, x + s * 0.3, F + 0.62, PILOT_SEAT_Z));
    }
    // Bulkhead with the door opening
    const bh = 0xcfd2d6;
    const top = F + 2.28; // reaches the cabin ceiling
    parts.push(box(1.62 - DOOR_HALF, top - F, 0.06, bh, -(1.62 + DOOR_HALF) / 2, (F + top) / 2, BULKHEAD_Z));
    parts.push(box(1.62 - DOOR_HALF, top - F, 0.06, bh, (1.62 + DOOR_HALF) / 2, (F + top) / 2, BULKHEAD_Z));
    parts.push(box(DOOR_HALF * 2, top - F - 1.96, 0.06, bh, 0, (F + 1.96 + top) / 2, BULKHEAD_Z));
    this.shell.add(new THREE.Mesh(merge(parts), this.material));
  }

  buildCabin() {
    const parts = [];
    const z0 = BULKHEAD_Z;
    const z1 = ROW_Z0 + ROWS * ROW_PITCH;
    const zc = (z0 + z1) / 2;
    const len = z1 - z0;
    // Floor with darker aisle
    parts.push(quad(-1.75, z0, 1.75, z1, F, 0x5b6371));
    parts.push(quad(-0.28, z0, 0.28, z1, F + 0.005, 0x454d59));
    // Forward galley: ceiling + walls with L1/R1 door outlines
    parts.push(box(3.3, 0.06, 2.1, 0xf4f3ef, 0, F + 2.22, -13.2));
    for (const s of [-1, 1]) {
      parts.push(box(0.06, 2.2, 2.05, 0xe4e1da, s * 1.6, F + 1.1, -13.2));
      parts.push(box(0.03, 1.85, 0.9, 0xa9aeb5, s * 1.565, F + 0.98, -13.2));
    }
    // Cabin walls: vertical lower wall + sloped window panel
    for (const s of [-1, 1]) {
      parts.push(box(0.06, 0.85, len - 2, 0xe8e5de, s * 1.75, F + 0.425, zc + 1));
      const pnl = new THREE.PlaneGeometry(len - 2, 0.95);
      pnl.rotateY(s > 0 ? -Math.PI / 2 : Math.PI / 2);
      pnl.rotateZ(s * 0.33); // top leans inward
      pnl.translate(s * 1.6, F + 1.3, zc + 1);
      parts.push(paint(pnl, 0xeeebe4));
      // Overhead bins + ceiling
      parts.push(box(0.55, 0.38, len - 2, 0xf3f2ed, s * 1.32, F + 1.93, zc + 1));
      parts.push(box(0.04, 0.05, len - 2, 0xbfc4ca, s * 1.05, F + 1.76, zc + 1));
    }
    parts.push(box(3.6, 0.06, len, 0xf4f3ef, 0, F + 2.16, zc));
    parts.push(box(3.6, 2.3, 0.06, 0xd9d4c9, 0, F + 1.1, z1)); // rear galley bulkhead
    this.cabin.add(new THREE.Mesh(merge(parts), this.material));

    // Window panels (unlit, sky-tinted) and ceiling light strips.
    const glow = [];
    for (let r = 0; r < ROWS; r++) {
      const z = ROW_Z0 + r * ROW_PITCH + 0.15;
      for (const s of [-1, 1]) {
        const w = new THREE.PlaneGeometry(0.24, 0.34);
        w.rotateY(s > 0 ? -Math.PI / 2 : Math.PI / 2);
        w.rotateZ(s * 0.33);
        w.translate(s * 1.585, F + 1.3, z);
        glow.push(w);
      }
    }
    for (const s of [-1, 1]) {
      const strip = new THREE.PlaneGeometry(0.08, len);
      strip.rotateX(Math.PI / 2);
      strip.translate(s * 0.98, F + 2.125, zc);
      glow.push(strip);
    }
    const glowGeo = merge(glow.map((g) => {
      g.deleteAttribute('uv');
      return g;
    }));
    this.cabin.add(new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0xdfeaf4, toneMapped: false })));

    // Instanced passenger seats
    const seat = merge([
      box(0.44, 0.12, 0.46, 0x2f3a52, 0, 0.44, 0),
      box(0.44, 0.72, 0.1, 0x2f3a52, 0, 0.84, 0.24),
      box(0.38, 0.2, 0.106, 0xe9e9e4, 0, 1.08, 0.235),
      box(0.04, 0.05, 0.42, 0x22262c, 0.22, 0.62, 0.02),
      box(0.3, 0.3, 0.06, 0x22262c, 0, 0.2, 0.15),
    ]);
    const seats = new THREE.InstancedMesh(seat, this.material, ROWS * SEAT_X.length);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < SEAT_X.length; c++) {
        const p = seatPos(r, c);
        m.makeTranslation(p.x, F, p.z);
        seats.setMatrixAt(i++, m);
      }
    }
    seats.instanceMatrix.needsUpdate = true;
    seats.computeBoundingSphere();
    this.cabin.add(seats);
  }

  buildDoor() {
    this.door = new THREE.Group();
    this.door.position.set(-DOOR_HALF, F, BULKHEAD_Z);
    const panel = merge([
      box(DOOR_HALF * 2 - 0.02, 1.94, 0.05, 0xb7bcc3, DOOR_HALF, 0.97, 0),
      box(0.05, 0.12, 0.04, 0x50565e, DOOR_HALF * 2 - 0.12, 1.0, 0.04),
      box(0.18, 0.12, 0.01, 0x2a2e33, DOOR_HALF, 1.45, 0.03),
    ]);
    this.door.add(new THREE.Mesh(panel, this.material));
    this.cabin.add(this.door);
  }

  buildCast() {
    this.chars = new CharacterSystem(110);
    this.chars.cockpitPoint.set(0, F + 1.45, BULKHEAD_Z - 0.1);
    this.cabin.add(this.chars.group);
    const sys = this.chars;
    const rand = mulberry32(1073);
    this.cast = {
      captain: sys.create(LOOKS.captain, 11),
      firstOfficer: sys.create(LOOKS.firstOfficer, 12),
      crew: sys.create(LOOKS.crew, 13),
      crew2: sys.create(LOOKS.crew2, 14),
      player: sys.create(LOOKS.offDutyPilot, 15),
      helper: sys.create(LOOKS.offDutyPilot2, 16),
      // Passengers who get up and help: business casual, beard, hoodie, jacket, backpack.
      p1: sys.create({ ...makePassenger(rand, 6), height: 1.06, react: 1.1 }, 21),
      p2: sys.create({ ...makePassenger(rand, 2), react: 1.1 }, 22),
      p3: sys.create({ ...makePassenger(rand, 0), react: 1.1 }, 23),
      p4: sys.create({ ...makePassenger(rand, 5), react: 1.1 }, 24),
      p5: sys.create({ ...makePassenger(rand, 8), react: 1.1 }, 25),
    };
    this.cast.captain.neighborSide = -1;
    this.cast.firstOfficer.neighborSide = 1;
    // Scripted seats (kept free of background passengers). The seats ahead of
    // and beside the player stay empty: the close-up camera looks across them.
    this.scriptSeats = { player: [2, 2], helper: [2, 3], p1: [4, 3], p2: [5, 2], p3: [6, 3], p4: [7, 2], p5: [8, 3] };
    const reserved = new Set([...Object.values(this.scriptSeats), [1, 1], [1, 2], [2, 1]].map(([r, c]) => `${r}:${c}`));
    this.extras = [];
    let n = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < SEAT_X.length; c++) {
        if (reserved.has(`${r}:${c}`) || rand() > 0.52) continue;
        // Cycle through the archetypes so every look appears, then randomise.
        const ch = sys.create(makePassenger(rand, n++ % ARCHETYPE_COUNT), 100 + n);
        ch.home = seatPos(r, c);
        ch.row = r;
        ch.col = c;
        this.extras.push(ch);
      }
    }
    for (const [key, [r, c]] of Object.entries(this.scriptSeats)) Object.assign(this.cast[key], { row: r, col: c });
    for (const ch of [...this.extras, ...Object.values(this.cast)]) {
      if (ch.col == null) continue;
      ch.seatSide = ch.col < 3 ? 1 : -1;
      const inner = ch.col === 2 || ch.col === 3;
      const window = ch.col === 0 || ch.col === 5;
      ch.neighborSide = inner ? ch.seatSide : window ? -ch.seatSide : (ch.id % 2 ? 1 : -1);
    }
    // A few aisle-seat passengers stand up in place during the emergency.
    this.standers = this.extras.filter((e) => (e.col === 2 || e.col === 3) && e.row >= 9 && e.row <= 15 && e.row !== 12).slice(0, 3);
  }

  setCabinVisible(v) {
    this.cabin.visible = v;
  }

  /** How hard the cabin is being shaken (0-1): drives everyone's sway. */
  setAgitation(v) {
    this.chars.agitation = v;
  }

  setDoorOpen(t) {
    this.door.rotation.y = Math.max(0, Math.min(1, t)) * 1.55;
  }

  /** Put the whole cast back in its opening positions. */
  reset() {
    const c = this.cast;
    const calm = (ch) => {
      ch.setVisible(true);
      ch.setMood('calm');
      ch.lookAt(null);
    };
    const seat = (ch, [r, col]) => {
      const p = seatPos(r, col);
      ch.place(p.x, F, p.z + 0.12, 0);
      ch.setPose('sit', true);
      calm(ch);
    };
    c.captain.place(-0.48, F, PILOT_SEAT_Z + 0.08, 0);
    c.captain.setPose('pilot', true);
    c.firstOfficer.place(0.48, F, PILOT_SEAT_Z + 0.08, 0);
    c.firstOfficer.setPose('pilot', true);
    c.crew.place(-1.0, F, -12.75, -Math.PI / 2);
    c.crew.setPose('stand', true);
    c.crew2.place(0, F, seatPos(11, 2).z - 0.05, Math.PI);
    c.crew2.setPose('stand', true);
    for (const k of ['captain', 'firstOfficer', 'crew', 'crew2']) calm(c[k]);
    for (const [key, s] of Object.entries(this.scriptSeats)) seat(c[key], s);
    for (const e of this.extras) seat(e, [e.row, e.col]);
    this.setAgitation(0);
    this.setDoorOpen(0);
  }

  /** @param camPos camera position in the aircraft frame (character LOD). */
  update(dt, camPos) {
    if (this.cabin.visible) this.chars.update(dt, camPos);
  }
}
