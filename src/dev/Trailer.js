// Development tool — NOT part of the game bundle (nothing imports it).
// Renders a 1920x1080, 30 fps promo trailer frame by frame from the real game
// and posts every frame to dev-tools/trailer-sink.mjs (port 8792). ffmpeg then
// turns the frames into an MP4 (see trailer/make-trailer.md).
//
//   const { recordTrailer } = await import('/src/dev/Trailer.js');
//   recordTrailer(window.__sky);           // progress in window.__trailer
//
// Structure: opener over the FlyDubaiSIM banner -> the incident card -> the
// in-game cutscene (with its captions) -> "your turn" -> gameplay (recovery,
// diversion, final approach, touchdown) -> end card.

import { CINE } from '../game/Cinematic.js';
import { SPEC } from '../physics/FlightModel.js';
import { feetPerMeter } from '../physics/AltitudeScale.js';

const W = 1920;
const H = 1080;
const FPS = 30;
const NAVY = '#04172a';
const ORANGE = '#f28a1e';
const WHITE = '#f2f4f6';
const SANS = 'Inter, "Segoe UI", Arial, sans-serif';
const MONO = '"JetBrains Mono", Consolas, monospace';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = (u) => {
  const k = clamp(u, 0, 1);
  return k * k * (3 - 2 * k);
};
const angDiff = (a, b) => ((((a - b + 180) % 360) + 360) % 360) - 180;

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

// --- drawing helpers -----------------------------------------------------------------------
function text(ctx, str, x, y, { size = 40, weight = 600, color = WHITE, align = 'center', font = SANS, alpha = 1, rise = 0, track = 0, maxWidth = W - 200 } = {}) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${weight} ${size}px ${font}`;
  if (track) ctx.letterSpacing = `${track}px`;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 12;
  ctx.fillText(str, x, y + (1 - alpha) * rise, maxWidth);
  ctx.restore();
}

/** Fade-in alpha for an element appearing at `t0` (seconds) within a clip at time t. */
const appear = (t, t0, dur = 0.6) => ease((t - t0) / dur);

function cover(ctx, img, zoom = 1, oy = 0.42) {
  const s = Math.max(W / img.width, H / img.height) * zoom;
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) * oy, w, h);
}

function fill(ctx, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function wordmark(ctx, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 ${size}px ${SANS}`;
  ctx.textBaseline = 'alphabetic';
  const a = ctx.measureText('FlyDubai').width;
  const b = ctx.measureText('SIM').width;
  const x0 = x - (a + b) / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'left';
  ctx.fillText('FlyDubai', x0, y);
  ctx.fillStyle = ORANGE;
  ctx.fillText('SIM', x0 + a, y);
  ctx.restore();
}

function shotTitle(ctx, str, t, sub = '') {
  const a = appear(t, 0.15, 0.45);
  const gr = ctx.createLinearGradient(0, 0, 0, 300);
  gr.addColorStop(0, 'rgba(4,23,42,0.72)');
  gr.addColorStop(1, 'rgba(4,23,42,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, 300);
  ctx.save();
  ctx.globalAlpha = a;
  const x = 96 - (1 - a) * 30;
  ctx.fillStyle = ORANGE;
  ctx.fillRect(x, 92, 8, 108);
  ctx.restore();
  text(ctx, str, x + 30, 146, { size: 54, weight: 700, align: 'left', alpha: a });
  if (sub) text(ctx, sub, x + 32, 190, { size: 28, weight: 500, align: 'left', color: 'rgba(242,244,246,0.85)', alpha: appear(t, 0.35, 0.45) });
}

/** Rounded translucent panel behind text. */
function panel(ctx, x, y, w, h, alpha = 1, color = 'rgba(4,15,28,0.62)') {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 12);
  ctx.fill();
  ctx.restore();
}

function watermark(ctx, mark, alpha = 0.85) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const h = 34;
  const w = (mark.width / mark.height) * h;
  ctx.drawImage(mark, W - 330, 40, w, h);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 30px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = WHITE;
  const fx = W - 330 + w + 12;
  ctx.fillText('FlyDubai', fx, 69);
  ctx.fillStyle = ORANGE;
  ctx.fillText('SIM', fx + ctx.measureText('FlyDubai').width, 69);
  ctx.restore();
}

