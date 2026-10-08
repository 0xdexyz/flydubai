// WebGL renderer wrapper. Two scenes are drawn per frame:
//  1. the world (terrain, airport, aircraft) with a large depth range
//  2. the cockpit overlay with its own tiny near/far range, drawn after a
//     depth clear. This avoids z-fighting between centimetre-scale cockpit
//     geometry and a 150 km world without a logarithmic depth buffer.

import * as THREE from 'three';

const QUALITY_PIXEL_RATIO = {
  low: () => 0.75,
  medium: () => Math.min(window.devicePixelRatio || 1, 1),
  high: () => Math.min(window.devicePixelRatio || 1, 1.75),
};

export class Renderer {
  constructor(container, settings) {
    this.settings = settings;
    const renderer = new THREE.WebGLRenderer({
      antialias: !!settings.get('antialias'),
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.autoClear = false;
    renderer.info.autoReset = false; // two passes per frame; reset manually
    renderer.domElement.id = 'game-canvas';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 1, 160000);

    this.overlayScene = new THREE.Scene();
    this.overlayCamera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.02, 8);
    this.overlayVisible = false;

    this.basePixelRatio = 1;
    this.dynamicScale = 1;
    this.width = 1;
    this.height = 1;
    this.resizeListeners = new Set();

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.setQuality(settings.get('quality'));
    this.resize();
  }

  setQuality(q) {
    this.basePixelRatio = (QUALITY_PIXEL_RATIO[q] || QUALITY_PIXEL_RATIO.medium)();
    this.applyPixelRatio();
  }

  /** Adaptive resolution multiplier (0.5 - 1) driven by the perf monitor. */
  setDynamicScale(s) {
    if (Math.abs(s - this.dynamicScale) < 0.01) return;
    this.dynamicScale = s;
    this.applyPixelRatio();
  }

  applyPixelRatio() {
    this.renderer.setPixelRatio(this.basePixelRatio * this.dynamicScale);
    this.renderer.setSize(this.width, this.height);
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.overlayCamera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.overlayCamera.updateProjectionMatrix();
    for (const fn of this.resizeListeners) fn(this.width, this.height);
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height);
    const aspect = this.width / this.height;
    this.camera.aspect = aspect;
    this.overlayCamera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.overlayCamera.updateProjectionMatrix();
    for (const fn of this.resizeListeners) fn(this.width, this.height);
  }

  /** Pixels covered by 1 world unit at distance 1 — used by point-light sprites. */
  get pixelsPerUnit() {
    const h = this.height * this.renderer.getPixelRatio();
    return h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  render() {
    const r = this.renderer;
    r.info.reset();
    r.clear();
    r.render(this.scene, this.camera);
    if (this.overlayVisible) {
      r.clearDepth();
      r.render(this.overlayScene, this.overlayCamera);
    }
  }
}
