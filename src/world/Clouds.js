// Low-poly cumulus clouds: a couple of merged icosahedron clusters drawn
// with InstancedMesh (one draw call per variant). Instance centres/radii are
// kept so the game can cheaply test "is the camera inside a cloud?".

import * as THREE from 'three';
import { mulberry32 } from '../core/MathUtil.js';
import { merge, paint } from './Geometry.js';
import { yFromMsl } from './Route.js';

function clusterGeometry(rand) {
  const parts = [];
  const puffs = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < puffs; i++) {
    const r = 0.55 + rand() * 0.55;
    const g = new THREE.IcosahedronGeometry(r, 1);
    const x = (rand() - 0.5) * 2.6;
    const z = (rand() - 0.5) * 1.4;
    const y = r * 0.35 + rand() * 0.25 * (1 - Math.abs(x) / 1.3);
    g.scale(1, 0.72, 1);
    g.translate(x, y, z);
    // Flatten cloud bottoms.
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) if (p.getY(v) < 0) p.setY(v, p.getY(v) * 0.25);
    parts.push(paint(g, 0xffffff));
  }
  return merge(parts);
}

export class Clouds {
  constructor({ density = 1 } = {}) {
    const rand = mulberry32(4242);
    this.group = new THREE.Group();
    this.instances = []; // { x, y, z, rx, ry, rz }
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      flatShading: true,
      emissive: 0xb4c2d2,
      emissiveIntensity: 0.78,
    });

    const variants = [clusterGeometry(rand), clusterGeometry(rand)];
    const placements = [[], []];

    const add = (x, y, z, s) => {
      const v = rand() < 0.5 ? 0 : 1;
      placements[v].push({ x, y, z, s, rot: rand() * Math.PI * 2 });
      this.instances.push({ x, y: y + s * 0.3, z, rx: s * 1.45, ry: s * 0.55, rz: s * 1.1 });
    };

    // Mid-level layer (~21-26,000 ft): the cruise floats above it and the
    // emergency descent plunges through it.
    let tries = 0;
    while (placements[0].length + placements[1].length < 100 && tries++ < 2000) {
      const x = -50000 + rand() * 85000;
      const z = -5000 + rand() * 65000;
      add(x, yFromMsl(21000 + rand() * 5000), z, 280 + rand() * 360);
    }
    // Sparse fair-weather cumulus lower down, clear of the final approach.
    tries = 0;
    while (placements[0].length + placements[1].length < 140 && tries++ < 2000) {
      const x = -40000 + rand() * 70000;
      const z = -20000 + rand() * 70000;
      if (Math.abs(x) < 3500 && z < 14000 && z > -4000) continue;
      add(x, yFromMsl(8300 + rand() * 2400), z, 200 + rand() * 260);
    }

    this.meshes = variants.map((geo, vi) => {
      const list = placements[vi];
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const p = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      list.forEach((it, i) => {
        q.setFromAxisAngle(up, it.rot);
        sc.set(it.s, it.s * (0.8 + (i % 3) * 0.12), it.s);
        p.set(it.x, it.y, it.z);
        m.compose(p, q, sc);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.userData.total = list.length;
      this.group.add(mesh);
      return mesh;
    });
    this.setDensity(density);
  }

  setDensity(d) {
    for (const mesh of this.meshes) mesh.count = Math.max(1, Math.round(mesh.userData.total * d));
  }

  /** 0..1 — how deep inside a cloud the point is. */
  insideFactor(px, py, pz) {
    let best = 0;
    for (let i = 0; i < this.instances.length; i++) {
      const c = this.instances[i];
      const dx = (px - c.x) / c.rx;
      if (dx > 1 || dx < -1) continue;
      const dz = (pz - c.z) / c.rz;
      if (dz > 1 || dz < -1) continue;
      const dy = (py - c.y) / c.ry;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < 1) best = Math.max(best, 1 - d);
    }
    return best;
  }
}
