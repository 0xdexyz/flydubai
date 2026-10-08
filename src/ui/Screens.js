// Menu, leaderboard, how-to, settings, pause and result screens.
// Plain DOM: each screen is built once and toggled, never re-created.

import { formatInt } from '../core/MathUtil.js';
import { ago } from '../online/OnlineService.js';
import { LAMPORTS, sol, short, explorerTx, connectPhantom, disconnectPhantom, phantomProvider } from '../wallet/GameWallet.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Real geography, simple projection (x = (lon - 33.5) * 20, y = (33 - lat) * 20):
// DXB 25.25N 55.36E, TLV 32.0N 34.88E, TUU 28.37N 36.62E. FZ1073's track runs
// toward Tel Aviv, breaks off near the Saudi-Jordanian border, swings west into
// Jordanian airspace and turns back south to Tabuk.
const TRACK = 'M437 155 L100 44 Q52 26 62 92';
const ROUTE_MAP = `
<svg class="route-map" viewBox="0 0 480 190" role="img" aria-label="FZ1073 track: Dubai toward Tel Aviv, diverted to Tabuk">
  <defs><pattern id="rm-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/></pattern></defs>
  <rect width="480" height="190" fill="url(#rm-grid)"/>
  <text class="rm-region" x="250" y="118">SAUDI ARABIA</text>
  <text class="rm-region" x="112" y="16">JORDAN</text>
  <text class="rm-region" x="14" y="158">RED SEA</text>
  <path class="rm-planned" d="M437 155 L27.6 20"/>
  <path class="rm-track" d="${TRACK}" pathLength="100"/>
  <g class="rm-ap"><circle cx="437" cy="155" r="4"/><text x="444" y="168">DXB</text></g>
  <g class="rm-ap muted"><circle cx="27.6" cy="20" r="3.5"/><text x="34" y="14">TLV</text></g>
  <g class="rm-ap dest"><circle cx="62.4" cy="92.6" r="5"/><text x="72" y="104">TUU</text></g>
  <g class="rm-ev ev1"><circle cx="100" cy="44" r="3.5"/><text x="106" y="58">05:21 UTC</text></g>
  <g class="rm-ev ev2"><circle cx="64" cy="44" r="3.5"/><text x="24" y="60">05:35 · 7500</text></g>
  <g class="rm-ev ev3"><text x="72" y="118">06:45 · landed</text></g>
  <g class="rm-plane"><path transform="translate(-8 -8) scale(0.5)" d="M30 14.6 19.4 12 13.2 2.4h-2.6l3.2 9.2-6.9-1.4-2.6-3.6H2.4l1.6 6.2-1.6 6.2h1.9l2.6-3.6 6.9-1.4-3.2 9.2h2.6l6.2-9.6L30 17.4c.9-.2.9-2.6 0-2.8z"/>
    <animateMotion dur="9s" repeatCount="indefinite" rotate="auto" keyPoints="0;1;1" keyTimes="0;0.8;1" calcMode="linear" path="${TRACK}"/></g>
</svg>`;

const TICKER = [
  'FLYDUBAI FZ1073 · BOEING 737 MAX 8',
  '03:05 UTC DEPARTED DUBAI (DXB) FOR TEL AVIV (TLV)',
  '05:21 ATTACK ON THE FLIGHT DECK',
  'THE AIRCRAFT PLUNGES AND ROLLS',
  '05:28 SQUAWK 7700',
  'PASSENGERS, CREW AND TWO OFF-DUTY PILOTS TAKE BACK THE FLIGHT DECK',
  '05:33 ABOUT 15,000 FT',
  '05:35 SQUAWK 7500',
  'TURNS WEST INTO JORDANIAN AIRSPACE, THEN BACK TOWARD TABUK',
  '06:45 LANDED AT TABUK (TUU)',
  'ALL 172 ON BOARD SAFE',
].map((t) => `<span>${t}</span>`).join('');

const MENU = `
<div class="lx-art" aria-hidden="true"><img src="brand/home-hero.webp" alt="" draggable="false"></div>
<div class="lx-shade"></div>
<header class="lx-top">
  <div class="lx-brand"><img class="lx-logo" src="brand/logo-mark.png" alt="FlyDubaiSIM"><div><b>FlyDubai<i>SIM</i></b><span>FLYDUBAI FZ1073 · THE TABUK DIVERSION</span></div></div>
  <nav class="lx-tabs">
    <button class="on" data-go="home">PLAY</button>
    <button data-go="pilot">PILOT</button>
    <button data-go="wallet">WALLET</button>
    <button data-go="leaderboard">LEADERBOARD</button>
    <button data-go="howto">HOW TO PLAY</button>
    <button data-go="settings">SETTINGS</button>
    <span class="lx-tab-ind"></span>
  </nav>
  <div class="lx-user">
    <button class="lx-fp lx-sol" data-go="wallet" title="Wallet"><span class="sol-mark">◎</span><b data-bind="sol">0.00</b><em>SOL</em></button>
    <button class="lx-pilot" data-go="pilotchip"><span class="lx-avatar" data-bind="initials">P</span><span class="lx-who"><b data-bind="callsign"></b><em data-bind="rank"></em></span></button>
  </div>
</header>
<main class="lx-center">
  <h1 class="sr-only">FlyDubaiSim: the Tabuk diversion of flydubai flight FZ1073</h1>
  <div class="lx-kicker lx-rise" style="--d:0.1s"><span class="pulse"></span>FLYDUBAI · FLIGHT FZ1073 · BOEING 737 MAX 8 · 30 SEPTEMBER 2026</div>
  <div class="flap lx-rise" style="--d:0.2s">
    <div class="flap-col"><span class="flap-h">FLIGHT</span><div class="flap-row" data-flap="FZ1073"></div></div>
    <div class="flap-col"><span class="flap-h">FROM</span><div class="flap-row" data-flap="DXB"></div></div>
    <div class="flap-col"><span class="flap-h">TO</span><div class="flap-row strike" data-flap="TLV"></div></div>
    <div class="flap-col"><span class="flap-h">STATUS</span><div class="flap-row alert" data-flap="DIVERTED TUU"></div></div>
  </div>
  <div class="lx-cta lx-rise" style="--d:0.32s">
    <button class="lx-play" data-go="play"><span class="lx-play-icon"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></span><span class="lx-play-txt"><b>FLY FZ1073</b><em>FREE · CINEMATIC + FLIGHT · ENTER</em></span><span class="lx-play-arrow">→</span></button>
    <button class="lx-ghost" data-go="howto">BRIEFING</button>
  </div>
  <p class="lx-facts lx-rise" style="--d:0.42s"><span data-bind="rewardfact">+0.01 SOL for a safe landing</span><span>About 3 minutes</span><span><b data-bind="landings" data-count>0</b> safe landings</span><span>Softest <b data-bind="sink">—</b></span></p>
</main>
<section class="lx-row">
  <section class="lx-card lx-map lx-rise" style="--d:0.5s">
    <header><span>FZ1073 · TRACK REPLAY</span><em class="lx-live"><i></i>REPLAY</em></header>
    ${ROUTE_MAP}
  </section>
  <section class="lx-card lx-rise" style="--d:0.58s">
    <header><span>PILOT</span><button class="lx-link" data-go="pilotchip">PROFILE</button></header>
    <div class="lx-rank"><div class="lx-badge" data-bind="badge"></div><div class="lx-rank-txt"><b data-bind="rank2"></b><em data-bind="nextrank"></em><div class="lx-bar"><i data-bind="rankbar"></i></div></div></div>
    <div class="lx-stats">
      <div><span>FLIGHTS</span><b data-bind="flights" data-count>0</b></div>
      <div><span>SUCCESS</span><b data-bind="rate">—</b></div>
      <div><span>SOFTEST TOUCHDOWN</span><b data-bind="sink">—</b></div>
      <div><span>FLIGHT POINTS</span><b data-bind="fp" data-count>0</b></div>
    </div>
  </section>
  <section class="lx-card lx-livecard lx-rise" style="--d:0.66s">
    <header><span>LIVE LEADERBOARD</span><em class="lx-live" data-bind="online"><i></i>OFFLINE</em></header>
    <ol class="lx-top5" data-bind="top5"><li class="empty">Connecting…</li></ol>
    <div class="lx-lastfeed" data-bind="lastfeed"></div>
    <button class="lx-link lx-viewall" data-go="leaderboard">VIEW FULL LEADERBOARD →</button>
  </section>
</section>
<footer class="lx-foot"><p class="disclaimer">Fictionalized gameplay reconstruction inspired by publicly reported events surrounding flydubai flight FZ1073. Not affiliated with or endorsed by flydubai. <span data-bind="version"></span></p></footer>
<div class="lx-ticker"><span class="lx-ticker-tag"><i></i>FZ1073</span><div class="lx-ticker-window"><div class="lx-ticker-track"><div>${TICKER}</div><div aria-hidden="true">${TICKER}</div></div></div></div>
`;

