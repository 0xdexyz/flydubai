// Development tool — NOT part of the game bundle (nothing imports it).
// A scripted pilot that plays the complete scenario headlessly and faster
// than real time, used to verify the cinematic hand-over, phase flow,
// timing, scoring and landing logic.
//
// Usage from the browser console while the dev server runs:
//   const { runTestPilot, placeOnFinal } = await import('/src/dev/TestPilot.js');
//   const report = await runTestPilot(window.__sky, { cinematic: true });

import { feetPerMeter } from '../physics/AltitudeScale.js';
import { SPEC } from '../physics/FlightModel.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const angDiff = (a, b) => ((((a - b + 180) % 360) + 360) % 360) - 180;

function frame(g) {
  g.fixedUpdate(1 / 120);
  g.fixedUpdate(1 / 120);
  g.update(1 / 60);
}

/** Start the scenario and get to the player's first frame of control. */
function toGameplay(g, watchCinematic) {
  g.loop.stop();
  g.launchFlight(); // bypasses the fee screen
  const report = {};
  if (watchCinematic) {
    const states = [];
    let n = 0;
    while (!g.sm.inFlight && n++ < 60 * 60) {
      frame(g);
      if (states.at(-1) !== g.sm.current) states.push(g.sm.current);
    }
    report.states = states;
  } else {
    g.cinematic.skip();
    frame(g);
  }
  const t = g.tele;
  report.handover = {
    state: g.sm.current, altFt: Math.round(t.altFt), vsFpm: Math.round(t.vsFpm), speedKt: Math.round(t.speedKt),
    hdg: Math.round(t.hdg), bank: +t.bankDeg.toFixed(1), x: Math.round(t.x), z: Math.round(t.z), camera: g.cameraCtl.mode,
  };
  return report;
}

/** Put the aircraft on a stabilised final approach `s` metres out (landing phase). */
export async function placeOnFinal(g, s = 3000, { frozen = false, camera = 'cockpit' } = {}) {
  const R = await import('../world/Route.js');
  if (!g.sm.inFlight) toGameplay(g, false);
  const fm = g.fm;
  fm.pos.set(0, R.glideY(s), R.RUNWAY.thresholdZ + s);
  fm.psi = 0;
  fm.phi = 0;
  fm.V = 72;
  fm.gamma = (-3 * Math.PI) / 180;
  fm.theta = fm.gamma + 0.112;
  fm.gearCmd = true;
  fm.gearPos = 1;
  fm.flapsCmd = 3;
  fm.flapsPos = 3;
  fm.throttle = fm.n1 = 0.44;
  fm.onGround = false;
  fm.frozen = frozen;
  fm.disturb.pitchRate = fm.disturb.rollRate = 0;
  const m = g.mission;
  m.stage = 'stable';
  m.partA = 100;
  for (const p of ['DIVERSION', 'APPROACH', 'LANDING']) if (m.phaseIndex < { DIVERSION: 2, APPROACH: 3, LANDING: 4 }[p]) m.toPhase(p, g.atm);
  g.cameraMode = camera;
  g.cameraCtl.setMode(camera);
  g.loop.start();
  return { y: fm.pos.y, altFt: g.tele.altFt, state: g.sm.current };
}

