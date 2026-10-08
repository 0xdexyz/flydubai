// Opening cinematic (~46 s), built from the game's own systems: the real
// flight model flies the aircraft (driven by a scripted "cinematic pilot"),
// the camera framework provides the shots, and the interior set + stylized
// cast act out the sequence. It ends exactly on the gameplay cockpit pose,
// so control passes to the player without a cut or loading screen.
//
// The sequence follows the publicly reported timeline of 30 September 2026
// (UAE Attorney-General findings, airline statement, flight-tracking data and
// witness accounts):
//   05:21 UTC  the co-pilot attacks the captain from behind and tries to seize
//              the controls; the aircraft pitches down and rolls, plunges,
//              climbs sharply, then dives again
//   05:28 UTC  squawk 7700 near the Saudi-Jordanian border; panic in the cabin
//              the injured captain opens the flight-deck door; crew, passengers
//              and two airline pilots travelling off duty rush in and pin the
//              co-pilot to the floor
//   05:33 UTC  about 15,000 ft; pilots travelling on board take over
//   05:35 UTC  squawk 7500 (unlawful interference); diversion to Tabuk
// Depiction: the attack itself is a cut to black with sound. No weapon,
// blood or wounds are shown, no real names are used, and every character
// and the livery are fictional.

import * as THREE from 'three';
import { DEG, clamp, lerp } from '../core/MathUtil.js';
import { FlightModel, KT_TO_MS } from '../physics/FlightModel.js';
import { Atmosphere } from '../physics/Atmosphere.js';
import { feetPerMeter } from '../physics/AltitudeScale.js';
import { CRUISE, GAMEPLAY_START, mslFeet, toWorldHeading, yFromMsl } from '../world/Route.js';
import { EYE } from '../aircraft/AircraftModel.js';
import { BULKHEAD_Z, FLOOR, PILOT_SEAT_Z } from '../aircraft/Interior.js';
import { COCKPIT_QUAT, lookQuat } from './CameraController.js';

export const CINE = Object.freeze({
  emergency: 8.7, // CINEMATIC_INTRO -> EMERGENCY (the attack)
  transfer: 37.6, // EMERGENCY -> CONTROL_TRANSFER (co-pilot restrained)
  takeControl: 45.4,
  end: 46.4,
});

const STEP = 1 / 120;
const SCALE_WINDOWS = [[11.6, 20.6, 4]]; // time-lapse the long exterior descent

// Cinematic pilot schedule, in simulated seconds since the attack.
const ALT_KEYS = [
  [0, 34000], [3.5, 33300], [22, 24500], [29, 25800], // plunge, sharp climb
  [42, 18000], [47.5, 16700], [53, 16100], [69, 15800], [1e4, 15800], // second dive, then ~15,000 ft
];
// Witnesses: the aircraft "abruptly dropped and began to spin slightly".
const BANK_KEYS = [[0, 0], [0.5, 36], [1.4, 18], [2.6, 32], [3.5, 24], [21, 18], [24, -14], [30, -22], [47.5, -16], [52, 8], [60, -6], [69, 5], [1e4, 5]];

// Cabin mood over the sequence (real seconds): motion felt by the cast, and the sound mix.
const AGITATION = [[0, 0], [8.6, 0], [9.0, 1], [20.6, 0.95], [28.4, 0.8], [29.6, 1], [34, 0.85], [37.6, 0.6], [60, 0.45]];
const PANIC = [[0, 0.05], [8.7, 0.05], [9.2, 0.85], [20.6, 0.95], [29.6, 1], [34, 0.9], [37.6, 0.7], [60, 0.5]];
const RUMBLE = [[0, 0], [8.7, 0], [8.9, 1], [20.6, 1], [37.6, 0.8], [60, 0.65]];

function keyAt(keys, t) {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      const u = (t - t0) / (t1 - t0);
      return { value: lerp(v0, v1, u), slope: (v1 - v0) / (t1 - t0) };
    }
  }
  return { value: keys[keys.length - 1][1], slope: 0 };
}

