// Gradient sky dome + sun sprite. The dome follows the camera, is drawn
// first without depth writes, and ignores fog — one cheap draw call.

import * as THREE from 'three';
import { radialTexture } from './Geometry.js';

// Clear desert sky with a warm, dusty horizon haze.
export const SKY = {
  zenith: new THREE.Color(0x2e6fc4),
  mid: new THREE.Color(0x86b5df),
  horizon: new THREE.Color(0xe1ddd0),
  below: new THREE.Color(0xd3c8b4),
};

export class Sky {
  constructor(sunDir) {
    this.group = new THREE.Group();
    const radius = 120000;
    const geo = new THREE.SphereGeometry(radius, 32, 16);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / radius;
      if (t < 0) c.copy(SKY.horizon).lerp(SKY.below, Math.min(1, -t * 4));
      else if (t < 0.18) c.copy(SKY.horizon).lerp(SKY.mid, t / 0.18);
      else c.copy(SKY.mid).lerp(SKY.zenith, Math.min(1, (t - 0.18) / 0.6));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const dome = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture(128, 'rgba(255,250,235,1)', 'rgba(255,240,210,0)'),
        fog: false,
        depthWrite: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
      })
    );
    sun.scale.setScalar(16000);
    sun.position.copy(sunDir).multiplyScalar(radius * 0.8);
    sun.renderOrder = -9;
    sun.frustumCulled = false;
    this.group.add(sun);
  }

  update(camera) {
    this.group.position.copy(camera.position);
  }
}
