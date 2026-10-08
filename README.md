# FlyDubaiSim

**Control. Stabilize. Land.** A short, cinematic 3D emergency-flight game for desktop browsers.

> Fictionalized gameplay reconstruction inspired by publicly reported events surrounding Flydubai Flight FZ1073. Some gameplay elements are simplified or fictionalized.

Every session follows the same structured scenario. There's no free flight and no setup:

```
PLAY → cinematic (~45 s) → TAKE CONTROL → recover → stable flight → divert to Tabuk → approach → land → score + Flight Points
```

A careful flight from TAKE CONTROL to taxi speed takes **about 2.5–3 minutes**: the hand-over is ~15 km from Tabuk (TUU) and the descent is compressed (see `physics/AltitudeScale.js`). **There is still no time limit.** No countdown, no "time remaining", and no failure for being slow. Phases advance only when the aircraft meets their conditions. Scores grade how well you fly, never how fast. A missed landing becomes a go-around. The flight only ends early if the aircraft becomes genuinely unrecoverable.

## Run

```bash
npm install
npm run dev        # http://localhost:5204
npm run build      # static build in dist/ (relative paths, host anywhere)
```

Stack: Three.js (WebGL), vanilla JavaScript modules, HTML/CSS and the Web Audio API. Vite is only the dev server and bundler. There are no binary assets: the aircraft, cockpit, cabin, characters, terrain and airport are generated as low-poly geometry, and every sound is synthesised. The production bundle is about 200 KB gzipped.

## Scenario and sources

The cinematic follows the publicly reported timeline of 30 September 2026. Sources: UAE Attorney-General findings (3 October), the airline's statements, flight-tracking data (Flightradar24, AirNav Radar) and passenger and crew accounts reported by Gulf News, Khaleej Times, Al Jazeera and The National.

| Time (UTC) | Reported event | In the game |
| --- | --- | --- |
| 03:05 | Departs Dubai for Tel Aviv, cruises at about 34,000 ft | Exterior cruise, title card |
| ~05:21 | The co-pilot attacks the captain from behind and tries to seize the controls (UAE findings) | The co-pilot gets up behind the captain; **cut to black**, a single muffled sound |
| 05:21–05:28 | The aircraft pitches down and rolls ("began to spin slightly"), plunges, climbs sharply, then dives again | Flight deck in chaos, instruments, the exterior plunge (time-lapsed) |
| 05:28 | Squawk 7700 near the Saudi-Jordanian border | Caption |
| — | Panic in the cabin; passengers later described screaming children | Cabin sequence, indistinct cries, staggered reactions |
| — | Injured, the captain manages to open the flight-deck door (witness accounts) | The captain, holding his head, comes out; the crew help him to the galley floor |
| — | Crew, passengers and two airline pilots travelling off duty rush in and pin the co-pilot to the floor; he is restrained | The rush up the aisle; three people kneeling behind the seats, the co-pilot hidden beneath them |
| 05:33 | About 15,000 ft | Pilots travelling on board take the seats |
| 05:35 | Squawk 7500 (unlawful interference); turns west, briefly into Jordanian airspace, then back toward Saudi Arabia | Caption, then **TAKE CONTROL** heading north-west: turning back to Tabuk is the player's job |
| ~06:45 | Lands safely at Tabuk; all 172 people on board safe | The landing you fly; the result screen |

**Depiction rules.** The attack itself is never shown: it is a cut to black with sound. No weapon, blood or wounds appear on screen. The captain is shown hurt only through body language. No real names are used (including the two off-duty pilots and the co-pilot), all characters, the livery and the airport buildings are fictional and generic, and captions stick to wording that was officially stated or reported as witness accounts. Details that were not public when this was written (exactly who flew the landing, how the door was unlocked, the motive) are left open.

Tabuk's runway 06/24 (3,350 m) and its field elevation (2,551 ft) match public airport data. Distances and the altitude scale are compressed, so a careful flight takes minutes rather than the real ~70 minutes from 15,000 ft to landing, but nothing is timed.

### Launcher

