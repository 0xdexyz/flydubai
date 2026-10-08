// Synthetic voice callouts ("Sink rate", "Five hundred", "Retard") using the
// browser's built-in speech synthesis. Optional, rate-limited, and silently
// disabled where the API is unavailable.

export class Callouts {
  constructor(settings) {
    this.settings = settings;
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.voice = null;
    this.last = new Map();
    if (this.supported) {
      const pick = () => {
        const voices = window.speechSynthesis.getVoices();
        this.voice = voices.find((v) => /en[-_]US/i.test(v.lang) && /male|david|guy|daniel/i.test(v.name)) ||
          voices.find((v) => /^en/i.test(v.lang)) || null;
      };
      pick();
      window.speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  say(text, { cooldown = 3.5, interrupt = false } = {}) {
    if (!this.supported || !this.settings.get('voice')) return;
    const now = performance.now();
    if (now - (this.last.get(text) || 0) < cooldown * 1000) return;
    this.last.set(text, now);
    const synth = window.speechSynthesis;
    if (interrupt) synth.cancel();
    if (synth.speaking && !interrupt && synth.pending) return; // don't pile up
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.12;
    u.pitch = 0.82;
    u.volume = Math.min(1, this.settings.get('volume') * 1.1);
    if (this.voice) u.voice = this.voice;
    synth.speak(u);
  }

  cancel() {
    if (this.supported) window.speechSynthesis.cancel();
    this.last.clear();
  }
}
