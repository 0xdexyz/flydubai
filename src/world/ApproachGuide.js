// Visual approach path: a guide line from the approach fix down to the final
// gate, then rectangular "gates" along the 3-degree glide path that shrink
// toward the runway. Gates fade out once flown through.

import * as THREE from 'three';
import { DEG } from '../core/MathUtil.js';
import { APPROACH_FIX, GATE, GATE_DIST, RUNWAY, approachProfileY, glideY } from './Route.js';

const GATE_DISTANCES = [2500, 2050, 1650, 1250, 900, 560, 280];

export class ApproachGuide {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.gates = [];

    const mat = new THREE.LineBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0.85, fog: false, depthWrite: false });
    for (const s of GATE_DISTANCES) {
      const z = RUNWAY.thresholdZ + s;
      const y = glideY(s);
      const d = s + 300;
      const hh = Math.max(9, d * Math.tan(0.4 * DEG));
      const hw = Math.max(26, (d + 2800) * Math.tan(0.55 * DEG));
      const pts = [
        new THREE.Vector3(-hw, y - hh, z), new THREE.Vector3(hw, y - hh, z),
        new THREE.Vector3(hw, y + hh, z), new THREE.Vector3(-hw, y + hh, z),
        new THREE.Vector3(-hw, y - hh, z),
      ];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat.clone());
      line.frustumCulled = false;
      line.userData.s = s;
      this.gates.push(line);
      this.group.add(line);
    }

    // Dashed path approach fix -> gate -> threshold.
    const bravo = APPROACH_FIX;
    const gate = GATE;
    const path = [];
    const legLen = Math.hypot(bravo.x - gate.x, bravo.z - gate.z);
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = bravo.x + (gate.x - bravo.x) * t;
      const z = bravo.z + (gate.z - bravo.z) * t;
      path.push(new THREE.Vector3(x, approachProfileY(legLen * (1 - t)), z));
    }
    for (let s = GATE_DIST; s >= 0; s -= 150) path.push(new THREE.Vector3(0, glideY(s), RUNWAY.thresholdZ + s));
    const segs = [];
    for (let i = 0; i < path.length - 1; i += 2) segs.push(path[i], path[i + 1]);
    this.pathLine = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(segs),
      new THREE.LineBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0.45, fog: false, depthWrite: false })
    );
    this.pathLine.frustumCulled = false;
    this.group.add(this.pathLine);
  }

  reset() {
    this.group.visible = false;
    for (const g of this.gates) {
      g.visible = true;
      g.material.opacity = 0.85;
    }
  }

  update(dt, enabled, alongTrack) {
    this.group.visible = enabled;
    if (!enabled) return;
    for (const g of this.gates) {
      if (!g.visible) continue;
      if (alongTrack < g.userData.s - 20) {
        g.material.opacity -= dt * 2.5;
        if (g.material.opacity <= 0) g.visible = false;
      }
    }
  }
}
