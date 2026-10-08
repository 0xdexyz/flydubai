// Fixed geography of the scenario: Tabuk runway 24, the diversion and
// approach geometry, glide path, and where the cinematic hands control over.
//
// World axes: +Y up, -Z is the landing direction of runway 24. Displayed
// headings are rotated by HEADING_OFFSET so world -Z reads 240 on the compass
// (this keeps every runway calculation axis-aligned).
//
// Real-world reference (public airport data): Tabuk / Prince Sultan bin
// Abdulaziz Airport, runway 06/24, 3,350 m, field elevation 2,551 ft.

import { DEG, RAD, wrap360 } from '../core/MathUtil.js';
import { displayFeet, worldY } from '../physics/AltitudeScale.js';

export const HEADING_OFFSET = 240;
export const AIRPORT_ELEV = 4; // world metres
export const PAVE = 0.3;
export const FIELD_ELEV_FT = 2551;

export const AIRPORT_NAME = 'TABUK';

export const RUNWAY = Object.freeze({
  name: '24',
  oppositeName: '06',
  heading: 240,
  halfWidth: 30,
  halfLength: 1675,
  thresholdZ: 1675, // landing threshold (approach end)
  endZ: -1675,
  surfaceY: AIRPORT_ELEV + PAVE,
});

export const GLIDE_DEG = 3;
export const AIM_POINT = 300; // metres beyond the threshold
const TAN_GS = Math.tan(GLIDE_DEG * DEG);

export const GATE_DIST = 2500; // final approach gate, metres before threshold
export const APPROACH_ZONE_DIST = 5600; // "TABUK APPROACH" begins here
export const APPROACH_SLOPE = Math.tan(7 * DEG); // approach-phase descent profile
export const DIVERSION_SLOPE = Math.tan(5.5 * DEG); // diversion descent profile, continuous from the hand-over

/** Start of the approach zone on the extended centreline. */
export const APPROACH_FIX = Object.freeze({ id: 'TABUK APPROACH', x: 0, z: RUNWAY.thresholdZ + APPROACH_ZONE_DIST });
export const GATE = Object.freeze({ id: 'FINAL GATE', x: 0, z: RUNWAY.thresholdZ + GATE_DIST });

/**
 * Where the player takes control (end of the cinematic): ~15 km NE of Tabuk,
 * heading NW. Close enough that a careful flight to touchdown takes 2-3 minutes.
 */
export const GAMEPLAY_START = Object.freeze({ x: -4600, z: 14400, heading: 300 });

/** Cruise state at the start of the cinematic (position is calibrated at boot). */
export const CRUISE = Object.freeze({ altFt: 34000, speedKt: 280, heading: 300 });

// Stabilisation targets after the recovery.
export const STABLE_TARGETS = Object.freeze({ alt: 15000, spd: 250, hdg: 300 }); // alt caps the descent profile

export const toDisplayHeading = (psi) => wrap360(psi * RAD + HEADING_OFFSET);
export const toWorldHeading = (deg) => (deg - HEADING_OFFSET) * DEG;

/** Displayed (MSL) altitude in feet for a world height. */
export const mslFeet = (y) => FIELD_ELEV_FT + displayFeet(y - AIRPORT_ELEV);
/** World height for a displayed (MSL) altitude. */
export const yFromMsl = (ft) => worldY(ft - FIELD_ELEV_FT) + AIRPORT_ELEV;

/** Displayed bearing from one point to another. */
export function bearing(fromX, fromZ, toX, toZ) {
  return wrap360(Math.atan2(toX - fromX, -(toZ - fromZ)) * RAD + HEADING_OFFSET);
}

/** Distance along the extended centreline, positive before the threshold. */
export const alongTrack = (z) => z - RUNWAY.thresholdZ;

/** World height of the 3-degree glide path at along-track distance s. */
export const glideY = (s) => RUNWAY.surfaceY + (s + AIM_POINT) * TAN_GS;

/** Height of the approach-phase profile at distance dGate from the final gate. */
export const approachProfileY = (dGate) => glideY(GATE_DIST) + Math.max(0, dGate) * APPROACH_SLOPE;

/** Height of the diversion profile at distance d from the approach fix. */
export const diversionProfileY = (d) =>
  approachProfileY(APPROACH_ZONE_DIST - GATE_DIST) + Math.max(0, d) * DIVERSION_SLOPE;

/** Glide slope deviation in degrees (+ = above path). */
export function gsDeviationDeg(y, z) {
  const d = Math.max(30, alongTrack(z) + AIM_POINT);
  return Math.atan2(y - RUNWAY.surfaceY, d) * RAD - GLIDE_DEG;
}

/** Localizer deviation in degrees (+ = right of centreline). */
export function locDeviationDeg(x, z) {
  const d = Math.max(50, alongTrack(z) + RUNWAY.halfLength * 2 + 300);
  return Math.atan2(x, d) * RAD;
}

export function onRunway(x, z, margin = 0) {
  return Math.abs(x) <= RUNWAY.halfWidth + margin && z <= RUNWAY.thresholdZ + 60 + margin && z >= RUNWAY.endZ - 60 - margin;
}

/** World unit direction for a displayed compass bearing. */
export function compassDir(deg) {
  const a = (deg - HEADING_OFFSET) * DEG;
  return { x: Math.sin(a), z: -Math.cos(a) };
}
