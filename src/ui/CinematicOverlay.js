// Cinematic presentation layer: letterbox bars, captions, the large altitude
// ticker during exterior shots, fades, and the "hold to skip" hint (replays
// only). DOM is built once; updates only touch changed values.

import { formatInt } from '../core/MathUtil.js';

export class CinematicOverlay {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'cine hidden';
    this.el.innerHTML = `
      <div class="lb top"></div><div class="lb bottom"></div>
      <div class="cine-alt"><span class="lbl">ALTITUDE</span><div class="row"><b>0</b><i>FT</i></div><span class="cine-vs"></span></div>
      <div class="cine-caption"></div>
      <div class="cine-skip">HOLD <kbd>SPACE</kbd> TO SKIP<span class="bar"><i></i></span></div>
      <div class="cine-fade"></div>`;
    root.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    this.altBox = q('.cine-alt');
    this.alt = q('.cine-alt b');
    this.vs = q('.cine-vs');
    this.caption = q('.cine-caption');
    this.skipBox = q('.cine-skip');
    this.skipBar = q('.cine-skip .bar i');
    this.fade = q('.cine-fade');
    this.cache = {};
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  show() {
    this.el.classList.remove('hidden');
    this.cache = {};
  }

  hide() {
    this.el.classList.add('hidden');
  }

  setCaption(text, kind = '') {
    this.set('cap', text + kind, () => {
      this.caption.textContent = text;
      this.caption.className = `cine-caption ${text ? 'on' : ''} ${kind}`;
    });
  }

  setAltitude(ft, vsFpm) {
    const on = ft != null;
    this.set('altOn', on, (v) => this.altBox.classList.toggle('on', v));
    if (!on) return;
    this.set('alt', Math.round(ft / 100) * 100, (v) => (this.alt.textContent = formatInt(v)));
    const vs = Math.round(vsFpm / 100) * 100;
    this.set('vs', vs, (v) => {
      this.vs.textContent = Math.abs(v) >= 1500 ? `${v > 0 ? '+' : ''}${formatInt(v)} FPM` : '';
      this.vs.classList.toggle('alarm', v < -6000);
    });
  }

  setFade(v) {
    this.set('fade', v.toFixed(2), (x) => (this.fade.style.opacity = x));
  }

  setLetterbox(on) {
    this.set('lb', on, (v) => this.el.classList.toggle('letterbox', v));
  }

  setSkip(visible, progress = 0) {
    this.set('skipOn', visible, (v) => this.skipBox.classList.toggle('on', v));
    this.set('skipP', progress.toFixed(2), (p) => (this.skipBar.style.width = `${p * 100}%`));
  }
}