const ease = (u) => u * u * (3 - 2 * u);
const easeIn = (u) => u * u;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const F = FLOOR;
const tmpE = new THREE.Euler();
const yawPitchQuat = (yaw, pitch, out) => out.setFromEuler(tmpE.set(pitch, yaw, 0, 'YXZ'));

const COCKPIT_BACK = { pos: V(0.05, 5.08, -14.38), target: V(-0.05, 4.28, -16.9) };
const DOOR_POINT = V(0, F + 1.15, BULKHEAD_Z);
const CAPTAIN_HEAD = V(-0.48, F + 1.3, -15.36);
const PILOT_LANE = -15.25; // between the two pilot seats, just behind the pedestal
const SEAT_Z = PILOT_SEAT_Z + 0.08;
const DOOR_OPEN = 29.5;
const DOOR_CLOSE = 42.9;
const CAPTAIN_REST = [1.28, -13.45]; // galley floor, right-hand wall

// Camera shots. pose(u, ctx) returns { pos, target } or { pos, quat }.
const SHOTS = [
  // 1 · normal cruise above the clouds
  { from: 0, to: 4.4, interior: false, frame: 'yaw', fov: 46,
    pose: (u) => {
      const k = ease(u);
      const a = lerp(2.5, 1.55, k);
      const r = lerp(52, 40, k);
      return { pos: V(Math.sin(a) * r, lerp(9, 4, k), Math.cos(a) * r - 2), target: V(0, 3.2, -3) };
    } },
  // 2 · push in toward the flight-deck windows
  { from: 4.4, to: 5.1, interior: false, frame: 'aircraft', fov: 46,
    pose: (u) => {
      const k = easeIn(u);
      return { pos: V(lerp(10, 3, k), lerp(5.5, 4.9, k), lerp(-26, -20.5, k)), target: V(-0.4, 4.4, -17.2) };
    } },
  // 3 · the flight deck, all normal
  { from: 5.1, to: 6.6, interior: true, fov: 64,
    pose: (u) => ({ pos: COCKPIT_BACK.pos.clone().setZ(lerp(-14.36, -14.46, u)), target: COCKPIT_BACK.target }) },
  // 4 · the captain flying; behind him the co-pilot unbuckles and gets up
  { from: 6.6, to: 8.7, interior: true, fov: 50,
    pose: (u) => ({ pos: V(-1.02, F + 1.42, lerp(-16.04, -16.1, u)), target: V(lerp(-0.42, -0.28, ease(u)), F + 1.3, -15.15) }) },
  // 5 · cut to black: the attack is heard, not shown
  { from: 8.7, to: 9.05, interior: true, fov: 50, black: true,
    pose: () => ({ pos: V(-1.02, F + 1.42, -16.1), target: V(-0.28, F + 1.3, -15.15) }) },
  // 6 · flight deck: captain hurt, the co-pilot pushing the controls forward
  { from: 9.05, to: 10.6, interior: true, fov: 62, shake: 1.8,
    pose: (u) => ({ pos: V(0.32, 5.02, lerp(-14.45, -14.55, u)), target: V(-0.15, 4.3, -16.6) }) },
  // 7 · instruments: nose down, rolling, the altitude unwinding
  { from: 10.6, to: 11.6, interior: true, fov: 48, shake: 1.4,
    pose: (u) => ({ pos: V(-0.42, 4.42, lerp(-15.9, -15.98, u)), target: V(-0.52, 4.17, -16.41) }) },
  // 8-10 · the plunge, exterior (time-lapsed)
  { from: 11.6, to: 15.2, interior: false, frame: 'chase', fov: 58, shake: 1.1,
    pose: (u) => ({ pos: V(lerp(-2, 6, u), lerp(8, 5, u), lerp(36, 30, u)), target: V(0, 2, -16) }) },
  { from: 15.2, to: 18.2, interior: false, frame: 'yaw', fov: 50, shake: 0.8,
    pose: (u) => ({ pos: V(-40, lerp(-2, -6, u), lerp(-4, 5, u)), target: V(0, 2, -3) }) },
  { from: 18.2, to: 20.6, interior: false, frame: 'aircraft', fov: 55, shake: 0.9,
    pose: (u) => ({ pos: V(lerp(16, 12, u), 4, lerp(-52, -46, u)), target: V(0, 3, -6) }) },
  // 11 · into the cabin: at the closed flight-deck door, turn and move aft down the aisle
  { from: 20.6, to: 25.0, interior: true, cabin: true, fov: 62, shake: 0.8,
    pose: (u, ctx) => {
      const k = ease(u);
      const turn = ease(clamp(u * 1.35 - 0.12, 0, 1));
      return {
        pos: V(lerp(0.3, 0.02, k), F + lerp(1.6, 1.74, k), lerp(-13.55, -12.0, k)),
        quat: yawPitchQuat(turn * Math.PI, lerp(-0.06, -0.16, turn), ctx.q),
      };
    } },
  // 12 · faces in the forward rows
  { from: 25.0, to: 27.6, interior: true, cabin: true, fov: 52, shake: 0.7,
    pose: (u) => ({ pos: V(lerp(0.12, 0.02, u), F + 1.42, lerp(-8.55, -8.32, u)), target: V(-0.95, F + 0.96, lerp(-4.9, -5.3, u)) }) },
  // 13 · the flight-deck door from several rows back; holds still while it opens
  { from: 27.6, to: 33.4, interior: true, cabin: true, fov: 50, shake: 0.5,
    pose: (u) => ({ pos: V(0.06, F + 1.62, lerp(-5.0, -5.6, ease(clamp((u - 0.55) / 0.45, 0, 1)))), target: DOOR_POINT }) },
  // 14 · from the galley: people rush up the aisle toward the camera and into the flight deck
  { from: 33.4, to: 37.6, interior: true, cabin: true, fov: 58, shake: 0.5,
    pose: (u) => ({ pos: V(-0.78, F + 1.86, -12.9), target: V(lerp(0.15, 0.1, u), F + 1.25, lerp(-8.6, -12.0, ease(u))) }) },
  // 15 · inside the flight deck: the co-pilot is pinned to the floor (behind the seats)
  { from: 37.6, to: 40.6, interior: true, fov: 58, shake: 0.5,
    pose: (u) => ({ pos: V(-1.0, F + 1.7, lerp(-16.0, -16.06, u)), target: V(0.3, F + 0.85, -14.6) }) },
  // 16 · the pilots travelling on board take the seats
  { from: 40.6, to: 42.9, interior: true, fov: 58,
    pose: (u) => ({ pos: V(-1.02, F + 1.52, -16.0), target: V(lerp(-0.05, -0.4, ease(u)), F + lerp(1.45, 1.15, ease(u)), lerp(-14.4, -15.3, ease(u))) }) },
  // 17 · seated: third person, over his shoulder
  { from: 42.9, to: 44.1, interior: true, fov: 60,
    pose: (u) => ({ pos: V(lerp(-0.16, -0.28, u), F + 1.62, lerp(-14.55, -14.78, u)), target: V(-0.5, F + 1.05, -16.6) }) },
  // 18 · blend into the first-person cockpit eye
  { from: 44.1, to: 45.0, interior: true, seat: true },
  { from: 45.0, to: CINE.end + 1, interior: true, cockpit: true },
];

