// Stylized low-poly characters for the cinematic: pilots, cabin crew and
// passengers. The look is "realistic cartoon": rounded bodies with believable
// proportions, faces with eyes, brows, nose, mouth and ears, a range of hair
// styles, outfits and accessories. Nothing is photoreal, and nobody is
// modelled on a real person.
//
// Performance model (unchanged from the first cast): every character is an
// invisible bone hierarchy and every body-part TYPE is one InstancedMesh
// shared by the whole cast, so 70 people cost one draw call per part type.
// Animation is procedural and layered:
//   base pose (sit / stand / pilot / brace / walk)
//   + mood layer (calm idle actions, confused, worried, alarmed, crew ...)
//   + gaze (head + eyes look at a target or around)
//   + breathing, blinking and cabin-motion sway.
// Simple LOD: only characters near the camera animate their faces, and
// distant ones update at a third of the frame rate.

import * as THREE from 'three';
import { clamp, damp, lerp, mulberry32 } from '../core/MathUtil.js';

const TAU = Math.PI * 2;
const HY = 0.15; // head centre above the neck joint

// --- geometry helpers ------------------------------------------------------------------
function clean(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  return n;
}

function mergeAll(list) {
  const parts = list.map(clean);
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o);
    nor.set(p.attributes.normal.array, o);
    o += p.attributes.position.array.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

const ell = (r, sx, sy, sz, x, y, z, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h).scale(sx, sy, sz).translate(x, y, z);
const capsule = (r, len, y, seg = 7) => new THREE.CapsuleGeometry(r, len, 2, seg).translate(0, y, 0);
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const hairCap = (r = 0.118, theta = 0.52, tilt = 0.55) =>
  new THREE.SphereGeometry(r, 14, 6, 0, TAU, 0, theta * Math.PI).scale(0.97, 1.07, 1.05).rotateX(tilt).translate(0, HY + 0.004, 0.006);

function curlyHair() {
  const bumps = [new THREE.SphereGeometry(0.12, 12, 5, 0, TAU, 0, 0.5 * Math.PI).scale(1, 1.05, 1.05)];
  const rings = [[0.1, 3], [0.27, 7], [0.43, 10]];
  for (const [a, n] of rings) {
    for (let k = 0; k < n; k++) {
      const phi = (k / n) * TAU + a * 3;
      const th = a * Math.PI;
      const r = 0.116;
      bumps.push(ell(0.036, 1, 1, 1, Math.sin(th) * Math.cos(phi) * r, Math.cos(th) * r * 1.05, Math.sin(th) * Math.sin(phi) * r, 6, 4));
    }
  }
  return mergeAll(bumps).rotateX(0.5).translate(0, HY + 0.006, 0.008);
}

// Every part type: geometry with its pivot at the bone it is bound to.
const PART_DEFS = {
  // body
  pelvis: () => ell(1, 0.165, 0.11, 0.118, 0, -0.02, 0, 10, 6),
  torso: () => {
    const pts = [[0.001, 0], [0.148, 0], [0.156, 0.07], [0.15, 0.19], [0.16, 0.3], [0.178, 0.4], [0.19, 0.465], [0.172, 0.525], [0.115, 0.567], [0.05, 0.583], [0.001, 0.586]];
    return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 12).scale(1, 1, 0.62);
  },
  neck: () => new THREE.CylinderGeometry(0.044, 0.05, 0.12, 8).translate(0, 0.012, 0.004),
  upperArm: () => capsule(0.048, 0.2, -0.145, 7),
  foreArm: () => capsule(0.042, 0.18, -0.13, 7),
  hand: () => ell(0.04, 0.85, 1.3, 0.62, 0, -0.045, 0, 6, 4),
  thigh: () => capsule(0.074, 0.29, -0.215, 7),
  shin: () => capsule(0.056, 0.31, -0.21, 7),
  shoe: () => new THREE.CapsuleGeometry(0.046, 0.12, 2, 6).rotateX(Math.PI / 2).scale(1.12, 0.78, 1).translate(0, -0.036, -0.05),
  // face (bound to the 'face' bone, which carries the per-character face shape)
  head: () => mergeAll([ell(0.105, 0.93, 1.1, 1.0, 0, HY, 0, 14, 10), ell(0.07, 1.0, 0.85, 1.0, 0, HY - 0.06, -0.035, 10, 6)]),
  ears: () => mergeAll([ell(0.024, 0.45, 1, 0.75, -0.097, HY, 0.008, 6, 4), ell(0.024, 0.45, 1, 0.75, 0.097, HY, 0.008, 6, 4)]),
  nose: () => ell(0.021, 0.78, 1.0, 1.2, 0, HY - 0.012, -0.106, 6, 5),
  eyes: () => mergeAll([ell(0.021, 1.08, 0.95, 0.5, -0.038, HY + 0.018, -0.092, 8, 5), ell(0.021, 1.08, 0.95, 0.5, 0.038, HY + 0.018, -0.092, 8, 5)]),
  pupils: () => mergeAll([ell(0.0118, 1, 1, 0.45, -0.038, HY + 0.018, -0.1013, 6, 4), ell(0.0118, 1, 1, 0.45, 0.038, HY + 0.018, -0.1013, 6, 4)]),
  brow: () => new THREE.BoxGeometry(0.046, 0.011, 0.012),
  mouth: () => ell(0.021, 1.05, 0.26, 0.45, 0, 0, 0, 8, 4),
  // hair styles
  hairShort: () => hairCap(),
  // Neat short cut: side-swept volume over the forehead, tapered at the back.
  hairNeat: () => mergeAll([
    hairCap(0.116, 0.5, 0.6),
    ell(0.06, 1.45, 0.55, 1.0, -0.018, HY + 0.097, -0.05, 12, 6).rotateZ(0.12),
    ell(0.05, 1.6, 0.5, 1.2, 0.0, HY + 0.1, 0.0, 12, 6),
  ]),
  hairBuzz: () => hairCap(0.113, 0.5, 0.62),
  hairLong: () => mergeAll([
    hairCap(0.118, 0.56, 0.5),
    ell(0.1, 1.08, 1.75, 0.6, 0, HY - 0.085, 0.058, 12, 8),
    ell(0.034, 0.75, 2.3, 0.95, -0.093, HY - 0.05, -0.012, 8, 6),
    ell(0.034, 0.75, 2.3, 0.95, 0.093, HY - 0.05, -0.012, 8, 6),
  ]),
  hairBun: () => mergeAll([hairCap(), ell(0.05, 1, 0.95, 1, 0, HY + 0.085, 0.09, 10, 8)]),
  hairPony: () => mergeAll([hairCap(), ell(0.036, 0.9, 2.5, 0.9, 0, HY - 0.035, 0.132, 8, 8), ell(0.022, 1, 1, 1, 0, HY + 0.035, 0.12, 8, 6)]),
  hairCurly: curlyHair,
  hairSide: () => new THREE.SphereGeometry(0.117, 16, 4, -0.1 * Math.PI, 1.2 * Math.PI, 0.3 * Math.PI, 0.27 * Math.PI)
    .scale(0.98, 1.05, 1.05).rotateX(0.3).translate(0, HY + 0.002, 0.004),
  hairScarf: () => mergeAll([
    new THREE.SphereGeometry(0.126, 16, 8, 0, TAU, 0, 0.6 * Math.PI).scale(1, 1.07, 1.05).rotateX(0.75).translate(0, HY, 0.008),
    ell(0.1, 1.38, 1.4, 1.02, 0, HY - 0.115, 0.03, 14, 8),
  ]),
  // face / head accessories
  beard: () => mergeAll([
    new THREE.SphereGeometry(0.106, 14, 5, 0.9 * Math.PI, 1.2 * Math.PI, 0.62 * Math.PI, 0.34 * Math.PI).scale(0.97, 1, 1.04).translate(0, HY, -0.002),
    ell(0.075, 1.02, 0.9, 1.04, 0, HY - 0.062, -0.038, 12, 8),
    ell(0.03, 1.5, 0.35, 0.6, 0, HY - 0.037, -0.103, 8, 4),
  ]),
  glasses: () => mergeAll([
    new THREE.TorusGeometry(0.027, 0.0042, 4, 12).translate(-0.039, HY + 0.018, -0.111),
    new THREE.TorusGeometry(0.027, 0.0042, 4, 12).translate(0.039, HY + 0.018, -0.111),
    box(0.022, 0.005, 0.005, 0, HY + 0.024, -0.112),
    box(0.004, 0.005, 0.1, -0.094, HY + 0.026, -0.062),
    box(0.004, 0.005, 0.1, 0.094, HY + 0.026, -0.062),
  ]),
  bcap: () => mergeAll([
    new THREE.SphereGeometry(0.123, 16, 6, 0, TAU, 0, 0.44 * Math.PI).scale(1, 1, 1.04).rotateX(0.3).translate(0, HY + 0.012, 0.004),
    ell(0.082, 1, 0.12, 0.9, 0, HY + 0.07, -0.135, 12, 4),
  ]),
  pcap: () => mergeAll([
    new THREE.CylinderGeometry(0.13, 0.121, 0.085, 16).translate(0, HY + 0.088, 0.008),
    ell(0.075, 1.05, 0.13, 0.85, 0, HY + 0.052, -0.114, 12, 4),
  ]),
  // torso accessories (bound to the waist)
  hood: () => new THREE.TorusGeometry(0.115, 0.042, 6, 12, 1.15 * Math.PI).rotateX(Math.PI / 2).rotateY(0.075 * Math.PI).scale(1.05, 1, 0.9).translate(0, 0.545, 0.03),
  // Shirt collar: a ring round the neck, open in a V at the front.
  collar: () => new THREE.TorusGeometry(0.066, 0.017, 5, 14, Math.PI * 1.6).rotateX(Math.PI / 2).rotateY(-1.7 * Math.PI)
    .scale(1, 1, 0.85).translate(0, 0.568, 0.004),
  shirtFront: () => new THREE.BoxGeometry(0.075, 0.36, 0.01).rotateX(-0.06).translate(0, 0.33, -0.108),
  tie: () => mergeAll([new THREE.BoxGeometry(0.042, 0.3, 0.01).rotateX(-0.06).translate(0, 0.35, -0.112), box(0.036, 0.03, 0.016, 0, 0.515, -0.11)]),
  epaulette: () => box(0.085, 0.014, 0.11, 0, 0.03, 0),
  backpack: () => mergeAll([ell(1, 0.135, 0.18, 0.07, 0, 0.32, 0.165, 12, 8), box(0.026, 0.32, 0.01, -0.085, 0.37, -0.112), box(0.026, 0.32, 0.01, 0.085, 0.37, -0.112)]),
  lapBag: () => ell(1, 0.15, 0.08, 0.11, 0, 0.12, -0.26, 12, 8),
  lanyard: () => mergeAll([
    new THREE.BoxGeometry(0.01, 0.24, 0.004).rotateZ(-0.32).translate(-0.036, 0.43, -0.118),
    new THREE.BoxGeometry(0.01, 0.24, 0.004).rotateZ(0.32).translate(0.036, 0.43, -0.118),
  ]),
  badge: () => box(0.048, 0.066, 0.005, 0, 0.3, -0.107),
  scarf: () => mergeAll([new THREE.TorusGeometry(0.07, 0.026, 6, 12).rotateX(Math.PI / 2).translate(0, 0.575, 0), ell(0.03, 1, 0.9, 0.6, 0.035, 0.53, -0.095, 8, 6)]),
  watch: () => new THREE.TorusGeometry(0.04, 0.009, 4, 10).rotateX(Math.PI / 2).translate(0, 0.03, 0),
};
const PAIRED = { upperArm: 2, foreArm: 2, hand: 2, thigh: 2, shin: 2, shoe: 2, epaulette: 2, brow: 2 };
const HAIR_PART = { neat: 'hairNeat', short: 'hairShort', buzz: 'hairBuzz', long: 'hairLong', bun: 'hairBun', pony: 'hairPony', curly: 'hairCurly', side: 'hairSide', scarf: 'hairScarf' };

