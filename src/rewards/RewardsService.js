// Flight Points + leaderboards. The game only talks to this service; the
// storage backend is a swappable provider (local today, see
// SolanaRewardsProvider for the interface a future on-chain adapter would use).

import { mulberry32 } from '../core/MathUtil.js';
import { LocalRewardsProvider, todayKey } from './LocalRewardsProvider.js';

const RIVALS = [
  'NIGHTJAR', 'KESTREL_9', 'VECTOR', 'ORBIT-7', 'HALCYON', 'STRATUS', 'MERIDIAN', 'TAILWIND',
  'GREYHAWK', 'AURORA', 'SKYLARK', 'NOVA-3', 'ZEPHYR', 'CIRRUS', 'ALTAIR', 'RIDGELINE',
  'HARBOR', 'PIONEER', 'LUMEN', 'DRIFT', 'NORTHSTAR', 'GLIDEPATH', 'ECHO-5', 'SOLSTICE',
];
const gradeFor = (sink) => (sink < 140 ? 'Butter landing' : sink < 240 ? 'Smooth landing' : sink < 600 ? 'Safe landing' : 'Hard landing');
const title = (t) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '');

/** Rival pilots for the offline board, ranked by their softest safe touchdown (fpm). */
function seededBoard(seed, count, lo, hi) {
  const rand = mulberry32(seed);
  const pool = RIVALS.slice();
  const rows = [];
  for (let i = 0; i < count; i++) {
    const name = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    const sink = Math.round(lo + (hi - lo) * Math.pow(i / count, 1.3) + rand() * 12);
    rows.push({ callsign: name, sink, grade: gradeFor(sink), you: false });
  }
  return rows;
}

export class RewardsService {
  constructor(provider = new LocalRewardsProvider()) {
    this.provider = provider;
  }

  get profile() {
    return this.provider.getProfile();
  }

  /**
   * Persist a finished flight. `milestones` are the Flight Point awards earned
   * live during the flight ({ label, fp }). They are only banked when the
   * aircraft lands safely: a crash or a lost flight earns nothing.
   */
  submitFlight(flight, milestones = []) {
    const before = this.provider.getProfile();
    const awards = flight.success ? milestones.map(({ label, fp }) => ({ label, fp })) : [];
    const fpEarned = awards.reduce((sum, a) => sum + a.fp, 0);
    const profile = this.provider.recordFlight(flight, fpEarned);
    return {
      awards,
      fpEarned,
      profile,
      newBest: flight.score > before.best,
      newDailyBest: flight.score > before.dailyBest,
    };
  }

  /** scope: 'global' | 'daily' | 'mine' */
  leaderboard(scope) {
    const p = this.provider.getProfile();
    if (scope === 'mine') {
      return p.flights.map((f) => ({
        callsign: new Date(f.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
          ' ' + new Date(f.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        sink: f.success ? f.sink : null,
        grade: f.success ? title(f.grade) : 'Flight lost',
        fp: f.fp,
        you: true,
      }));
    }
    const rows = scope === 'daily'
      ? seededBoard(Number(todayKey().replace(/-/g, '')), 9, 120, 520)
      : seededBoard(7, 14, 70, 380);
    const today = todayKey();
    const mine = scope === 'daily'
      ? p.flights.filter((f) => f.success && f.sink != null && f.date.slice(0, 10) === today).reduce((m, f) => Math.min(m, f.sink), Infinity)
      : p.stats?.bestSink || Infinity;
    if (Number.isFinite(mine)) rows.push({ callsign: p.callsign, sink: Math.round(mine), grade: gradeFor(mine), you: true });
    rows.sort((a, b) => a.sink - b.sink);
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  setCallsign(name) {
    return this.provider.setCallsign(name);
  }

  resetProgress() {
    this.provider.reset();
  }
}