const CAPTIONS = [
  [0.5, 4.2, '30 SEPTEMBER 2026 · FLYDUBAI FZ1073 · DUBAI → TEL AVIV · 34,000 FT', 'card'],
  [5.4, 8.5, '05:21 UTC · Over northern Saudi Arabia, near the Jordanian border.'],
  [9.1, 11.5, 'The co-pilot attacks the captain from behind and tries to seize the controls.'],
  [11.9, 15.0, 'The aircraft pitches sharply down and begins to roll.'],
  [15.3, 18.0, 'It plunges, climbs sharply, then dives again.'],
  [18.3, 20.5, '05:28 UTC · SKY DUBAI 1073 · SQUAWK 7700', 'alert'],
  [21.0, 24.8, 'In the cabin, passengers have no idea what is happening.'],
  [25.2, 27.5, 'Passengers later described screaming children and panic.'],
  [30.0, 33.2, 'Injured, the captain manages to open the flight deck door.'],
  [33.6, 37.4, 'Crew and passengers rush in, among them two airline pilots travelling off duty.'],
  [37.8, 40.4, 'They pin the co-pilot to the floor and restrain him.'],
  [40.8, 42.8, '05:33 UTC · About 15,000 ft. Pilots travelling on board take over the flight deck.'],
  [43.0, 45.2, '05:35 UTC · SKY DUBAI 1073 · SQUAWK 7500', 'alert'],
];

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

