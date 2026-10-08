// Gameplay mission after the cinematic hand-over:
//
//  RECOVERY   regain control (aircraft unstable, speed high), then STABLE FLIGHT
//             through moderate turbulence (stability meter)
//  DIVERSION  turn toward Tabuk and descend toward the approach zone
//  APPROACH   slow down, gear + flaps, line up with runway 24
//  LANDING    glide path, flare, touchdown, brake to a stop
//
// There is no time limit anywhere. Phases advance only when the aircraft
// meets the required conditions, scores grade how well the player flew (never
// how fast), and a missed landing becomes a go-around, not a failure. The
// flight only fails if the aircraft becomes genuinely unrecoverable.

import { DEG, angleDiffDeg, clamp, damp, formatInt, lerp, smoothstep } from '../core/MathUtil.js';
import { SPEC } from '../physics/FlightModel.js';
import {
  APPROACH_FIX, APPROACH_ZONE_DIST, GATE, GATE_DIST, RUNWAY, STABLE_TARGETS,
  approachProfileY, bearing, diversionProfileY, glideY, mslFeet, yFromMsl,
} from '../world/Route.js';
import { evaluateTouchdown } from './Landing.js';

export const PHASE = Object.freeze({
  RECOVERY: 'RECOVERY',
  DIVERSION: 'DIVERSION',
  APPROACH: 'APPROACH',
  LANDING: 'LANDING',
});
export const PHASE_INDEX = { RECOVERY: 1, DIVERSION: 2, APPROACH: 3, LANDING: 4 };

const round5 = (v) => Math.round(v / 5) * 5;
const round100 = (v) => Math.round(v / 100) * 100;
const CALLOUTS = [
  [1000, 'One thousand'], [500, 'Five hundred'], [200, 'Minimums'], [100, 'One hundred'],
  [50, 'Fifty'], [40, 'Forty'], [30, 'Thirty'], [20, 'Twenty'], [10, 'Ten'],
];
const STABLE_CAP_Y = yFromMsl(STABLE_TARGETS.alt);
const MAX_DESCENT = -4000; // fpm: a controlled emergency descent (anything steeper is the dive)
const STABLE_METER = 0.7; // stability needed for STABLE FLIGHT ...
const STABLE_HOLD = 6; // ... held this long (seconds of steady flying, not a deadline)

