// In-flight HUD (DOM overlay). Text is refreshed at ~20 Hz and only when a
// value changes, toasts and warning banners come from small reusable pools,
// and every animation runs on game time so a restart cleans up instantly.

import { angleDiffDeg, clamp, formatInt } from '../core/MathUtil.js';
import { FLAP_LABELS } from '../physics/FlightModel.js';

const ICON_CAMERA = '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor"/></svg>';

const TEMPLATE = `
<div class="hud-top">
  <div class="readout" data-r="alt"><span class="lbl">ALTITUDE</span><span class="val"><b>0</b><i>FT</i></span><span class="tgt"></span></div>
  <div class="readout" data-r="spd"><span class="lbl">AIRSPEED <em class="tag"></em></span><span class="val"><b>0</b><i>KT</i></span><span class="tgt"></span></div>
  <div class="readout" data-r="hdg"><span class="lbl">HEADING</span><span class="val"><b>000</b><i>°</i></span><span class="tgt"></span></div>
  <div class="readout" data-r="vs"><span class="lbl">VERTICAL SPEED</span><span class="val"><b>0</b><i>FPM</i></span><span class="tgt"></span></div>
</div>
<div class="hud-warnings"></div>
<div class="hud-phase">
  <div class="phase-tag"><span class="phase-num">1/4</span><span class="phase-name">RECOVERY</span></div>
  <div class="phase-obj"></div>
  <ul class="checklist"></ul>
</div>
<div class="hud-buttons">
  <button class="icon-btn" data-act="camera" title="Camera (C)">${ICON_CAMERA}<span>CAM</span></button>
  <button class="icon-btn" data-act="pause" title="Pause (Esc)">${ICON_PAUSE}</button>
</div>
<div class="hud-toasts"></div>
<div class="hud-banner"><div class="banner-title"></div><div class="banner-sub"></div></div>
<div class="hud-center">
  <div class="nav">
    <svg viewBox="-50 -50 100 100" class="nav-ring" aria-hidden="true">
      <circle r="43" class="ring"/>
      <g class="ticks">${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="-43" x2="0" y2="${i % 3 ? -39 : -36}" transform="rotate(${i * 30})"/>`).join('')}</g>
      <g class="nav-arrow"><path d="M0,-47 L7.5,-33 L-7.5,-33 Z"/></g>
      <path class="own" d="M0,-9 L7,7 L0,3.5 L-7,7 Z"/>
    </svg>
    <div class="nav-text"><span class="nav-name">TABUK</span><span class="nav-dist">DISTANCE 0 KM</span></div>
  </div>
  <div class="ils" title="Approach guidance: keep the aircraft under the runway and the diamond centred">
    <div class="apg">
      <div class="apg-lane"><span class="apg-rwy"></span><span class="apg-line"></span><span class="apg-plane"></span></div>
      <div class="apg-gs"><span class="apg-gs-mid"></span><span class="apg-gs-dot"></span></div>
    </div>
    <div class="papi"><i></i><i></i><i></i><i></i></div>
  </div>
  <div class="cue"><span class="cue-text"></span><span class="cue-key"></span></div>
</div>
<div class="hud-bl"><span class="lbl">SKY DUBAI 1073 · FZ1073</span><span class="squawk"><b>7500</b><em>UNLAWFUL INTERFERENCE</em></span><span class="tabuk">TABUK (TUU) <b>0</b> KM</span></div>
<div class="hud-br">
  <div class="stab"><span class="lbl">STABILITY</span><span class="stab-blocks">${'<i></i>'.repeat(10)}</span><b class="stab-pct">0%</b></div>
  <div class="fp-row" title="Flight Points are only banked if you land safely"><span class="lbl">ON LANDING</span><b class="fp-val">0</b><span class="fp-unit">FP</span></div>