// --- poses -------------------------------------------------------------------------------
// Joint angles [x, y, z] (radians). Limbs hang down, so +x swings them
// forward; the torso and neck point up, so +x leans them back (head up).
// For arms, -z moves the left arm outward and +z the right arm outward.
const POSES = {
  stand: { shoulderL: [0.05, 0, -0.06], shoulderR: [0.05, 0, 0.06], elbowL: [0.18, 0, 0], elbowR: [0.18, 0, 0] },
  sit: {
    hipL: [1.45, 0, -0.04], hipR: [1.45, 0, 0.04], kneeL: [-1.45, 0, 0], kneeR: [-1.45, 0, 0],
    waist: [0.06, 0, 0], shoulderL: [0.32, 0, 0.06], shoulderR: [0.32, 0, -0.06], elbowL: [0.95, 0, 0], elbowR: [0.95, 0, 0],
  },
  pilot: {
    hipL: [1.4, 0, 0], hipR: [1.4, 0, 0], kneeL: [-1.25, 0, 0], kneeR: [-1.25, 0, 0],
    waist: [-0.04, 0, 0], shoulderL: [0.75, 0, 0.12], shoulderR: [0.75, 0, -0.12], elbowL: [0.65, 0, 0], elbowR: [0.65, 0, 0],
  },
  brace: {
    hipL: [1.4, 0, 0], hipR: [1.4, 0, 0], kneeL: [-1.25, 0, 0], kneeR: [-1.25, 0, 0],
    waist: [0.18, 0, 0], neck: [-0.1, 0, 0], shoulderL: [1.0, 0, 0.42], shoulderR: [1.0, 0, -0.42], elbowL: [1.6, 0, 0], elbowR: [1.6, 0, 0],
  },
  // Sitting on the floor, back against a wall, legs out.
  floorSit: {
    hipL: [1.5, 0, -0.12], hipR: [1.5, 0, 0.12], kneeL: [-0.45, 0, 0], kneeR: [-0.25, 0, 0],
    waist: [0.22, 0, 0], shoulderL: [0.3, 0, -0.1], shoulderR: [0.3, 0, 0.1], elbowL: [0.6, 0, 0], elbowR: [0.6, 0, 0],
  },
  // Kneeling on the left knee, right foot planted.
  kneel: {
    hipL: [-0.12, 0, 0], kneeL: [-1.5, 0, 0], hipR: [1.35, 0, 0.08], kneeR: [-1.35, 0, 0],
    shoulderL: [0.3, 0, -0.08], shoulderR: [0.3, 0, 0.08], elbowL: [0.3, 0, 0], elbowR: [0.3, 0, 0],
  },
  // Lying face down (the root is rotated onto the floor), hands held behind the back.
  prone: {
    kneeL: [-0.85, 0, 0], kneeR: [-0.7, 0, 0], neck: [0.35, 0.5, 0],
    shoulderL: [-0.55, 0, 0.3], shoulderR: [-0.55, 0, -0.3], elbowL: [1.3, 0, 0], elbowR: [1.3, 0, 0],
  },
};
const SEATED = new Set(['sit', 'pilot', 'brace', 'floorSit']);
// Hip height per base pose (seat heights are absolute, kneeling / floor scale with the body).
const HIPS = { sit: 0.5, pilot: 0.5, brace: 0.5 };
const BODY_HIPS = { floorSit: 0.14, kneel: 0.5 };
const BONES = ['waist', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR', 'kneeL', 'kneeR'];
const STANDING_HIPS = 0.92;

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const IDENT = new THREE.Matrix4();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const set3 = (a, x, y, z) => {
  a[0] = x;
  a[1] = y;
  a[2] = z;
};
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (u) => u * u * (3 - 2 * u);

let nextId = 0;

export class Character {
  constructor(system, spec, seed = 1) {
    this.system = system;
    this.spec = spec;
    this.id = nextId++;
    const rand = (this.rand = mulberry32(seed));
    this.visible = true;
    this.written = false;
    this.scale = spec.height ?? 1;
    const bulk = spec.bulk ?? 1;
    this.root = new THREE.Object3D();
    this.root.rotation.order = 'YXZ'; // yaw first, so a character can also lie down
    this.root.scale.setScalar(this.scale);
    const b = (this.bones = {});
    const mk = (name, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      b[name] = o;
      return o;
    };
    mk('hips', this.root, 0, STANDING_HIPS, 0);
    mk('waist', b.hips, 0, 0.05, 0);
    mk('neck', b.waist, 0, 0.6, 0);
    const face = mk('face', b.neck);
    const fs = spec.face || [1, 1];
    face.scale.set(fs[0], fs[1], (fs[0] + 1) / 2);
    mk('shoulderL', b.waist, -0.2 * bulk, 0.5, 0);
    mk('shoulderR', b.waist, 0.2 * bulk, 0.5, 0);
    mk('elbowL', b.shoulderL, 0, -0.29, 0);
    mk('elbowR', b.shoulderR, 0, -0.29, 0);
    mk('wristL', b.elbowL, 0, -0.27, 0);
    mk('wristR', b.elbowR, 0, -0.27, 0);
    mk('hipL', b.hips, -0.095 * bulk, -0.02, 0);
    mk('hipR', b.hips, 0.095 * bulk, -0.02, 0);
    mk('kneeL', b.hipL, 0, -0.44, 0);
    mk('kneeR', b.hipR, 0, -0.44, 0);
    mk('ankleL', b.kneeL, 0, -0.43, 0);
    mk('ankleR', b.kneeR, 0, -0.43, 0);

    // Part bindings: [partType, bone, colour, local matrix?, when?]
    const s = spec;
    const top = s.top;
    const bulkM = new THREE.Matrix4().makeScale(bulk, 1, 0.5 + bulk * 0.5);
    const limbM = new THREE.Matrix4().makeScale(Math.sqrt(bulk), 1, Math.sqrt(bulk));
    const noseM = new THREE.Matrix4().makeTranslation(0, HY - 0.012, -0.106)
      .multiply(new THREE.Matrix4().makeScale(s.nose ?? 1, s.nose ?? 1, s.nose ?? 1))
      .multiply(new THREE.Matrix4().makeTranslation(0, -(HY - 0.012), 0.106));
    const browCol = s.brow ?? (s.hairColor != null ? darken(s.hairColor, 0.72) : 0x3a2c22);
    const bind = [
      ['pelvis', 'hips', s.pants, bulkM], ['torso', 'waist', top, bulkM], ['neck', 'neck', s.skin],
      ['head', 'face', s.skin], ['ears', 'face', s.skin], ['nose', 'face', s.skin, noseM],
      ['eyes', 'face', 0xf3efe7], ['pupils', 'face', s.eye ?? 0x3b2a1e],
      ['brow', 'face', browCol], ['brow', 'face', browCol], ['mouth', 'face', s.lips ?? 0x8a4c47],
      ['upperArm', 'shoulderL', top, limbM], ['upperArm', 'shoulderR', top, limbM],
      ['foreArm', 'elbowL', s.sleeve ?? top], ['foreArm', 'elbowR', s.sleeve ?? top],
      ['hand', 'wristL', s.skin], ['hand', 'wristR', s.skin],
      ['thigh', 'hipL', s.pants, limbM], ['thigh', 'hipR', s.pants, limbM],
      ['shin', 'kneeL', s.pants], ['shin', 'kneeR', s.pants],
      ['shoe', 'ankleL', s.shoes ?? 0x1f2125], ['shoe', 'ankleR', s.shoes ?? 0x1f2125],
    ];
    if (s.hairStyle && HAIR_PART[s.hairStyle]) bind.push([HAIR_PART[s.hairStyle], 'face', s.hairColor]);
    if (s.beard != null) bind.push(['beard', 'face', s.beard]);
    if (s.glasses != null) bind.push(['glasses', 'face', s.glasses]);
    if (s.bcap != null) bind.push(['bcap', 'face', s.bcap]);
    if (s.pcap != null) bind.push(['pcap', 'face', s.pcap]);
    if (s.hood != null) bind.push(['hood', 'waist', s.hood, bulkM]);
    if (s.collar != null) bind.push(['collar', 'waist', s.collar, bulkM]);
    if (s.shirtFront != null) bind.push(['shirtFront', 'waist', s.shirtFront]);
    if (s.tie != null) bind.push(['tie', 'waist', s.tie]);
    if (s.scarf != null) bind.push(['scarf', 'waist', s.scarf]);
    if (s.lanyard != null) bind.push(['lanyard', 'waist', s.lanyard], ['badge', 'waist', s.badge ?? 0xf1f2f3]);
    if (s.watch != null) bind.push(['watch', 'wristL', s.watch]);
    if (s.epaulette != null) bind.push(['epaulette', 'shoulderL', s.epaulette], ['epaulette', 'shoulderR', s.epaulette]);
    if (s.backpack != null) bind.push(['backpack', 'waist', s.backpack, bulkM, 'standing'], ['lapBag', 'hips', s.backpack, null, 'seated']);

    this.slots = bind.map(([type, bone, color, local, when]) => ({
      type, bone: b[bone], index: system.allocate(type, color), local: local ? local.clone() : null, when,
    }));
    this.face = {
      browL: this.slots.find((sl) => sl.type === 'brow'),
      browR: this.slots.filter((sl) => sl.type === 'brow')[1],
      mouth: this.slots.find((sl) => sl.type === 'mouth'),
      eyes: this.slots.find((sl) => sl.type === 'eyes'),
      pupils: this.slots.find((sl) => sl.type === 'pupils'),
    };
    for (const k of ['browL', 'browR', 'mouth', 'eyes', 'pupils']) this.face[k].local = new THREE.Matrix4();
    this.mouthZ = s.beard != null ? -0.116 : -0.104;
    this.faceVal = { brow: 0, tilt: 0, asym: 0, open: 0, width: 1, wide: 0 };
    this.faceGoal = { brow: 0, tilt: 0, asym: 0, open: 0, width: 1, wide: 0, talk: 0 };
    this.faceStatic = false;
    this.setFaceLocals(0, 0, 1);

    // Animation state
    this.current = {};
    this.target = {};
    for (const name of BONES) {
      this.current[name] = [0, 0, 0];
      this.target[name] = [0, 0, 0];
    }
    this.base = 'stand';
    this.mood = 'calm';
    this.moodTime = 0;
    this.pending = null;
    this.hipsHeight = STANDING_HIPS;
    this.walking = false;
    this.stepping = 0;
    this.walkPhase = rand() * 6;
    this.walkSpeed = 1.4;
    this.path = [];
    this.slide = null;
    this.yawTarget = null;
    this.onArrive = null;
    this.time = rand() * 10;
    this.acc = 0;
    this.phase = rand() * TAU;
    this.breath = 1.6 + rand() * 0.7;
    this.react = spec.react ?? 0.7 + rand() * 0.6; // how strongly this person reacts
    this.blinkT = rand() * 4;
    this.gaze = { yaw: 0, pitch: 0 };
    this.gazeGoal = { yaw: 0, pitch: 0 };
    this.gazePoint = null; // fixed look target (interior frame), overrides behaviour
    this.lookT = rand() * 3;
    this.action = null;
    this.actionT = 1 + rand() * 4;
    this.saccade = { x: 0, y: 0, t: 0 };
    this.seatSide = 0; // -1 window on the left, +1 on the right (set by the interior)
    this.neighborSide = 0;
    this.setPose('stand', true);
  }

  // --- control API ------------------------------------------------------------------------
  place(x, y, z, yaw = 0) {
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, yaw, 0);
    this.yawTarget = null;
    this.slide = null;
  }

  /** Lie face down on the floor at height y; the head points along `yaw`. */
  lieProne(x, y, z, yaw) {
    this.place(x, y + 0.12, z, yaw);
    this.root.rotation.x = -Math.PI / 2;
    this.setPose('prone', true);
  }

  setVisible(v) {
    this.visible = v;
  }

  /** Base pose: 'sit' | 'stand' | 'pilot' | 'brace'. */
  setPose(name, instant = false) {
    this.base = POSES[name] ? name : 'stand';
    this.walking = false;
    this.path.length = 0;
    if (instant) {
      const pose = POSES[this.base];
      for (const bone of BONES) set3(this.current[bone], ...(pose[bone] || [0, 0, 0]));
      this.hipsHeight = this.hipsGoal();
    }
  }

  get seated() {
    return SEATED.has(this.base);
  }

  get upright() {
    return this.visible && !this.seated && this.base !== 'prone';
  }

  /** Mood layer, optionally after a delay (staggered reactions). */
  setMood(mood, delay = 0) {
    if (delay > 0) {
      this.pending = { mood, delay };
      return;
    }
    this.pending = null;
    if (this.mood !== mood) {
      this.mood = mood;
      this.moodTime = 0;
      this.lookT = 0;
      this.action = null;
    }
  }

  /** Fix the gaze on a point in the interior frame (null = behaviour decides). */
  lookAt(point) {
    this.gazePoint = point ? point.clone() : null;
  }

  faceToward(x, z) {
    const p = this.root.position;
    this.yawTarget = Math.atan2(-(x - p.x), -(z - p.z));
  }

  /**
   * Walk along [x, z, speed?, faceYaw?] points (interior frame) at floor height y.
   * faceYaw keeps the body turned that way on a segment (side-steps).
   */
  walkTo(points, y, speed = 1.4, onArrive = null) {
    this.base = 'stand';
    this.slide = null;
    this.path = points.map(([x, z, sp, face]) => ({ x, z, speed: sp, face }));
    this.root.position.y = y;
    this.walkSpeed = speed;
    this.walking = true;
    this.onArrive = onArrive;
  }

  /** Stand up from a passenger seat, step into the aisle, then follow `points`. */
  leaveSeat(points, y, speed = 1.5, onArrive = null) {
    const p = this.root.position;
    const zLeg = p.z - 0.42;
    const toAisle = p.x > 0 ? 0.55 : -0.55;
    this.walkTo([[p.x, zLeg, 0.85, 0], [0, zLeg, 1.0, toAisle], ...points], y, speed, onArrive);
  }

  /** Stand in front of the seat (legroom), holding the seat ahead. */
  standInPlace(y) {
    const p = this.root.position;
    this.walkTo([[p.x, p.z - 0.4, 0.7, 0]], y, 0.7, (c) => {
      c.yawTarget = 0;
      c.setMood('standLook');
    });
  }

  /** Slide into a seat (pilot seat or passenger seat) over `dur` seconds. */
  sitAt(x, z, yaw = 0, pose = 'pilot', dur = 0.55) {
    const p = this.root.position;
    this.walking = false;
    this.path.length = 0;
    this.base = pose;
    this.slide = { x0: p.x, z0: p.z, x1: x, z1: z, y0: this.root.rotation.y, y1: yaw, t: 0, dur };
  }

  hipsGoal() {
    if (HIPS[this.base] != null) return HIPS[this.base] / this.scale;
    return BODY_HIPS[this.base] ?? STANDING_HIPS;
  }

  // --- per frame --------------------------------------------------------------------------
  update(dt, lod) {
    this.time += dt;
    if (this.pending) {
      this.pending.delay -= dt;
      if (this.pending.delay <= 0) this.setMood(this.pending.mood);
    }
    this.moodTime += dt;

    const T = this.target;
    const pose = POSES[this.base] || POSES.stand;
    for (const bone of BONES) {
      const v = pose[bone];
      if (v) set3(T[bone], v[0], v[1], v[2]);
      else set3(T[bone], 0, 0, 0);
    }
    this.locomote(dt);
    this.applyLayers(dt);
    this.applyGaze(dt);

    // Blend joints toward the targets (legs follow the walk cycle directly).
    const k = 1 - Math.exp(-7 * dt);
    const walk = this.walking && this.stepping > 0.01;
    for (const bone of BONES) {
      const c = this.current[bone];
      const t = T[bone];
      const direct = walk && (bone.startsWith('hip') || bone.startsWith('knee'));
      c[0] += (t[0] - c[0]) * (direct ? 1 : k);
      c[1] += (t[1] - c[1]) * k;
      c[2] += (t[2] - c[2]) * (direct ? 1 : k);
      this.bones[bone].rotation.set(c[0], c[1], c[2]);
    }
    this.hipsHeight = damp(this.hipsHeight, this.hipsGoal(), 6, dt);
    const bob = walk ? Math.abs(Math.cos(this.walkPhase)) * 0.028 * this.stepping : 0;
    this.bones.hips.position.y = this.hipsHeight + bob;

    if (lod === 0) this.updateFace(dt);
    else if (!this.faceStatic) {
      this.setFaceLocals(0, 0, 1);
      this.faceStatic = true;
    }
  }

  locomote(dt) {
    const p = this.root.position;
    if (this.slide) {
      const s = this.slide;
      s.t = Math.min(1, s.t + dt / s.dur);
      const k = smooth(s.t);
      p.x = lerp(s.x0, s.x1, k);
      p.z = lerp(s.z0, s.z1, k);
      this.root.rotation.y = s.y0 + wrapPi(s.y1 - s.y0) * k;
      if (s.t >= 1) {
        this.slide = null;
        this.yawTarget = null;
      }
      return;
    }
    if (this.walking && this.path.length) {
      const goal = this.path[0];
      const dx = goal.x - p.x;
      const dz = goal.z - p.z;
      const dist = Math.hypot(dx, dz);
      const speed = goal.speed ?? this.walkSpeed;
      const blocked = dist > 0.05 && this.system.isBlocked(this, dx / dist, dz / dist);
      this.stepping = clamp(this.stepping + (blocked ? -dt * 5 : dt * 4), 0, 1);
      if (!blocked) {
        const step = speed * dt * (0.35 + 0.65 * this.stepping);
        if (dist <= step) {
          p.x = goal.x;
          p.z = goal.z;
          this.path.shift();
          if (!this.path.length) {
            this.walking = false;
            this.stepping = 0;
            const cb = this.onArrive;
            this.onArrive = null;
            cb?.(this);
          }
        } else {
          p.x += (dx / dist) * step;
          p.z += (dz / dist) * step;
          this.yawTarget = goal.face ?? Math.atan2(-dx, -dz);
        }
        this.walkPhase += dt * speed * 5.4;
      }
    }
    if (this.yawTarget != null) {
      const d = wrapPi(this.yawTarget - this.root.rotation.y);
      this.root.rotation.y += d * Math.min(1, dt * (this.walking ? 8 : 4));
    }
  }

  /** Point in the interior frame -> local gaze yaw / pitch. */
  gazeTo(x, y, z, out) {
    const p = this.root.position;
    const dx = x - p.x;
    const dz = z - p.z;
    out.yaw = wrapPi(Math.atan2(-dx, -dz) - this.root.rotation.y);
    const headY = p.y + (this.hipsHeight + 0.7) * this.scale;
    out.pitch = Math.atan2(y - headY, Math.max(0.3, Math.hypot(dx, dz)));
    return out;
  }

  pickLook(kind) {
    const g = this.gazeGoal;
    const r = this.rand;
    switch (kind) {
      case 'cockpit': {
        const c = this.system.cockpitPoint;
        this.gazeTo(c.x + (r() - 0.5) * 0.4, c.y, c.z, g);
        break;
      }
      case 'neighbor':
        g.yaw = (this.neighborSide || (r() < 0.5 ? -1 : 1)) * (0.65 + r() * 0.3);
        g.pitch = -0.05 + r() * 0.08;
        break;
      case 'window':
        g.yaw = (this.seatSide || 1) * (0.9 + r() * 0.35);
        g.pitch = -0.05 + r() * 0.1;
        break;
      case 'aisle':
        g.yaw = -(this.seatSide || 1) * (0.5 + r() * 0.4);
        g.pitch = -0.08;
        break;
      case 'back':
        g.yaw = (r() < 0.5 ? -1 : 1) * (1.15 + r() * 0.3);
        g.pitch = 0.05;
        break;
      case 'down':
        g.yaw = (r() - 0.5) * 0.2;
        g.pitch = -0.45 - r() * 0.15;
        break;
      case 'up':
        g.yaw = (r() - 0.5) * 0.6;
        g.pitch = 0.25 + r() * 0.15;
        break;
      default:
        g.yaw = (r() - 0.5) * 0.3;
        g.pitch = (r() - 0.5) * 0.12;
    }
  }

  /** Mood + idle layer: writes deltas / overrides into the joint targets. */
  applyLayers(dt) {
    const T = this.target;
    const t = this.time;
    const r = this.rand;
    const F = this.faceGoal;
    F.brow = 0;
    F.tilt = 0;
    F.asym = 0;
    F.open = 0;
    F.width = 1;
    F.wide = 0;
    F.talk = 0;

    // Breathing
    const br = Math.sin(t * this.breath + this.phase);
    T.waist[0] += br * 0.014;
    T.shoulderL[2] -= br * 0.01;
    T.shoulderR[2] += br * 0.01;

    if (this.walking) {
      const s = Math.sin(this.walkPhase) * this.stepping;
      T.hipL[0] = s * 0.5;
      T.hipR[0] = -s * 0.5;
      T.kneeL[0] = -Math.max(0, -Math.sin(this.walkPhase)) * 0.75 * this.stepping;
      T.kneeR[0] = -Math.max(0, Math.sin(this.walkPhase)) * 0.75 * this.stepping;
      T.shoulderL[0] = -s * 0.38 + 0.05;
      T.shoulderR[0] = s * 0.38 + 0.05;
      T.elbowL[0] = 0.4;
      T.elbowR[0] = 0.4;
      T.waist[0] -= 0.07;
      T.waist[1] = s * 0.07;
      this.gazeGoal.yaw = this.mood === 'resolve' ? 0 : Math.sin(t * 0.9 + this.phase) * 0.25;
      this.gazeGoal.pitch = -0.08;
      F.brow = this.mood === 'resolve' ? -0.25 : 0.25;
      F.tilt = this.mood === 'resolve' ? 0 : 0.35;
      return;
    }

    const seated = this.base === 'sit';
    const lookEvery = (lo, hi, kinds) => {
      this.lookT -= dt;
      if (this.lookT <= 0) {
        this.lookT = lo + r() * (hi - lo);
        this.pickLook(kinds[Math.floor(r() * kinds.length)]);
      }
    };

    switch (this.mood) {
      case 'calm':
        if (this.base === 'pilot') lookEvery(2, 5, ['forward', 'forward', 'down', 'neighbor']);
        else if (seated) this.idleSeated(dt);
        else {
          lookEvery(2, 5, ['forward', 'aisle', 'back', 'forward']);
          T.shoulderL[0] = 0.28;
          T.shoulderR[0] = 0.28;
          T.shoulderL[2] = 0.25;
          T.shoulderR[2] = -0.25;
          T.elbowL[0] = 0.75;
          T.elbowR[0] = 0.75;
        }
        break;
      case 'confused':
        lookEvery(0.7, 1.7, ['cockpit', 'neighbor', 'cockpit', 'back', 'up']);
        F.brow = 0.55;
        F.asym = 0.4;
        F.open = 0.12;
        break;
      case 'worried':
        lookEvery(1.2, 2.6, ['cockpit', 'cockpit', 'neighbor', 'down']);
        if (seated) {
          set3(T.shoulderL, 0.24, 0, -0.13);
          set3(T.shoulderR, 0.24, 0, 0.13);
          T.elbowL[0] = 0.8;
          T.elbowR[0] = 0.8;
          T.waist[0] -= 0.12 * this.react;
        }
        F.brow = 0.35;
        F.tilt = 0.75;
        F.width = 0.85;
        break;
      case 'alarmed':
        lookEvery(0.35, 0.9, ['cockpit', 'neighbor', 'cockpit', 'back']);
        if (seated) {
          T.waist[0] += 0.05;
          set3(T.shoulderL, 0.26, 0, -0.1);
          set3(T.shoulderR, 0.26, 0, 0.1);
          T.elbowL[0] = 0.6;
          T.elbowR[0] = 0.6;
        }
        F.brow = 0.9;
        F.tilt = 0.45;
        F.open = 0.55 * this.react;
        F.wide = 1;
        break;
      case 'helpful': // unbuckling, about to stand
        lookEvery(0.8, 1.6, ['cockpit', 'down', 'cockpit']);
        set3(T.shoulderL, 0.5, 0, 0.3);
        set3(T.shoulderR, 0.5, 0, -0.3);
        T.elbowL[0] = 1.1;
        T.elbowR[0] = 1.1;
        T.waist[0] -= 0.1;
        F.brow = -0.15;
        break;
      case 'resolve': // calm, focused (the off-duty pilots)
        if (!this.gazePoint) lookEvery(1.5, 3, ['cockpit', 'cockpit', 'forward']);
        F.brow = -0.25;
        F.width = 0.9;
        break;
      case 'standLook': // standing in the legroom, hands on the seat ahead
        lookEvery(0.9, 2.2, ['cockpit', 'cockpit', 'back', 'neighbor']);
        set3(T.shoulderL, 0.85, 0, 0.12);
        set3(T.shoulderR, 0.85, 0, -0.12);
        T.elbowL[0] = 0.5;
        T.elbowR[0] = 0.5;
        T.waist[0] -= 0.06;
        F.brow = 0.6;
        F.tilt = 0.6;
        F.open = 0.2;
        break;
      case 'crewHold': // steadying against a seat back / bulkhead
        if (!this.gazePoint) lookEvery(0.8, 2, ['cockpit', 'cockpit', 'back', 'aisle']);
        set3(T.shoulderR, 0.72, 0, 0.45);
        T.elbowR[0] = 0.32;
        set3(T.shoulderL, 0.25, 0, -0.12);
        T.elbowL[0] = 0.5;
        T.waist[2] += Math.sin(t * 1.3 + this.phase) * 0.03;
        F.brow = 0.3;
        F.tilt = 0.5;
        break;
      case 'gesture': { // "please stay seated": both palms down, talking
        const s = Math.sin(t * 5);
        set3(T.shoulderL, 1.0 + s * 0.18, 0, -0.25);
        set3(T.shoulderR, 1.0 - s * 0.18, 0, 0.25);
        T.elbowL[0] = 0.32;
        T.elbowR[0] = 0.32;
        this.gazeGoal.yaw = Math.sin(t * 0.9 + this.phase) * 0.7;
        this.gazeGoal.pitch = -0.25;
        F.brow = 0.25;
        F.tilt = 0.3;
        F.talk = 1;
        break;
      }
      case 'knock': // at the flight-deck door
        set3(T.shoulderR, 1.42, 0, -0.05);
        T.elbowR[0] = 0.75 + 0.35 * Math.max(0, Math.sin(t * 10));
        set3(T.shoulderL, 0.35, 0, -0.35);
        T.elbowL[0] = 0.4;
        this.gazeGoal.yaw = 0;
        this.gazeGoal.pitch = 0.05;
        F.brow = 0.45;
        F.tilt = 0.6;
        F.talk = 0.6;
        break;
      case 'hurt': // injured: hunched, a hand held to the back of the head
        T.waist[0] -= 0.32;
        T.neck[0] -= 0.25;
        set3(T.shoulderL, 2.8, -0.2, 0.6); // hand clutching the back of the head
        T.elbowL[0] = 1.9;
        if (this.base !== 'floorSit') {
          set3(T.shoulderR, 0.55, 0, -0.05);
          T.elbowR[0] = 0.7;
        }
        if (this.base === 'stand') {
          T.kneeL[0] = -0.25;
          T.kneeR[0] = -0.2;
          T.hipL[0] = 0.15;
          T.hipR[0] = 0.12;
        }
        this.gazeGoal.yaw = Math.sin(t * 0.7 + this.phase) * 0.2;
        this.gazeGoal.pitch = -0.35;
        F.brow = 0.4;
        F.tilt = 0.9;
        F.width = 0.8;
        F.open = 0.15;
        break;
      case 'pushYoke': // leaning on the controls, pushing them forward
        T.waist[0] -= 0.3;
        set3(T.shoulderL, 1.2, 0, 0.14);
        set3(T.shoulderR, 1.2, 0, -0.14);
        T.elbowL[0] = 0.15;
        T.elbowR[0] = 0.15;
        this.gazeGoal.yaw = 0;
        this.gazeGoal.pitch = 0.05;
        F.brow = -0.3;
        F.tilt = -0.5;
        F.width = 0.8;
        break;
      case 'restrain': // kneeling / leaning over someone, pressing down
        T.waist[0] -= this.base === 'kneel' ? 0.55 : 0.7;
        set3(T.shoulderL, 1.35, 0, 0.12);
        set3(T.shoulderR, 1.35, 0, -0.12);
        T.elbowL[0] = 0.3 + Math.max(0, Math.sin(t * 3.1 + this.phase)) * 0.15;
        T.elbowR[0] = 0.3 + Math.max(0, Math.sin(t * 2.7 + this.phase)) * 0.15;
        this.gazeGoal.yaw = Math.sin(t * 1.3 + this.phase) * 0.25;
        this.gazeGoal.pitch = -0.6;
        F.brow = -0.1;
        F.tilt = 0.3;
        F.open = 0.2;
        F.talk = 0.4;
        break;
      case 'tend': // kneeling beside someone, a hand on their shoulder
        T.waist[0] -= 0.25;
        set3(T.shoulderR, 1.05, 0, 0.15);
        T.elbowR[0] = 0.45;
        set3(T.shoulderL, 0.7, 0, -0.1);
        T.elbowL[0] = 0.9;
        if (!this.gazePoint) {
          this.gazeGoal.yaw = 0.15;
          this.gazeGoal.pitch = -0.3;
        }
        F.brow = 0.3;
        F.tilt = 0.7;
        F.talk = 0.5;
        break;
      case 'brace': // the two pilots during the emergency
        lookEvery(0.4, 1.0, ['forward', 'neighbor', 'down']);
        F.brow = 0.6;
        F.tilt = 0.4;
        F.open = 0.3;
        break;
      default:
        break;
    }

    // Cabin motion: everyone sways, unsecured people more.
    const ag = this.system.agitation * this.react;
    if (ag > 0.01) {
      const sw = Math.sin(t * 6.7 + this.phase) * 0.045 + Math.sin(t * 13.1 + this.phase * 2) * 0.018;
      T.waist[2] += sw * ag * (seated ? 1 : 1.5);
      T.waist[0] += Math.sin(t * 4.3 + this.phase) * 0.02 * ag;
      T.neck[2] += Math.sin(t * 7.7 + this.phase) * 0.05 * ag;
    }
  }

  /** Seated idle actions: look around, phone, chat, window, posture shifts. */
  idleSeated(dt) {
    const T = this.target;
    const r = this.rand;
    this.actionT -= dt;
    if (this.actionT <= 0 || !this.action) {
      const pick = r();
      this.action = pick < 0.3 ? 'look' : pick < 0.5 ? 'phone' : pick < 0.68 ? 'chat' : pick < 0.84 ? 'window' : 'adjust';
      this.actionT = this.action === 'adjust' ? 1.6 : 3 + r() * 5;
      this.lookT = 0;
      this.adjust = (r() - 0.5) * 0.12;
    }
    switch (this.action) {
      case 'phone':
        set3(T.shoulderR, 0.5, 0, -0.18);
        T.elbowR[0] = 1.55;
        set3(T.shoulderL, 0.45, 0, 0.2);
        T.elbowL[0] = 1.2;
        if (this.lookT <= 0) {
          this.lookT = 99;
          this.pickLook('down');
        }
        break;
      case 'chat':
        if (this.lookT <= 0) {
          this.lookT = 1.5 + r() * 2;
          this.pickLook(r() < 0.75 ? 'neighbor' : 'forward');
        }
        this.lookT -= dt;
        T.elbowR[0] += Math.sin(this.time * 3.1) * 0.15;
        this.faceGoal.talk = 0.55;
        break;
      case 'window':
        if (this.lookT <= 0) {
          this.lookT = 99;
          this.pickLook('window');
        }
        break;
      case 'adjust':
        T.waist[2] += this.adjust;
        T.waist[1] += this.adjust * 1.5;
        T.waist[0] += 0.05;
        break;
      default:
        if (this.lookT <= 0) {
          this.lookT = 1.5 + r() * 2.5;
          this.pickLook(['forward', 'aisle', 'neighbor', 'up', 'forward'][Math.floor(r() * 5)]);
        }
        this.lookT -= dt;
    }
  }

  applyGaze(dt) {
    const G = this.gazeGoal;
    if (this.gazePoint) this.gazeTo(this.gazePoint.x, this.gazePoint.y, this.gazePoint.z, G);
    const fast = this.mood === 'alarmed' || this.mood === 'confused' ? 9 : 5;
    this.gaze.yaw = damp(this.gaze.yaw, clamp(G.yaw, -1.6, 1.6), fast, dt);
    this.gaze.pitch = damp(this.gaze.pitch, clamp(G.pitch, -0.7, 0.5), fast, dt);
    const T = this.target;
    const waistMax = this.seated ? 0.22 : 0.42;
    const wy = clamp(this.gaze.yaw * 0.3, -waistMax, waistMax);
    T.waist[1] += wy;
    const ny = clamp(this.gaze.yaw - wy, -1.1, 1.1);
    T.neck[1] += ny;
    T.neck[0] += this.gaze.pitch - T.waist[0] * 0.6; // keep the head level when leaning
    this.eyeYaw = clamp(this.gaze.yaw - wy - ny, -0.5, 0.5);
  }

  // --- face ------------------------------------------------------------------------------
  updateFace(dt) {
    this.faceStatic = false;
    const v = this.faceVal;
    const g = this.faceGoal;
    for (const k of ['brow', 'tilt', 'asym', 'open', 'width', 'wide']) v[k] = damp(v[k], g[k], 10, dt);
    // Blink
    this.blinkT -= dt;
    let eyeY = 1 + v.wide * 0.12;
    if (this.blinkT < 0) {
      eyeY = 0.12;
      if (this.blinkT < -0.11) this.blinkT = (this.mood === 'calm' ? 2 : 1.2) + this.rand() * 3.5;
    }
    // Small saccades
    const sc = this.saccade;
    sc.t -= dt;
    if (sc.t <= 0) {
      sc.t = 0.4 + this.rand() * 1.4;
      sc.x = (this.rand() - 0.5) * 0.004;
      sc.y = (this.rand() - 0.5) * 0.003;
    }
    const talk = g.talk > 0 ? g.talk * (0.5 + 0.5 * Math.sin(this.time * 14)) * (0.6 + 0.4 * Math.sin(this.time * 3.7)) : 0;
    const px = -Math.sin(this.eyeYaw || 0) * 0.012 + sc.x;
    const py = clamp(this.gaze.pitch, -0.5, 0.5) * 0.008 + sc.y;
    this.setFaceLocals(px, py, eyeY, v.open + talk * 0.5);
  }

  setFaceLocals(px, py, eyeY, open = 0) {
    const f = this.face;
    const v = this.faceVal;
    // Eyes scale vertically about their centre (blink / wide open).
    const cy = HY + 0.018;
    const e = f.eyes.local.makeScale(1, eyeY, 1).elements;
    e[13] = cy * (1 - eyeY);
    const pe = f.pupils.local.makeScale(1, eyeY, 1).elements;
    pe[12] = px;
    pe[13] = cy * (1 - eyeY) + py;
    // Brows: raise, worried tilt (inner ends up), asymmetry.
    const by = HY + 0.05 + v.brow * 0.012;
    tmpS.set(1, 1, 1);
    tmpQ.setFromAxisAngle(Z_AXIS, 0.08 + v.tilt * 0.38);
    f.browL.local.compose(tmpP.set(-0.04, by + v.asym * 0.008, -0.089), tmpQ, tmpS);
    tmpQ.setFromAxisAngle(Z_AXIS, -0.08 - v.tilt * 0.38);
    f.browR.local.compose(tmpP.set(0.04, by, -0.089), tmpQ, tmpS);
    // Mouth: width + opening.
    tmpQ.identity();
    f.mouth.local.compose(tmpP.set(0, HY - 0.057, this.mouthZ), tmpQ, tmpS.set(v.width, 1 + open * 2.6, 1));
  }

  // --- output -------------------------------------------------------------------------------
  clear() {
    const sys = this.system;
    for (const s of this.slots) sys.meshes[s.type].setMatrixAt(s.index, ZERO);
    this.written = false;
  }

  write() {
    const sys = this.system;
    this.root.updateMatrixWorld(true);
    const seated = this.seated;
    for (const s of this.slots) {
      const mesh = sys.meshes[s.type];
      if ((s.when === 'seated' && !seated) || (s.when === 'standing' && seated)) {
        mesh.setMatrixAt(s.index, ZERO);
        continue;
      }
      if (s.local) mesh.setMatrixAt(s.index, tmpM.multiplyMatrices(s.bone.matrixWorld, s.local));
      else mesh.setMatrixAt(s.index, s.bone.matrixWorld);
    }
    this.written = true;
  }
}