export class Mission {
  /**
   * @param hooks { phase(name), stage(name), banner(title, sub), toast(obj), callout(text),
   *                fail(reason, kind), touchdown(result), complete(summary) }
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.reset();
  }

  reset() {
    this.phase = PHASE.RECOVERY;
    this.stage = 'regain';
    this.phaseTime = 0;
    this.time = 0;
    this.stableHold = 0;
    this.disturbance = 1;
    this.recoveredAt = null;
    this.overspeedTime = 0;
    this.regainStall = 0;
    this.peakBank = 0;
    this.meter = 0.3;
    this.meterSum = 0;
    this.meterTime = 0;
    this.meterHold = 0;
    this.turnedAt = null;
    this.trackTime = 0;
    this.trackOk = 0;
    this.altOkTime = 0;
    this.spdOkTime = 0;
    this.goArounds = 0;
    this.goAroundWp = null;
    this.structuralTime = 0;
    this.partA = null;
    this.glideOn = 0;
    this.glideTime = 0;
    this.touchdown = null;
    this.stoppedTime = 0;
    this.brakeUsed = false;
    this.callouts = new Set();
    this.retardCalled = false;
    this.done = false;
    this.targets = { alt: null, spd: null, hdg: null };
    this.guide = { title: 'RECOVERY', objective: '', cue: '', key: '', checklist: [] };
    this.nav = { name: 'TABUK', distKm: 0, bearing: 0, rel: 0 };
  }

  get phaseIndex() {
    return PHASE_INDEX[this.phase];
  }

  toPhase(name, atm) {
    this.phase = name;
    this.phaseTime = 0;
    this.configureAtmosphere(atm);
    this.hooks.phase?.(name);
  }

  configureAtmosphere(atm) {
    if (!atm) return;
    atm.joltsEnabled = false;
    if (this.phase === PHASE.RECOVERY && this.stage === 'regain') atm.setTurbulence(0.55);
    else if (this.phase === PHASE.RECOVERY) {
      atm.setTurbulence(0.38);
      atm.joltsEnabled = true;
      atm.setWind(280, 20, 8);
    } else if (this.phase === PHASE.DIVERSION) atm.setTurbulence(0.28);
    else if (this.phase === PHASE.APPROACH) atm.setTurbulence(0.2);
    else atm.setTurbulence(0.12);
  }

  update(dt, fm, t, scoring, warnings, atm) {
    if (this.done) return;
    this.time += dt;
    this.phaseTime += dt;
    this.updateNav(t);
    switch (this.phase) {
      case PHASE.RECOVERY:
        if (this.stage === 'regain') this.updateRegain(dt, fm, t, scoring, atm);
        else this.updateStable(dt, fm, t, scoring, atm);
        break;
      case PHASE.DIVERSION: this.updateDiversion(dt, fm, t, scoring, atm); break;
      case PHASE.APPROACH: this.updateApproach(dt, fm, t, scoring, atm); break;
      default: this.updateLanding(dt, fm, t, scoring, atm);
    }
    if (!fm.onGround) this.updateMeter(dt, t, warnings);
    this.checkFailures(dt, t, warnings, fm);
  }

  /** Live stability (0-1): wings level, controlled vertical speed, safe speed, no warnings. */
  updateMeter(dt, t, warnings) {
    const tg = this.targets;
    const bankS = 1 - smoothstep(4, 30, Math.abs(t.bankDeg));
    let vertS;
    if (this.phase === PHASE.RECOVERY) {
      // Regain: the dive must be under control. Stable flight: follow the descent profile.
      vertS = tg.alt ? 1 - smoothstep(600, 2800, Math.abs(t.altFt - tg.alt)) : 1 - smoothstep(-MAX_DESCENT, 9000, -t.vsFpm);
    } else {
      vertS = tg.alt ? 1 - smoothstep(500, 2800, Math.abs(t.altFt - tg.alt)) : 1;
    }
    const spdS = tg.spd ? 1 - smoothstep(12, 55, Math.abs(t.speedKt - tg.spd)) : 1 - smoothstep(290, 345, t.speedKt);
    const caution = warnings.active.some((w) => w.level === 'caution' && w.id !== 'area');
    const warnF = warnings.hasCritical ? 0.55 : caution ? 0.85 : 1;
    const inst = (0.34 * bankS + 0.36 * vertS + 0.3 * spdS) * warnF;
    this.meter = damp(this.meter, inst, 1.4, dt);
  }

  updateNav(t) {
    let tx = 0;
    let tz = RUNWAY.thresholdZ;
    let name = 'TABUK';
    if (this.phase === PHASE.APPROACH) {
      tx = GATE.x;
      tz = GATE.z;
      name = 'FINAL GATE';
    } else if (this.phase === PHASE.LANDING) name = `RWY ${RUNWAY.name}`;
    else if (this.phase === PHASE.DIVERSION && this.goAroundWp) {
      tx = this.goAroundWp.x;
      tz = this.goAroundWp.z;
      name = 'REPOSITION';
    } else {
      tx = 0;
      tz = 0;
    }
    const brg = bearing(t.x, t.z, tx, tz);
    this.nav.name = name;
    this.nav.bearing = brg;
    this.nav.rel = angleDiffDeg(brg, t.hdg);
    this.nav.distKm = Math.hypot(t.x - tx, t.z - tz) / 1000;
    this.nav.tabukKm = Math.hypot(t.x, t.z) / 1000;
    t.navName = name;
    t.navDistNm = this.nav.distKm / 1.852;
  }