</div>
<div class="hud-touchdown"><b></b><span></span></div>
<div class="hud-systems">
  <div class="sys thr"><span class="lbl">THR</span><span class="bar"><i></i></span><b>0%</b></div>
  <div class="sys gear"><span class="lbl">GEAR</span><b>UP</b></div>
  <div class="sys flaps"><span class="lbl">FLAPS</span><b>UP</b></div>
  <div class="sys brk"><span class="lbl">BRK</span><b>OFF</b></div>
</div>
<div class="hud-controls">
  <div class="ctl-head"><span>CONTROLS</span><button class="ctl-toggle" data-act="help">HIDE · H</button></div>
  <div class="ctl-body">
    <div class="keys">
      <div><kbd>W</kbd><kbd>S</kbd><span>Pitch · S nose up</span></div>
      <div><kbd>A</kbd><kbd>D</kbd><span>Roll</span></div>
      <div><kbd>Q</kbd><kbd>E</kbd><span>Rudder / steer</span></div>
      <div><kbd>SHIFT</kbd><kbd>Z</kbd><span>Throttle</span></div>
      <div><kbd>G</kbd><span>Gear</span><kbd>F</kbd><kbd>R</kbd><span>Flaps</span></div>
      <div><kbd>B</kbd><span>Brakes</span><kbd>C</kbd><span>Camera</span></div>
    </div>
    <div class="vpad">
      <button data-hold="pitch:-1" class="vp-up" title="Nose down (W)">▲<small>NOSE DN</small></button>
      <button data-hold="roll:-1" class="vp-left" title="Roll left (A)">◀</button>
      <button data-hold="roll:1" class="vp-right" title="Roll right (D)">▶</button>
      <button data-hold="pitch:1" class="vp-down" title="Nose up (S)">▼<small>NOSE UP</small></button>
    </div>
  </div>
</div>
<div class="hud-throttle">
  <div class="thr-track" title="Throttle (Shift / Z)"><div class="thr-fill"></div><div class="thr-handle"></div></div>
  <div class="thr-pct">0%</div>
  <button data-act="gear" class="sys-btn gear-btn">GEAR</button>
  <div class="flap-btns"><button data-act="flapsUp" class="sys-btn" title="Flaps up (R)">F−</button><button data-act="flapsDown" class="sys-btn" title="Flaps down (F)">F+</button></div>
  <button data-hold="brake" class="sys-btn" title="Brakes (B / Space)">BRAKE</button>
