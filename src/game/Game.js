// Game orchestrator. Owns every subsystem and drives them from one
// requestAnimationFrame loop through an explicit state machine:
//
//   MENU -> CINEMATIC_INTRO -> EMERGENCY -> CONTROL_TRANSFER
//        -> RECOVERY -> DIVERSION -> APPROACH -> LANDING -> RESULT   (+ PAUSED)
//
// Systems stay separate: input, physics, camera, world, cinematic, HUD,
// audio, scoring, mission and rewards each live in their own module.

import * as THREE from 'three';
import { DEG, RAD, angleDiffDeg, clamp } from '../core/MathUtil.js';
import { Settings } from '../core/Settings.js';
import { Renderer } from '../core/Renderer.js';
import { Input } from '../core/Input.js';
import { Loop } from '../core/Loop.js';
import { CINEMATIC_STATES, FLIGHT_STATES, STATE, StateMachine } from '../core/StateMachine.js';
import { PerfMonitor } from '../core/Perf.js';
import { World } from '../world/World.js';
import {
  RUNWAY, alongTrack, gsDeviationDeg, locDeviationDeg, mslFeet, toDisplayHeading,
} from '../world/Route.js';
import { AircraftModel } from '../aircraft/AircraftModel.js';
import { Cockpit } from '../aircraft/Cockpit.js';
import { Interior } from '../aircraft/Interior.js';
import { FlightModel, MS_TO_KT } from '../physics/FlightModel.js';
import { Atmosphere } from '../physics/Atmosphere.js';
import { displayFeet, feetPerMeter } from '../physics/AltitudeScale.js';
import { Mission, PHASE } from './Mission.js';
import { Scoring } from './Scoring.js';
import { Warnings } from './Warnings.js';
import { CameraController } from './CameraController.js';
import { Cinematic, CINE } from './Cinematic.js';
import { SmokePool } from './Particles.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Callouts } from '../audio/Callouts.js';
import { RewardsService } from '../rewards/RewardsService.js';
import { GameWallet } from '../wallet/GameWallet.js';
import { OnlineService } from '../online/OnlineService.js';
import { HUD } from '../ui/HUD.js';
import { Screens } from '../ui/Screens.js';
import { CinematicOverlay } from '../ui/CinematicOverlay.js';

const WARNING_CALLOUTS = {
  'stall:critical': 'Stall, stall',
  'sink:critical': 'Pull up',
  'sink:caution': 'Sink rate',
  'overspeed:critical': 'Overspeed',
  'bank:caution': 'Bank angle',
  'terrain:critical': 'Too low, terrain',
  'gear:critical': 'Too low, gear',
  'flaps:caution': 'Too low, flaps',
  'gs:caution': 'Glide slope',
  'lowspeed:critical': 'Speed, speed',
};

const PHASE_TO_STATE = {
  [PHASE.RECOVERY]: STATE.RECOVERY,
  [PHASE.DIVERSION]: STATE.DIVERSION,
  [PHASE.APPROACH]: STATE.APPROACH,
  [PHASE.LANDING]: STATE.LANDING,
};