const PILOT = `
<div class="panel wide pilot-panel">
  <header><h2>PILOT PROFILE</h2><button class="close" data-go="back" aria-label="Close">✕</button></header>
  <div class="pilot-head">
    <div class="lx-badge big" data-bind="badge"></div>
    <div class="pilot-id">
      <b data-bind="callsign"></b>
      <em data-bind="rank"></em>
      <div class="lx-bar"><i data-bind="rankbar"></i></div>
      <span class="pilot-next" data-bind="nextrank"></span>
    </div>
    <div class="pilot-fp"><span>FLIGHT POINTS</span><b data-bind="fp">0</b></div>
  </div>
  <div class="pilot-stats">
    <div><span>FLIGHTS</span><b data-bind="flights">0</b></div>
    <div><span>SAFE LANDINGS</span><b data-bind="landings">0</b></div>
    <div><span>FLIGHTS LOST</span><b data-bind="lost">0</b></div>
    <div><span>SUCCESS RATE</span><b data-bind="rate">—</b></div>
    <div><span>HARD LANDINGS</span><b data-bind="hard">0</b></div>
    <div><span>SOFTEST TOUCHDOWN</span><b data-bind="sink">—</b></div>
    <div><span>BUTTER LANDINGS</span><b data-bind="butter">0</b></div>
    <div><span>PILOT SINCE</span><b data-bind="since">—</b></div>
  </div>
  <h3 class="pilot-h3">FLIGHT LOG</h3>
  <div class="board ui-scroll"><table><thead><tr><th>Date</th><th>Result</th><th class="num">Touchdown</th><th class="num">FP</th></tr></thead><tbody data-bind="log"></tbody></table></div>
  <div class="pilot-ranks" data-bind="ranks"></div>
</div>`;

// Ranks are earned with safe landings.
export const RANKS = [
  { name: 'CADET', at: 0 },
  { name: 'SECOND OFFICER', at: 1 },
  { name: 'FIRST OFFICER', at: 3 },
  { name: 'CAPTAIN', at: 7 },
  { name: 'SENIOR CAPTAIN', at: 15 },
  { name: 'TRAINING CAPTAIN', at: 30 },
];

export function rankFor(landings) {
  let i = 0;
  while (i + 1 < RANKS.length && landings >= RANKS[i + 1].at) i++;
  const next = RANKS[i + 1];
  const cur = RANKS[i];
  return {
    index: i,
    name: cur.name,
    next,
    progress: next ? (landings - cur.at) / (next.at - cur.at) : 1,
    toNext: next ? next.at - landings : 0,
  };
}

const badgeHtml = (i) => `<span class="bars">${'<i></i>'.repeat(Math.min(4, i + 1))}</span>${i >= 4 ? '<span class="star">★</span>' : ''}`;

const HOWTO = `
<div class="panel wide">
  <header><h2>HOW TO PLAY</h2><button class="close" data-go="back" aria-label="Close">✕</button></header>
  <div class="howto ui-scroll">
    <section>
      <h3>THE FLIGHT</h3>
      <ol class="phases">
        <li><b>RECOVERY</b><span>You take over at about 15,800 ft with the aircraft still unstable and too fast. Level the wings, stop the descent and bring the speed below 300 kt. Then hold steady flight through turbulence until the stability meter stays high.</span></li>
        <li><b>EMERGENCY DIVERSION</b><span>Turn toward Tabuk. Follow the arrow and the distance readout, and descend and slow down as the targets ask.</span></li>
        <li><b>TABUK APPROACH</b><span>Lower the gear (G), set full flaps (F), keep the speed at or below 185 kt and line up with runway 24.</span></li>
        <li><b>LANDING</b><span>Keep the aircraft icon under the runway symbol and the diamond centred (PAPI: two white, two red). Flare at 30 ft, touch down, then brake to a stop.</span></li>
      </ol>
    </section>
    <section>
      <h3>CONTROLS</h3>
      <div class="ctrl-table">
        <div><kbd>W</kbd><kbd>S</kbd> / <kbd>↑</kbd><kbd>↓</kbd><span>Pitch — S / ↓ raises the nose</span></div>
        <div><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd><span>Roll (bank to turn)</span></div>
        <div><kbd>Q</kbd><kbd>E</kbd><span>Rudder · nose-wheel steering on the ground</span></div>
        <div><kbd>SHIFT</kbd><kbd>Z</kbd><span>Throttle up / down (mouse wheel works too)</span></div>
        <div><kbd>G</kbd><span>Landing gear</span></div>
        <div><kbd>F</kbd><kbd>R</kbd><span>Flaps down / up</span></div>
        <div><kbd>B</kbd> / <kbd>SPACE</kbd><span>Wheel brakes · speed brakes in the air</span></div>
        <div><kbd>C</kbd><span>Cockpit / chase camera</span></div>
        <div><kbd>ESC</kbd><span>Pause</span></div>
      </div>
      <p class="hint">Release the keys and the aircraft holds its attitude, so fly with short, smooth inputs.</p>
    </section>
    <section>
      <h3>REWARDS</h3>
      <div class="score-table">
        <div><span>Flight</span><b>Free</b></div>
        <div><span>Safe landing</span><b data-bind="hw-reward">+0.01 SOL</b></div>
        <div><span>Crash or lost flight</span><b>No reward</b></div>
        <div><span>Withdraw from</span><b data-bind="hw-min">0.05 SOL</b></div>
      </div>
      <p class="hint">Flight Points are also <b>paid only when you land safely</b>. A careful flight takes about 3 minutes, but there is no time limit, and if a landing doesn't work out you can go around and try again.</p>
      <p class="hint" data-bind="hw-net"></p>
    </section>
  </div>
</div>`;

