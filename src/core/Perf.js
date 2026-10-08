// FPS monitor with adaptive resolution. When the frame rate stays low the
// render resolution steps down; when there is headroom it steps back up.
// If a step down does not actually raise the frame rate (the browser is
// v-synced / throttled rather than GPU-bound) it is undone and adaptation
// pauses, so quality is never sacrificed for nothing.

export class PerfMonitor {
  constructor(renderer, settings) {
    this.renderer = renderer;
    this.settings = settings;
    this.fps = 60;
    this.low = 0;
    this.high = 0;
    this.scale = 1;
    this.probe = null; // { fpsBefore, prevScale, t }
    this.cooldown = 0;
    this.el = document.createElement('div');
    this.el.className = 'fps-counter';
    document.body.appendChild(this.el);
    this.textTimer = 0;
    this.debug = new URLSearchParams(location.search).has('debug');
    this.applyVisibility();
    settings.onChange((k) => {
      if (k === 'showFps') this.applyVisibility();
      if (k === 'autoResolution' && !settings.get('autoResolution')) this.setScale(1);
    });
  }

  applyVisibility() {
    this.el.style.display = this.settings.get('showFps') || this.debug ? 'block' : 'none';
  }

  setScale(s) {
    this.scale = s;
    this.renderer.setDynamicScale(s);
  }

  update(dt) {
    if (dt <= 0) return;
    this.fps += (1 / dt - this.fps) * 0.05;
    if (this.settings.get('autoResolution')) this.adapt(dt);

    this.textTimer -= dt;
    if (this.textTimer <= 0 && this.el.style.display !== 'none') {
      this.textTimer = 0.5;
      const info = this.renderer.renderer.info;
      let txt = `${Math.round(this.fps)} FPS`;
      if (this.debug) {
        txt += ` · ${info.render.calls} calls · ${(info.render.triangles / 1000).toFixed(0)}k tris · x${this.scale.toFixed(2)}`;
      }
      this.el.textContent = txt;
    }
  }

  adapt(dt) {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }
    if (this.probe) {
      this.probe.t += dt;
      if (this.probe.t < 4) return;
      if (this.fps < this.probe.fpsBefore * 1.1) {
        // Lower resolution did not help: restore and back off for a while.
        this.setScale(this.probe.prevScale);
        this.cooldown = 60;
      }
      this.probe = null;
      this.low = this.high = 0;
      return;
    }
    if (this.fps < 48) {
      this.low += dt;
      this.high = 0;
    } else if (this.fps > 58) {
      this.high += dt;
      this.low = 0;
    } else {
      this.low = this.high = 0;
    }
    if (this.low > 3 && this.scale > 0.55) {
      this.probe = { fpsBefore: this.fps, prevScale: this.scale, t: 0 };
      this.setScale(Math.max(0.55, this.scale - 0.15));
      this.low = 0;
    } else if (this.high > 10 && this.scale < 1) {
      this.setScale(Math.min(1, this.scale + 0.1));
      this.high = 0;
    }
  }
}