export class Game {
  constructor(container, uiRoot) {
    this.settings = new Settings();
    this.renderer = new Renderer(container, this.settings);
    this.input = new Input();
    this.input.invertPitch = this.settings.get('invertPitch');

    this.world = new World(this.renderer, this.settings.get('quality'));
    this.aircraft = new AircraftModel();
    this.renderer.scene.add(this.aircraft.group);
    this.world.airport.addParkedAircraft(this.aircraft.createStaticGeometry(), this.aircraft.material);
    this.cockpit = new Cockpit(this.renderer.overlayScene);
    this.interior = new Interior(this.renderer.overlayScene);

    this.fm = new FlightModel();
    this.menuFm = new FlightModel();
    this.atm = new Atmosphere();
    this.warnings = new Warnings();
    this.audio = new AudioEngine(this.settings);
    this.callouts = new Callouts(this.settings);
    this.rewards = new RewardsService();
    this.wallet = new GameWallet(); // reward wallet: the server pays out SOL (devnet) for safe landings
    this.online = new OnlineService(); // pilot names + live leaderboard (server/index.mjs)
    this.wallet.attach(this.online); // signed-in pilots keep their wallet on the server
    this.cameraCtl = new CameraController(this.renderer, this.aircraft);
    this.smoke = new SmokePool(this.renderer.scene);

    this.hud = new HUD(uiRoot, this);
    this.overlay = new CinematicOverlay(uiRoot);
    this.screens = new Screens(uiRoot, this);
    this.scoring = new Scoring((t) => this.hud.toast(t));
    this.mission = new Mission({
      phase: (name) => this.onPhase(name),
      stage: () => this.hud.setPhaseTitle(),
      banner: (title, sub) => this.hud.banner(title, sub),
      toast: (t) => this.hud.toast(t),
      callout: (text) => this.callouts.say(text, { cooldown: 1 }),
      fail: (reason, kind) => this.endFlight(false, { reason, kind }),
      touchdown: (r) => this.onTouchdown(r),
      complete: (summary) => this.endFlight(true, summary),
    });
    this.perf = new PerfMonitor(this.renderer, this.settings);

    this.tele = {
      x: 0, y: 0, z: 0, altFt: 0, vsFpm: 0, speedKt: 0, hdg: 0, pitchDeg: 0, bankDeg: 0,
      aglM: 0, aglFt: 0, alongTrack: 0, gsDev: 0, locDev: 0, hdgErr: 0, distFromAirport: 0,
      surface: 'land', n1: 0, throttle: 0, gearPos: 0, gearCmd: false,
      flapsCmd: 0, flapsPos: 0, spoilers: 0, stalled: false, gLoad: 1, phase: 0,
      phaseName: '', targets: null, navName: '', navDistNm: 0, wpIndex: 0,
    };
    const terrain = this.world.terrain;
    this.env = {
      pitchRate: 0, rollRate: 0, vertical: 0, windX: 0, windZ: 0,
      groundHeight: (x, z) => terrain.height(x, z),
      surfaceAt: (x, z) => terrain.surfaceAt(x, z),
    };
    this.cinematic = new Cinematic(this);
    this.ctrl = { pitch: 0, roll: 0, yaw: 0, brake: false };
    this.flightMix = { cabin: 0, panic: 0, emergency: 0 };
    this.cameraMode = 'cockpit';
    this.cloudFactor = 0;
    this.ended = false;
    this.endTimer = 0;
    this.pendingResult = null;
    this.menuTime = 0;
    this.skipHold = 0;
    this.playsThisSession = 0;

    this.sm = new StateMachine(STATE.MENU, (from, to, data) => this.onState(from, to, data));
    this.cameraCtl.onModeChange = (interior) => {
      this.interior.shell.visible = interior;
    };

    this.renderer.setFov(this.settings.get('fov'));
    this.settings.onChange((k) => this.onSetting(k));
    this.renderer.resizeListeners.add(() => this.onResize());
    this.onResize();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.sm.inFlight || this.sm.inCinematic)) this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && !e.repeat && this.screens.current === 'pay') {
        this.screens.confirmPay();
        return;
      }
      if (e.code === 'Enter' && !e.repeat && this.sm.is(STATE.MENU, STATE.RESULT) &&
        (this.screens.current === 'menu' || this.screens.current === 'results')) {
        this.startFlight();
      }
    });

    this.enterMenu();
    // Online: check the service, then ask new players for a pilot name.
    this.online.init().then((status) => {
      if (status === 'online' && !this.online.registered && this.sm.is(STATE.MENU) && this.screens.current === 'menu') this.screens.show('signin');
      else if (this.screens.current === 'menu') this.screens.renderLiveCard();
    });
    this.loop = new Loop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      update: (dt) => this.update(dt),
      // The home page is a full banner: skip the 3D scene behind it.
      render: () => {
        if (!this.sm.is(STATE.MENU)) this.renderer.render();
      },
    });
    this.loop.start();
    if (import.meta.env.DEV) window.__sky = this; // debugging handle (development only)
  }

  // --- settings ------------------------------------------------------------------------
  onSetting(key) {
    const s = this.settings;
    if (key === 'quality') {
      this.renderer.setQuality(s.get('quality'));
      this.world.setQuality(s.get('quality'));
    } else if (key === 'fov' && !this.sm.inCinematic) this.renderer.setFov(s.get('fov'));
    else if (key === 'invertPitch') this.input.invertPitch = s.get('invertPitch');
    else if (key === 'showControls') this.hud.applyControlsVisible(s.get('showControls'));
    else if (key === 'voice' && !s.get('voice')) this.callouts.cancel();
  }

  onResize() {
    const ppu = this.renderer.pixelsPerUnit;
    this.world.airport.setLightScale(ppu);
    this.aircraft.setLightScale(ppu);
    this.smoke.setScale(ppu);
  }

  // --- flow ----------------------------------------------------------------------------
  /** Full reset of everything a flight touches — used by Play, Play Again and Try Again. */
  resetFlight() {
    this.atm.reset();
    this.mission.reset();
    this.scoring.reset();
    this.warnings.reset();
    this.smoke.clear();
    this.world.guide.reset();
    this.hud.reset();
    this.callouts.cancel();
    this.input.clear();
    this.cameraCtl.reset();
    this.ended = false;
    this.endTimer = 0;
    this.pendingResult = null;
    this.cloudFactor = 0;
    this.skipHold = 0;
  }

  /** Every attempt starts with the boarding screen. */
  startFlight() {
    this.audio.init();
    // With the online service up, rewards are kept on a pilot account: a name comes first.
    if (this.online.status === 'online' && !this.online.registered) {
      this.screens.show('signin', { required: true });
      return;
    }
    this.screens.show('pay');
  }

  /** Boarded: run the scenario from the cinematic. */
  launchFlight() {
    this.audio.init();
    this.resetFlight();
    this.canSkip = this.playsThisSession > 0 || this.rewards.profile.flights.length > 0;
    this.playsThisSession++;
    this.sm.go(STATE.CINEMATIC_INTRO, { fresh: true });
  }

  toMenu() {
    if (this.sm.is(STATE.MENU)) return;
    this.sm.go(STATE.MENU);
  }

  pause() {
    if (!(this.sm.inFlight || this.sm.inCinematic) || this.ended) return;
    this.sm.go(STATE.PAUSED);
  }

  resume() {
    if (!this.sm.is(STATE.PAUSED)) return;
    this.sm.go(this.sm.previous);
  }

  enterMenu() {
    this.cinematic.stop();
    this.hud.hide();
    this.screens.show('menu');
    this.audio.stopLoops();
    this.callouts.cancel();
    this.renderer.setFov(this.settings.get('fov'));
    this.cameraCtl.setMode('orbit');
    this.aircraft.setVisible(true);
    this.menuFm.reset({ x: 9000, y: 2900, z: 30000, speed: 140, gamma: 0, pitch: 2 * DEG, bank: 0, heading: 0, throttle: 0.55 });
  }

  onState(from, to, data) {
    if (to === STATE.MENU) {
      this.enterMenu();
      return;
    }
    if (to === STATE.CINEMATIC_INTRO && data?.fresh) {
      this.screens.hideAll();
      this.hud.hide();
      this.audio.stopLoops();
      this.audio.startLoops();
      this.cinematic.start();
      return;
    }
    if (to === STATE.PAUSED) {
      this.screens.show('pause');
      this.callouts.cancel();
      this.input.clear();
      return;
    }
    if (from === STATE.PAUSED) {
      this.screens.hideAll();
      return;
    }
    if (to === STATE.RECOVERY && from === STATE.CONTROL_TRANSFER) {
      this.beginGameplay();
      return;
    }
    if (to === STATE.RESULT) {
      this.hud.hide();
      this.audio.stopLoops();
      this.screens.show('results', this.pendingResult);
    }
  }

  /** The cinematic camera has arrived in the cockpit: hand control to the player. */
  beginGameplay() {
    this.cinematic.stop();
    this.renderer.setFov(this.settings.get('fov'));
    this.cameraCtl.setMode(this.cameraMode);
    this.warnings.reset(); // envelope timers from the scripted dive don't count against the player
    this.atm.seed = 1 + Math.floor(Math.random() * 1000); // cinematic is deterministic; gameplay turbulence varies
    this.mission.configureAtmosphere(this.atm);
    this.hud.show();
    this.hud.setPhaseTitle();
  }

  onTakeControlCue() {
    this.hud.show();
    this.hud.banner('TAKE CONTROL', 'Stabilize the aircraft', 3.2, 'big');
    this.audio.play('takeControl');
  }

  onPhase(name) {
    this.hud.setPhaseTitle();
    this.audio.play('phase');
    const target = PHASE_TO_STATE[name];
    if (target && this.sm.inFlight) this.sm.go(target);
  }

  onTouchdown(r) {
    const hard = r.sink > 600;
    this.audio.play(hard ? 'hard' : 'touchdown');
    this.cameraCtl.kick(hard ? 1 : 0.35);
    this.hud.touchdown(r);
    const g = this.aircraft.group;
    for (const side of [-1, 1]) {
      const p = new THREE.Vector3(side * 3.6, 0.3, 1.2).applyMatrix4(g.matrixWorld);
      this.smoke.emit(p.x, p.y, p.z, 7, { spread: 1.5, up: 0.6, speed: 2, size: 3, life: 1.8, grow: 4, color: 0xe6e8ea });
    }
  }

  endFlight(success, info) {
    if (this.ended) return;
    this.ended = true;
    const crash = !success && info.kind === 'crash';
    if (crash) {
      this.fm.frozen = true;
      this.audio.play('crash');
      this.hud.flash('#ffffff', 1);
      this.cameraCtl.kick(1.5);
      const p = this.fm.pos;
      this.smoke.emit(p.x, p.y + 2, p.z, 40, { spread: 14, up: 6, speed: 8, size: 14, life: 4.5, grow: 10, color: 0x6a6056 });
      if (this.cameraMode === 'cockpit') this.cameraCtl.setMode('chase');
    } else if (!success) {
      this.fm.frozen = true;
      this.audio.play('fail');
    } else {
      this.audio.play('success');
      this.callouts.say('Flight secured', { cooldown: 0 });
    }
    if (!success) this.mission.finishApproachGrade(this.scoring);
    this.endTimer = success ? 1.6 : crash ? 2.2 : 1.2;

    const score = this.scoring.score;
    const grade = success ? this.mission.touchdown?.grade || 'SAFE LANDING' : null;
    const sink = success ? this.mission.touchdown?.sink : null;
    // Signed in: the server decides the reward when the result is recorded (below). Otherwise there is none.
    const serverWallet = this.wallet.remote && !!this.online.flightId;
    const sub = this.rewards.submitFlight({ success, score, grade, time: this.mission.time, sink }, this.scoring.awards);
    this.pendingResult = {
      success,
      grade,
      score,
      reason: info.reason || '',
      time: this.mission.time,
      goArounds: this.mission.goArounds,
      sol: { reward: 0, balance: this.wallet.balance, pending: serverWallet, none: !serverWallet },
      online: undefined,
      breakdown: this.scoring.breakdown(),
      penalties: Math.round(this.scoring.penalties),
      awards: sub.awards,
      fpEarned: sub.fpEarned,
      fpTotal: sub.profile.fp,
      best: sub.profile.best,
      newBest: sub.newBest,
      touchdown: this.mission.touchdown,
    };
    // Report to the live leaderboard (pilots with a name only).
    const report = this.pendingResult;
    this.online.finishFlight({ success, sink: sink ?? null, grade: grade || null, fp: sub.fpEarned }).then((res) => {
      report.online = res;
      if (serverWallet) {
        if (res?.wallet) this.wallet.adopt(res.wallet);
        report.sol = { reward: res?.reward || 0, balance: this.wallet.balance, pending: true, failed: !res, note: res?.rewardNote || '' };
      }
      if (this.screens.current === 'results') this.screens.updateResultRank(report);
    });
  }

  // --- loop ------------------------------------------------------------------------------
  fixedUpdate(dt) {
    if (this.sm.inCinematic) {
      if (!this.cinematic.done && !this.cinematic.debugFreeze) this.cinematic.tick(this.fm, this.atm, this.env);
      return;
    }
    if (!this.sm.inFlight || this.fm.frozen) return;
    const fm = this.fm;
    this.atm.update(dt, fm.pos.y, this.cloudFactor > 0.05);
    const env = this.env;
    env.pitchRate = this.atm.pitchRate;
    env.rollRate = this.atm.rollRate;
    env.vertical = fm.onGround ? 0 : this.atm.vertical;
    env.windX = this.atm.windX;
    env.windZ = this.atm.windZ;
    const c = this.ctrl;
    c.pitch = this.input.pitch;
    c.roll = this.input.roll;
    c.yaw = this.input.yaw;
    c.brake = this.input.brake;
    fm.step(dt, c, env);

    if (fm.events.length) {
      for (const ev of fm.events) {
        if (ev.type === 'contact') {
          this.aircraft.sync(fm, 0);
          this.aircraft.group.updateMatrixWorld();
          this.mission.onContact(ev, fm, this.scoring, this.atm);
        }
      }
      fm.events.length = 0;
    }
  }

  handleActions() {
    const flying = this.sm.inFlight && !this.ended;
    for (const a of this.input.consume()) {
      switch (a) {
        case 'pause':
          if (this.sm.is(STATE.PAUSED)) {
            if (!this.screens.back()) this.resume();
          } else if (this.sm.inFlight || this.sm.inCinematic) this.pause();
          else this.screens.back();
          break;
        case 'camera':
          if (flying) {
            this.cameraMode = this.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
            this.cameraCtl.setMode(this.cameraMode);
          }
          break;
        case 'gear':
          if (flying && !this.fm.onGround) {
            this.fm.toggleGear();
            this.audio.play('gear');
          }
          break;
        case 'flapsDown':
          if (flying && this.fm.flapsDown()) this.audio.play('flaps');
          break;
        case 'flapsUp':
          if (flying && this.fm.flapsUp()) this.audio.play('flaps');
          break;
        case 'help':
          this.hud.toggleControls();
          break;
        case 'mute':
          this.audio.toggleMute();
          break;
        default:
          break;
      }
    }
  }

  computeTelemetry() {
    const fm = this.fm;
    const t = this.tele;
    const terrain = this.world.terrain;
    t.x = fm.pos.x;
    t.y = fm.pos.y;
    t.z = fm.pos.z;
    t.altFt = mslFeet(fm.pos.y);
    t.vsFpm = fm.vy * feetPerMeter(fm.pos.y - 4) * 60;
    t.speedKt = fm.V * MS_TO_KT;
    t.hdg = toDisplayHeading(fm.psi);
    t.pitchDeg = fm.theta * RAD;
    t.bankDeg = fm.phi * RAD;
    const gh = terrain.height(fm.pos.x, fm.pos.z);
    t.aglM = fm.pos.y - gh;
    t.aglFt = displayFeet(fm.pos.y - 4) - displayFeet(gh - 4);
    t.alongTrack = alongTrack(fm.pos.z);
    t.gsDev = gsDeviationDeg(fm.pos.y, fm.pos.z);
    t.locDev = locDeviationDeg(fm.pos.x, fm.pos.z);
    t.hdgErr = angleDiffDeg(t.hdg, RUNWAY.heading);
    t.distFromAirport = Math.hypot(fm.pos.x, fm.pos.z);
    t.surface = fm.onGround ? terrain.surfaceAt(fm.pos.x, fm.pos.z) : 'air';
    t.n1 = fm.n1;
    t.throttle = fm.throttle;
    t.gearPos = fm.gearPos;
    t.gearCmd = fm.gearCmd;
    t.flapsCmd = fm.flapsCmd;
    t.flapsPos = fm.flapsPos;
    t.spoilers = fm.spoilers;
    t.stalled = fm.stalled;
    t.gLoad = fm.gLoad;
    const inCine = this.sm.inCinematic;
    t.phase = inCine ? 0 : this.mission.phaseIndex;
    t.phaseName = inCine ? 'EMERGENCY' : this.mission.guide.title;
    t.targets = this.mission.targets;
  }

  update(dt) {
    this.perf.update(dt);
    this.handleActions();
    const state = this.sm.current;
    const fm = this.fm;
    const inCine = this.sm.inCinematic;
    const inFlight = this.sm.inFlight;

    if (state === STATE.MENU) {
      this.updateMenu(dt);
    } else if (inCine) {
      this.computeTelemetry();
      this.warnings.evaluate(dt, this.tele, 0, fm);
      for (const w of this.warnings.started) {
        const line = WARNING_CALLOUTS[`${w.id}:${w.level}`];
        if (line && this.cinematic.time > CINE.emergency) this.callouts.say(line, { cooldown: 5 });
      }
      this.updateSkip(dt);
      this.cinematic.update(dt);
      // Walk the cinematic states in order (a skip may jump several at once).
      const target = CINEMATIC_STATES.indexOf(this.cinematic.stateLabel);
      for (let i = CINEMATIC_STATES.indexOf(this.sm.current) + 1; i <= target; i++) this.sm.go(CINEMATIC_STATES[i]);
      if (this.cinematic.done) this.sm.go(STATE.RECOVERY);
    } else if (inFlight) {
      if (!this.ended) {
        const delta = this.input.throttleDelta * 0.45 * dt + this.input.takeWheel() * 0.05;
        if (delta) fm.setThrottle(fm.throttle + delta);
      }
      this.computeTelemetry();
      if (!this.ended) {
        this.warnings.evaluate(dt, this.tele, this.mission.phaseIndex, fm);
        this.mission.update(dt, fm, this.tele, this.scoring, this.warnings, this.atm);
        for (const w of this.warnings.started) {
          const line = WARNING_CALLOUTS[`${w.id}:${w.level}`];
          if (line) this.callouts.say(line, { interrupt: w.level === 'critical', cooldown: 4 });
          if (w.level === 'caution') this.audio.play('caution');
        }
      }
      this.world.guide.update(dt, this.settings.get('guides') && this.mission.phaseIndex >= 3, this.tele.alongTrack);
      if (this.ended) {
        this.endTimer -= dt;
        if (this.endTimer <= 0 && this.pendingResult) this.sm.go(STATE.RESULT);
      }
    } else if (state === STATE.RESULT) {
      this.cameraCtl.setOrbit(fm.pos, 70, 16);
      if (this.cameraCtl.mode !== 'orbit') this.cameraCtl.setMode('orbit');
    }

    // --- visuals
    if (state !== STATE.MENU) this.aircraft.sync(fm, state === STATE.PAUSED ? 0 : dt);
    let shake = 0;
    if (inFlight && !fm.onGround) shake = this.atm.shake + (fm.stalled ? 0.8 : 0);
    else if (inFlight && fm.onGround && fm.V > 5) shake = 0.25;
    if (inFlight && this.mission.phase === PHASE.RECOVERY && this.mission.stage === 'regain') shake += this.mission.disturbance * 0.8;
    this.cameraCtl.update(state === STATE.PAUSED ? 0 : dt, state === STATE.MENU ? this.menuFm : fm, {
      shake,
      groundHeight: this.env.groundHeight,
    });
    const cam = this.renderer.camera;
    this.world.update(cam);
    const p = state === STATE.MENU ? this.menuFm.pos : fm.pos;
    this.world.airport.updatePapi(p.x, p.y, p.z);
    if (this.renderer.overlayVisible) {
      this.cockpit.updateLighting(this.world.sunDir, this.aircraft.group.quaternion);
      this.cockpit.update(dt, this.tele, this.warnings.active);
    }
    this.cloudFactor = this.world.clouds.insideFactor(cam.position.x, cam.position.y, cam.position.z);
    this.hud.setWhiteout(inFlight || inCine ? this.cloudFactor * (this.renderer.overlayVisible || inFlight ? 1 : 0.6) : 0);
    this.smoke.update(state === STATE.PAUSED ? 0 : dt);

    const warningActive = (inFlight && !this.ended) || (inCine && this.cinematic.time > CINE.emergency)
      ? this.warnings.hasCritical : false;
    // Sound mix: the cinematic directs it; in flight the emergency sounds fade
    // as the aircraft is brought back under control.
    let mix = this.cinematic.mix;
    if (inFlight) {
      const regain = this.mission.phase === PHASE.RECOVERY && this.mission.stage === 'regain';
      const d = regain ? this.mission.disturbance : 0;
      mix = this.flightMix;
      mix.emergency = d * 0.7;
      mix.panic = 0.15 + d * 0.3;
      mix.cabin = this.renderer.overlayVisible ? 0.12 + d * 0.15 : 0;
    } else if (!inCine) mix = this.flightMix;
    this.audio.update({
      n1: fm.n1,
      speed: fm.V,
      cockpit: this.renderer.overlayVisible,
      paused: state === STATE.PAUSED || this.ended,
      warningActive,
      cabin: mix.cabin,
      panic: mix.panic,
      emergency: mix.emergency,
      rolling: inFlight && fm.onGround ? fm.V : 0,
      braking: inFlight && fm.onGround && fm.braking && fm.V > 1,
    });
    if (inCine && this.cinematic.time >= CINE.takeControl - 0.2) this.mission.updateNav(this.tele);
    if (inFlight || (inCine && this.cinematic.time >= CINE.takeControl - 0.2)) {
      this.hud.update(dt, this.tele, this.mission, this.scoring, this.warnings, fm);
    }
  }

  /** Hold SPACE to skip the cinematic (only after it has been seen once). */
  updateSkip(dt) {
    const visible = this.canSkip && this.cinematic.time > 1.5 && this.cinematic.time < CINE.takeControl - 1;
    if (visible && this.input.has('Space')) this.skipHold += dt;
    else this.skipHold = Math.max(0, this.skipHold - dt * 2);
    this.overlay.setSkip(visible, Math.min(1, this.skipHold / 1.2));
    if (this.skipHold >= 1.2) {
      this.skipHold = 0;
      this.overlay.setSkip(false, 0);
      this.cinematic.skip();
    }
  }

  /** Menu background: the airliner cruises above the desert while the camera orbits. */
  updateMenu(dt) {
    this.menuTime += dt;
    const m = this.menuFm;
    const a = this.menuTime * 0.018;
    const R = 7000;
    m.pos.set(9000 + Math.sin(a) * R, 2900 + Math.sin(this.menuTime * 0.3) * 4, 30000 - Math.cos(a) * R);
    m.psi = a + Math.PI / 2;
    m.phi = 10 * DEG;
    m.theta = 2 * DEG;
    m.n1 = 0.55;
    this.aircraft.sync(m, dt);
    this.cameraCtl.setOrbit(m.pos, 58, 9);
  }
}

export { clamp, CINEMATIC_STATES, FLIGHT_STATES };
