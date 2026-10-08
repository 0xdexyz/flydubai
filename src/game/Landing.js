// Touchdown evaluation: decides crash vs. landing and grades the landing on
// descent rate, touchdown point, alignment and speed (max 300 points).

import { RAD, angleDiffDeg, clamp } from '../core/MathUtil.js';
import { RUNWAY, alongTrack, toDisplayHeading } from '../world/Route.js';

export function evaluateTouchdown(c) {
  const sink = -c.vsFpm; // positive = descending
  const bankDeg = Math.abs(c.bank * RAD);
  const pitchDeg = c.pitch * RAD;
  const distPast = -alongTrack(c.z); // metres beyond the threshold
  const hdgErr = Math.abs(angleDiffDeg(toDisplayHeading(c.psi), RUNWAY.heading));
  const lateral = Math.abs(c.x);
  const base = { sink, bankDeg, pitchDeg, distPast, hdgErr, lateral, speedKt: c.speedKt };

  if (c.surface !== 'runway') {
    const nearAirport = Math.abs(c.x) < 2000 && c.z > -4000 && c.z < 6000;
    const reason = nearAirport ? 'The aircraft touched down outside the runway.' : 'The aircraft struck the terrain.';
    return { ...base, crash: true, reason };
  }
  if (!c.gearDown) return { ...base, crash: true, reason: 'The landing gear was not down — the aircraft belly-landed.' };
  if (sink > 1200) return { ...base, crash: true, reason: 'Touchdown was far too hard — the landing gear collapsed.' };
  if (bankDeg > 9) return { ...base, crash: true, reason: 'A wingtip struck the runway on touchdown.' };
  if (pitchDeg < -2.5) return { ...base, crash: true, reason: 'The nose gear hit first and collapsed.' };

  const vsPts = sink < 120 ? 120 : sink < 240 ? 100 : sink < 360 ? 78 : sink < 600 ? 45 : sink < 900 ? 15 : 5;
  let posPts;
  if (distPast < 0) posPts = 10;
  else if (distPast >= 150 && distPast <= 650) posPts = 60;
  else if (distPast < 150 || distPast <= 900) posPts = 40;
  else posPts = 15;
  const alignPts = Math.round(60 * clamp(1 - (lateral - 4) / 16, 0, 1) * clamp(1 - (hdgErr - 3) / 9, 0, 1));
  const spd = c.speedKt;
  const spdPts = spd >= 118 && spd <= 150 ? 60 : Math.round(clamp(60 - (spd < 118 ? 118 - spd : spd - 150) * 1.7, 10, 60));

  let damage = 0;
  if (sink > 600) damage += ((sink - 600) / 600) * 60;
  if (pitchDeg > 11) damage += 25; // tail strike
  if (hdgErr > 10) damage += 10;
  damage = Math.round(clamp(damage, 0, 90));

  const raw = vsPts + posPts + alignPts + spdPts;
  const points = Math.round(raw * (1 - damage / 100));
  let grade = 'SAFE LANDING';
  if (sink > 600) grade = 'HARD LANDING';
  else if (sink < 140 && raw >= 250) grade = 'BUTTER LANDING';
  else if (raw >= 200) grade = 'SMOOTH LANDING';

  return {
    ...base,
    crash: false,
    points,
    grade,
    damage,
    tailStrike: pitchDeg > 11,
    detail: { vsPts, posPts, alignPts, spdPts },
  };
}
