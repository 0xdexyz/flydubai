// Keyboard + on-screen control input. Continuous axes are polled each frame;
// discrete actions (gear, flaps, camera...) are queued and consumed once.

import { clamp } from './MathUtil.js';

const PREVENT_DEFAULT = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
]);

const ACTIONS = {
  KeyG: 'gear',
  KeyF: 'flapsDown',
  KeyR: 'flapsUp',
  KeyC: 'camera',
  Escape: 'pause',
  KeyP: 'pause',
  KeyH: 'help',
  KeyM: 'mute',
};

const isTyping = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

export class Input {
  constructor() {
    this.keys = new Set();
    this.queue = [];
    this.invertPitch = false;
    this.wheel = 0;
    // Written by the on-screen controls.
    this.virtual = { pitch: 0, roll: 0, yaw: 0, brake: false, throttleUp: false, throttleDown: false };

    this.onKeyDown = (e) => {
      if (isTyping(e.target)) return;
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat && ACTIONS[e.code]) this.queue.push(ACTIONS[e.code]);
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.clear();
    this.onWheel = (e) => {
      if (e.target.closest?.('.ui-scroll')) return;
      this.wheel += e.deltaY < 0 ? 1 : -1;
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  has(...codes) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** +1 = nose up (stick back). S / ArrowDown pull, W / ArrowUp push. */
  get pitch() {
    let v = 0;
    if (this.has('KeyS', 'ArrowDown')) v += 1;
    if (this.has('KeyW', 'ArrowUp')) v -= 1;
    v = clamp(v + this.virtual.pitch, -1, 1);
    return this.invertPitch ? -v : v;
  }

  /** +1 = roll right. */
  get roll() {
    let v = 0;
    if (this.has('KeyD', 'ArrowRight')) v += 1;
    if (this.has('KeyA', 'ArrowLeft')) v -= 1;
    return clamp(v + this.virtual.roll, -1, 1);
  }

  /** +1 = yaw right. */
  get yaw() {
    let v = 0;
    if (this.has('KeyE')) v += 1;
    if (this.has('KeyQ')) v -= 1;
    return clamp(v + this.virtual.yaw, -1, 1);
  }

  /** -1..1 continuous throttle change request. */
  get throttleDelta() {
    let v = 0;
    if (this.has('ShiftLeft', 'ShiftRight', 'PageUp', 'Equal', 'NumpadAdd') || this.virtual.throttleUp) v += 1;
    if (this.has('KeyZ', 'PageDown', 'Minus', 'NumpadSubtract') || this.virtual.throttleDown) v -= 1;
    return v;
  }

  get brake() {
    return this.has('Space', 'KeyB') || this.virtual.brake;
  }

  /** Mouse wheel notches since last call (throttle nudges). */
  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  trigger(action) {
    this.queue.push(action);
  }

  consume() {
    if (!this.queue.length) return EMPTY;
    const q = this.queue;
    this.queue = [];
    return q;
  }

  clear() {
    this.keys.clear();
    this.queue.length = 0;
    this.wheel = 0;
    Object.assign(this.virtual, { pitch: 0, roll: 0, yaw: 0, brake: false, throttleUp: false, throttleDown: false });
  }
}

const EMPTY = Object.freeze([]);