const SETTINGS = `
<div class="panel">
  <header><h2>SETTINGS</h2><button class="close" data-go="back" aria-label="Close">✕</button></header>
  <div class="settings ui-scroll">
    <label class="row"><span>Graphics quality</span>
      <div class="seg" data-setting="quality"><button data-v="low">LOW</button><button data-v="medium">MEDIUM</button><button data-v="high">HIGH</button></div>
    </label>
    <label class="row"><span>Auto resolution <small>keeps the frame rate smooth</small></span><input type="checkbox" data-setting="autoResolution"></label>
    <label class="row"><span>Anti-aliasing <small>applies after reload</small></span><input type="checkbox" data-setting="antialias"></label>
    <label class="row"><span>Field of view <small data-out="fov"></small></span><input type="range" min="50" max="80" step="1" data-setting="fov"></label>
    <label class="row"><span>Volume <small data-out="volume"></small></span><input type="range" min="0" max="1" step="0.05" data-setting="volume"></label>
    <label class="row"><span>Voice callouts</span><input type="checkbox" data-setting="voice"></label>
    <label class="row"><span>Invert pitch <small>W raises the nose</small></span><input type="checkbox" data-setting="invertPitch"></label>
    <label class="row"><span>Approach guide gates</span><input type="checkbox" data-setting="guides"></label>
    <label class="row"><span>On-screen controls</span><input type="checkbox" data-setting="showControls"></label>
    <label class="row"><span>Show FPS</span><input type="checkbox" data-setting="showFps"></label>
    <label class="row"><span>Pilot name <small data-out="pilotnote"></small></span><input type="text" maxlength="12" class="callsign-input" spellcheck="false"></label>
    <div class="row"><span>Live leaderboard name <small>Claim a different name (your old name keeps its results)</small></span><button class="btn small" data-go="signin-change">CHANGE</button></div>
    <div class="row"><span>Progress <small>Flight Points, stats and flight log on this device</small></span><button class="btn small danger" data-go="reset-progress">RESET</button></div>
  </div>
</div>`;

const LEADERBOARD = `
<div class="panel wide">
  <header><h2>LEADERBOARD</h2><span class="lb-status" data-bind="lbstatus"></span><button class="close" data-go="back" aria-label="Close">✕</button></header>
  <div class="tabs"><button data-tab="global" class="on">All time</button><button data-tab="daily">Today</button><button data-tab="mine">My flights</button><span class="lb-me" data-bind="lbme"></span></div>
  <div class="lb-grid">
    <div class="board ui-scroll"><table><thead></thead><tbody></tbody></table></div>
    <aside class="lb-feed"><h3><span class="lx-live"><i></i>LIVE</span> Latest flights</h3><ul data-bind="feed"></ul></aside>
  </div>
  <p class="board-note">Real pilots, live. FZ1073 landings at Tabuk (TUU), ranked by each pilot's softest safe touchdown. Updates the moment anyone lands.</p>
</div>`;

const PAUSE = `
<div class="panel narrow">
  <header><h2>PAUSED</h2></header>
  <div class="stack">
    <button class="btn primary" data-go="resume">RESUME <kbd>ESC</kbd></button>
    <button class="btn" data-go="play">RESTART SCENARIO</button>
    <button class="btn" data-go="settings">SETTINGS</button>
    <button class="btn" data-go="menu">MAIN MENU</button>
  </div>
</div>`;

const RESULTS = `
<div class="panel results-panel">
  <div class="res-status"><span class="dot"></span><span class="res-kicker"></span></div>
  <h2 class="res-title"></h2>
  <p class="res-reason"></p>
  <div class="res-grid">
    <section class="res-section">
      <h3>Landing report</h3>
      <dl class="res-dl"></dl>
    </section>
    <section class="res-section res-reward">
      <h3>Reward</h3>
      <div class="res-fp"><b></b><span></span></div>
      <dl class="res-dl res-money"></dl>
    </section>
  </div>
  <div class="res-buttons"><button class="btn primary" data-go="play"></button><button class="btn" data-go="menu">Main menu</button></div>
</div>`;

const PAY = `
<div class="panel narrow pay-panel">
  <header><h2>Board flydubai FZ1073</h2><button class="close" data-go="back" aria-label="Close">✕</button></header>
  <div class="pay-route"><span>DXB</span><i></i><span class="x">TLV</span><i></i><span class="to">TUU</span><em>Boeing 737 MAX 8 · Tabuk diversion · about 3 minutes</em></div>
  <dl class="pay-dl">
    <div><dt>Flight</dt><dd>Free</dd></div>
    <div><dt>Safe landing reward</dt><dd class="pos" data-bind="reward">+0.01 SOL</dd></div>
    <div><dt>Crash or lost flight</dt><dd>No reward</dd></div>
    <div class="sep"><dt>Your rewards</dt><dd data-bind="bal"></dd></div>
  </dl>
  <p class="pay-warn hidden" data-bind="warn"></p>
  <button class="btn primary pay-confirm" data-go="pay-confirm">Board <kbd>ENTER</kbd></button>
  <p class="pay-note" data-bind="paynote"></p>
</div>`;

