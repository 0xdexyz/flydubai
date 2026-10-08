// Persisted player settings. Every storage access is guarded: private windows
// and blocked storage simply fall back to defaults.

const KEY = 'skyrecovery.settings.v1';

export const DEFAULT_SETTINGS = {
  quality: 'medium', // low | medium | high
  autoResolution: true,
  antialias: true, // applied on next load
  fov: 56,
  volume: 0.8,
  voice: true,
  invertPitch: false,
  guides: true,
  showControls: true,
  showFps: false,
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULT_SETTINGS };
    this.listeners = new Set();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.values, JSON.parse(raw));
    } catch {
      /* storage unavailable */
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      /* ignore */
    }
    for (const fn of this.listeners) fn(key, value);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