  // --- RECOVERY: regain control ------------------------------------------------------
  updateRegain(dt, fm, t, scoring, atm) {
    // The upset keeps pushing; it fades over time, faster while held steady.
    fm.disturb.pitchRate = -0.9 * DEG * this.disturbance;
    fm.disturb.rollRate = 2.6 * DEG * Math.sin(this.phaseTime * 0.45 + 0.4) * this.disturbance;
    this.disturbance = Math.max(0, this.disturbance - dt * (0.012 + 0.05 * this.meter));
    if (t.speedKt > 335) this.overspeedTime += dt;
    if (fm.stalled) this.regainStall += dt;
    this.peakBank = Math.max(this.peakBank, Math.abs(t.bankDeg));

    const wingsOk = Math.abs(t.bankDeg) < 10;
    const descentOk = t.vsFpm > MAX_DESCENT && t.vsFpm < 2500;
    const speedOk = t.speedKt < 300;
    this.targets.alt = null;
    this.targets.spd = null;
    this.targets.hdg = null;
    this.guide.title = 'RECOVERY';
    this.guide.objective = 'Stabilize the aircraft';
    this.guide.checklist = [
      { label: 'LEVEL THE WINGS', key: 'A / D', done: wingsOk },
      { label: 'CONTROL THE DESCENT', key: 'S  NOSE UP', done: descentOk },
      { label: 'REDUCE SPEED < 300 KT', key: 'Z  THRUST · B  SPD BRK', done: speedOk },
    ];
    const next = this.guide.checklist.find((c) => !c.done);
    this.guide.cue = next ? next.label : 'HOLD IT STEADY';
    this.guide.key = next ? next.key : '';

    const ok = wingsOk && descentOk && speedOk;
    this.stableHold = ok ? this.stableHold + dt : Math.max(0, this.stableHold - dt * 2);
    // Advances only once the aircraft is actually under control. The grade is
    // about how cleanly it was recovered (overspeed, stall, bank excursions),
    // never how long it took.
    if (this.stableHold >= 3) {
      const pct = clamp(
        100 - Math.min(30, this.overspeedTime * 0.8) - Math.min(30, this.regainStall * 8) - Math.min(20, Math.max(0, this.peakBank - 45) * 0.8),
        40, 100);
      scoring.setCategory('recovery', pct);
      scoring.awardFP('recover');
      this.recoveredAt = this.time;
      this.stage = 'stable';
      this.disturbance = 0;
      fm.disturb.pitchRate = fm.disturb.rollRate = 0;
      this.configureAtmosphere(atm);
      this.hooks.stage?.('stable');
      this.hooks.banner?.('AIRCRAFT STABLE', 'Hold a safe altitude, speed and heading');
    }
  }

  // --- RECOVERY: stable flight -------------------------------------------------------
  updateStable(dt, fm, t, scoring, atm) {
    // Stable flight is flown as a steady, controlled descent toward Tabuk: the
    // same targets as the diversion, so no time is lost levelling off.
    const tg = this.targets;
    this.diversionTargets(t);
    const { altOk, spdOk } = this.tracking(t, 1000, 20, 12);
    const hdgOk = Math.abs(angleDiffDeg(t.hdg, tg.hdg)) <= 15;

    // Reached by holding the stability meter high, however long that takes.
    this.meterSum += this.meter * dt;
    this.meterTime += dt;
    this.meterHold = this.meter >= STABLE_METER ? this.meterHold + dt : Math.max(0, this.meterHold - dt * 1.5);
    const hold = Math.min(1, this.meterHold / STABLE_HOLD);

    this.guide.title = 'STABLE FLIGHT';
    this.guide.objective = 'Steady, controlled descent toward Tabuk through turbulence';
    this.guide.checklist = [
      { label: `HDG ${String(tg.hdg).padStart(3, '0')}° TOWARD TABUK`, key: '', done: hdgOk },
      { label: `${t.altFt > tg.alt ? 'DESCEND' : 'CLIMB'} TO ${formatInt(tg.alt)} FT`, key: '', done: altOk },
      { label: `SPD ${tg.spd} KT`, key: '', done: spdOk },
      { label: `HOLD STEADY FLIGHT · ${Math.floor(hold * 10) * 10}%`, key: '', done: hold >= 1 },
    ];
    this.trackingCue(t, altOk, spdOk, hdgOk);

    if (this.meterHold >= STABLE_HOLD) {
      scoring.awardFP('stable');
      const avg = this.meterSum / Math.max(1, this.meterTime);
      scoring.setCategory('stability', clamp(avg * 108, 0, 100));
      this.hooks.banner?.('EMERGENCY DIVERSION', 'DIVERT TO TABUK');
      this.toPhase(PHASE.DIVERSION, atm);
    }
  }

