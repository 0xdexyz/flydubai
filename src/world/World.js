// Assembles the environment and keeps camera-relative pieces (sky, fog
// range, light sprite scale) up to date. Only what the scenario needs
// exists: the Tabuk desert plateau, one airport, one cloud field.

import * as THREE from 'three';
import { clamp } from '../core/MathUtil.js';
import { Sky, SKY } from './Sky.js';
import { Terrain } from './Terrain.js';
import { Clouds } from './Clouds.js';
import { Airport } from './Airport.js';
import { ApproachGuide } from './ApproachGuide.js';

const QUALITY = {
  low: { segments: 110, clouds: 0.6, trees: 0.45 },
  medium: { segments: 150, clouds: 1, trees: 1 },
  high: { segments: 150, clouds: 1, trees: 1 },
};

export class World {
  constructor(renderer, quality = 'medium') {
    this.renderer = renderer;
    const q = QUALITY[quality] || QUALITY.medium;
    const scene = renderer.scene;

    this.sunDir = new THREE.Vector3(0.45, 0.62, 0.64).normalize();
    scene.background = SKY.horizon.clone();
    scene.fog = new THREE.Fog(SKY.horizon.clone(), 4000, 40000);

    this.hemi = new THREE.HemisphereLight(0xdbe8f8, 0x8a7356, 1.35);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
    this.sun.position.copy(this.sunDir).multiplyScalar(1000);
    scene.add(this.sun);

    this.sky = new Sky(this.sunDir);
    scene.add(this.sky.group);

    this.terrain = new Terrain({ segments: q.segments });
    scene.add(this.terrain.mesh, this.terrain.backdrop);

    this.clouds = new Clouds({ density: q.clouds });
    scene.add(this.clouds.group);

    this.airport = new Airport({ treeDensity: q.trees, terrain: this.terrain });
    scene.add(this.airport.group);

    this.guide = new ApproachGuide();
    scene.add(this.guide.group);

    this.onResize = () => this.airport.setLightScale(renderer.pixelsPerUnit);
    renderer.resizeListeners.add(this.onResize);
    this.onResize();
  }

  setQuality(quality) {
    const q = QUALITY[quality] || QUALITY.medium;
    this.clouds.setDensity(q.clouds);
    this.airport.setTreeDensity(q.trees);
  }

  /** Camera-relative updates, once per frame. */
  update(camera) {
    this.sky.update(camera);
    const y = Math.max(0, camera.position.y);
    // Fog opens up with altitude: crisp near the runway, long views at cruise.
    this.renderer.scene.fog.near = 3500 + y * 2;
    this.renderer.scene.fog.far = clamp(38000 + y * 11, 38000, 72000);
  }
}
