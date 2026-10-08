// Arcade altitude scale.
//
// A real descent from 28,500 ft takes ~20 minutes, far longer than a game flight. Instead
// of building an enormous world, displayed altitude is a smooth, monotonic
// function of world height: close to the ground 1 m = 3.28 ft (true scale, so
// the runway, flare and touchdown look and feel right), and above ~1,100 m each
// metre counts ~5.4x. That keeps the whole emergency descent and the diversion
// inside a 2-3 minute flight. Vertical speed is the exact derivative of displayed
// altitude, so the altimeter and VSI always agree with each other.

import { FT_PER_M, smoothstep } from '../core/MathUtil.js';

const MAX_Y = 9000;
const table = new Float64Array(MAX_Y + 1);

/** Display-feet per world-metre multiplier at a given world height. */
export const altMultiplier = (y) => 1 + 4.4 * smoothstep(80, 1100, y);

for (let i = 1; i <= MAX_Y; i++) table[i] = table[i - 1] + FT_PER_M * altMultiplier(i - 0.5);

/** World height (m) -> displayed altitude (ft). */
export function displayFeet(y) {
  if (y <= 0) return y * FT_PER_M;
  if (y >= MAX_Y) return table[MAX_Y] + (y - MAX_Y) * FT_PER_M * altMultiplier(MAX_Y);
  const i = Math.floor(y);
  return table[i] + (table[i + 1] - table[i]) * (y - i);
}

/** Displayed feet per world metre at height y (used for vertical speed). */
export const feetPerMeter = (y) => FT_PER_M * altMultiplier(Math.max(0, y));

/** Displayed altitude (ft) -> world height (m). */
export function worldY(ft) {
  if (ft <= 0) return ft / FT_PER_M;
  if (ft >= table[MAX_Y]) return MAX_Y + (ft - table[MAX_Y]) / (FT_PER_M * altMultiplier(MAX_Y));
  let lo = 0;
  let hi = MAX_Y;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] < ft) lo = mid;
    else hi = mid;
  }
  return lo + (ft - table[lo]) / (table[hi] - table[lo]);
}