  /** Heading, altitude and speed targets for the run toward Tabuk. Returns the desired bearing. */
  diversionTargets(t) {
    const tg = this.targets;
    const d = Math.hypot(t.x - APPROACH_FIX.x, t.z - APPROACH_FIX.z);
    const wp = this.goAroundWp;
    const desired = wp ? bearing(t.x, t.z, wp.x, wp.z) : bearing(t.x, t.z, 0, Math.min(APPROACH_FIX.z, t.z - 2500));
    tg.hdg = round5(desired) % 360;
    // Repositioning is flown at circuit height: about the approach-fix altitude plus 1,000 ft.
    tg.alt = wp ? round100(mslFeet(diversionProfileY(0)) + 1000) : round100(mslFeet(Math.min(diversionProfileY(d), STABLE_CAP_Y)));
    tg.spd = round5(lerp(210, 250, clamp((d - 1000) / 7000, 0, 1)));
    return desired;
  }

  tracking(t, altTol, spdTol, hdgTol) {
    const tg = this.targets;
    const altErr = t.altFt - tg.alt;
    const altOk = Math.abs(altErr) <= altTol ||
      (altErr > 0 && t.vsFpm <= -500 && t.vsFpm >= -12000) ||
      (altErr < 0 && t.vsFpm >= 500 && t.vsFpm <= 4000);
    const spdOk = Math.abs(t.speedKt - tg.spd) <= spdTol;
    const hdgOk = Math.abs(angleDiffDeg(t.hdg, tg.hdg)) <= hdgTol;
    return { altOk, spdOk, hdgOk };
  }

  trackingCue(t, altOk, spdOk, hdgOk) {
    const tg = this.targets;
    if (!hdgOk && (this.phase === PHASE.DIVERSION || this.stage === 'stable')) {
      const right = angleDiffDeg(tg.hdg, t.hdg) > 0;
      this.guide.cue = right ? 'TURN RIGHT TOWARD TABUK' : 'TURN LEFT TOWARD TABUK';
      this.guide.key = right ? 'D  BANK RIGHT' : 'A  BANK LEFT';
    } else if (!altOk) {
      const above = t.altFt > tg.alt;
      this.guide.cue = above ? 'DESCEND' : 'CLIMB';
      this.guide.key = above ? 'W  NOSE DOWN · B  SPEED BRAKE' : 'S  NOSE UP';
    } else if (!spdOk) {
      const fast = t.speedKt > tg.spd;
      this.guide.cue = fast ? 'REDUCE SPEED' : 'INCREASE SPEED';
      this.guide.key = fast ? 'Z  THRUST · B  SPEED BRAKE' : 'SHIFT  THRUST';
    } else if (!hdgOk) {
      const right = angleDiffDeg(tg.hdg, t.hdg) > 0;
      this.guide.cue = right ? 'TURN RIGHT' : 'TURN LEFT';
      this.guide.key = right ? 'D' : 'A';
    } else {
      this.guide.cue = '';
      this.guide.key = '';
    }
  }

