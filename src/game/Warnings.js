// Flight warnings: evaluated every frame from telemetry. Each warning has an
// id, display text and level (caution = yellow, critical = red). The class
// also tracks how long the aircraft has been outside the safe envelope,
// which the game uses for "lost control" / "stalled" failures.

import { SPEC } from '../physics/FlightModel.js';
import { APPROACH_ZONE_DIST } from '../world/Route.js';

const PRIORITY = { critical: 0, caution: 1 };

export class Warnings {
  constructor() {
    this.reset();
  }

  reset() {
    this.active = [];
    this.ids = new Set();
    this.prevIds = new Set();
    this.started = []; // ids that became active this frame
    this.envelopeTime = 0;
    this.stallTime = 0;
  }

  evaluate(dt, t, phase, fm) {
    const out = [];
    const push = (id, text, level) => out.push({ id, text, level });
    const airborne = !fm.onGround;

    if (airborne) {
      // --- speed
      if (fm.stalled) push('stall', 'STALL', 'critical');
      else if (fm.V < fm.stallSpeed * 1.12) push('lowspeed', 'LOW SPEED', fm.V < fm.stallSpeed * 1.04 ? 'critical' : 'caution');
      if (t.speedKt > 350) push('overspeed', 'OVERSPEED', 'critical');
      else if (t.speedKt > 335) push('overspeed', 'OVERSPEED', 'caution');
      if (fm.flapsCmd > 0 && t.speedKt > SPEC.flapLimitKt[fm.flapsCmd] + 6) push('flapspeed', 'FLAP OVERSPEED', 'caution');
      if (fm.gearPos > 0.05 && t.speedKt > SPEC.gearLimitKt + 6) push('gearspeed', 'GEAR OVERSPEED', 'caution');

      // --- descent rate: emergency-descent limits high up, ground-proximity
      // limits (based on true vertical speed vs. height) down low.
      const aglM = t.aglM;
      const vy = fm.vy;
      const high = t.altFt > 10000;
      const critLim = Math.min(high ? 99 : 32, 6 + aglM * 0.06);
      const cautLim = Math.min(high ? 99 : 20, 4 + aglM * 0.04);
      if ((high && t.vsFpm < -17000) || vy < -critLim) push('sink', 'PULL UP', 'critical');
      else if ((high && t.vsFpm < -12500) || vy < -cautLim) push('sink', 'SINK RATE', 'caution');

      // --- attitude
      const bank = Math.abs(t.bankDeg);
      if (bank > 50) push('bank', 'BANK ANGLE', 'critical');
      else if (bank > 36) push('bank', 'BANK ANGLE', 'caution');

      // --- terrain / configuration
      const inCorridor = t.alongTrack < APPROACH_ZONE_DIST + 1500 && t.alongTrack > -2000 && Math.abs(t.x) < 1800;
      if (t.aglFt < 1000 && !inCorridor) push('terrain', 'TOO LOW · TERRAIN', 'critical');
      if (phase >= 3 && t.aglFt < 500 && !fm.gearDown) push('gear', 'TOO LOW · GEAR', 'critical');
      if (phase === 4 && t.aglFt < 400 && fm.flapsCmd < 2) push('flaps', 'TOO LOW · FLAPS', 'caution');

      // --- approach quality
      if (phase === 4 && t.aglFt < 1500) {
        const off = Math.abs(t.locDev) > 1.0 || Math.abs(t.hdgErr) > 12;
        if (t.aglFt < 300 && Math.abs(t.x) > 120) push('align', 'ALIGNMENT', 'critical');
        else if (off) push('align', 'ALIGNMENT', 'caution');
        if (t.aglFt > 80 && Math.abs(t.gsDev) > 0.8) push('gs', 'GLIDE SLOPE', 'caution');
        if (t.aglFt < 1000 && t.aglFt > 50 &&
          (t.speedKt > 168 || t.speedKt < 118 || t.vsFpm < -1700 || !fm.gearDown || fm.flapsCmd < 2)) {
          push('unstable', 'UNSTABLE APPROACH', 'caution');
        }
      }
    }

    // --- mission level (no fuel or time pressure: only a reminder to head back)
    if (t.distFromAirport > 55000) push('area', 'RETURN TO ROUTE', 'caution');

    out.sort((a, b) => PRIORITY[a.level] - PRIORITY[b.level]);

    // Edge detection for audio / multiplier.
    this.prevIds = this.ids;
    this.ids = new Set(out.map((w) => w.id + ':' + w.level));
    this.started.length = 0;
    for (const w of out) if (!this.prevIds.has(w.id + ':' + w.level)) this.started.push(w);
    this.active = out;

    // Envelope tracking.
    const envelopeCritical = out.some((w) =>
      w.level === 'critical' && (w.id === 'stall' || w.id === 'overspeed' || w.id === 'bank' || w.id === 'lowspeed'));
    this.envelopeTime = envelopeCritical ? this.envelopeTime + dt : Math.max(0, this.envelopeTime - dt * 0.5);
    this.stallTime = airborne && fm.stalled ? this.stallTime + dt : 0;
    return out;
  }

  get hasCritical() {
    return this.active.some((w) => w.level === 'critical');
  }

  get criticalStarted() {
    return this.started.some((w) => w.level === 'critical');
  }
}
