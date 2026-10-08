# Assets

The game ships with **zero binary assets**: aircraft, cockpit, terrain, airport and
clouds are generated as low-poly geometry at startup, and all sound is synthesised
with the Web Audio API. This keeps the first load tiny.

Optional overrides:

- `models/` – drop a `.glb` here and point `src/core/AssetConfig.js` at it
  (for example `aircraft: 'assets/models/airliner.glb'`). If the file is missing
  or fails to load, the procedural model is used automatically.
- `textures/` – small (≤512px) textures, if you ever want them.
- `audio/` – short compressed clips; the synthesised sounds remain as fallback.