  // --- DIVERSION ---------------------------------------------------------------------
  updateDiversion(dt, fm, t, scoring, atm) {
    // South of the approach fix without being lined up (after a go-around, or
    // after wandering): route out to a repositioning point first, then back
    // down the extended centreline.
    const s = t.alongTrack;
    const lined = Math.abs(t.x) < 2500 && Math.abs(angleDiffDeg(t.hdg, RUNWAY.heading)) < 70;
    if (!this.goAroundWp && t.z < APPROACH_FIX.z - 500 && !lined) this.setReposition(t);
    if (this.goAroundWp && Math.hypot(t.x - this.goAroundWp.x, t.z - this.goAroundWp.z) < 2500) this.goAroundWp = null;
    const tg = this.targets;
    const wp = this.goAroundWp;
    const desired = this.diversionTargets(t);
    const err = Math.abs(angleDiffDeg(t.hdg, desired));
    if (this.turnedAt === null && err < 20) this.turnedAt = this.phaseTime;
    const { altOk, spdOk } = this.tracking(t, 900, 20, 15);
    const hdgOk = err < 15;
    // Navigation quality: how well heading, altitude and speed were held once
    // established on the diversion. Time taken does not matter.
    if (this.turnedAt !== null) {
      this.trackTime += dt;
      if (hdgOk) this.trackOk += dt;
      if (altOk) this.altOkTime += dt;
      if (spdOk) this.spdOkTime += dt;
    }
    this.guide.title = wp ? 'GO AROUND' : 'EMERGENCY DIVERSION';
    this.guide.objective = wp ? 'Reposition, then line up with runway 24 again' : `Divert to Tabuk · ${this.nav.tabukKm.toFixed(0)} km`;
    this.guide.checklist = [
      { label: wp ? 'FLY TO THE REPOSITIONING POINT' : 'TURN TOWARD TABUK', key: 'FOLLOW THE ARROW', done: !wp && this.turnedAt !== null },
      { label: `${t.altFt > tg.alt ? 'DESCEND' : 'CLIMB'} TO ${formatInt(tg.alt)} FT`, key: '', done: altOk },
      { label: `SPEED ${tg.spd} KT`, key: '', done: spdOk },
    ];
    this.trackingCue(t, altOk, spdOk, hdgOk);

    if (!wp && s <= APPROACH_ZONE_DIST + 300 && s > -500 && lined) {
      if (scoring.pct.navigation == null) {
        const T = Math.max(1, this.trackTime);
        scoring.setCategory('navigation', 100 * (0.5 * (this.trackOk / T) + 0.3 * (this.altOkTime / T) + 0.2 * (this.spdOkTime / T)));
      }
      scoring.awardFP('diversion');
      this.hooks.banner?.('TABUK APPROACH', `RUNWAY ${RUNWAY.name} · GEAR DOWN · FULL FLAPS`);
      this.toPhase(PHASE.APPROACH, atm);
    }
  }

  /** Repositioning point north-east/west of the approach fix, on the side the aircraft is on. */
  setReposition(t) {
    const side = t.x >= 0 ? 1 : -1;
    this.goAroundWp = { x: side * 4500, z: APPROACH_FIX.z + 2500 };
    this.nav.wp = this.goAroundWp;
  }

  /** Missed landing: climb away and come round again. Never a failure. */
  goAround(t, atm) {
    this.goArounds++;
    this.callouts.clear();
    this.retardCalled = false;
    this.glideOn = 0;
    this.glideTime = 0;
    this.setReposition(t);
    this.hooks.banner?.('GO AROUND', 'Climb, circle back and line up with runway 24 again');
    this.hooks.callout?.('Go around');
    this.toPhase(PHASE.DIVERSION, atm);
  }

