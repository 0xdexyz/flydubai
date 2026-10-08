// Performance score + Flight Points for one flight.
//
// Score: five categories, each graded 0-100 % and weighted (max 2,000).
// Flight Points: awarded live for milestones (recover, stable flight,
// diversion, approach, landing). FP are non-withdrawable in-game points.

export const CATEGORIES = [
  { id: 'recovery', label: 'RECOVERY', weight: 300 },
  { id: 'stability', label: 'STABILITY', weight: 400 },
  { id: 'navigation', label: 'NAVIGATION', weight: 300 },
  { id: 'approach', label: 'APPROACH', weight: 400 },
  { id: 'landing', label: 'LANDING', weight: 600 },
];

export const FP_REWARDS = {
  recover: { label: 'AIRCRAFT STABLE', fp: 100 },
  stable: { label: 'STABLE FLIGHT', fp: 150 },
  diversion: { label: 'SUCCESSFUL DIVERSION', fp: 200 },
  goodApproach: { label: 'GOOD APPROACH', fp: 200 },
  approach: { label: 'APPROACH FLOWN', fp: 100 },
  landing: { label: 'SAFE LANDING', fp: 350 },
  smooth: { label: 'SMOOTH TOUCHDOWN', fp: 50 },
};

export class Scoring {
  constructor(onToast) {
    this.onToast = onToast;
    this.reset();
  }

  reset() {
    this.pct = {};
    for (const c of CATEGORIES) this.pct[c.id] = null; // null = not reached
    this.awards = [];
    this.fp = 0;
    this.penalties = 0;
  }

  /** Grade a category (0-100). */
  setCategory(id, pct) {
    this.pct[id] = Math.max(0, Math.min(100, Math.round(pct)));
  }

  /** Award a Flight Point milestone once. */
  awardFP(key) {
    if (this.awards.some((a) => a.key === key)) return 0;
    const r = FP_REWARDS[key];
    this.awards.push({ key, label: r.label, fp: r.fp });
    this.fp += r.fp;
    this.onToast?.({ label: r.label, points: r.fp, kind: 'fp' });
    return r.fp;
  }

  /** Internal grading only: scores are no longer shown to the player. */
  penalty(points) {
    this.penalties += points;
  }

  get score() {
    let s = 0;
    for (const c of CATEGORIES) s += ((this.pct[c.id] ?? 0) / 100) * c.weight;
    return Math.max(0, Math.round(s - this.penalties));
  }

  breakdown() {
    return CATEGORIES.map((c) => ({ ...c, pct: this.pct[c.id] }));
  }
}