const WALLET = `
<div class="panel wide wallet-panel">
  <header><h2>Wallet</h2><button class="close" data-go="back" aria-label="Close">✕</button></header>
  <div class="wl-top">
    <div class="wl-balance"><span>Rewards available</span><b data-bind="bal">0.00 SOL</b></div>
    <div class="wl-figs">
      <div><span>Paid landings today</span><b data-bind="paid">0</b></div>
      <div><span>Rewards earned</span><b data-bind="earned">0.00</b></div>
      <div><span>Withdrawn</span><b data-bind="withdrawn">0.00</b></div>
    </div>
  </div>
  <div class="wl-grid">
    <section class="wl-card">
      <h3>Withdrawal address</h3>
      <div class="wl-addr" data-bind="addr">No wallet connected</div>
      <div class="wl-actions">
        <button class="btn small primary wl-connect" data-go="wallet-connect">Connect Phantom</button>
        <button class="btn small wl-disconnect hidden" data-go="wallet-disconnect">Disconnect</button>
      </div>
      <p class="wl-hint" data-bind="phantom"></p>
    </section>
    <section class="wl-card">
      <h3>Withdraw</h3>
      <div class="wl-progress"><div class="lx-bar"><i data-bind="wbar"></i></div><span data-bind="wtext"></span></div>
      <button class="btn small primary wl-withdraw" data-go="wallet-withdraw">Withdraw to Phantom</button>
      <div class="wl-pool hidden"><span>Payout pool</span><b data-bind="pool">—</b></div>
      <p class="wl-hint" data-bind="wstatus"></p>
    </section>
  </div>
  <section class="wl-card wl-ownerbox hidden">
    <h3>Owner</h3>
    <div class="wl-ownerrow"><span>Payout wallet</span><b data-bind="ow-addr">—</b></div>
    <div class="wl-ownerrow"><span>Wallet balance</span><b data-bind="ow-main">—</b></div>
    <div class="wl-ownerrow"><span>Payout pool</span><b data-bind="ow-dev">—</b></div>
  </section>
  <p class="wl-hint wl-owner" data-bind="wowner"></p>
  <h3 class="pilot-h3">Transactions</h3>
  <div class="board ui-scroll wl-txs"><table><thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead><tbody data-bind="txs"></tbody></table></div>
</div>`;

const SIGNIN = `
<div class="panel narrow signin-panel">
  <header><h2>Choose your pilot name</h2><button class="close" data-go="back" aria-label="Close">✕</button></header>
  <p class="si-sub">Your name goes on the live FZ1073 leaderboard, next to every landing you make at Tabuk.</p>
  <label class="si-field"><span>Pilot name</span><input class="si-input" maxlength="16" placeholder="e.g. Capt_Sam" spellcheck="false" autocomplete="off"></label>
  <p class="si-rules">3–16 letters, numbers, _ or -. Names are unique.</p>
  <p class="si-error hidden"></p>
  <button class="btn primary si-submit" data-go="signin-submit">Claim name <kbd>ENTER</kbd></button>
  <button class="btn si-skip" data-go="back">Not now</button>
</div>`;

const OVERLAYS = new Set(['howto', 'settings', 'leaderboard', 'pilot', 'pay', 'wallet', 'signin']);

export class Screens {
  constructor(root, game) {
    this.game = game;
    this.root = root;
    this.screens = {};
    this.current = null;
    this.modalReturn = null;

    this.make('menu', 'screen menu', MENU);
    this.make('howto', 'screen modal', HOWTO);
    this.make('settings', 'screen modal', SETTINGS);
    this.make('leaderboard', 'screen modal', LEADERBOARD);
    this.make('pilot', 'screen modal', PILOT);
    this.make('pay', 'screen modal', PAY);
    this.make('wallet', 'screen modal', WALLET);
    this.make('signin', 'screen modal', SIGNIN);
    this.bindSignin();
    game.online.on((ev) => this.onOnline(ev));
    game.wallet.onChange(() => {
      this.refreshSol();
      if (this.current === 'wallet') this.renderWallet();
      if (this.current === 'pay') this.renderPay();
    });
    this.make('pause', 'screen modal', PAUSE);
    this.make('results', 'screen modal results', RESULTS);

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('mouseover', (e) => {
      if (e.target.closest?.('.btn') && !e.target.closest('.btn').contains(e.relatedTarget)) this.game.audio.play('hover');
    });
    this.bindSettings();
    this.bindLeaderboard();
    this.screens.menu.querySelector('[data-bind="version"]').textContent = 'v0.3';
  }

  make(name, cls, html) {
    const el = document.createElement('section');
    el.className = `${cls} hidden`;
    el.dataset.screen = name;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.screens[name] = el;
    return el;
  }

  show(name, data) {
    // Modals opened from another screen remember where to return.
    const isOverlay = OVERLAYS.has(name);
    if (isOverlay && this.current && this.current !== name) this.modalReturn = this.current;
    else if (!isOverlay) this.modalReturn = null;
    for (const [n, el] of Object.entries(this.screens)) {
      const keepUnder = isOverlay && n === this.modalReturn && n === 'menu';
      el.classList.toggle('hidden', n !== name && !keepUnder);
    }
    this.current = name;
    if (name === 'menu') this.refreshMenu();
    if (name === 'leaderboard') this.renderBoard(this.boardTab || 'global');
    if (name === 'pilot') this.renderPilot();
    this.syncTabs(name);
    if (name === 'settings') this.syncSettings();
    if (name === 'results' && data) this.renderResults(data);
    if (name === 'pay') this.renderPay();
    if (name === 'wallet') {
      this.renderWallet();
      this.game.wallet.refresh();
      this.loadOwnerView();
    }
    if (name === 'signin') this.openSignin(data?.required);
  }

  hideAll() {
    for (const el of Object.values(this.screens)) el.classList.add('hidden');
    this.current = null;
    this.modalReturn = null;
  }

  /** Close an overlay modal (Esc / ✕). Returns true if something was closed. */
  back() {
    if (OVERLAYS.has(this.current)) {
      const ret = this.modalReturn || 'menu';
      this.show(ret);
      return true;
    }
    return false;
  }

  onClick(e) {
    const btn = e.target.closest('[data-go]');
    if (!btn) return;
    this.game.audio.play('click');
    const go = btn.dataset.go;
    btn.blur();
    switch (go) {
      case 'play': this.game.startFlight(); break;
      case 'menu': this.game.toMenu(); break;
      case 'resume': this.game.resume(); break;
      case 'back': this.back(); break;
      case 'home': if (this.current !== 'menu') this.back(); break;
      case 'pay-confirm': this.confirmPay(); break;
      case 'pilotchip': this.show(this.game.online.registered ? 'pilot' : 'signin'); break;
      case 'signin-submit': this.submitSignin(); break;
      case 'signin-change':
        this.game.online.signOut();
        this.show('signin');
        break;
      case 'wallet-connect': this.connectWallet(); break;
      case 'wallet-disconnect':
        disconnectPhantom();
        this.game.wallet.setAddress('');
        break;
      case 'wallet-withdraw': this.withdraw(); break;
      case 'reset-progress':
        if (window.confirm('Reset Flight Points, stats and flight log on this device?')) {
          this.game.rewards.resetProgress();
          this.refreshMenu();
        }
        break;
      default: this.show(go);
    }
  }