export class CharacterSystem {
  constructor(capacity = 110) {
    this.group = new THREE.Group();
    this.material = new THREE.MeshLambertMaterial();
    this.meshes = {};
    this.used = {};
    this.characters = [];
    this.agitation = 0;
    this.cockpitPoint = new THREE.Vector3(0, 4.3, -14.3);
    this.frame = 0;
    for (const [type, make] of Object.entries(PART_DEFS)) {
      const count = capacity * (PAIRED[type] || 1);
      const geo = make();
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const mesh = new THREE.InstancedMesh(geo, this.material, count);
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, ZERO);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      this.meshes[type] = mesh;
      this.used[type] = 0;
      this.group.add(mesh);
    }
  }

  allocate(type, color) {
    const i = this.used[type]++;
    const mesh = this.meshes[type];
    if (i >= mesh.instanceMatrix.count) throw new Error(`character capacity exceeded for ${type}`);
    mesh.setColorAt(i, new THREE.Color(color));
    mesh.instanceColor.needsUpdate = true;
    mesh.count = this.used[type];
    return i;
  }

  create(spec, seed) {
    const c = new Character(this, spec, seed ?? this.characters.length * 7919 + 13);
    this.characters.push(c);
    return c;
  }

  /**
   * Is someone standing in `ch`'s lane within arm's reach ahead (direction
   * dx, dz)? Walkers wait instead of walking through each other; people
   * standing beside the lane (in a seat row) never block it.
   */
  isBlocked(ch, dx, dz) {
    const p = ch.root.position;
    for (const o of this.characters) {
      if (o === ch || !o.upright) continue;
      const rx = o.root.position.x - p.x;
      const rz = o.root.position.z - p.z;
      const ahead = rx * dx + rz * dz;
      const lateral = Math.abs(rx * dz - rz * dx);
      if (ahead > 0.05 && ahead < 0.6 && lateral < 0.36) return true;
    }
    return false;
  }

  /** @param camPos camera position in the interior frame (for LOD). */
  update(dt, camPos) {
    this.frame++;
    for (const c of this.characters) {
      if (!c.visible) {
        if (c.written) c.clear();
        continue;
      }
      const d = camPos ? c.root.position.distanceTo(camPos) : 0;
      const lod = d < 5.5 ? 0 : d < 11 ? 1 : 2;
      c.acc += dt;
      if (lod < 2 || c.walking || c.slide || (this.frame + c.id) % 3 === 0 || !c.written) {
        c.update(c.acc, lod);
        c.acc = 0;
        c.write();
      }
    }
    for (const mesh of Object.values(this.meshes)) mesh.instanceMatrix.needsUpdate = true;
  }
}

