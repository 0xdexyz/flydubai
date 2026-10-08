// Geometry helpers. Static scenery is built from simple primitives that are
// painted with vertex colours and merged, so a whole airport becomes one or
// two draw calls with a single shared material.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const tmpColor = new THREE.Color();

/** Convert to non-indexed, drop UVs and paint a flat vertex colour. */
export function paint(geo, color) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  tmpColor.set(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = tmpColor.r;
    arr[i * 3 + 1] = tmpColor.g;
    arr[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export function merge(list) {
  const g = mergeGeometries(list, false);
  for (const item of list) item.dispose();
  g.computeBoundingSphere();
  return g;
}

/** Box centred on (x, y, z). */
export function box(w, h, d, color, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, color);
}

/** Box standing on the ground: y is its base. */
export function block(w, h, d, color, x, y, z, ry = 0) {
  return box(w, h, d, color, x, y + h / 2, z, ry);
}

export function cylinder(rTop, rBottom, h, seg, color, x = 0, y = 0, z = 0, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
  g.translate(x, y + h / 2, z);
  return paint(g, color);
}

export function cone(r, h, seg, color, x = 0, y = 0, z = 0) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(x, y + h / 2, z);
  return paint(g, color);
}

/** Horizontal quad facing up, spanning [x0,x1] x [z0,z1] at height y. */
export function quad(x0, z0, x1, z1, y, color) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array([
    x0, y, z0, x0, y, z1, x1, y, z1,
    x0, y, z0, x1, y, z1, x1, y, z0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const nrm = new Float32Array(18);
  for (let i = 0; i < 6; i++) nrm[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return paint(g, color);
}

/** Quad centred at (cx, cz) with size (w, l), rotated by ry around Y. */
export function quadRot(cx, cz, w, l, ry, y, color) {
  const g = quad(-w / 2, -l / 2, w / 2, l / 2, 0, color);
  g.rotateY(ry);
  g.translate(cx, y, cz);
  return g;
}

/** Shared flat-shaded vertex-colour material. */
export function worldMaterial(extra = {}) {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...extra });
}

/** Radial-gradient sprite texture generated on a canvas (no image files). */
export function radialTexture(size = 64, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