  /** Highlight the launcher tab for the open screen and slide the underline to it. */
  syncTabs(name) {
    const tab = name === 'menu' ? 'home' : name;
    let on = null;
    for (const b of this.screens.menu.querySelectorAll('.lx-tabs [data-go]')) {
      b.classList.toggle('on', b.dataset.go === tab);
      if (b.dataset.go === tab) on = b;
    }
    const ind = this.screens.menu.querySelector('.lx-tab-ind');
    requestAnimationFrame(() => {
      if (!on) {
        ind.style.opacity = 0;
        return;
      }
      ind.style.opacity = 1;
      ind.style.width = `${on.offsetWidth - 24}px`;
      ind.style.transform = `translateX(${on.offsetLeft + 12}px)`;
    });
  }

  /** Split-flap departure board: every cell rattles through letters and settles. */
  runFlaps() {
    const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    clearInterval(this.flapTimer);
    const cells = [];
    for (const row of this.screens.menu.querySelectorAll('[data-flap]')) {
      const text = row.dataset.flap;
      if (row.children.length !== text.length) row.innerHTML = [...text].map((c) => `<i class="${c === ' ' ? 'gap' : ''}"></i>`).join('');
      [...text].forEach((c, i) => {
        if (c === ' ') return;
        cells.push({ el: row.children[i], c, stop: 6 + i * 2 + Math.floor(Math.random() * 10) });
      });
    }
    let n = 0;
    this.flapTimer = setInterval(() => {
      n++;
      let busy = false;
      for (const cell of cells) {
        if (n < cell.stop) {
          busy = true;
          cell.el.textContent = CH[Math.floor(Math.random() * CH.length)];
          cell.el.classList.remove('tick');
          void cell.el.offsetWidth;
          cell.el.classList.add('tick');
        } else if (cell.el.textContent !== cell.c) {
          cell.el.textContent = cell.c;
          cell.el.classList.remove('tick');
          void cell.el.offsetWidth;
          cell.el.classList.add('tick');
        }
      }
      if (!busy) clearInterval(this.flapTimer);
    }, 55);
  }

