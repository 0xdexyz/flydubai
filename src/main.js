// FlyDubaiSim — entry point.
import './ui/styles.css';
import { Game } from './game/Game.js';

// Development only (removed from the production build): open /?reset=1 once to wipe this browser's
// saved game data (pilot sign-in, stats, settings), then continue on a clean URL.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('reset')) {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('skyrecovery.')).forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
  location.replace(location.pathname);
}

function boot() {
  const loader = document.getElementById('boot');
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) throw new Error('WebGL unavailable');
  } catch {
    loader.innerHTML = '<div class="boot-error">This game needs WebGL. Please enable hardware acceleration or try a different browser.</div>';
    return;
  }
  // Let the loading screen paint before the (short) world build. A timeout
  // (not rAF) so the game still boots in a background tab.
  setTimeout(() => {
    const t0 = performance.now();
    new Game(document.getElementById('app'), document.getElementById('ui'));
    console.info(`[boot] game ready in ${Math.round(performance.now() - t0)} ms`);
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 600);
  }, 50);
}

boot();