// --- flight autopilot for the gameplay shots (same control law as TestPilot) ------------------------
export function autopilot(g, st) {
  const T = g.tele;
  const m = g.mission;
  const fm = g.fm;
  const tg = m.targets;
  const v = g.input.virtual;
  let vsCmd;
  let spdCmd = tg.spd || 270;
  let hdgCmd = tg.hdg ?? T.hdg;
  if (m.phaseIndex === 1 && m.stage === 'regain') {
    vsCmd = -2500;
    spdCmd = 265;
    hdgCmd = T.hdg;
  } else if (m.phaseIndex <= 3) vsCmd = clamp((tg.alt - T.altFt) * 6, -14000, 3000);
  else {
    vsCmd = clamp(-720 - T.gsDev * 1200, -2200, -150);
    hdgCmd = 240 - clamp(T.locDev * 30, -20, 20);
    spdCmd = 140;
  }
  // Short final: steady descent (no glide-slope chasing near the ground), then a smooth flare.
  if (m.phaseIndex === 4 && !fm.onGround && T.aglFt < 150) vsCmd = T.aglFt < 60 ? -(200 + 8 * Math.max(0, T.aglFt)) : -700;
  if (!fm.onGround) {
    const fpm = feetPerMeter(fm.pos.y - 4) * 60;
    const gammaCmd = Math.asin(clamp(vsCmd / fpm / fm.V, -0.3, 0.3));
    v.pitch = clamp((gammaCmd + fm.alpha - fm.theta) / ((2.5 * Math.PI) / 180), -1, 1);
    const bankCmd = clamp(angDiff(hdgCmd, T.hdg) * 1.2, -25, 25);
    v.roll = clamp((bankCmd - T.bankDeg) / 8, -1, 1);
    st.thrI = clamp(st.thrI + (spdCmd - T.speedKt) * 0.0004, -0.4, 0.4);
    let thr = clamp(0.45 + (spdCmd - T.speedKt) * 0.03 + st.thrI, 0, 1);
    if (m.phaseIndex === 4 && T.aglFt < 25) thr = 0;
    fm.setThrottle(thr);
    v.brake = T.speedKt > spdCmd + 12;
    const configure = m.phaseIndex >= 3 || (m.phaseIndex === 2 && T.alongTrack < 12000 && Math.abs(T.x) < 4000);
    if (configure && st.t - st.lastCfg > 1.5) {
      if (!fm.gearCmd && T.speedKt < 250) {
        g.input.trigger('gear');
        st.lastCfg = st.t;
      } else if (fm.flapsCmd < 3 && T.speedKt < SPEC.flapLimitKt[fm.flapsCmd + 1] - 5) {
        g.input.trigger('flapsDown');
        st.lastCfg = st.t;
      }
    }
  } else {
    v.pitch = 0;
    v.roll = 0;
    fm.setThrottle(0);
    v.brake = true;
    v.yaw = clamp(-T.x * 0.15 - angDiff(T.hdg, 240) * 0.3, -1, 1);
  }
}