function darken(hex, k) {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(k).getHex();
}

// --- looks ----------------------------------------------------------------------------------
// Fictional and generic: no airline uniforms, insignia or real likenesses.
export const LOOKS = {
  captain: {
    skin: 0xb98a6a, hairStyle: 'neat', hairColor: 0x2a211c, top: 0xf1f3f5, sleeve: 0xf1f3f5, pants: 0x1f2633,
    tie: 0x1f2633, collar: 0xf6f7f8, epaulette: 0xd8b04a, pcap: 0x1f2633, height: 1.03, face: [1.02, 1.04], react: 0.9,
  },
  firstOfficer: {
    skin: 0xc79a78, hairStyle: 'buzz', hairColor: 0x3b2c22, top: 0xf1f3f5, sleeve: 0xf1f3f5, pants: 0x1f2633,
    tie: 0x1f2633, collar: 0xf6f7f8, epaulette: 0xd8b04a, height: 1.0, face: [0.98, 1.0], react: 0.9,
  },
  crew: {
    skin: 0xd3a684, hairStyle: 'bun', hairColor: 0x4a3426, top: 0x6b2d3b, sleeve: 0x6b2d3b, pants: 0x3d1d26,
    shoes: 0x1b1b1b, scarf: 0xe9dcc6, lips: 0x9a4a50, height: 0.96, bulk: 0.9, face: [0.96, 1.02], eye: 0x2c4a6a, react: 0.8,
  },
  crew2: {
    skin: 0x9a6a4a, hairStyle: 'short', hairColor: 0x1e1916, top: 0x6b2d3b, sleeve: 0xf1f3f5, shirtFront: 0xf1f3f5,
    collar: 0xf6f7f8, tie: 0x3d1d26, pants: 0x2a2a30, shoes: 0x1b1b1b, height: 1.02, face: [1.0, 1.02], react: 0.8,
  },
  // The off-duty pilot the player becomes: smart casual, calm, a crew lanyard and a watch.
  offDutyPilot: {
    skin: 0xa77b5c, hairStyle: 'neat', hairColor: 0x241c17, top: 0x2b3a55, sleeve: 0x2b3a55, collar: 0xc9d9ea,
    pants: 0xa89a7a, shoes: 0x5a3b26, lanyard: 0x1d2b44, badge: 0xf2f2f2, watch: 0xc9cdd2,
    height: 1.04, bulk: 1.02, face: [1.0, 1.05], nose: 1.05, eye: 0x2e2118, react: 0.35,
  },
  // Second off-duty pilot: uniform shirt, glasses.
  offDutyPilot2: {
    skin: 0xe0b896, hairStyle: 'side', hairColor: 0x6a4a30, top: 0xf1f3f5, sleeve: 0xe0b896, collar: 0xf6f7f8,
    pants: 0x262d3a, epaulette: 0xbfc6cf, glasses: 0x30343a, height: 1.0, bulk: 1.05, face: [1.04, 0.98], eye: 0x4a6a8a, react: 0.4,
  },
};