  // --- APPROACH ----------------------------------------------------------------------
  updateApproach(dt, fm, t, scoring, atm) {
    const tg = this.targets;
    const dGate = Math.hypot(t.x - GATE.x, t.z - GATE.z);
    tg.alt = round100(mslFeet(approachProfileY(dGate)));
    tg.spd = round5(lerp(175, 220, clamp((dGate - 500) / 4000, 0, 1)));
    tg.hdg = round5(bearing(t.x, t.z, 0, Math.min(GATE.z, t.z - 2500))) % 360;
    const { altOk, spdOk, hdgOk } = this.tracking(t, 700, 20, 15);
    const spd = t.speedKt;
    this.guide.title = 'TABUK APPROACH';
    this.guide.objective = `Configure and line up with runway ${RUNWAY.name}`;
    this.guide.checklist = [
      { label: 'GEAR DOWN', key: 'G', done: fm.gearDown },
      { label: 'FLAPS FULL', key: 'F', done: fm.flapsCmd === 3 },
      { label: 'SPEED ≤ 185 KT', key: '', done: spd <= 185 },
      { label: 'LINE UP WITH RUNWAY', key: 'A / D', done: Math.abs(t.x) < 150 },
    ];
    const nextFlapLimit = SPEC.flapLimitKt[Math.min(3, fm.flapsCmd + 1)];
    if (t.altFt - tg.alt > 1500) {
      this.guide.cue = 'TOO HIGH — DESCEND';
      this.guide.key = 'W  NOSE DOWN · B  SPEED BRAKE';
    } else if (!fm.gearCmd && spd < SPEC.gearLimitKt) {
      this.guide.cue = 'LANDING GEAR DOWN';
      this.guide.key = 'G';
    } else if (fm.flapsCmd < 3 && spd > nextFlapLimit) {
      this.guide.cue = 'SLOW DOWN FOR FLAPS';
      this.guide.key = `Z  THRUST · B  SPEED BRAKE · < ${nextFlapLimit} KT`;
    } else if (fm.flapsCmd < 3) {
      this.guide.cue = 'EXTEND FLAPS';
      this.guide.key = 'F';
    } else {
      this.trackingCue(t, altOk, spdOk, hdgOk);
    }

    const s = t.alongTrack;
    if (Math.abs(t.x) > 6000 || s > APPROACH_ZONE_DIST + 6000) {
      this.goAround(t, atm); // drifted well away from the approach: set up again
      return;
    }
    if ((s <= GATE_DIST + 100 && Math.abs(t.x) < 1500) || s < GATE_DIST - 400) {
      const flaps = fm.flapsCmd === 3 ? 25 : fm.flapsCmd === 2 ? 12 : 0;
      const speed = spd <= 190 ? 25 : spd <= 205 ? 12 : 0;
      const align = Math.abs(t.x) < 60 ? 25 : Math.abs(t.x) < 200 ? 12 : 0;
      this.partA = (fm.gearDown ? 25 : 0) + flaps + speed + align;
      if (this.partA >= 75) scoring.awardFP('goodApproach');
      else if (this.partA >= 40) scoring.awardFP('approach');
      this.hooks.banner?.('FINAL APPROACH', `RUNWAY ${RUNWAY.name} · FOLLOW THE GLIDE PATH · FLARE AT 30 FT`);
      this.toPhase(PHASE.LANDING, atm);
    }
  }

  // --- LANDING -----------------------------------------------------------------------
  updateLanding(dt, fm, t, scoring, atm) {
    const tg = this.targets;
    tg.spd = 140;
    tg.hdg = RUNWAY.heading;
    const s = t.alongTrack;
    tg.alt = s > 0 ? round100(mslFeet(glideY(s))) : null;

    if (!fm.onGround) {
      const onPath = Math.abs(t.gsDev) < 0.4 && Math.abs(t.locDev) < 0.45;
      if (t.aglFt > 50) {
        this.glideTime += dt;
        if (onPath) this.glideOn += dt;
      }
      for (const [ft, text] of CALLOUTS) {
        if (t.aglFt <= ft && t.aglFt > ft - 60 && !this.callouts.has(ft) && t.vsFpm < 0) {
          this.callouts.add(ft);
          this.hooks.callout?.(text);
        }
      }
      if (!this.retardCalled && t.aglFt < 22 && fm.throttle > 0.05) {
        this.retardCalled = true;
        this.hooks.callout?.('Retard');
      }
      const spdOk = t.speedKt >= 128 && t.speedKt <= 155;
      this.guide.title = 'LANDING';
      this.guide.objective = `Land safely on runway ${RUNWAY.name}`;
      this.guide.checklist = [
        { label: 'ALIGN WITH RUNWAY', key: 'A / D', done: Math.abs(t.locDev) < 0.5 },
        { label: 'ON GLIDE PATH', key: '2 WHITE · 2 RED', done: Math.abs(t.gsDev) < 0.4 },
        { label: 'SPEED 130–150 KT', key: '', done: spdOk },
        { label: 'FLARE AT 30 FT', key: 'S', done: false },
      ];
      if (t.aglFt < 40) {
        const idle = fm.throttle > 0.05 && t.aglFt < 25;
        this.guide.cue = idle ? 'THRUST IDLE' : 'FLARE';
        this.guide.key = idle ? 'Z' : 'S  GENTLY NOSE UP';
      } else if (Math.abs(t.locDev) > 0.5) {
        const right = t.locDev < 0;
        this.guide.cue = right ? 'STEER RIGHT' : 'STEER LEFT';
        this.guide.key = right ? 'D' : 'A';
      } else if (t.gsDev > 0.5) {
        this.guide.cue = 'TOO HIGH';
        this.guide.key = 'W  NOSE DOWN · Z  THRUST';
      } else if (t.gsDev < -0.5) {
        this.guide.cue = 'TOO LOW';
        this.guide.key = 'S  NOSE UP · SHIFT  THRUST';
      } else if (!spdOk) {
        this.guide.cue = t.speedKt > 155 ? 'REDUCE SPEED' : 'INCREASE SPEED';
        this.guide.key = t.speedKt > 155 ? 'Z' : 'SHIFT';
      } else {
        this.guide.cue = '';
        this.guide.key = '';
      }
      // Past the runway, or far off the centreline: go around and try again.
      if (t.z < RUNWAY.endZ + 150 || Math.abs(t.x) > 4000 || t.alongTrack > APPROACH_ZONE_DIST + 3000) this.goAround(t, atm);
      return;
    }

    // Rollout
    if (fm.braking) this.brakeUsed = true;
    this.guide.objective = 'Slow down to taxi speed on the runway';
    this.guide.checklist = [
      { label: 'THRUST IDLE', key: 'Z', done: fm.throttle < 0.1 },
      { label: 'BRAKES', key: 'B / SPACE', done: fm.braking || fm.V < 1 },
      { label: 'STAY ON CENTERLINE', key: 'Q / E', done: Math.abs(t.x) < 8 },
    ];
    const next = this.guide.checklist.find((c) => !c.done);
    this.guide.cue = next ? next.label : 'ROLLING OUT';
    this.guide.key = next ? next.key : '';
    if (t.surface !== 'runway') {
      if (fm.V > 8) {
        this.fail('The aircraft ran off the runway.');
        return;
      }
      scoring.penalty(80, 'RUNWAY EXCURSION');
      fm.V = 0;
    }
    // Down to taxi speed on the runway (~30 kt): the aircraft is safe.
    if (fm.V < 15) {
      this.stoppedTime += dt;
      if (this.stoppedTime > 0.5) this.complete(fm, t, scoring);
    }
  }

