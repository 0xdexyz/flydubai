// Point-sprite lights (runway edge, approach, PAPI, aircraft strobes).
// A tiny custom shader keeps a minimum on-screen size so lights stay visible
// from many kilometres away, and uses additive blending for a soft glow.

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  uniform float uMinPx;
  uniform float uMaxPx;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(1.0, -mv.z);
    gl_PointSize = clamp(aSize * uScale / d, uMinPx, uMaxPx);
    vFade = clamp(1.4 - d / 22000.0, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uIntensity;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c) * 4.0;
    float a = exp(-r * 3.2);
    if (a < 0.03) discard;
    gl_FragColor = vec4(vColor * (0.6 + a), a * vFade * uIntensity);
  }
`;

export class LightPoints {
  /** @param lights Array<{ x, y, z, color, size }> */
  constructor(lights, { minPx = 1.6, maxPx = 28, intensity = 1 } = {}) {
    const n = lights.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const c = new THREE.Color();
    lights.forEach((l, i) => {
      pos.set([l.x, l.y, l.z], i * 3);
      c.set(l.color);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = l.size ?? 2.5;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.computeBoundingSphere();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: 800 },
        uMinPx: { value: minPx },
        uMaxPx: { value: maxPx },
        uIntensity: { value: intensity },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setScale(pixelsPerUnit) {
    this.material.uniforms.uScale.value = pixelsPerUnit;
  }

  setColor(i, hex) {
    const attr = this.points.geometry.attributes.aColor;
    const c = tmp.set(hex);
    attr.setXYZ(i, c.r, c.g, c.b);
    attr.needsUpdate = true;
  }
}

const tmp = new THREE.Color();