const SKINS = [0xf1c9a5, 0xe6b894, 0xd4a07c, 0xc58f6a, 0xa8754f, 0x8a5a3b, 0x6b4430, 0xf0d0b4];
const HAIRS = [0x1e1916, 0x2a211c, 0x3b2a1f, 0x5a3e2a, 0x6a4a30, 0x9b7a50, 0xc9a26b, 0x2a2a2a];
const GREYS = [0xb7b0a6, 0xcfcac2, 0x9a958e, 0xe2ded8];
const EYES = [0x3b2a1e, 0x2a1d14, 0x4a6a8a, 0x5a6b3a, 0x1e1a18, 0x6a4a2a];
const TEES = [0x3d6fa8, 0xb8443f, 0x3f7a55, 0x5d5f66, 0xd9a441, 0x7a4d8f, 0xe6e6e6, 0x2f3d55, 0xc27b5a, 0x55767a, 0x1f1f22];
const HOODIES = [0x4b5563, 0x2f3d55, 0x7a2e3a, 0x3f6e4f, 0x8a8f96, 0x1f2023, 0xb36b2c];
const JACKETS = [0x2b2f36, 0x4a3b2f, 0x2f4058, 0x5c6b4a, 0x6e4a3a, 0x3a3f46];
const BLAZERS = [0x2b3445, 0x3e434a, 0x23262b, 0x4a4f57];
const SHIRTS = [0xf1f3f5, 0xc9d9ea, 0xe8e0d0, 0xd7e3d4, 0xf3dede];
const BLOUSES = [0xc0392b, 0x2e86ab, 0xe8c4a0, 0x8e5572, 0xf2efe6, 0x4f7c6b, 0xd98e5f];
const CARDIGANS = [0x8b6f5a, 0x6f7f8f, 0xa38b6d, 0x7b5d6e, 0x5f6f5f];
const SCARVES = [0x2c4a6a, 0x7a2e3a, 0xd9c7a5, 0x3f6e4f, 0x1f1f22, 0x8e5572, 0xb36b2c];
const DENIM = [0x2c3a52, 0x34465f, 0x3b4b63, 0x1f2430];
const PANTS = [0x2c3a52, 0x3b3b3b, 0x5a4a3a, 0x1f2430, 0x6b6f75, 0x40506a, 0xa89a7a];
const SNEAKERS = [0xe8e8e8, 0x2a2a2a, 0xd6d0c4, 0x3a4a6a];