export async function runTestPilot(g, opts = {}) {
  const maxVs = opts.maxVs ?? -9000;
  const flareFt = opts.flareFt ?? 60;
  const flareVs = opts.flareVs ?? -170;
  const logEvery = opts.logEvery ?? 15;
  const report = toGameplay(g, !!opts.cinematic);
  const v = g.input.virtual;
  const log = [];
  let t = 0;
  let lastLog = -99;
  let lastCfg = 0;
  let thrI = 0;

  for (let i = 0; i < 60 * 480 && !g.ended; i++) {
    if (opts.stopAt != null && t >= opts.stopAt) {
      g.loop.start();
      return { ...report, stoppedAt: Math.round(t), state: g.sm.current, alt: Math.round(g.tele.altFt) };
    }
    const T = g.tele;
    const m = g.mission;
    const fm = g.fm;
    const tg = m.targets;
    let vsCmd;
    let spdCmd = tg.spd || 270;
    let hdgCmd = tg.hdg ?? T.hdg;
    if (m.phaseIndex === 1 && m.stage === 'regain') {
      vsCmd = -2500; // controlled descent while recovering
      spdCmd = 265;
      hdgCmd = T.hdg;
    } else if (m.phaseIndex <= 3) {
      vsCmd = clamp((tg.alt - T.altFt) * (opts.altGain ?? 3), maxVs, 3000);
    } else {
      vsCmd = clamp(-720 - T.gsDev * 1200, -2200, -150);
      hdgCmd = 240 - clamp(T.locDev * 30, -20, 20);
      spdCmd = 140;
    }
    if (m.phaseIndex === 4 && !fm.onGround && T.aglFt < flareFt) vsCmd = flareVs;

    if (!fm.onGround) {
      const fpm = feetPerMeter(fm.pos.y - 4) * 60;
      const gammaCmd = Math.asin(clamp(vsCmd / fpm / fm.V, -0.3, 0.3));
      v.pitch = clamp((gammaCmd + fm.alpha - fm.theta) / ((2.5 * Math.PI) / 180), -1, 1);
      const bankCmd = clamp(angDiff(hdgCmd, T.hdg) * 1.2, -25, 25);
      v.roll = clamp((bankCmd - T.bankDeg) / 8, -1, 1);
      thrI = clamp(thrI + (spdCmd - T.speedKt) * 0.0004, -0.4, 0.4);
      let thr = clamp(0.45 + (spdCmd - T.speedKt) * 0.03 + thrI, 0, 1);
      if (m.phaseIndex === 4 && T.aglFt < 25) thr = 0;
      fm.setThrottle(thr);
      v.brake = T.speedKt > spdCmd + 12;
      const configure = m.phaseIndex >= 3 || (m.phaseIndex === 2 && T.alongTrack < 12000 && Math.abs(T.x) < 4000);
      if (configure && t - lastCfg > 1.5) {
        if (!fm.gearCmd && T.speedKt < 250) {
          g.input.trigger('gear');
          lastCfg = t;
        } else if (fm.flapsCmd < 3 && T.speedKt < SPEC.flapLimitKt[fm.flapsCmd + 1] - 5) {
          g.input.trigger('flapsDown');
          lastCfg = t;
        }
      }
    } else {
      v.pitch = 0;
      v.roll = 0;
      fm.setThrottle(0);
      v.brake = true;
      v.yaw = clamp(-T.x * 0.15 - angDiff(T.hdg, 240) * 0.3, -1, 1);
    }

    if (t - lastLog >= logEvery || g.sm.current !== log.at(-1)?.state) {
      lastLog = t;
      log.push({
        t: Math.round(t), state: g.sm.current, stage: m.stage, alt: Math.round(T.altFt), vs: Math.round(T.vsFpm),
        spd: Math.round(T.speedKt), hdg: Math.round(T.hdg), tgt: [tg.alt, tg.spd, tg.hdg].join('/'),
        x: Math.round(T.x), z: Math.round(T.z), meter: +m.meter.toFixed(2), fp: g.scoring.fp,
        warn: g.warnings.active.map((w) => w.text).join(','),
      });
    }
    frame(g);
    t += 1 / 60;
  }
  for (let k = 0; k < 200; k++) frame(g);
  Object.assign(v, { pitch: 0, roll: 0, yaw: 0, brake: false });
  g.loop.start();
  const r = g.pendingResult;
  return {
    ...report,
    end: g.sm.current,
    result: r && {
      success: r.success, grade: r.grade, score: r.score, reason: r.reason, time: Math.round(r.time),
      grades: r.breakdown.map((b) => `${b.id}:${b.pct ?? '-'}`).join(' '),
      fp: r.fpEarned, awards: r.awards.map((a) => `${a.label} ${a.fp}`).join(', '),
      touchdown: r.touchdown && {
        sink: Math.round(r.touchdown.sink), dist: Math.round(r.touchdown.distPast),
        spd: Math.round(r.touchdown.speedKt), lateral: +r.touchdown.lateral.toFixed(1),
      },
    },
    log,
  };
}
