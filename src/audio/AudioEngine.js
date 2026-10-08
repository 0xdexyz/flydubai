// Procedural audio with the Web Audio API — zero audio files.
// Continuous loops (engine rumble, turbine whine, jet roar, wind) are
// modulated by throttle and airspeed. A cabin layer (air hiss, indistinct
// passenger murmur, an agitated "panic" murmur), an emergency rumble /
// vibration layer and runway roll + brake loops are mixed by the game.
// One-shot effects are short synthesized envelopes. Voices are always
// indistinct: no words. The AudioContext is created on the first user gesture.

import { clamp } from '../core/MathUtil.js';

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.loops = null;
    this.muted = false;
    this.lastWarning = 0;
    settings.onChange((k) => {
      if (k === 'volume') this.applyVolume();
    });
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.applyVolume();
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  applyVolume() {
    if (!this.master) return;
    const v = this.muted ? 0 : this.settings.get('volume');
    this.master.gain.setTargetAtTime(v * 0.9, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyVolume();
    return this.muted;
  }

  noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  startLoops() {
    if (!this.ctx || this.loops) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(this.master);

    const mk = (type, freq) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      return o;
    };
    const gain = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type, freq, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };

    const o1 = mk('sawtooth', 48);
    const o2 = mk('sawtooth', 48.7);
    const engLp = filter('lowpass', 260);
    const engGain = gain(0.1);
    o1.connect(engLp);
    o2.connect(engLp);
    engLp.connect(engGain).connect(bus);

    const whine = mk('sine', 1600);
    const whineGain = gain(0.01);
    whine.connect(whineGain).connect(bus);

    const roar = this.noiseSource();
    const roarFilter = filter('bandpass', 450, 0.6);
    const roarGain = gain(0.05);
    roar.connect(roarFilter).connect(roarGain).connect(bus);

    const wind = this.noiseSource();
    const windFilter = filter('bandpass', 900, 0.4);
    const windGain = gain(0.03);
    wind.connect(windFilter).connect(windGain).connect(bus);

    // Cabin: air-conditioning hiss + two murmur layers whose loudness is
    // modulated by slow and fast LFOs (conversation-like, never words).
    const lfo = (freq, depth, target) => {
      const o = mk('sine', freq);
      const g = gain(depth);
      o.connect(g).connect(target);
      return o;
    };
    const hiss = this.noiseSource();
    const hissGain = gain(0);
    hiss.connect(filter('lowpass', 1500)).connect(hissGain).connect(bus);
    const murmur = this.noiseSource();
    const murmurAm = gain(0.5);
    const murmurGain = gain(0);
    murmur.connect(filter('bandpass', 420, 1.3)).connect(murmurAm).connect(murmurGain).connect(bus);
    const panic = this.noiseSource();
    const panicAm = gain(0.45);
    const panicGain = gain(0);
    panic.connect(filter('bandpass', 980, 2.2)).connect(panicAm).connect(panicGain).connect(bus);
    const lfos = [lfo(3.1, 0.35, murmurAm.gain), lfo(0.37, 0.15, murmurAm.gain), lfo(6.7, 0.35, panicAm.gain), lfo(2.3, 0.2, panicAm.gain)];
    // Emergency: low airframe rumble with a buffeting tremor.
    const rumbleOsc = mk('sine', 33);
    const rumbleNoise = this.noiseSource();
    const rumbleAm = gain(0.7);
    const rumbleGain = gain(0);
    rumbleOsc.connect(rumbleAm);
    rumbleNoise.connect(filter('lowpass', 140)).connect(rumbleAm);
    rumbleAm.connect(rumbleGain).connect(bus);
    lfos.push(lfo(8.5, 0.3, rumbleAm.gain));
    // Ground: runway roll and wheel brakes.
    const roll = this.noiseSource();
    const rollGain = gain(0);
    roll.connect(filter('lowpass', 320)).connect(rollGain).connect(bus);
    const brake = this.noiseSource();
    const brakeGain = gain(0);
    brake.connect(filter('bandpass', 2300, 3)).connect(brakeGain).connect(bus);

    const sources = [o1, o2, whine, roar, wind, hiss, murmur, panic, rumbleOsc, rumbleNoise, roll, brake, ...lfos];
    for (const s of sources) s.start(now);
    bus.gain.setTargetAtTime(1, now, 0.4);
    this.loops = {
      bus, sources, o1, o2, engLp, engGain, whine, whineGain, roarFilter, roarGain, windFilter, windGain,
      hissGain, murmurGain, panicGain, rumbleGain, rollGain, brakeGain,
    };
  }

  stopLoops() {
    if (!this.loops) return;
    const { bus, sources } = this.loops;
    const now = this.ctx.currentTime;
    bus.gain.setTargetAtTime(0, now, 0.08);
    for (const s of sources) s.stop(now + 0.5);
    setTimeout(() => bus.disconnect(), 700);
    this.loops = null;
  }

  /** @param s { n1, speed (m/s), cockpit, paused, warningActive, cabin, panic, emergency (0-1), rolling (m/s), braking } */
  update(s) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const L = this.loops;
    if (L) {
      const n1 = clamp(s.n1, 0, 1);
      const muffle = s.cockpit ? 0.6 : 1;
      L.bus.gain.setTargetAtTime(s.paused ? 0 : 1, now, 0.1);
      L.o1.frequency.setTargetAtTime(38 + n1 * 34, now, 0.3);
      L.o2.frequency.setTargetAtTime(38.6 + n1 * 34.8, now, 0.3);
      L.engLp.frequency.setTargetAtTime(180 + n1 * 420, now, 0.3);
      L.engGain.gain.setTargetAtTime((0.07 + n1 * 0.12) * muffle, now, 0.3);
      L.whine.frequency.setTargetAtTime(900 + n1 * 2300, now, 0.4);
      L.whineGain.gain.setTargetAtTime((0.004 + n1 * 0.016) * muffle, now, 0.3);
      L.roarFilter.frequency.setTargetAtTime(280 + n1 * 650, now, 0.3);
      L.roarGain.gain.setTargetAtTime((0.015 + n1 * 0.09) * muffle, now, 0.3);
      const w = clamp((s.speed - 30) / 150, 0, 1);
      L.windFilter.frequency.setTargetAtTime(400 + s.speed * 5, now, 0.3);
      const em = clamp(s.emergency ?? 0, 0, 1);
      L.windGain.gain.setTargetAtTime(w * (s.cockpit ? 0.07 : 0.12) + em * 0.05, now, 0.3);
      const cabin = clamp(s.cabin ?? 0, 0, 1);
      const panic = clamp(s.panic ?? 0, 0, 1);
      L.hissGain.gain.setTargetAtTime(cabin * 0.035, now, 0.5);
      L.murmurGain.gain.setTargetAtTime(cabin * (0.05 + panic * 0.05), now, 0.6);
      L.panicGain.gain.setTargetAtTime(cabin * panic * panic * 0.07, now, 0.5);
      L.rumbleGain.gain.setTargetAtTime(em * 0.16, now, 0.4);
      const rv = clamp((s.rolling ?? 0) / 70, 0, 1);
      L.rollGain.gain.setTargetAtTime(rv > 0.01 ? 0.03 + rv * 0.13 : 0, now, 0.08);
      L.brakeGain.gain.setTargetAtTime(s.braking ? 0.02 + rv * 0.05 : 0, now, 0.1);
    }
    // Master warning: repeating triple beep while a critical warning is active.
    if (s.warningActive && !s.paused && now - this.lastWarning > 0.62) {
      this.lastWarning = now;
      this.tone(1050, 0.09, { type: 'square', gain: 0.07 });
      this.tone(1050, 0.09, { type: 'square', gain: 0.07, delay: 0.16 });
    }
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, attack = 0.005, slideTo = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise(dur, { gain = 0.2, freq = 800, type = 'bandpass', q = 0.8, slideTo = null, delay = 0, attack = 0.01 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  /** Indistinct voice: a few vowel-like syllables (sawtooth through a formant filter). */
  voice(syllables, pitch, level = 0.06) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(f1).connect(f2).connect(g).connect(this.master);
    let t = t0;
    for (let i = 0; i < syllables; i++) {
      const d = 0.16 + Math.random() * 0.12;
      o.frequency.setValueAtTime(pitch * (1 + Math.random() * 0.25), t);
      o.frequency.linearRampToValueAtTime(pitch * (0.9 + Math.random() * 0.2), t + d);
      f1.frequency.setValueAtTime(600 + Math.random() * 700, t);
      g.gain.setTargetAtTime(level, t, 0.02);
      g.gain.setTargetAtTime(0.0001, t + d * 0.8, 0.03);
      t += d + 0.05 + Math.random() * 0.08;
    }
    o.start(t0);
    o.stop(t + 0.2);
  }

  play(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'click':
        this.tone(1250, 0.05, { type: 'square', gain: 0.035 });
        break;
      case 'hover':
        this.tone(1800, 0.03, { gain: 0.015 });
        break;
      case 'gear':
        this.noise(1.9, { gain: 0.16, freq: 220, type: 'lowpass', attack: 0.2 });
        this.tone(140, 1.6, { type: 'sawtooth', gain: 0.025, slideTo: 110 });
        this.tone(65, 0.25, { type: 'triangle', gain: 0.35, delay: 1.7 });
        break;
      case 'flaps':
        this.tone(380, 1.3, { type: 'sawtooth', gain: 0.018, slideTo: 470, attack: 0.15 });
        this.noise(1.3, { gain: 0.04, freq: 600, attack: 0.2 });
        break;
      case 'touchdown':
        this.tone(58, 0.35, { type: 'sine', gain: 0.6 });
        this.noise(0.45, { gain: 0.32, freq: 2200, q: 2, slideTo: 900 });
        break;
      case 'hard':
        this.tone(45, 0.6, { type: 'sine', gain: 0.8 });
        this.noise(0.6, { gain: 0.5, freq: 400, type: 'lowpass' });
        break;
      case 'crash':
        this.noise(2.2, { gain: 0.8, freq: 900, type: 'lowpass', slideTo: 120 });
        this.tone(90, 1.5, { type: 'sawtooth', gain: 0.25, slideTo: 30 });
        break;
      case 'success':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.5, { gain: 0.12, delay: i * 0.11 }));
        break;
      case 'fail':
        this.tone(330, 0.9, { type: 'triangle', gain: 0.15, slideTo: 110 });
        break;
      case 'caution':
        this.tone(880, 0.16, { gain: 0.1 });
        this.tone(660, 0.24, { gain: 0.1, delay: 0.18 });
        break;
      case 'phase':
        this.tone(740, 0.14, { gain: 0.08 });
        this.tone(988, 0.22, { gain: 0.08, delay: 0.12 });
        break;
      case 'score':
        this.tone(1320, 0.08, { gain: 0.05 });
        this.tone(1760, 0.12, { gain: 0.05, delay: 0.07 });
        break;
      case 'multi':
        this.tone(880, 0.25, { gain: 0.07, slideTo: 1320 });
        break;
      case 'count':
        this.tone(660, 0.12, { gain: 0.12 });
        break;
      case 'go':
        this.tone(990, 0.35, { gain: 0.14 });
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) this.tone(i % 2 ? 620 : 830, 0.22, { type: 'square', gain: 0.05, delay: i * 0.24 });
        break;
      case 'apDisconnect': // rising "wailer" tone, repeated
        for (let i = 0; i < 4; i++) this.tone(700, 0.34, { type: 'triangle', gain: 0.07, slideTo: 1150, delay: i * 0.38 });
        break;
      case 'whoosh':
        this.noise(1.4, { gain: 0.3, freq: 400, slideTo: 1800, q: 0.6, attack: 0.25 });
        break;
      case 'doorUnlock':
        this.tone(180, 0.08, { type: 'square', gain: 0.12 });
        this.noise(0.12, { gain: 0.2, freq: 2500, type: 'highpass', delay: 0.05 });
        break;
      case 'door':
        this.noise(0.9, { gain: 0.12, freq: 650, slideTo: 300, q: 1.2, attack: 0.1 });
        this.tone(70, 0.3, { type: 'sine', gain: 0.35, delay: 0.85 });
        break;
      case 'footsteps':
        for (let i = 0; i < 14; i++) {
          this.noise(0.09, { gain: 0.09 + Math.random() * 0.05, freq: 260, type: 'lowpass', delay: i * 0.27 + Math.random() * 0.06 });
        }
        break;
      case 'commotion': // muffled raised voices / movement, deliberately indistinct
        this.noise(3.2, { gain: 0.11, freq: 520, type: 'bandpass', q: 0.5, attack: 0.6 });
        this.noise(2.4, { gain: 0.07, freq: 900, type: 'bandpass', q: 1.1, attack: 0.4, delay: 0.5 });
        break;
      case 'seatbelt': // cabin chime: high, then low
        this.tone(1175, 0.9, { gain: 0.07, attack: 0.01 });
        this.tone(880, 1.2, { gain: 0.07, attack: 0.01, delay: 0.42 });
        break;
      case 'gasp': // several people at once, breathy and indistinct
        for (let i = 0; i < 6; i++) {
          this.noise(0.3 + Math.random() * 0.25, {
            gain: 0.035 + Math.random() * 0.03, freq: 1200 + Math.random() * 700, slideTo: 650 + Math.random() * 200,
            q: 2.5, attack: 0.03, delay: Math.random() * 0.7,
          });
        }
        break;
      case 'crewCall': // a raised, indistinct voice down the cabin
        this.voice(4, 225);
        break;
      case 'thump': // one dull, muffled impact (heard, never shown)
        this.tone(52, 0.32, { type: 'sine', gain: 0.55 });
        this.noise(0.22, { gain: 0.3, freq: 260, type: 'lowpass', attack: 0.004 });
        break;
      case 'screams': // indistinct cries from the cabin (voices, no words)
        for (let i = 0; i < 4; i++) {
          setTimeout(() => this.voice(2 + Math.floor(Math.random() * 2), 430 + Math.random() * 260, 0.035), i * 260 + Math.random() * 200);
        }
        break;
      case 'pounding': // fists on the flight-deck door
        for (let i = 0; i < 5; i++) {
          this.tone(78, 0.14, { type: 'sine', gain: 0.4, delay: i * 0.32 });
          this.noise(0.1, { gain: 0.18, freq: 380, type: 'lowpass', delay: i * 0.32 });
        }
        break;
      case 'struggle': // muffled scuffle and raised voices on the flight deck
        for (let i = 0; i < 6; i++) this.noise(0.12, { gain: 0.14, freq: 300, type: 'lowpass', delay: i * 0.22 + Math.random() * 0.12 });
        this.voice(4, 190);
        setTimeout(() => this.voice(3, 240), 350);
        break;
      case 'takeControl':
        this.tone(660, 0.18, { gain: 0.1 });
        this.tone(880, 0.18, { gain: 0.1, delay: 0.16 });
        this.tone(1320, 0.4, { gain: 0.09, delay: 0.32 });
        break;
      default:
        break;
    }
  }
}