/**
 * Reusable passenger appearances (a dozen archetypes), each randomised in
 * hair, clothing, height, face shape, accessories and proportions.
 */
const ARCHETYPES = [
  (p, r) => ({ ...p, hairStyle: p.pick(['short', 'curly', 'buzz']), top: p.c(HOODIES), hood: p.same, sleeve: p.same, pants: p.c(DENIM), shoes: p.c(SNEAKERS), height: 0.98 + r() * 0.08 }),
  (p, r) => ({ ...p, hairStyle: p.pick(['neat', 'side', 'long']), glasses: p.c([0x23262b, 0x5a3e2a, 0x7a7f86]), top: p.c(SHIRTS), collar: p.same, pants: p.c(PANTS) }),
  (p, r) => ({ ...p, hairStyle: 'buzz', beard: p.hairColor, top: p.c(JACKETS), shirtFront: p.c(TEES), pants: p.c(DENIM), bulk: 1.02 + r() * 0.1 }),
  (p, r) => ({ ...p, hairStyle: 'long', top: p.c(BLOUSES), sleeve: r() < 0.5 ? p.skin : p.same, pants: p.c(PANTS), height: 0.93 + r() * 0.06, bulk: 0.86 + r() * 0.08, lips: 0x9a4a50 }),
  (p, r) => ({ ...p, hairStyle: 'side', hairColor: p.c(GREYS), glasses: r() < 0.6 ? 0x5a5f66 : null, top: p.c(CARDIGANS), shirtFront: p.c(SHIRTS), collar: p.same, pants: p.c(PANTS), bulk: 1.04 + r() * 0.1, react: 0.6 }),
  (p, r) => ({ ...p, hairStyle: p.pick(['pony', 'short', 'long']), top: p.c(JACKETS), shirtFront: p.c(TEES), pants: p.c(DENIM), shoes: p.c(SNEAKERS) }),
  (p, r) => {
    const suit = p.pick(BLAZERS);
    return { ...p, hairStyle: p.pick(['neat', 'short']), top: suit, shirtFront: p.c(SHIRTS), collar: p.same, pants: suit, shoes: 0x3a2618, height: 1.0 + r() * 0.06 };
  },
  (p, r) => ({ ...p, hairStyle: 'bun', hairColor: p.c(GREYS), scarf: p.c(SCARVES), top: p.c(CARDIGANS), glasses: r() < 0.4 ? 0x5a3e2a : null, pants: p.c(PANTS), height: 0.9 + r() * 0.05, bulk: 0.95 + r() * 0.1, lips: 0x9a5a58 }),
  (p, r) => ({ ...p, hairStyle: p.pick(['curly', 'short']), backpack: p.c([0x2a2a2a, 0x3d6fa8, 0x8a3a2a, 0x4a5a3a]), bcap: r() < 0.45 ? p.c(TEES) : null, top: p.c(TEES), pants: p.c(DENIM), shoes: p.c(SNEAKERS) }),
  (p, r) => ({ ...p, hairStyle: 'scarf', hairColor: p.c(SCARVES), top: p.c(BLOUSES), pants: p.c(PANTS), height: 0.92 + r() * 0.06, bulk: 0.9 + r() * 0.08, lips: 0x9a4a50 }),
  (p, r) => ({ ...p, hairStyle: 'curly', top: p.c(TEES), pants: p.c(PANTS), beard: r() < 0.3 ? p.hairColor : null }),
  (p, r) => ({ ...p, hairStyle: p.pick(['pony', 'bun']), top: p.c(HOODIES), sleeve: p.same, pants: p.c(DENIM), shoes: p.c(SNEAKERS), height: 0.93 + r() * 0.06, bulk: 0.88 + r() * 0.08 }),
];
export const ARCHETYPE_COUNT = ARCHETYPES.length;

export function makePassenger(rand, archetype = Math.floor(rand() * ARCHETYPES.length)) {
  let last = null;
  // c() picks a colour and remembers it; `same` repeats it (hood = hoodie colour ...).
  const p = {
    pick: (a) => a[Math.floor(rand() * a.length)],
    c: (a) => (last = a[Math.floor(rand() * a.length)]),
    get same() {
      return last;
    },
  };
  p.skin = p.pick(SKINS);
  p.hairColor = p.pick(HAIRS);
  p.eye = p.pick(EYES);
  p.height = 0.95 + rand() * 0.1;
  p.bulk = 0.92 + rand() * 0.16;
  p.face = [0.94 + rand() * 0.12, 0.95 + rand() * 0.1];
  p.nose = 0.85 + rand() * 0.35;
  p.shoes = 0x2a2522;
  const spec = ARCHETYPES[archetype % ARCHETYPES.length](p, rand);
  delete spec.pick;
  delete spec.c;
  delete spec.same;
  return spec;
}