</div>
<div class="hud-whiteout"></div>
<div class="hud-flash"></div>
`;

export class HUD {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'hud hidden';
    this.el.innerHTML = TEMPLATE;
    root.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);

    this.r = {};
    for (const key of ['alt', 'spd', 'hdg', 'vs']) {
      const box = q(`[data-r="${key}"]`);
      this.r[key] = { box, val: box.querySelector('b'), tgt: box.querySelector('.tgt'), state: '' };
    }
    this.phaseNum = q('.phase-num');
    this.phaseName = q('.phase-name');
    this.objective = q('.phase-obj');
    this.checklist = q('.checklist');
    this.warnBox = q('.hud-warnings');
    this.navArrow = q('.nav-arrow');
    this.navName = q('.nav-name');
    this.navDist = q('.nav-dist');
    this.nav = q('.nav');
    this.ils = q('.ils');
    this.apgPlane = q('.apg-plane');
    this.apgGs = q('.apg-gs-dot');
    this.spdTag = q('[data-r="spd"] .tag');
    this.stabBlocks = [...this.el.querySelectorAll('.stab-blocks i')];
    this.stabPct = q('.stab-pct');
    this.stabBox = q('.stab');
    this.fpVal = q('.fp-val');
    this.tdEl = q('.hud-touchdown');
    this.tdTitle = q('.hud-touchdown b');
    this.tdSub = q('.hud-touchdown span');
    this.tdLife = 0;
    this.displayFp = 0;
    this.papi = [...this.el.querySelectorAll('.papi i')];
    this.cueText = q('.cue-text');
    this.cueKey = q('.cue-key');
    this.cue = q('.cue');
    this.tabukKm = q('.tabuk b');
    this.thrBar = q('.thr .bar i');
    this.thrText = q('.thr b');
    this.gearText = q('.gear b');
    this.gearSys = q('.sys.gear');
    this.flapText = q('.flaps b');
    this.brkText = q('.brk b');
    this.brkSys = q('.sys.brk');
    this.toasts = q('.hud-toasts');
    this.bannerEl = q('.hud-banner');
    this.bannerTitle = q('.banner-title');
    this.bannerSub = q('.banner-sub');
    this.whiteout = q('.hud-whiteout');
    this.flashEl = q('.hud-flash');
    this.controls = q('.hud-controls');
    this.thrFill = q('.thr-fill');
    this.thrHandle = q('.thr-handle');
    this.thrPct = q('.thr-pct');
    this.thrTrack = q('.thr-track');
    this.gearBtn = q('.gear-btn');

    this.toastPool = [];
    this.activeToasts = [];
    this.warnEls = new Map();
    this.bannerLife = 0;
    this.flashLife = 0;
    this.timer = 0;
    this.cache = new Map();
    this.checkKey = '';

    this.bindControls();
    this.applyControlsVisible(game.settings.get('showControls'));
  }

  // --- visibility ---------------------------------------------------------------
  show() {
    this.el.classList.remove('hidden');
  }
  hide() {
    this.el.classList.add('hidden');
  }

  toggleControls() {
    const v = !this.game.settings.get('showControls');
    this.game.settings.set('showControls', v);
    this.applyControlsVisible(v);
  }

  applyControlsVisible(v) {
    this.controls.classList.toggle('collapsed', !v);
    this.controls.querySelector('.ctl-toggle').textContent = v ? 'HIDE · H' : 'SHOW · H';
  }

  reset() {
    for (const t of this.activeToasts) {
      t.el.classList.remove('show');
      t.el.remove();
      this.toastPool.push(t);
    }
    this.activeToasts.length = 0;
    this.warnBox.replaceChildren();
    this.warnEls.clear();
    this.bannerLife = 0;
    this.bannerEl.classList.remove('show');
    this.flashLife = 0;
    this.flashEl.style.opacity = 0;
    this.whiteout.style.opacity = 0;
    this.displayFp = 0;
    this.tdLife = 0;
    this.tdEl.classList.remove('show');
    this.cache.clear();
    this.checkKey = '';
    this.setPhaseTitle();
  }

  // --- input bindings ----------------------------------------------------------
  bindControls() {
    const input = this.game.input;
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      this.game.audio.play('click');
      const act = btn.dataset.act;
      if (act === 'help') this.toggleControls();
      else input.trigger(act);
      btn.blur();
    });
    const release = (btn) => {
      const [axis] = btn.dataset.hold.split(':');
      if (axis === 'brake') input.virtual.brake = false;
      else input.virtual[axis] = 0;
      btn.classList.remove('held');
    };
    for (const btn of this.el.querySelectorAll('[data-hold]')) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        const [axis, val] = btn.dataset.hold.split(':');
        if (axis === 'brake') input.virtual.brake = true;
        else input.virtual[axis] = Number(val);
        btn.classList.add('held');
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => release(btn));
    }
    // Throttle slider
    const setFromPointer = (e) => {
      const rect = this.thrTrack.getBoundingClientRect();
      const v = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
      this.game.fm.setThrottle(v);
    };
    this.thrTrack.addEventListener('pointerdown', (e) => {
      this.thrTrack.setPointerCapture(e.pointerId);
      this.dragging = true;
      setFromPointer(e);
    });
    this.thrTrack.addEventListener('pointermove', (e) => this.dragging && setFromPointer(e));
    this.thrTrack.addEventListener('pointerup', () => (this.dragging = false));
    this.thrTrack.addEventListener('pointercancel', () => (this.dragging = false));
  }

  // --- feedback ------------------------------------------------------------------
  /** Phase tag (1/4 RECOVERY, 1/4 STABLE FLIGHT, 2/4 EMERGENCY DIVERSION ...). */
  setPhaseTitle() {
    const m = this.game.mission;
    this.setText(this.phaseNum, 'phaseN', `${m.phaseIndex}/4`);
    this.setText(this.phaseName, 'phaseT', m.phase === 'RECOVERY' && m.stage === 'stable' ? 'STABLE FLIGHT' : m.goAroundWp ? 'GO AROUND' : {
      RECOVERY: 'RECOVERY', DIVERSION: 'EMERGENCY DIVERSION', APPROACH: 'TABUK APPROACH', LANDING: 'LANDING',
    }[m.phase]);
    this.el.dataset.phase = m.phaseIndex;
  }

  banner(title, sub = '', life = 3.6, variant = '') {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerLife = life;
    this.bannerEl.className = `hud-banner show ${variant}`;
  }

  /** Big touchdown readout: sink rate + grade, coloured by quality. */
  touchdown(r) {
    const cls = r.sink < 240 ? 'good' : r.sink < 600 ? 'ok' : 'hard';
    this.tdTitle.textContent = r.grade;
    this.tdSub.textContent = `TOUCHDOWN · ${Math.round(r.sink)} FPM · ${Math.round(r.speedKt)} KT · ${Math.max(0, Math.round(r.distPast))} M PAST THRESHOLD`;
    this.tdEl.className = `hud-touchdown show ${cls}`;
    this.tdLife = 4;
  }

  toast({ label, points, kind }) {
    let t = this.toastPool.pop();
    if (!t) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = '<span class="t-label"></span><span class="t-pts"></span>';
      t = { el, label: el.querySelector('.t-label'), pts: el.querySelector('.t-pts'), life: 0 };
    }
    t.el.className = `toast ${kind || 'gain'}`;
    t.label.textContent = label;
    t.pts.textContent = points == null ? '' : `${points > 0 ? '+' : ''}${formatInt(points)}${kind === 'fp' ? ' FP' : ''}`;
    t.life = 2.6;
    this.toasts.prepend(t.el);
    requestAnimationFrame(() => t.el.classList.add('show'));
    this.activeToasts.push(t);
    if (this.activeToasts.length > 5) this.activeToasts[0].life = Math.min(this.activeToasts[0].life, 0.3);
    if ((kind === 'gain' || kind === 'fp') && points) this.game.audio.play('score');
    if (kind === 'multi') this.game.audio.play('multi');
  }

  flash(color = '#ffffff', strength = 0.8) {
    this.flashEl.style.background = color;
    this.flashLife = strength;
  }

  setWhiteout(v) {
    const o = (v * 0.92).toFixed(2);
    if (this.cache.get('whiteout') !== o) {
      this.cache.set('whiteout', o);
      this.whiteout.style.opacity = o;
    }
  }

  setText(el, key, text) {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    el.textContent = text;
  }

  setState(r, state) {
    if (r.state === state) return;
    r.box.classList.remove('good', 'caution', 'critical');
    if (state) r.box.classList.add(state);
    r.state = state;
  }

  // --- per-frame -----------------------------------------------------------------
  update(dt, t, mission, scoring, warnings, fm) {
    // Animated pieces run every frame.
    for (let i = this.activeToasts.length - 1; i >= 0; i--) {
      const ts = this.activeToasts[i];
      ts.life -= dt;
      if (ts.life <= 0.35) ts.el.classList.remove('show');
      if (ts.life <= 0) {
        ts.el.remove();
        this.activeToasts.splice(i, 1);
        this.toastPool.push(ts);
      }
    }
    if (this.bannerLife > 0) {
      this.bannerLife -= dt;
      if (this.bannerLife <= 0) this.bannerEl.classList.remove('show');
    }
    if (this.flashLife > 0) {
      this.flashLife = Math.max(0, this.flashLife - dt * 1.4);
      this.flashEl.style.opacity = this.flashLife.toFixed(2);
    }
    if (this.tdLife > 0) {
      this.tdLife -= dt;
      if (this.tdLife <= 0) this.tdEl.classList.remove('show');
    }
    this.displayFp += (scoring.fp - this.displayFp) * Math.min(1, dt * 5);

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.05;

    const tg = mission.targets;
    const wIds = new Set(warnings.active.map((w) => w.id + w.level));
    const has = (id) => (wIds.has(id + 'critical') ? 'critical' : wIds.has(id + 'caution') ? 'caution' : '');

    // Readouts
    this.setText(this.r.alt.val, 'alt', formatInt(Math.round(t.altFt / 10) * 10));
    this.setText(this.r.alt.tgt, 'altT', tg.alt ? `TGT ${formatInt(tg.alt)}` : '');
    const altTol = mission.phaseIndex === 4 ? 200 : 1000;
    this.setState(this.r.alt, has('terrain') || has('gear') || (tg.alt && Math.abs(t.altFt - tg.alt) <= altTol ? 'good' : ''));

    this.setText(this.r.spd.val, 'spd', String(Math.round(t.speedKt)));
    this.setText(this.r.spd.tgt, 'spdT', tg.spd ? `TGT ${tg.spd}` : '');
    this.setState(this.r.spd, has('stall') || has('overspeed') || has('lowspeed') || has('flapspeed') ||
      (tg.spd && Math.abs(t.speedKt - tg.spd) <= 20 ? 'good' : ''));
    const spdTag = t.speedKt > 320 && !fm.onGround ? 'HIGH' : fm.stalled || (t.speedKt < 125 && !fm.onGround) ? 'LOW' : '';
    this.setText(this.spdTag, 'spdTag', spdTag);

    this.setText(this.r.hdg.val, 'hdg', String(Math.round(t.hdg) % 360).padStart(3, '0'));
    this.setText(this.r.hdg.tgt, 'hdgT', tg.hdg != null ? `TGT ${String(tg.hdg).padStart(3, '0')}°` : '');
    this.setState(this.r.hdg, has('align') || (tg.hdg != null && Math.abs(angleDiffDeg(t.hdg, tg.hdg)) <= 12 ? 'good' : ''));

    const vs = Math.round(t.vsFpm / 50) * 50;
    this.setText(this.r.vs.val, 'vs', `${vs > 0 ? '+' : ''}${formatInt(vs)}`);
    const regain = mission.phase === 'RECOVERY' && mission.stage === 'regain';
    this.setText(this.r.vs.tgt, 'vsT', regain ? 'TGT > -1,500' : mission.phaseIndex === 4 && !fm.onGround ? 'TGT -700' : '');
    this.setState(this.r.vs, has('sink'));

    // Phase panel
    this.setPhaseTitle();
    this.setText(this.objective, 'obj', mission.guide.objective);
    const checkKey = mission.guide.checklist.map((c) => c.label + c.done + c.key).join('|');
    if (checkKey !== this.checkKey) {
      this.checkKey = checkKey;
      const first = mission.guide.checklist.findIndex((c) => !c.done);
      this.checklist.innerHTML = mission.guide.checklist.map((c, i) =>
        `<li class="${c.done ? 'done' : i === first ? 'next' : ''}"><span class="box"></span><span class="c-label">${c.label}</span>${c.key ? `<kbd>${c.key}</kbd>` : ''}</li>`).join('');
    }

    // Warnings (pooled per id)
    const shown = warnings.active.slice(0, 3);
    for (const [id, el] of this.warnEls) if (!shown.some((w) => w.id === id)) el.remove();
    shown.forEach((w, i) => {
      let el = this.warnEls.get(w.id);
      if (!el) {
        el = document.createElement('div');
        this.warnEls.set(w.id, el);
      }
      el.className = `warn ${w.level}`;
      if (el.textContent !== w.text) el.textContent = w.text;
      if (this.warnBox.children[i] !== el) this.warnBox.insertBefore(el, this.warnBox.children[i] || null);
    });

    // Navigation
    this.navArrow.setAttribute('transform', `rotate(${mission.nav.rel.toFixed(1)})`);
    this.setText(this.navName, 'navN', mission.nav.name);
    const km = mission.nav.distKm;
    this.setText(this.navDist, 'navD', `DISTANCE ${km < 10 ? km.toFixed(1) : km.toFixed(0)} KM`);
    const showIls = mission.phaseIndex >= 3;
    this.ils.classList.toggle('on', showIls && !fm.onGround);
    if (showIls) {
      // Aircraft icon slides sideways under the runway symbol; diamond shows the glide path.
      this.apgPlane.style.transform = `translate(calc(-50% + ${(clamp(t.locDev / 2.5, -1, 1) * 2.4).toFixed(2)}rem), 0)`;
      this.apgGs.style.transform = `translateY(${(clamp(-t.gsDev / 0.8, -1, 1) * 2.1).toFixed(2)}rem)`;
      const papi = this.game.world.airport.papiState;
      this.papi.forEach((p, i) => p.classList.toggle('white', papi[i] === 1));
    }
    this.setText(this.cueText, 'cue', mission.guide.cue);
    this.setText(this.cueKey, 'cueK', mission.guide.key);
    this.cue.classList.toggle('empty', !mission.guide.cue);

    // No clock anywhere: distance to Tabuk instead.
    const tk = mission.nav.tabukKm ?? 0;
    this.setText(this.tabukKm, 'tabuk', tk < 10 ? tk.toFixed(1) : tk.toFixed(0));
    this.setText(this.fpVal, 'fp', formatInt(Math.abs(scoring.fp - this.displayFp) < 0.6 ? scoring.fp : this.displayFp));
    const stab = clamp(mission.meter, 0, 1);
    const blocks = Math.round(stab * 10);
    if (this.cache.get('stabB') !== blocks) {
      this.cache.set('stabB', blocks);
      this.stabBlocks.forEach((b, i) => b.classList.toggle('on', i < blocks));
      this.stabBox.dataset.level = stab >= 0.72 ? 'high' : stab >= 0.45 ? 'mid' : 'low';
    }
    this.setText(this.stabPct, 'stabP', `${Math.round(stab * 100)}%`);

    // Systems
    const thr = Math.round(fm.throttle * 100);
    this.setText(this.thrText, 'thr', `${thr}%`);
    this.setText(this.thrPct, 'thrP', `${thr}%`);
    this.thrBar.style.width = `${thr}%`;
    this.thrFill.style.height = `${thr}%`;
    this.thrHandle.style.bottom = `calc(${thr}% - 7px)`;
    const gearState = fm.gearPos >= 0.99 ? 'DOWN' : fm.gearPos > 0.01 ? 'TRANSIT' : 'UP';
    this.setText(this.gearText, 'gear', gearState);
    if (this.cache.get('gearS') !== gearState) {
      this.cache.set('gearS', gearState);
      this.gearSys.dataset.state = gearState;
      this.gearBtn.dataset.state = gearState;
    }
    const flapMoving = Math.abs(fm.flapsPos - fm.flapsCmd) > 0.02;
    this.setText(this.flapText, 'flap', FLAP_LABELS[fm.flapsCmd] + (flapMoving ? ' ▸' : ''));
    const brk = fm.onGround ? (fm.braking ? 'ON' : 'OFF') : fm.spoilers > 0.1 ? 'SPD BRK' : 'OFF';
    this.setText(this.brkText, 'brk', brk);
    this.brkSys.dataset.on = brk !== 'OFF';
  }
}