  /** Count numbers up from zero (keeps any unit after the number). */
  countUp(root) {
    for (const el of root.querySelectorAll('[data-count]')) {
      const m = el.textContent.match(/^([\d,]+)(.*)$/);
      if (!m) continue;
      const target = Number(m[1].replace(/,/g, ''));
      const unit = m[2];
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 900);
        const e = 1 - (1 - k) ** 3;
        el.textContent = `${formatInt(target * e)}${unit}`;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  pilotData() {
    const p = this.game.rewards.profile;
    const st = p.stats || { flights: 0, landings: 0, lost: 0, bestSink: 0, butter: 0 };
    const rank = rankFor(st.landings);
    return { p, st, rank };
  }

  /** Fill every [data-bind] inside `root` from the pilot's profile. */
  bindPilot(root) {
    const { p, st, rank } = this.pilotData();
    const set = (key, html, asHtml = false) => {
      for (const el of root.querySelectorAll(`[data-bind="${key}"]`)) {
        if (asHtml) el.innerHTML = html;
        else el.textContent = html;
      }
    };
    const rate = st.flights ? `${Math.round((st.landings / st.flights) * 100)}%` : '—';
    set('fp', formatInt(p.fp));
    set('best', p.best ? formatInt(p.best) : '—');
    set('daily', p.dailyBest ? formatInt(p.dailyBest) : '—');
    const name = this.game.online.name || p.callsign;
    set('callsign', name);
    set('callsign2', name);
    set('initials', name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'P');
    set('rank', rank.name);
    set('rank2', rank.name);
    set('nextrank', rank.next ? `${rank.toNext} safe landing${rank.toNext === 1 ? '' : 's'} to ${rank.next.name}` : 'Highest rank reached');
    set('badge', badgeHtml(rank.index), true);
    set('flights', formatInt(st.flights));
    set('landings', formatInt(st.landings));
    set('lost', formatInt(st.lost));
    set('butter', formatInt(st.butter));
    set('hard', formatInt(st.hard || 0));
    set('rate', rate);
    set('sink', st.bestSink ? `${formatInt(st.bestSink)} FPM` : '—');
    set('since', st.since ? new Date(st.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
    for (const bar of root.querySelectorAll('[data-bind="rankbar"]')) bar.style.width = `${Math.round(rank.progress * 100)}%`;
    return { p, st, rank };
  }

  // --- wallet -------------------------------------------------------------------
  refreshSol() {
    const v = (this.game.wallet.balance / LAMPORTS).toFixed(2);
    for (const el of this.screens.menu.querySelectorAll('[data-bind="sol"]')) el.textContent = v;
    // Reward amounts and the payout network come from the server's rules.
    const rules = this.game.wallet.rules;
    const text = (root, k, t) => root.querySelectorAll(`[data-bind="${k}"]`).forEach((el) => (el.textContent = t));
    text(this.screens.menu, 'rewardfact', `+${sol(rules.reward)} for a safe landing`);
    text(this.screens.howto, 'hw-reward', `+${sol(rules.reward)}`);
    text(this.screens.howto, 'hw-min', sol(rules.withdrawMin));
    text(this.screens.howto, 'hw-net', rules.cluster === 'devnet'
      ? `Rewards are paid in SOL on Solana Devnet and have no market value. They are sent from the FlyDubaiSim payout wallet to the Phantom address you connect. Connecting Phantom only shares your public address; the game never asks you to sign or send a transaction. Daily limits apply (${rules.maxRewardsPerDay} paid landings per pilot).`
      : 'Withdrawals are currently unavailable.');
  }

  renderPay() {
    const w = this.game.wallet;
    const el = this.screens.pay;
    const rules = w.rules;
    el.querySelector('[data-bind="reward"]').textContent = `+${sol(rules.reward)}`;
    el.querySelector('[data-bind="bal"]').textContent = w.remote ? sol(w.balance) : '—';
    el.querySelector('.pay-confirm').disabled = !!this.paying;
    const warn = el.querySelector('.pay-warn');
    const msg = w.error || (!w.remote ? 'Rewards need a pilot name and the FlyDubaiSim server. You can still fly.' : '');
    warn.textContent = msg;
    warn.classList.toggle('hidden', !msg);
    el.querySelector('[data-bind="paynote"]').textContent = w.remote
      ? `Rewards are saved to your pilot wallet (${this.game.online.name}). Up to ${rules.maxRewardsPerDay} paid landings per day.`
      : '';
  }

  /** "Solana Devnet" etc. */
  networkLabel(rules) {
    return rules.cluster === 'devnet' ? 'Solana Devnet' : `Solana ${rules.cluster}`;
  }

  /** Board the flight: the server opens it (free), then the scenario starts. */
  async confirmPay() {
    if (this.paying) return;
    this.paying = true;
    this.renderPay();
    await this.game.wallet.begin();
    this.paying = false;
    if (this.current !== 'pay') {
      this.renderPay();
      return;
    }
    this.game.audio.play('score');
    this.game.launchFlight();
  }

  async withdraw() {
    const w = this.game.wallet;
    const address = w.data.address;
    const tx = await w.withdraw();
    this.withdrawStatus = tx ? `Withdrawal requested · ${sol(tx.amount)} to ${short(address)}. It usually arrives within 5–10 minutes.` : w.error;
    this.renderWallet();
  }

  async connectWallet() {
    if (!phantomProvider()) {
      this.phantomMsg = 'Phantom was not found in this browser. Install it from phantom.app, then try again.';
      this.renderWallet();
      return;
    }
    const res = await connectPhantom();
    if (res.address) {
      this.phantomMsg = '';
      await this.game.wallet.setAddress(res.address);
      if (this.game.wallet.error) {
        this.phantomMsg = this.game.wallet.error;
        this.renderWallet();
      }
    } else {
      this.phantomMsg = 'The connection was cancelled in Phantom.';
      this.renderWallet();
    }
  }

  /** Owner-only panel: the payout wallet's mainnet + devnet balances. Requested from localhost only; the server checks too. */
  async loadOwnerView() {
    const box = this.screens.wallet.querySelector('.wl-ownerbox');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
    const r = await this.game.online.req('/owner/wallet');
    if (!r.ok || !r.data.address) {
      box.classList.add('hidden');
      return;
    }
    const set = (k, v) => (box.querySelector(`[data-bind="${k}"]`).textContent = v);
    set('ow-addr', short(r.data.address));
    box.querySelector('[data-bind="ow-addr"]').title = r.data.address;
    set('ow-main', r.data.mainnet == null ? 'unavailable' : sol(r.data.mainnet, 3));
    set('ow-dev', r.data.devnet == null ? 'unavailable' : sol(r.data.devnet, 3));
    box.classList.remove('hidden');
  }

  renderWallet() {
    const w = this.game.wallet;
    const d = w.data;
    const rules = w.rules;
    const el = this.screens.wallet;
    const set = (k, v) => (el.querySelector(`[data-bind="${k}"]`).textContent = v);
    set('bal', sol(d.balance));
    set('paid', `${d.rewardsToday} of ${rules.maxRewardsPerDay}`);
    set('earned', sol(d.earned));
    set('withdrawn', sol(d.withdrawn));
    set('addr', d.address ? d.address : 'No wallet connected');
    el.querySelector('.wl-addr').classList.toggle('none', !d.address);
    el.querySelector('.wl-connect').classList.toggle('hidden', !!d.address);
    el.querySelector('.wl-disconnect').classList.toggle('hidden', !d.address);
    set('phantom', this.phantomMsg || (d.address ? 'Withdrawals are sent to this address.' : 'Connect Phantom to set where withdrawals go.'));
    const ready = d.balance >= rules.withdrawMin;
    el.querySelector('[data-bind="wbar"]').style.width = `${Math.round(Math.min(1, d.balance / rules.withdrawMin) * 100)}%`;
    set('wtext', !rules.payoutsEnabled ? rules.payoutsNote || 'Withdrawals are currently unavailable.'
      : w.pending ? 'Withdrawal processing · usually arrives within 5–10 minutes'
        : ready ? 'Ready to withdraw' : `${sol(rules.withdrawMin - d.balance)} to go · withdrawals open at ${sol(rules.withdrawMin)}`);
    el.querySelector('.wl-withdraw').disabled = !w.canWithdraw;
    const pool = el.querySelector('.wl-pool');
    pool.classList.toggle('hidden', !rules.pool);
    if (rules.pool) {
      set('pool', sol(rules.pool.balance, 3));
      pool.title = `Payout wallet ${rules.pool.address}`;
    }
    if (!w.pending && /^Withdrawal requested/.test(this.withdrawStatus || '')) this.withdrawStatus = '';
    set('wstatus', this.withdrawStatus || (ready && !d.address ? 'Connect Phantom first.' : ''));
    set('wowner', !w.remote
      ? this.game.online.status === 'online' ? 'Choose a pilot name to start earning rewards.' : 'The server is offline: rewards pause until it is back.'
      : `Saved to your pilot account (${this.game.online.name}) on any device.`);
    const label = { reward: 'Landing reward', withdraw: 'Withdrawal', refund: 'Refund', credit: 'Credit' };
    const byId = Object.fromEntries((d.payouts || []).map((p) => [p.id, p]));
    const state = (t) => {
      const p = byId[t.payout];
      if (t.type !== 'withdraw' || !p) return '';
      if (p.status === 'sent') return ` · <a href="${esc(explorerTx(p.signature, rules.cluster))}" target="_blank" rel="noopener">Completed · view transaction</a>`;
      if (p.status === 'failed') return ' · Failed, returned to your balance';
      return ' · Processing';
    };
    el.querySelector('[data-bind="txs"]').innerHTML = d.txs.length
      ? d.txs.map((t) => `<tr><td>${esc(new Date(t.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</td><td>${label[t.type] || t.type}</td><td class="muted">${esc(t.note)}${state(t)}</td><td class="num ${t.amount > 0 ? 'pos' : ''}">${t.amount > 0 ? '+' : '−'}${(Math.abs(t.amount) / LAMPORTS).toFixed(2)}</td><td class="num">${(t.balance / LAMPORTS).toFixed(2)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">No transactions yet.</td></tr>';
  }

  refreshMenu() {
    this.refreshSol();
    const m = this.screens.menu;
    const { p } = this.bindPilot(m);
    this.countUp(m);
    this.runFlaps();
    this.renderLiveCard();
    const recentEl = m.querySelector('[data-bind="recent"]');
    if (!recentEl) return;
    const recent = p.flights.slice(0, 4);
    recentEl.innerHTML = recent.length
      ? recent.map((f) => `<li class="${f.success ? 'ok' : 'lost'}"><span class="dot"></span><span class="what">${esc(f.success ? f.grade : 'FLIGHT LOST')}</span><span class="when">${esc(new Date(f.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span><b>${f.success && f.sink != null ? `${formatInt(f.sink)} fpm` : '—'}</b></li>`).join('')
      : '<li class="empty">No flights yet. Your first landing will appear here.</li>';
  }

  renderPilot() {
    const el = this.screens.pilot;
    const { p, rank } = this.bindPilot(el);
    el.querySelector('[data-bind="log"]').innerHTML = p.flights.length
      ? p.flights.map((f) => `<tr class="${f.success ? '' : 'lost'}"><td>${esc(new Date(f.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</td><td>${esc(f.success ? f.grade : 'FLIGHT LOST')}</td><td class="num">${f.sink != null ? `${formatInt(f.sink)} FPM` : '—'}</td><td class="num fp">${f.fp ? `+${formatInt(f.fp)}` : '0'}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">No flights yet. Take the flight from the Play tab.</td></tr>';
    el.querySelector('[data-bind="ranks"]').innerHTML = RANKS.map((r, i) =>
      `<div class="${i <= rank.index ? 'got' : ''} ${i === rank.index ? 'cur' : ''}"><span class="lx-badge sm">${badgeHtml(i)}</span><b>${r.name}</b><em>${r.at} safe landing${r.at === 1 ? '' : 's'}</em></div>`).join('');
  }

  rankText(r) {
    const o = this.game.online;
    if (!o.registered) return 'Pick a pilot name';
    if (r.online === undefined) return 'Saving…';
    if (!r.online) return o.status === 'online' ? 'Not recorded' : 'Offline';
    return r.online.rank ? `#${r.online.rank} of ${formatInt(o.pilots)}` : r.success ? 'Recorded' : 'Flight lost';
  }

  /** The online result arrives after the results screen: update it in place. */
  updateResultRank(r) {
    const dd = this.screens.results.querySelector('.res-rank');
    if (dd) dd.textContent = this.rankText(r);
    if (r.sol?.pending) this.renderRewardBlock(r);
  }

  // --- leaderboard -----------------------------------------------------------------
  bindLeaderboard() {
    const el = this.screens.leaderboard;
    el.querySelector('.tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      this.game.audio.play('click');
      this.renderBoard(tab.dataset.tab);
    });
  }

  renderBoard(tab) {
    this.boardTab = tab;
    const el = this.screens.leaderboard;
    const online = this.game.online;
    for (const b of el.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
    const thead = el.querySelector('thead');
    const tbody = el.querySelector('tbody');
    el.querySelector('[data-bind="lbme"]').innerHTML = online.registered
      ? `Flying as <b>${esc(online.name)}</b>`
      : '<button class="lx-link" data-go="signin">CHOOSE A PILOT NAME →</button>';
    this.renderFeed();
    if (tab === 'mine') {
      const rows = this.game.rewards.leaderboard('mine');
      thead.innerHTML = '<tr><th>Flight</th><th>Result</th><th class="num">Touchdown</th><th class="num">FP</th></tr>';
      tbody.innerHTML = rows.length
        ? rows.map((r) => `<tr class="you"><td>${esc(r.callsign)}</td><td>${esc(r.grade)}</td><td class="num">${r.sink != null ? `${formatInt(r.sink)} fpm` : '—'}</td><td class="num fp">${r.fp ? `+${formatInt(r.fp)}` : '0'}</td></tr>`).join('')
        : '<tr><td colspan="4" class="empty">No flights yet. Your first landing will show up here.</td></tr>';
      return;
    }
    thead.innerHTML = '<tr><th>#</th><th>Pilot</th><th class="num">Landings</th><th>Best landing</th><th class="num">Softest touchdown</th></tr>';
    tbody.innerHTML = '<tr><td colspan="5" class="empty">Loading the live leaderboard…</td></tr>';
    const token = (this.boardReq = (this.boardReq || 0) + 1);
    online.leaderboard(tab === 'daily' ? 'today' : 'all').then((data) => {
      if (token !== this.boardReq || this.boardTab !== tab) return;
      this.renderStatus();
      if (!data) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty">The live leaderboard is offline right now. Your flights are still saved under My flights.</td></tr>';
        return;
      }
      const title = (t) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '—');
      tbody.innerHTML = data.rows.length
        ? data.rows.map((r) => {
          const you = r.name === online.name;
          return `<tr class="${you ? 'you' : ''}"><td class="rank">${r.rank}</td><td>${esc(r.name)}${you ? ' <em>You</em>' : ''}</td><td class="num">${formatInt(r.landings)}</td><td>${esc(title(r.grade))}</td><td class="num">${formatInt(r.sink)} fpm</td></tr>`;
        }).join('')
        : `<tr><td colspan="5" class="empty">${tab === 'daily' ? 'No landings today yet. Be the first.' : 'No landings yet. Be the first pilot on the board.'}</td></tr>`;
      this.renderFeed();
    });
  }

  feedLine(ev) {
    const name = `<b>${esc(ev.name)}</b>`;
    if (ev.type === 'landing') return `${name} landed at Tabuk · ${formatInt(ev.sink)} fpm`;
    if (ev.type === 'lost') return `${name} lost the aircraft`;
    if (ev.type === 'join') return `${name} joined as a pilot`;
    return '';
  }

  renderFeed() {
    const ul = this.screens.leaderboard.querySelector('[data-bind="feed"]');
    const feed = this.game.online.feed.filter((e) => e.type !== 'presence').slice(0, 10);
    ul.innerHTML = feed.length
      ? feed.map((e) => `<li class="${e.type}"><span>${this.feedLine(e)}</span><time>${ago(e.at)}</time></li>`).join('')
      : '<li class="empty">No flights yet.</li>';
  }

  renderStatus() {
    const o = this.game.online;
    const text = o.status === 'online' ? `${formatInt(o.online)} online · ${formatInt(o.pilots)} pilots` : 'OFFLINE';
    const lb = this.screens.leaderboard.querySelector('[data-bind="lbstatus"]');
    lb.textContent = o.status === 'online' ? text : '';
    const chip = this.screens.menu.querySelector('[data-bind="online"]');
    chip.innerHTML = `<i></i>${o.status === 'online' ? `${formatInt(o.online)} ONLINE` : 'OFFLINE'}`;
    chip.classList.toggle('off', o.status !== 'online');
  }

  /** Launcher card: top five pilots + the latest flight, live. */
  async renderLiveCard() {
    const online = this.game.online;
    const ol = this.screens.menu.querySelector('[data-bind="top5"]');
    const data = online.status === 'offline' ? null : await online.leaderboard('all');
    this.renderStatus();
    if (!data) {
      ol.innerHTML = '<li class="empty">Live leaderboard offline.</li>';
      return;
    }
    ol.innerHTML = data.rows.length
      ? data.rows.slice(0, 5).map((r) => `<li class="${r.name === online.name ? 'you' : ''}"><span class="rk">${r.rank}</span><span class="nm">${esc(r.name)}</span><b>${formatInt(r.sink)} fpm</b></li>`).join('')
      : '<li class="empty">No landings yet. Be the first on the board.</li>';
    const last = online.feed.find((e) => e.type === 'landing' || e.type === 'lost');
    this.screens.menu.querySelector('[data-bind="lastfeed"]').innerHTML = last ? `<span class="lx-live"><i></i></span>${this.feedLine(last)} · ${ago(last.at)}` : '';
  }

  onOnline(ev) {
    if (ev.type === 'me') {
      if (this.current === 'menu') this.refreshMenu();
      return;
    }
    this.renderStatus();
    clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => {
      if (this.current === 'menu' || this.current === null || this.screens.menu.classList.contains('hidden') === false) this.renderLiveCard();
      if (this.current === 'leaderboard') this.renderBoard(this.boardTab || 'global');
    }, 250);
  }

  // --- sign-in ------------------------------------------------------------------------
  bindSignin() {
    const input = this.screens.signin.querySelector('.si-input');
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.submitSignin();
      if (e.key === 'Escape') this.back();
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  openSignin(required = false) {
    const el = this.screens.signin;
    this.signinThenPay = !!required;
    el.querySelector('.si-sub').textContent = required
      ? 'Pick a pilot name to board. Your wallet, rewards and leaderboard results are saved to it on the server.'
      : 'Your name goes on the live FZ1073 leaderboard, next to every landing you make at Tabuk. Your game wallet is saved to it too.';
    const offline = this.game.online.status === 'offline';
    el.querySelector('.si-error').classList.toggle('hidden', !offline);
    el.querySelector('.si-error').textContent = offline ? 'The leaderboard server is offline. You can still play; pick a name when it is back.' : '';
    el.querySelector('.si-submit').disabled = offline;
    const input = el.querySelector('.si-input');
    input.value = '';
    setTimeout(() => input.focus(), 60);
  }

  async submitSignin() {
    const el = this.screens.signin;
    const err = el.querySelector('.si-error');
    const btn = el.querySelector('.si-submit');
    const name = el.querySelector('.si-input').value.trim();
    if (!/^[A-Za-z0-9_-]{3,16}$/.test(name)) {
      err.textContent = 'Use 3–16 letters, numbers, _ or -.';
      err.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    const res = await this.game.online.register(name);
    btn.disabled = false;
    if (res.error) {
      err.textContent = res.error;
      err.classList.remove('hidden');
      return;
    }
    this.game.audio.play('score');
    await this.game.wallet.refresh();
    const next = this.signinThenPay ? 'pay' : 'menu';
    this.signinThenPay = false;
    this.show(next);
  }

  // --- settings --------------------------------------------------------------------
  bindSettings() {
    const el = this.screens.settings;
    const s = this.game.settings;
    el.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      e.preventDefault();
      this.game.audio.play('click');
      s.set(seg.dataset.setting, b.dataset.v);
      this.syncSettings();
    }));
    el.querySelectorAll('input[data-setting]').forEach((input) => {
      const key = input.dataset.setting;
      input.addEventListener(input.type === 'range' ? 'input' : 'change', () => {
        const v = input.type === 'checkbox' ? input.checked : Number(input.value);
        s.set(key, v);
        this.syncSettings();
      });
    });
    const cs = el.querySelector('.callsign-input');
    cs.addEventListener('change', () => {
      cs.value = this.game.rewards.setCallsign(cs.value);
    });
    cs.addEventListener('keydown', (e) => e.stopPropagation());
  }

  syncSettings() {
    const el = this.screens.settings;
    const s = this.game.settings;
    el.querySelectorAll('.seg').forEach((seg) => {
      for (const b of seg.querySelectorAll('[data-v]')) b.classList.toggle('on', b.dataset.v === s.get(seg.dataset.setting));
    });
    el.querySelectorAll('input[data-setting]').forEach((input) => {
      const v = s.get(input.dataset.setting);
      if (input.type === 'checkbox') input.checked = !!v;
      else input.value = v;
    });
    el.querySelector('[data-out="fov"]').textContent = `${s.get('fov')}°`;
    el.querySelector('[data-out="volume"]').textContent = `${Math.round(s.get('volume') * 100)}%`;
    const cs = el.querySelector('.callsign-input');
    const online = this.game.online;
    cs.value = online.name || this.game.rewards.profile.callsign;
    cs.disabled = online.registered;
    el.querySelector('[data-out="pilotnote"]').textContent = online.registered ? 'your live leaderboard name' : 'used until you claim a live name';
  }

  // --- results ---------------------------------------------------------------------
  renderResults(r) {
    const el = this.screens.results;
    const q = (sel) => el.querySelector(sel);
    const title = (t) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '');
    el.classList.toggle('failed', !r.success);
    q('.res-kicker').textContent = r.success ? 'flydubai FZ1073 · landed at Tabuk (TUU), runway 24' : 'flydubai FZ1073 · flight lost';
    q('.res-title').textContent = r.success ? 'Flight secured' : 'The aircraft was lost';
    q('.res-reason').textContent = r.success
      ? `All 172 people on board are safe${r.goArounds ? `, after ${r.goArounds} go-around${r.goArounds > 1 ? 's' : ''}` : ''}.`
      : r.reason;
    const td = r.touchdown;
    const rows = td && !td.crash
      ? [
        ['Landing', title(td.grade)],
        ['Sink rate', `${formatInt(td.sink)} fpm`],
        ['Touchdown past threshold', `${formatInt(Math.max(0, td.distPast))} m`],
        ['Speed at touchdown', `${Math.round(td.speedKt)} kt`],
        ['Centreline deviation', `${td.lateral.toFixed(1)} m`],
        ['Aircraft damage', `${td.damage}%`],
      ]
      : [['Landing', 'Not completed']];
    q('.res-dl').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
    this.renderRewardBlock(r);
    q('.res-buttons .primary').textContent = r.success ? 'Fly again' : 'Try again';
  }

  /** Reward + wallet rows. For signed-in pilots the server's confirmation arrives in place. */
  renderRewardBlock(r) {
    const q = (sel) => this.screens.results.querySelector(sel);
    const m = r.sol || { reward: 0, balance: this.game.wallet.balance };
    const waiting = !!m.pending && r.online === undefined;
    q('.res-fp b').textContent = waiting && r.success ? 'Confirming…' : m.reward ? `+${sol(m.reward)}` : '0.00 SOL';
    q('.res-fp span').textContent = m.none ? 'Rewards need a pilot name and the FlyDubaiSim server.'
      : m.failed && r.success ? 'The reward could not be confirmed because the server was not reachable.'
        : waiting && r.success ? 'Waiting for the server to record your landing'
          : m.reward ? 'Added to your rewards. Withdraw it from the Wallet.' : m.note || 'No reward for this flight.';
    q('.res-money').innerHTML = [
      ['Landing reward', waiting && r.success ? '…' : m.reward ? `+${sol(m.reward)}` : '—'],
      ['Rewards available', m.none ? '—' : waiting ? '…' : sol(m.balance)],
      ['Flight Points', r.success ? `+${formatInt(r.fpEarned)}` : '0'],
      ['Live leaderboard', this.rankText(r)],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd class="${k === 'Live leaderboard' ? 'res-rank' : ''}">${v}</dd></div>`).join('');
  }
}