The home page is the FlyDubaiSIM banner (`public/brand/home-hero.webp`, cabin · dusk runway · cockpit) across the top with a slow camera drift, fading into the navy theme; the 3D scene is not rendered behind it. Under the logo: animated launcher — a split-flap flight board (FZ1073 · DXB · TLV · DIVERTED TUU), a looping track replay of the real route (Dubai toward Tel Aviv, broken off near the Saudi-Jordanian border, west into Jordan, back to Tabuk), a ticker with the published timeline, a sliding tab indicator, count-up stats. Real names used: flydubai, FZ1073 (callsign SKY DUBAI 1073, ICAO FDB1073), Boeing 737 MAX 8, DXB, TLV, TUU. No real crew names. The footer states the game is not affiliated with or endorsed by flydubai.

### The cinematic (~46 s, skippable on replays)

| Time | Shot |
| --- | --- |
| 0–6.6 s | Exterior cruise above the clouds at 34,000 ft, then the flight deck: two fictional pilots, all normal |
| 6.6–8.7 s | Close on the captain flying; behind him the co-pilot unbuckles and stands |
| 8.7–9.05 s | Black. One muffled sound. The autopilot-disconnect wailer starts |
| 9.05–11.6 s | Flight deck: the captain hunched, holding his head; the co-pilot pushing the controls forward; instruments, nose down and rolling |
| 11.6–20.6 s | The plunge, exterior (time-lapsed): roll, clouds rushing past, altitude 34,000 → ~20,000 ft, squawk 7700 |
| 20.6–27.6 s | The cabin: passengers with no idea what is happening; staggered reactions, crew steadying themselves and gesturing |
| 27.6–33.4 s | The crew pound on the locked door; it opens and the injured captain comes out |
| 33.4–37.6 s | From the galley: two off-duty pilots and passengers rush up the aisle into the flight deck |
| 37.6–40.6 s | They pin the co-pilot to the floor and restrain him |
| 40.6–45 s | 05:33, about 15,000 ft: the off-duty pilots take the seats; over-the-shoulder → first person; squawk 7500 → **TAKE CONTROL** |

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` (or `↑` / `↓`) | Pitch. `S` raises the nose |
| `A` / `D` (or `←` / `→`) | Roll |
| `Q` / `E` | Rudder, or nose-wheel steering on the ground |
| `Shift` / `Z` (or mouse wheel) | Throttle up / down |
| `G` | Landing gear |
| `F` / `R` | Flaps down / up |
| `B` / `Space` | Wheel brakes on the ground, speed brakes in the air |
| `C` | Cockpit / chase camera |
| `Esc` / `P` | Pause |
| Hold `Space` during the cinematic | Skip it (replays only) |

On-screen controls are also available: a throttle slider, gear / flaps / brake buttons and a pitch-and-roll pad.

## Gameplay (open-ended: no time limit)

| Phase | What you do | Flight Points |
| --- | --- | --- |
| **Recovery** | Take over at about 15,800 ft: speed HIGH, still descending, still unstable. Level the wings, stop the descent, bring the speed under 300 kt. It advances only once all three hold for a few seconds. | AIRCRAFT STABLE +100 |
| **Stable flight** | Hold 12,000 ft, 270 kt and heading 300 through moderate turbulence until the stability meter has stayed high for 12 seconds of flying, however long that takes. Far from Tabuk, the heading target turns you back toward it. | STABLE FLIGHT +150 |
| **Emergency diversion** | Turn toward Tabuk. Follow the arrow and the distance readout. Descend and slow down as the targets ask. | SUCCESSFUL DIVERSION +200 |
| **Tabuk approach** | Gear down, full flaps, 185 kt or slower, line up with runway 24. | GOOD APPROACH +200 |
| **Landing** | Approach guide (runway symbol, glide-path diamond, PAPI), flare, touch down, brake to a stop. | SAFE LANDING +350 (+50 smooth) |

The result screen grades **Recovery, Stability, Navigation, Approach and Landing** in percent and adds them up to a total score (maximum 2,000). Recovery is graded on how cleanly it was done (overspeed, stall and bank excursions). Navigation is graded on how well heading, altitude and speed were held. Nothing is graded on elapsed time. A rough but safe landing still succeeds.

Missing the landing (overflying the runway, drifting far off the approach) triggers **GO AROUND**: you are routed to a repositioning point at circuit height and can line up again as often as you like. Only genuinely unrecoverable situations end the flight: a crash or touchdown off the runway, a deep stall held for 12 s, more than 8 s beyond structural speed (390 kt), running off the runway, or leaving the 70 km playable area (a RETURN TO ROUTE warning appears at 55 km). **Try Again** and **Play Again** restart the whole scenario, including the cinematic, without reloading the page.

**Flight Points (FP)** are banked **only after a safe landing**: a crash or a lost flight earns nothing (the milestones you passed are shown, but not paid). They are non-withdrawable in-game points. They are not a token and have no cash value. No deposits, purchases or wagering are involved. FP and scores are stored in the browser. The rewards layer (`src/rewards`) is modular: `SolanaRewardsProvider` is an unconnected stub that documents a future integration. No keys or secrets belong in the frontend.

## Pilot names and the live leaderboard

`server/index.mjs` is a small Node service (no dependencies, data in `server/data/online.json`) for real players:

- **Pilot names:** first launch asks for a unique name (3–16 letters, numbers, `_` or `-`, case-insensitive). It's claimed once and protected by a random token kept in the player's browser (the server stores only its hash).
- **Results:** every flight is reported (start + finish; flights shorter than 60 s are rejected).
- **Live leaderboard:** All time / Today, ranked by each pilot's softest safe touchdown, plus a live feed (landings, lost flights, new pilots) and an online count, pushed instantly over Server-Sent Events. A live top-5 card sits on the launcher.

Run both servers (Vite proxies `/api` to the service, so everyone opening the game on your network shares one board):

```bash
npm run server     # online service on :8791
npm run dev -- --host   # game on :5204 (and your LAN IP)
```

If the service is down, the game still plays and the leaderboard says it's offline. The game runs in the browser, so the results checks are sanity checks, not anti-cheat.

## Rewards (free flights, SOL paid on devnet)

Flights are **free**. A **safe landing earns 0.01 SOL** into the pilot's reward wallet; a crash or lost flight earns nothing. From **0.05 SOL** the pilot can withdraw to the Phantom address they connect, and the server sends a **real transfer on Solana devnet** (test SOL, no market value) from the payout wallet. The wallet screen and How to Play say it is devnet.

**Devnet only, by design.** The sender (`server/solana.mjs`) turns itself on only if `SOLANA_CLUSTER=devnet` **and** the RPC endpoint reports devnet's genesis hash; any mainnet setting, or a mainnet RPC, keeps payouts off (the wallet then says "Mainnet payouts are not active"). There is no mainnet code path.

The reward wallet lives on the server (`server/index.mjs`), tied to the pilot name, so it follows the pilot and can't be edited from the browser. PLAY asks for a pilot name first when the service is up.

- `POST /api/flight/finish` pays the reward only for a validated safe landing on a flight that really started, once, and only if the flight took at least `REWARD_MIN_FLIGHT_MS` and the pilot is under their daily cap.
- `POST /api/wallet/withdraw` needs the minimum balance, a saved address, no payout already in progress, and room in the per-pilot and daily budgets. It moves the balance into a queued payout.
- `server/payouts.mjs` pays the queue. It saves each transaction's signature **before** broadcasting, so after a crash or timeout it checks the chain instead of paying twice; a payout that fails, or arrives when the payout wallet is too low, is returned to the pilot's balance.
- New pilots are rate-limited per connection (10 per hour).

### Setting up the payout wallet

1. Create a **new** wallet used only for this (never one that holds real funds), and fund its public address with devnet SOL at https://faucet.solana.com.
2. Copy `.env.example` to `.env` and paste that wallet's secret key into `PAYOUT_SECRET_KEY` yourself. `.env` is gitignored. Never put a key in chat, code or git.
3. Restart the service (`npm run server`). The log says `[payouts] devnet payouts ON from <address>`.

If there is no key, rewards still accumulate and the wallet says payouts aren't switched on. If the service is down or nobody is signed in, the game plays without rewards.

All amounts are lamports; the game never asks Phantom to sign or send anything: it only reads the public address.

### Tests

```bash
node dev-tools/payout-queue-test.mjs        # queue safety logic with a fake sender (no network)
# reward rules over HTTP, payouts off, throwaway data folder:
DATA_DIR=/tmp/wtdata PORT=8795 MIN_FLIGHT_MS=300 REWARD_MIN_FLIGHT_MS=300 MAX_REWARDS_PER_PILOT_PER_DAY=6 PAYOUT_SECRET_KEY= node server/index.mjs
node dev-tools/wallet-test.mjs http://localhost:8795
node dev-tools/payout-devnet-test.mjs       # real devnet transfer: makes a throwaway wallet, airdrops, pays, verifies on chain
```

`payout-devnet-test.mjs` needs the public devnet faucet, which rate-limits often; re-run later if it reports a 429.

## Deploying

One Node process serves both the game (the `dist/` build) and the API, so a deployment is a single service.

```bash
npm ci
npm run build      # produces dist/
npm start          # serves the game + API on $PORT (default 8791)
```

Or with Docker (single container, data on a volume):

```bash
docker build -t flydubaisim .
docker run -p 8791:8791 -v flydubaisim-data:/data --env-file .env.production flydubaisim
```

Set these in the host's environment settings (see `.env.example`; never upload your local `.env`):

| Variable | Why |
|---|---|
| `NODE_ENV=production` | production defaults (owner panel off, startup warnings) |
| `DATA_DIR` | **persistent disk/volume** for pilots, rewards and payout records; without it every redeploy starts empty |
| `TRUST_PROXY` | number of reverse proxies in front (Render/Railway/Nginx/Cloudflare = usually `1`); needed so rate limits and the sign-up limit see each player's real address |
| `PAYOUT_SECRET_KEY` | secret key of the **devnet** payout wallet, set as a host secret; leave empty to keep payouts off |
| `ALLOWED_ORIGIN` | only if the game is served from a different origin than the API |

What the server does for production: HTTPS-aware headers behind a proxy, gzip + long caching for hashed assets, no path traversal, a per-address API rate limit (`RATE_LIMIT_PER_MIN`), a cap on live-stream connections per address, saves data on shutdown, and has no debug handle in the browser build. The health check is `GET /api/health`.

Before going live:

1. Use HTTPS (the host usually does this) and set `TRUST_PROXY`.
2. Put `DATA_DIR` on a persistent volume and back it up (`online.json` holds every pilot and payout).
3. Run **one** instance: the data is a JSON file, not a shared database.
4. Fund the devnet payout wallet and set its key as a secret on the host. Payouts stay devnet-only in code.
5. Run `node dev-tools/prod-smoke-test.mjs` after `npm run build` to check the production behaviour locally.

## Architecture

The existing simulator was converted rather than rebuilt:

| System | Module | What happened to it |
| --- | --- | --- |
| Rendering | `core/Renderer.js` (world pass + overlay pass) | Reused. The overlay pass now holds the cockpit *and* the cabin in aircraft-local space |
| Game loop | `core/Loop.js` (fixed-step physics + per-frame render) | Reused |
| State | `core/StateMachine.js` | New scenario states (below) |
| Input | `core/Input.js` | Reused unchanged |
| Flight physics | `physics/FlightModel.js`, `Atmosphere.js`, `AltitudeScale.js` | Reused unchanged. The cinematic dive is flown by the same model through scripted control inputs |
| Aircraft | `aircraft/AircraftModel.js` | Reused, refined into a Boeing 737 MAX 8 in the flydubai livery as photographed (Wikimedia Commons): white fuselage with large "fly" (orange) "dubai" (blue) titles on a canvas-texture decal, dark-blue rear fuselage with light-blue, white and orange ribbons, light-blue fin with the dark sweep and orange stripe, white LEAP-1B-style nacelles with chevron exhausts, split (upper + lower) orange winglets, dorsal fin. Smooth-shaded 40-segment fuselage, windscreen and side windows on the skin |
| Cockpit | `aircraft/Cockpit.js` | Reused, now placed in aircraft-local coordinates |
| Cabin + cast | `aircraft/Interior.js`, `aircraft/Characters.js` | Stylized "realistic cartoon" cast: faces (eyes, pupils, brows, nose, mouth, ears), 9 hair styles, beards, glasses, caps, hoods, collars, scarves and backpacks, with a dozen passenger archetypes randomised in height, build, face shape and colours. Layered procedural animation: base pose + mood (calm idle actions, confused, worried, alarmed, crew gestures) + gaze + breathing and blinking. One InstancedMesh per part type (~40 draw calls and ~180k triangles for 75 people). Distant people update at a third of the rate and skip facial animation. Walkers wait for anyone standing in their lane, so nobody walks through anyone |
| Camera | `game/CameraController.js` | Extended with a `cinematic` mode (exterior or interior poses) |
| Cinematic | `game/Cinematic.js` | **New**: shot list, events, captions, scripted pilot, boot-time calibration |
| World | `world/*` | Reused. Terrain re-themed to the Tabuk desert; runway 24/06 |
| Mission / scoring | `game/Mission.js`, `Scoring.js`, `Landing.js`, `Warnings.js` | Rewritten for the new phases; landing grading reused |
| HUD / UI | `ui/HUD.js`, `ui/Screens.js`, `ui/CinematicOverlay.js` | HUD extended; cinematic overlay is new. The main menu is a game launcher (tabs, pilot chip, mission hero, side cards) with a **pilot profile**: ranks earned by safe landings (Cadet → Second Officer → First Officer → Captain → Senior Captain → Training Captain), lifetime stats and a flight log |
| Audio | `audio/AudioEngine.js`, `Callouts.js` | Reused, plus a cabin layer (air hiss, indistinct murmur, agitated murmur), an emergency rumble that fades as you recover, seatbelt chime, gasps, a crew call, door, footsteps, runway roll and brakes |

States: `MENU → CINEMATIC_INTRO → EMERGENCY → CONTROL_TRANSFER → RECOVERY → DIVERSION → APPROACH → LANDING → RESULT`, plus `PAUSED`. Transitions outside that table are rejected.

**Seamless hand-over.** The cinematic runs the real flight model on a fixed clock, so it's deterministic. At boot it is simulated once, headlessly, to work out the cruise start position that lands it exactly on the gameplay hand-over point (15,800 ft, high speed, heading 300). Its last shot blends into the gameplay cockpit pose, so control passes to the player without a cut. A replay skip fast-forwards the same simulation.

## Performance notes

- About 30–45 draw calls in flight (about 50 during cabin shots). Static scenery is merged; trees, seats, clouds, parked aircraft and every character body part are instanced.
- Cockpit and cabin are drawn as a second pass with their own depth range (no logarithmic depth buffer).
- No shadows, no post-processing, no volumetrics. Fog adapts with altitude.
- Adaptive resolution only steps down when that actually raises the frame rate.
- Pooled particles, toasts and warning banners.

## Testing helper

With the dev server running, open the browser console:

```js
const { runTestPilot, placeOnFinal } = await import('/src/dev/TestPilot.js');
await runTestPilot(window.__sky, { cinematic: true }); // plays the cinematic + flies the mission headlessly
await placeOnFinal(window.__sky, 2500);                 // jump onto a 2.5 km final approach
```

`src/dev/` is never imported by the game, so it isn't included in the production build.

## Promo trailer (1920×1080, 30 fps, for X)

Renders a ~96 s trailer from the real game: opener, the FZ1073 incident card with the route drawn to scale, the in-game cutscene with its captions, "Now you're the off-duty pilot", recovery / diversion / final approach / touchdown flown by an autopilot, and an end card.

1. `node dev-tools/trailer-sink.mjs` (port 8792, writes `trailer/frames/`)
2. With the game running and its browser pane visible (hidden tabs get throttled), in the console:
   ```js
   const { recordTrailer } = await import('/src/dev/Trailer.js');
   recordTrailer(window.__sky); // progress in window.__trailer; reload the page afterwards
   ```
3. `python dev-tools/trailer_soundtrack.py` (numpy only, synthesizes `trailer/soundtrack.wav` timed from `trailer/timeline.json`)
4. Encode:
   ```bash
   ffmpeg -framerate 30 -i trailer/frames/f_%05d.jpg -i trailer/soundtrack.wav -vf "scale=in_range=full:out_range=limited,format=yuv420p" -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:v libx264 -preset slow -crf 18 -profile:v high -g 60 -c:a aac -b:a 192k -shortest -movflags +faststart trailer/FlyDubaiSIM_trailer.mp4
   ```

`trailer/` is gitignored.