  /** Called by the game when the flight model reports ground contact. */
  onContact(contact, fm, scoring, atm) {
    if (this.done) return null;
    if (this.phase !== PHASE.LANDING) this.toPhase(PHASE.LANDING, atm);
    const result = evaluateTouchdown(contact);
    if (result.crash) {
      this.fail(result.reason, 'crash');
      return result;
    }
    this.touchdown = result;
    this.hooks.touchdown?.(result);
    return result;
  }

  finishApproachGrade(scoring) {
    if (this.partA === null) return;
    const glide = this.glideTime > 3 ? (this.glideOn / this.glideTime) * 100 : 50;
    scoring.setCategory('approach', 0.6 * this.partA + 0.4 * glide);
  }

  complete(fm, t, scoring) {
    if (this.done) return;
    this.done = true;
    this.finishApproachGrade(scoring);
    const td = this.touchdown;
    const onRunway = t.surface === 'runway';
    const landingPct = (td.points / 300) * 100 * 0.85 + (onRunway ? 10 : 0) + (this.brakeUsed ? 5 : 0);
    scoring.setCategory('landing', landingPct);
    scoring.awardFP('landing');
    if (td.grade === 'SMOOTH LANDING' || td.grade === 'BUTTER LANDING') scoring.awardFP('smooth');
    this.hooks.complete?.({ time: this.time, touchdown: td, stopDistance: -t.alongTrack });
  }

  fail(reason, kind = 'fail') {
    if (this.done) return;
    this.done = true;
    this.hooks.fail?.(reason, kind);
  }

  /** Only genuinely unrecoverable situations end the flight; slowness never does. */
  checkFailures(dt, t, warnings, fm) {
    if (this.done) return;
    this.structuralTime = t.speedKt > 390 && !fm.onGround ? this.structuralTime + dt : Math.max(0, this.structuralTime - dt * 0.5);
    if (warnings.stallTime > 12) this.fail('The aircraft stayed in a deep stall and could not be recovered.');
    else if (this.structuralTime > 8) this.fail('The aircraft exceeded its structural speed limits and became unrecoverable.');
    else if (t.distFromAirport > 70000) this.fail('The aircraft left the playable area.');
  }
}
