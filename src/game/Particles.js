// Pooled smoke particles (tyre smoke on touchdown, smoke at a crash site).
// A fixed-size pool lives in one THREE.Points object: emitting reuses dead
// slots, so there are no allocations and a single draw call.

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 0.0, 512.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(uColor, vAlpha * (1.0 - d));
  }
`;

export class SmokePool {
  constructor(scene, size = 64) {
    this.size = size;
    this.pos = new Float32Array(size * 3);
    this.vel = new Float32Array(size * 3);
    this.sizes = new Float32Array(size);
    this.alpha = new Float32Array(size);
    this.life = new Float32Array(size);
    this.maxLife = new Float32Array(size);
    this.grow = new Float32Array(size);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 }, uColor: { value: new THREE.Color(0xd9dde2) } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.active = 0;
    scene.add(this.points);
  }

  setScale(ppu) {
    this.material.uniforms.uScale.value = ppu;
  }

  emit(x, y, z, count, { spread = 2, up = 1.5, speed = 3, size = 4, life = 2.5, grow = 3, color } = {}) {
    if (color) this.material.uniforms.uColor.value.set(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.size;
      this.pos[i * 3] = x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = y + Math.random() * spread * 0.3;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = (Math.random() - 0.5) * speed;
      this.vel[i * 3 + 1] = up * (0.5 + Math.random());
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * speed;
      this.sizes[i] = size * (0.7 + Math.random() * 0.6);
      this.maxLife[i] = this.life[i] = life * (0.7 + Math.random() * 0.6);
      this.grow[i] = grow;
    }
    this.active = this.size;
  }

  update(dt) {
    if (!this.active) return;
    let alive = 0;
    for (let i = 0; i < this.size; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      alive++;
      this.life[i] -= dt;
      const k = i * 3;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.vel[k] *= 0.98;
      this.vel[k + 2] *= 0.98;
      this.sizes[i] += this.grow[i] * dt;
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]) * 0.55;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    if (!alive) this.active = 0;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
    this.active = 0;
  }
}