export async function recordTrailer(g, { sink = 'http://localhost:8792', quality = 0.92, scale = 2 } = {}) {
  const status = (window.__trailer = { frame: 0, stage: 'setup', done: false, error: null });
  try {
    // --- render setup: 1920x1080, supersampled, no adaptive resolution
    g.loop.stop();
    g.pause = () => {};
    // Fixed resolution and full scenery for the recording, without touching the saved settings.
    g.perf.update = () => {};
    g.world.setQuality('high');
    const R = g.renderer;
    window.removeEventListener('resize', R.onResize);
    R.width = W;
    R.height = H;
    R.basePixelRatio = scale;
    R.dynamicScale = 1;
    R.renderer.setPixelRatio(scale);
    R.renderer.setSize(W, H, false);
    R.camera.aspect = W / H;
    R.overlayCamera.aspect = W / H;
    R.camera.updateProjectionMatrix();
    R.overlayCamera.updateProjectionMatrix();
    for (const fn of R.resizeListeners) fn(W, H);
    const gl = R.renderer.domElement;

    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const [banner, glowLogo, mark] = await Promise.all([
      loadImg('brand/home-hero.webp'), loadImg('brand/logo-mark-glow.png'), loadImg('brand/logo-mark.png'),
    ]);
    await Promise.all([
      document.fonts.load(`800 60px ${SANS}`), document.fonts.load(`700 60px ${SANS}`),
      document.fonts.load(`600 40px ${SANS}`), document.fonts.load(`500 40px ${SANS}`), document.fonts.load(`600 40px ${MONO}`),
    ]);

    const timeline = { fps: FPS, events: [] };
    const markEvent = (name) => timeline.events.push({ name, t: status.frame / FPS });
    await fetch(`${sink}/reset`, { method: 'POST' });
    const emit = async () => {
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', quality));
      await fetch(`${sink}/frame?i=${status.frame}`, { method: 'POST', body: blob });
      status.frame++;
    };
    const clip = async (seconds, draw) => {
      const n = Math.round(seconds * FPS);
      for (let i = 0; i < n; i++) {
        draw(i / FPS, i / n);
        await emit();
      }
    };

    // --- A · opener over the banner (5 s)
    status.stage = 'opener';
    markEvent('opener');
    await clip(5, (t) => {
      fill(ctx, '#000');
      cover(ctx, banner, 1 + t * 0.012, 0.42);
      const g2 = ctx.createLinearGradient(0, H * 0.55, 0, H);
      g2.addColorStop(0, 'rgba(4,23,42,0)');
      g2.addColorStop(1, 'rgba(4,23,42,0.95)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);
      text(ctx, 'A real-life aviation incident,', W / 2, 890, { size: 58, weight: 700, alpha: appear(t, 0.9), rise: 18 });
      text(ctx, 'transformed into an immersive virtual experience.', W / 2, 965, { size: 44, weight: 600, color: ORANGE, alpha: appear(t, 1.6), rise: 18 });
      fill(ctx, '#000', 1 - ease(t / 0.8));
      fill(ctx, NAVY, ease((t - 4.4) / 0.6));
    });

    // --- B · the incident card (7 s): what happened, with the route drawn to scale
    status.stage = 'incident';
    markEvent('incident');
    // Equirectangular map, 40 px per degree.
    const geo = (lon, lat) => [548 + (lon - 34.8) * 40, 905 - (lat - 25.3) * 40];
    const DXB = geo(55.36, 25.25);
    const TLV = geo(34.89, 32.01);
    const TUU = geo(36.62, 28.37);
    const brk = 0.82; // where the emergency happened along the planned route (near the Jordanian border)
    const EMG = [DXB[0] + (TLV[0] - DXB[0]) * brk, DXB[1] + (TLV[1] - DXB[1]) * brk];
    const lerp2 = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
    await clip(7, (t) => {
      fill(ctx, NAVY);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      for (let x = 0; x <= W; x += 80) ctx.strokeRect(x, -1, 0.5, H + 2);
      for (let y = 0; y <= H; y += 80) ctx.strokeRect(-1, y, W + 2, 0.5);
      ctx.restore();
      text(ctx, 'REAL INCIDENT  →  VIRTUAL EXPERIENCE', W / 2, 200, { size: 26, weight: 600, color: ORANGE, font: MONO, track: 4, alpha: appear(t, 0.2) });
      text(ctx, '30 September 2026', W / 2, 310, { size: 88, weight: 800, alpha: appear(t, 0.6), rise: 20 });
      text(ctx, 'flydubai flight FZ1073 · Dubai → Tel Aviv', W / 2, 392, { size: 46, weight: 600, alpha: appear(t, 1.2), rise: 16 });
      text(ctx, 'A serious cockpit emergency at 34,000 ft.', W / 2, 462, { size: 46, weight: 600, color: ORANGE, alpha: appear(t, 1.8), rise: 16 });

      const mapA = appear(t, 2.2, 0.5);
      if (mapA > 0) {
        ctx.save();
        ctx.globalAlpha = mapA;
        ctx.lineCap = 'round';
        // Planned route (dashed)
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 14]);
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.beginPath();
        ctx.moveTo(...DXB);
        ctx.lineTo(...TLV);
        ctx.stroke();
        ctx.setLineDash([]);
        // Flown track: DXB -> emergency point -> Tabuk
        const k1 = ease((t - 2.6) / 1.7);
        const k2 = ease((t - 4.5) / 0.9);
        ctx.lineWidth = 6;
        ctx.strokeStyle = ORANGE;
        ctx.beginPath();
        ctx.moveTo(...DXB);
        let head = lerp2(DXB, EMG, k1);
        ctx.lineTo(...head);
        if (k2 > 0) {
          head = lerp2(EMG, TUU, k2);
          ctx.lineTo(...head);
        }
        ctx.stroke();
        const dot = (p, color, r = 10) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
          ctx.fill();
        };
        dot(DXB, WHITE);
        dot(TLV, 'rgba(255,255,255,0.45)');
        dot(TUU, k2 > 0.98 ? ORANGE : 'rgba(255,255,255,0.45)');
        ctx.restore();
        const lab = { size: 24, weight: 600, font: MONO, align: 'left', track: 2 };
        text(ctx, 'DUBAI · DXB', DXB[0] - 70, DXB[1] + 50, { ...lab, alpha: mapA });
        text(ctx, 'TEL AVIV · TLV', TLV[0] - 30, TLV[1] - 26, { ...lab, color: 'rgba(242,244,246,0.6)', alpha: mapA });
        text(ctx, 'TABUK · TUU', TUU[0] + 24, TUU[1] + 44, { ...lab, color: ORANGE, alpha: appear(t, 5.3, 0.4) });
        text(ctx, 'DIVERTED · ALL 172 SAFE', TUU[0] + 24, TUU[1] + 78, { ...lab, size: 20, color: 'rgba(242,244,246,0.8)', alpha: appear(t, 5.6, 0.4) });
        // Emergency marker pulses once the track reaches it.
        if (k1 >= 1) {
          const pt = t - 4.3;
          ctx.save();
          ctx.strokeStyle = '#ff6b4a';
          ctx.lineWidth = 3;
          ctx.globalAlpha = Math.max(0, 1 - (pt % 1));
          ctx.beginPath();
          ctx.arc(EMG[0], EMG[1], 10 + (pt % 1) * 30, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = '#ff6b4a';
          ctx.beginPath();
          ctx.arc(EMG[0], EMG[1], 9, 0, Math.PI * 2);
          ctx.fill();
          text(ctx, 'EMERGENCY · 34,000 FT', EMG[0] + 26, EMG[1] - 24, { ...lab, size: 22, color: '#ff8a6e', alpha: appear(t, 4.3, 0.3) });
        }
        if (k1 > 0 && k1 < 1) ctx.drawImage(mark, head[0] - 27, head[1] - 18, 54, 36);
        if (k2 > 0 && k2 < 1) ctx.drawImage(mark, head[0] - 27, head[1] - 18, 54, 36);
      }
      text(ctx, 'The incident remains under investigation.', W / 2, 1030, { size: 22, weight: 500, color: 'rgba(242,244,246,0.5)', alpha: appear(t, 2.6) });
      fill(ctx, '#000', ease((t - 6.5) / 0.5));
    });

    // --- C · the in-game cutscene
    status.stage = 'cutscene';
    g.launchFlight();
    markEvent('cutscene');
    const cine = g.cinematic;
    const ov = g.overlay;
    const beats = [['attack', CINE.emergency], ['dive', 11.6], ['cabin', 20.6], ['door', 29.5], ['rush', 33.4], ['restrain', CINE.transfer], ['takecontrol', CINE.takeControl]];
    let lb = 0;
    let altA = 0;
    let cap = { text: '', kind: '', since: 0, prev: '', prevKind: '', prevSince: -9 };
    let ct = 0;
    let afterCine = 0;
    while (true) {
      const inCine = g.sm.inCinematic;
      if (!inCine) afterCine += 1 / FPS;
      if (afterCine > 1.4) break;
      for (let i = 0; i < 4; i++) g.fixedUpdate(1 / 120);
      g.update(1 / FPS);
      R.render();
      ct += 1 / FPS;
      for (const b of beats) if (!b.done && cine.time >= b[1]) {
        b.done = true;
        markEvent(b[0]);
      }
      ctx.drawImage(gl, 0, 0, W, H);
      // Cinematic overlay, redrawn from the game's own overlay state.
      const fade = Number(ov.fade.style.opacity || 0);
      fill(ctx, '#000', fade);
      const lbOn = ov.el.classList.contains('letterbox') && inCine;
      lb += ((lbOn ? 97 : 0) - lb) * 0.18;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, lb);
      ctx.fillRect(0, H - lb, W, lb);
      const altOn = ov.altBox.classList.contains('on') && inCine;
      altA += ((altOn ? 1 : 0) - altA) * 0.25;
      if (altA > 0.02) {
        const y0 = lb + 26;
        panel(ctx, 64, y0, 380, ov.vs.textContent ? 168 : 128, altA);
        text(ctx, 'ALTITUDE', 92, y0 + 40, { size: 20, weight: 700, align: 'left', track: 6, color: 'rgba(255,255,255,0.75)', alpha: altA });
        text(ctx, `${ov.alt.textContent}`, 88, y0 + 106, { size: 68, weight: 600, align: 'left', font: MONO, alpha: altA });
        ctx.font = `600 68px ${MONO}`;
        text(ctx, 'FT', 98 + ctx.measureText(ov.alt.textContent).width, y0 + 106, { size: 26, weight: 700, align: 'left', color: 'rgba(255,255,255,0.7)', alpha: altA });
        if (ov.vs.textContent) text(ctx, ov.vs.textContent, 92, y0 + 146, { size: 26, weight: 600, align: 'left', font: MONO, color: ov.vs.classList.contains('alarm') ? '#ff7a6b' : 'rgba(232,236,241,0.85)', alpha: altA });
      }
      const capText = inCine ? ov.caption.textContent : '';
      const kind = ov.caption.classList.contains('alert') ? 'alert' : ov.caption.classList.contains('card') ? 'card' : '';
      if (capText !== cap.text) cap = { text: capText, kind, since: ct, prev: cap.text, prevKind: cap.kind, prevSince: ct };
      const drawCap = (str, k, a) => {
        if (!str || a <= 0) return;
        const size = k === 'alert' || k === 'card' ? 34 : 38;
        ctx.save();
        ctx.font = `${k ? 700 : 600} ${size}px ${k ? MONO : SANS}`;
        if (k) ctx.letterSpacing = '3px';
        const tw = Math.min(W - 200, ctx.measureText(str).width);
        ctx.restore();
        panel(ctx, W / 2 - tw / 2 - 30, H - 150 - size - 14, tw + 60, size + 40, a, k === 'alert' ? 'rgba(40,12,8,0.7)' : 'rgba(4,15,28,0.62)');
        text(ctx, str, W / 2, H - 150, { size, weight: k ? 700 : 600, font: k ? MONO : SANS, color: k === 'alert' ? '#ffc04d' : WHITE, alpha: a, track: k ? 3 : 0, rise: 8 });
      };
      drawCap(cap.prev, cap.prevKind, 1 - ease((ct - cap.prevSince) / 0.4));
      drawCap(cap.text, cap.kind, ease((ct - cap.since) / 0.45));
      if (cine.time >= CINE.takeControl || !inCine) {
        const tk = inCine ? cine.time - CINE.takeControl : CINE.end - CINE.takeControl + afterCine;
        const ta = appear(tk, 0, 0.35);
        ctx.save();
        ctx.globalAlpha = ta * 0.7;
        const band = ctx.createLinearGradient(0, H * 0.36 - 170, 0, H * 0.36 + 130);
        band.addColorStop(0, 'rgba(4,23,42,0)');
        band.addColorStop(0.3, 'rgba(4,23,42,1)');
        band.addColorStop(0.75, 'rgba(4,23,42,1)');
        band.addColorStop(1, 'rgba(4,23,42,0)');
        ctx.fillStyle = band;
        ctx.fillRect(0, H * 0.36 - 170, W, 300);
        ctx.restore();
        text(ctx, 'TAKE CONTROL', W / 2, H * 0.36, { size: 110, weight: 800, track: 22, alpha: ta, rise: 10 });
        text(ctx, 'Stabilize the aircraft', W / 2, H * 0.36 + 70, { size: 36, weight: 600, color: ORANGE, alpha: appear(tk, 0.25, 0.4) });
      }
      watermark(ctx, mark, inCine ? 0.8 : 0.6);
      fill(ctx, '#000', 1 - ease(ct / 0.5));
      await emit();
    }

    // --- D · your turn (2.6 s)
    status.stage = 'turn';
    markEvent('turn');
    const st = { thrI: 0, lastCfg: -9, t: 0 };
    const sim = (renderIt) => {
      for (let i = 0; i < 2; i++) {
        autopilot(g, st);
        g.fixedUpdate(1 / 120);
        g.fixedUpdate(1 / 120);
        g.update(1 / 60);
        st.t += 1 / 60;
      }
      if (renderIt) R.render();
    };
    // The aircraft keeps flying under the card.
    await clip(3.2, (t) => {
      sim(false);
      fill(ctx, NAVY);
      text(ctx, 'YOU BOARDED AS A PASSENGER', W / 2, 400, { size: 26, weight: 600, color: 'rgba(242,244,246,0.6)', font: MONO, track: 5, alpha: appear(t, 0.1) });
      text(ctx, "Now you're the off-duty pilot.", W / 2, 510, { size: 92, weight: 800, alpha: appear(t, 0.3), rise: 20 });
      text(ctx, 'Recover the aircraft. Divert to Tabuk. Land.', W / 2, 600, { size: 42, weight: 600, color: ORANGE, alpha: appear(t, 0.8), rise: 14 });
      fill(ctx, '#000', ease((t - 2.8) / 0.4));
    });

    // --- E · gameplay shots
    status.stage = 'gameplay';
    markEvent('gameplay');
    const setCam = (mode) => {
      g.cameraMode = mode;
      g.cameraCtl.setMode(mode);
    };
    const shoot = async (seconds, caption, sub, stop = () => false) => {
      let t = 0;
      const n = Math.round(seconds * FPS);
      for (let i = 0; i < n && !stop(); i++, t += 1 / FPS) {
        sim(true);
        ctx.drawImage(gl, 0, 0, W, H);
        shotTitle(ctx, caption, t, sub);
        watermark(ctx, mark, 0.75);
        fill(ctx, '#000', 1 - ease(t / 0.35));
        await emit();
      }
    };
    const fastForward = (until, maxSec = 400) => {
      for (let i = 0; i < maxSec * 30 && !until(); i++) sim(false);
    };

    setCam('cockpit');
    await shoot(4.5, 'Recover the aircraft', 'Level the wings · arrest the dive · stabilize');
    fastForward(() => g.mission.phaseIndex >= 2 && g.tele.altFt < 13000);
    setCam('chase');
    await shoot(4.5, 'Divert to Tabuk', 'Emergency descent toward runway 24');
    fastForward(() => g.mission.phaseIndex >= 4 && g.tele.alongTrack < 1800);
    setCam('cockpit');
    await shoot(5, 'Line up with runway 24', 'Gear down · full flaps · follow the glide path');
    fastForward(() => g.tele.aglFt < 70 || g.fm.onGround);
    setCam('chase');
    let touchedAt = null;
    await shoot(18, 'Land it safely', 'Bring all 172 people home', () => {
      if (touchedAt === null && g.fm.onGround) {
        touchedAt = status.frame;
        markEvent('touchdown');
      }
      return touchedAt !== null && status.frame - touchedAt > 4 * FPS;
    });

    // Keep the last landing frame as the end-card background.
    const last = document.createElement('canvas');
    last.width = W;
    last.height = H;
    R.render();
    last.getContext('2d').drawImage(gl, 0, 0, W, H);

    // --- F · end card (6 s)
    status.stage = 'end';
    markEvent('end');
    await clip(6, (t) => {
      fill(ctx, '#000');
      ctx.save();
      ctx.filter = 'blur(10px)';
      const z = 1.06 + t * 0.008;
      ctx.drawImage(last, (W - W * z) / 2, (H - H * z) / 2, W * z, H * z);
      ctx.restore();
      fill(ctx, NAVY, 0.68 * ease(t / 0.8) + 0.0);
      const a = appear(t, 0.2, 0.8);
      ctx.save();
      ctx.globalAlpha = a;
      const lw = 300;
      const lh = (glowLogo.height / glowLogo.width) * lw;
      ctx.drawImage(glowLogo, W / 2 - lw / 2, 250 - (1 - a) * 20, lw, lh);
      ctx.restore();
      wordmark(ctx, W / 2, 610, 120, appear(t, 0.6, 0.7));
      text(ctx, 'Real incident  →  virtual experience', W / 2, 700, { size: 40, weight: 600, alpha: appear(t, 1.2, 0.7) });
      text(ctx, 'FLY FZ1073 NOW', W / 2, 800, { size: 30, weight: 700, color: ORANGE, font: MONO, track: 6, alpha: appear(t, 1.8, 0.6) });
      text(ctx, 'Fictionalized reconstruction of publicly reported events · Not affiliated with or endorsed by flydubai', W / 2, 1020, { size: 22, weight: 500, color: 'rgba(242,244,246,0.55)', alpha: appear(t, 2.2, 0.6) });
      fill(ctx, '#000', ease((t - 5.4) / 0.6));
    });
    markEvent('done');

    await fetch(`${sink}/timeline`, { method: 'POST', body: JSON.stringify(timeline) });
    status.stage = 'done';
    status.done = true;
    status.timeline = timeline;
  } catch (err) {
    status.error = String(err && err.stack ? err.stack : err);
  }
  return status;
}