export class Cinematic {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.tau = -1; // simulated seconds since the attack (negative = cruise)
    this.active = false;
    this.events = [];
    this.fired = new Set();
    this.ctx = { playerHead: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.seatStart = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60 };
    this.currentFov = 0;
    this.inputs = { pitch: 0, roll: 0, yaw: 0, brake: false };
    this.startXZ = { x: 0, z: 0 };
    this.mix = { cabin: 0, panic: 0, emergency: 0 }; // sound mix read by the game
    this.buildEvents();
    this.calibrate();
  }

  // --- flight ------------------------------------------------------------------
  initAircraft(fm, atm, x, z) {
    fm.reset({
      x,
      y: yFromMsl(CRUISE.altFt),
      z,
      speed: CRUISE.speedKt * KT_TO_MS,
      gamma: 0,
      pitch: 0.046,
      bank: 0,
      heading: toWorldHeading(CRUISE.heading),
      throttle: 0.55,
    });
    atm.reset(1073);
    atm.setTurbulence(0.12);
    atm.turbulence = 0.12;
  }

  /** Scripted control inputs for the flight model (one physics step). */
  pilot(fm, tau) {
    const altFt = mslFeet(fm.pos.y);
    let vsCmd;
    let bankCmd;
    if (tau < 0) {
      vsCmd = (CRUISE.altFt - altFt) * 3;
      bankCmd = 0;
      fm.setThrottle(clamp(0.55 + (CRUISE.speedKt * KT_TO_MS - fm.V) * 0.05, 0.3, 0.8));
    } else {
      const a = keyAt(ALT_KEYS, tau);
      vsCmd = a.slope * 60 + (a.value - altFt) * 3;
      bankCmd = keyAt(BANK_KEYS, tau).value;
      fm.setThrottle(tau > 47.5 ? 0.32 : 0.62);
    }
    const fpm = feetPerMeter(fm.pos.y - 4) * 60;
    const gammaCmd = Math.asin(clamp(vsCmd / fpm / fm.V, -0.3, 0.3));
    const I = this.inputs;
    I.pitch = clamp((gammaCmd + fm.alpha - fm.theta) / (2.5 * DEG), -1, 1);
    I.roll = clamp((bankCmd * DEG - fm.phi) / (8 * DEG), -1, 1);
    I.yaw = 0;
    return I;
  }

  scaleAt(t) {
    for (const [a, b, s] of SCALE_WINDOWS) if (t >= a && t < b) return s;
    return 1;
  }

  /** Advance the cinematic clock by one fixed tick and step the physics. */
  tick(fm, atm, env, cloud = false) {
    this.time += STEP;
    const steps = this.scaleAt(this.time);
    for (let i = 0; i < steps; i++) {
      if (this.time >= CINE.emergency) this.tau = this.tau < 0 ? 0 : this.tau + STEP;
      const turb = this.time < CINE.emergency ? 0.12 : this.time < 11.6 ? 0.7 : this.time < 20.6 ? 0.85 : 0.5;
      atm.setTurbulence(turb);
      atm.update(STEP, fm.pos.y, cloud);
      env.pitchRate = atm.pitchRate;
      env.rollRate = atm.rollRate;
      env.vertical = atm.vertical;
      env.windX = atm.windX;
      env.windZ = atm.windZ;
      fm.step(STEP, this.pilot(fm, this.tau), env);
      fm.events.length = 0;
    }
  }

  /** Simulate the whole cinematic once at boot to find where it must start. */
  calibrate() {
    const fm = new FlightModel();
    const atm = new Atmosphere();
    const env = { ...this.game.env };
    this.initAircraft(fm, atm, 0, 0);
    this.time = 0;
    this.tau = -1;
    while (this.time < CINE.end) this.tick(fm, atm, env);
    this.startXZ = { x: GAMEPLAY_START.x - fm.pos.x, z: GAMEPLAY_START.z - fm.pos.z };
    this.calibration = { altFt: mslFeet(fm.pos.y), speedKt: fm.speedKt, vy: fm.vy };
    this.time = 0;
    this.tau = -1;
  }

  // --- lifecycle -----------------------------------------------------------------
  start() {
    const g = this.game;
    this.time = 0;
    this.tau = -1;
    this.active = true;
    this.fired.clear();
    this.currentFov = 0;
    this.seatShot = null;
    this.initAircraft(g.fm, g.atm, this.startXZ.x, this.startXZ.z);
    g.interior.reset();
    g.interior.setCabinVisible(true);
    g.cameraCtl.setMode('cinematic');
    g.overlay.show();
    this.update(0);
  }

  stop() {
    this.active = false;
    this.game.interior.setCabinVisible(false);
    this.game.overlay.hide();
  }

  /** Jump to the end (replays only): fast-forward the physics deterministically. */
  skip() {
    const g = this.game;
    while (this.time < CINE.end) this.tick(g.fm, g.atm, g.env);
    for (const e of this.events) if (e.t < CINE.takeControl) this.fired.add(e);
    this.layoutAfterTakeover();
    g.interior.cast.player.setVisible(false);
    this.update(0);
  }

  /**
   * Where everyone is once the pilots travelling on board have the flight
   * deck: the co-pilot restrained on the galley floor, the captain resting
   * against the opposite wall with a crew member beside him.
   */
  layoutAfterTakeover() {
    const g = this.game;
    const c = g.interior.cast;
    c.firstOfficer.lieProne(-1.05, F, -12.4, 0);
    c.firstOfficer.setMood('calm');
    const kneel = (ch, x, z, yaw, mood) => {
      ch.place(x, F, z, yaw);
      ch.setPose('kneel', true);
      ch.setMood(mood);
      ch.lookAt(null);
      ch.setVisible(true);
    };
    kneel(c.p1, -0.62, -12.95, Math.PI / 2, 'restrain');
    kneel(c.p2, -0.62, -13.5, Math.PI / 2, 'restrain');
    c.crew2.place(-0.45, F, -12.55, 0);
    c.crew2.setPose('stand', true);
    c.crew2.setMood('crewHold');
    c.crew2.lookAt(V(-1.05, F + 0.3, -13.0));
    c.captain.place(CAPTAIN_REST[0], F, CAPTAIN_REST[1], Math.PI / 2);
    c.captain.setPose('floorSit', true);
    c.captain.setMood('hurt');
    kneel(c.crew, 0.78, -13.02, Math.atan2(-(CAPTAIN_REST[0] - 0.78), -(CAPTAIN_REST[1] + 13.02)), 'tend');
    c.helper.place(0.48, F, SEAT_Z, 0);
    c.helper.setPose('pilot', true);
    c.helper.setMood('resolve');
  }

  get stateLabel() {
    if (this.time < CINE.emergency) return 'CINEMATIC_INTRO';
    if (this.time < CINE.transfer) return 'EMERGENCY';
    return 'CONTROL_TRANSFER';
  }

  get done() {
    return this.time >= CINE.end;
  }

  // --- events ------------------------------------------------------------------
  buildEvents() {
    const g = this.game;
    const I = () => g.interior;
    const cast = () => g.interior.cast;
    const ev = (t, fn) => this.events.push({ t, fn });
    const rng = (seed) => {
      let s = seed;
      return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    };

    // --- 05:21: the co-pilot gets up and moves behind the captain
    ev(6.8, () => cast().firstOfficer.setMood('helpful'));
    ev(7.35, () => {
      const fo = cast().firstOfficer;
      fo.setMood('resolve');
      fo.lookAt(CAPTAIN_HEAD);
      fo.walkTo([[0.1, -15.2], [-0.12, -14.92]], F, 0.75, (c) => c.faceToward(-0.48, -15.37));
    });

    // --- the attack (off-screen: black frame + sound), then the dive
    ev(CINE.emergency, () => {
      g.audio.play('thump');
      g.cameraCtl.kick(1.4);
      const c = cast();
      c.captain.setMood('hurt');
      c.firstOfficer.place(0.48, F, SEAT_Z, 0);
      c.firstOfficer.setPose('pilot', true);
      c.firstOfficer.lookAt(null);
      c.firstOfficer.setMood('pushYoke');
      c.crew.setMood('crewHold');
      c.crew2.setMood('crewHold');
      // Staggered reactions through the cabin: nobody reacts at the same moment.
      const r = rng(7);
      for (const e of I().extras) {
        const p = r();
        e.setMood(p < 0.4 ? 'alarmed' : p < 0.75 ? 'worried' : 'confused', 0.2 + r() * 2.5);
      }
      for (const k of ['p1', 'p2', 'p3', 'p4', 'p5']) c[k].setMood(r() < 0.5 ? 'alarmed' : 'worried', 0.3 + r() * 2);
      c.player.setMood('confused', 0.8);
      c.helper.setMood('confused', 0.6);
    });
    ev(8.95, () => g.audio.play('apDisconnect'));
    ev(9.2, () => g.audio.play('alarm'));
    ev(11.6, () => g.audio.play('whoosh'));
    ev(12.2, () => g.audio.play('screams'));
    ev(16.0, () => {
      g.audio.play('gasp');
      const r = rng(19);
      for (const e of I().extras) if (r() < 0.4) e.setMood('alarmed', r() * 2);
    });

    // --- the cabin
    ev(20.6, () => {
      g.audio.play('commotion');
      g.audio.play('screams');
      cast().crew.lookAt(DOOR_POINT);
    });
    ev(21.6, () => {
      cast().crew2.setMood('gesture'); // "stay seated, heads down"
      g.audio.play('crewCall');
    });
    ev(22.6, () => I().standers[0]?.standInPlace(F));
    ev(23.4, () => I().standers[1]?.standInPlace(F));
    ev(24.2, () => g.audio.play('gasp'));
    // The second crew member moves up the aisle to mid-cabin, then follows the rush forward.
    ev(24.8, () => {
      const c = cast().crew2;
      c.setMood('resolve');
      c.walkTo([[0, -4.0]], F, 1.2, (ch) => {
        ch.yawTarget = 0;
        ch.setMood('crewHold');
        ch.lookAt(DOOR_POINT);
      });
    });
    ev(34.4, () => {
      const c = cast().crew2;
      c.lookAt(null);
      c.setMood('resolve');
      c.walkTo([[0, -12.2], [-0.7, -13.9]], F, 1.8, (ch) => {
        ch.faceToward(0, BULKHEAD_Z - 0.6);
        ch.setMood('crewHold');
      });
    });
    ev(25.4, () => {
      g.audio.play('screams');
      const r = rng(31);
      for (const e of I().extras) if (e.row < 9 && r() < 0.5) e.setMood(r() < 0.6 ? 'alarmed' : 'worried', r() * 1.2);
    });
    ev(26.0, () => I().standers[2]?.standInPlace(F));
    // Cabin crew at the locked door.
    ev(27.9, () => {
      const c = cast().crew;
      c.lookAt(null);
      c.walkTo([[-0.25, -13.75]], F, 1.4, (ch) => {
        ch.yawTarget = 0;
        ch.setMood('knock');
        g.audio.play('pounding');
      });
    });
    // Inside (unseen): the injured captain gets to the door.
    ev(28.9, () => {
      const cap = cast().captain;
      cap.place(0.55, F, -14.55, 2.07); // facing the door
      cap.setPose('stand', true);
      cap.setMood('hurt');
    });
    ev(DOOR_OPEN - 0.3, () => g.audio.play('doorUnlock'));
    ev(DOOR_OPEN, () => {
      g.audio.play('door');
      g.cameraCtl.kick(0.3);
      const c = cast().crew;
      c.setMood('crewHold');
      c.walkTo([[-0.6, -13.5]], F, 1.2, (ch) => ch.faceToward(0, -14.3));
    });
    ev(30.0, () => {
      const cap = cast().captain;
      cap.walkTo([[0.15, -14.3, 0.7], [0.2, -13.9, 0.7], [0.85, -13.55, 0.7]], F, 0.7, (ch) => {
        ch.sitAt(CAPTAIN_REST[0], CAPTAIN_REST[1], Math.PI / 2, 'floorSit', 0.9);
      });
      g.audio.play('gasp');
      const r = rng(43);
      for (const e of I().extras) {
        if (e.row <= 12) {
          e.setMood('alarmed', r() * 1.2);
          if (r() < 0.6) e.lookAt(DOOR_POINT);
        }
      }
    });
    ev(32.2, () => {
      const c = cast().crew;
      const [cx, cz] = CAPTAIN_REST;
      c.walkTo([[0.78, -13.02]], F, 1.0, (ch) => {
        ch.faceToward(cx, cz);
        ch.setPose('kneel');
        ch.setMood('tend');
        ch.lookAt(V(cx, F + 0.75, cz));
      });
    });

    // --- the rush: two off-duty pilots, then passengers
    ev(32.6, () => {
      const c = cast();
      for (const k of ['player', 'helper', 'p1', 'p2']) {
        c[k].lookAt(DOOR_POINT);
        c[k].setMood('helpful');
      }
      for (const k of ['p3', 'p4', 'p5']) c[k].setMood('alarmed');
    });
    const rush = (key, t, path, speed = 1.8) => ev(t, () => {
      const ch = cast()[key];
      ch.lookAt(null);
      ch.setMood('resolve');
      ch.leaveSeat(path, F, speed, (c) => {
        c.yawTarget = 0;
        c.setMood('restrain');
      });
    });
    rush('helper', 33.0, [[0, -12.2], [0, -14.05], [0.5, -14.55]]);
    rush('player', 33.3, [[0, -12.2], [0, -14.05], [0, -14.5]]);
    rush('p1', 33.7, [[0, -12.2], [0, -14.05], [0.95, -14.5]]);
    rush('p2', 34.1, [[0, -12.2], [0, -13.95]]);
    ev(34.0, () => {
      const c = cast();
      c.p3.standInPlace(F);
      c.p5.standInPlace(F);
      g.audio.play('footsteps');
    });
    ev(36.4, () => g.audio.play('struggle'));
    ev(36.9, () => g.audio.play('commotion'));

    // --- 05:3x: the co-pilot is pinned to the floor (behind the pilot seats)
    ev(CINE.transfer, () => {
      const c = cast();
      c.firstOfficer.lieProne(1.15, F, -14.8, Math.PI / 2);
      c.firstOfficer.setMood('calm');
      const kneel = (ch, x, z) => {
        ch.place(x, F, z, 0);
        ch.setPose('kneel', true);
        ch.setMood('restrain');
      };
      kneel(c.player, -0.02, -14.78);
      kneel(c.helper, 0.5, -14.78);
      kneel(c.p1, 1.0, -14.76);
      c.p2.place(0.05, F, -14.05, 0);
      c.p2.setPose('stand', true);
      c.p2.setMood('restrain');
      c.crew2.place(-0.4, F, -13.75, -0.3);
      c.crew2.setPose('stand', true);
      c.crew2.setMood('crewHold');
      c.crew2.lookAt(V(0.4, F + 0.5, -14.8));
      const r = rng(59);
      for (const e of I().extras) {
        e.lookAt(r() < 0.5 ? DOOR_POINT : null);
        e.setMood(r() < 0.7 ? 'worried' : 'confused', r() * 2);
      }
    });
    ev(38.6, () => g.audio.play('struggle'));

    // --- 05:33: the pilots travelling on board take the seats
    ev(40.6, () => {
      this.layoutAfterTakeover();
      const c = cast();
      c.helper.place(0.02, F, -14.95, 0);
      c.helper.setPose('stand', true);
      c.helper.sitAt(0.48, SEAT_Z, 0, 'pilot', 0.7);
      c.player.place(0, F, -14.3, 0);
      c.player.setPose('stand', true);
      c.player.setMood('resolve');
    });
    ev(40.9, () => {
      cast().player.walkTo([[0, PILOT_LANE]], F, 1.0, (c) => c.sitAt(-0.48, SEAT_Z, 0, 'pilot'));
    });
    ev(DOOR_CLOSE, () => g.audio.play('door'));
    ev(44.75, () => cast().player.setVisible(false));
    ev(CINE.takeControl, () => g.onTakeControlCue());
  }

  // --- per frame ------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const T = this.time;
    for (const e of this.events) {
      if (!this.fired.has(e) && T >= e.t) {
        this.fired.add(e);
        e.fn();
      }
    }

    // Flight-deck door: opened by the captain, swung shut once both seats are taken.
    g.interior.setDoorOpen(ease(clamp((T - DOOR_OPEN) / 1.0, 0, 1)) * (1 - ease(clamp((T - DOOR_CLOSE) / 0.9, 0, 1))));
    g.interior.setAgitation(keyAt(AGITATION, T).value);
    g.interior.update(dt, g.renderer.overlayCamera.position);
    const head = g.interior.cast.player.bones.neck;
    head.updateMatrixWorld(true);
    head.getWorldPosition(this.ctx.playerHead);
    this.ctx.playerHead.y += 0.15;

    // Camera
    const shot = SHOTS.find((s) => T >= s.from && T < s.to) || SHOTS[SHOTS.length - 1];
    const u = clamp((T - shot.from) / (shot.to - shot.from), 0, 1);
    let fov = shot.fov ?? g.settings.get('fov');
    let pos;
    let quat = tmpQ;
    if (shot.cockpit) {
      pos = EYE;
      quat = COCKPIT_QUAT;
      fov = g.settings.get('fov');
    } else if (shot.seat) {
      if (this.seatShot !== shot) {
        // Capture the pose we are blending from.
        this.seatShot = shot;
        const prev = SHOTS[SHOTS.indexOf(shot) - 1];
        const p = prev.pose(1, this.ctx);
        this.seatStart.pos.copy(p.pos);
        if (p.quat) this.seatStart.quat.copy(p.quat);
        else lookQuat(p.pos, p.target, this.seatStart.quat);
        this.seatStart.fov = prev.fov;
      }
      const k = ease(u);
      pos = tmpV.copy(this.seatStart.pos).lerp(EYE, k);
      quat = tmpQ.copy(this.seatStart.quat).slerp(COCKPIT_QUAT, k);
      fov = lerp(this.seatStart.fov, g.settings.get('fov'), k);
    } else {
      const p = shot.pose(u, this.ctx);
      pos = p.pos;
      quat = p.quat ?? lookQuat(p.pos, p.target, tmpQ2);
    }
    if (Math.abs(fov - this.currentFov) > 0.05) {
      this.currentFov = fov;
      g.renderer.setFov(fov);
    }
    const shake = (shot.shake ?? 0) * (T >= CINE.emergency ? 1 : 0);
    g.cameraCtl.setCinematicPose(shot.interior, shot.frame || 'aircraft', pos, quat, shake);

    // Sound mix: cabin ambience when the camera is in the cabin, a little through the door.
    this.mix.cabin = shot.cabin ? 1 : shot.interior ? 0.3 : 0.05;
    this.mix.panic = keyAt(PANIC, T).value;
    this.mix.emergency = keyAt(RUMBLE, T).value;

    // Overlay: letterbox, captions, altitude ticker, fades.
    const cap = CAPTIONS.find(([a, b]) => T >= a && T < b);
    g.overlay.setCaption(cap ? cap[2] : '', cap?.[3]);
    const showAlt = T < 4.4 || (T >= CINE.emergency + 0.35 && T < CINE.takeControl - 1.2);
    // Vertical speed only outside: the exterior descent is time-lapsed.
    g.overlay.setAltitude(showAlt ? mslFeet(g.fm.pos.y) : null, shot.interior ? 0 : g.tele.vsFpm);
    const fadeOut = clamp((T - 4.7) / 0.4, 0, 1) * (T < 5.1 ? 1 : 0);
    const fadeIn = T >= 5.1 && T < 5.5 ? 1 - (T - 5.1) / 0.4 : 0;
    g.overlay.setFade(shot.black ? 1 : Math.max(fadeOut, fadeIn));
    g.overlay.setLetterbox(T < CINE.takeControl - 0.6);
  }
}
