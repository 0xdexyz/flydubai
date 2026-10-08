// Default rewards provider: Flight Points, best scores and flight history are
// stored in this browser only. Flight Points are non-withdrawable in-game
// points — they are not a token and carry no monetary value.

const KEY = 'skyrecovery.rewards.v1';

export const todayKey = () => new Date().toISOString().slice(0, 10);

function randomCallsign() {
  const words = ['FALCON', 'KITE', 'HERON', 'SWIFT', 'CONDOR', 'PETREL', 'OSPREY', 'TERN'];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(10 + Math.random() * 89)}`;
}

function defaults() {
  return {
    fp: 0, best: 0, daily: { date: '', best: 0 }, lastFlightDate: '', flights: [], callsign: randomCallsign(),
    stats: { flights: 0, landings: 0, lost: 0, bestSink: 0, butter: 0, hard: 0, since: new Date().toISOString() },
  };
}

export class LocalRewardsProvider {
  constructor() {
    this.name = 'local';
    this.data = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        this.data = { ...defaults(), ...saved, stats: { ...defaults().stats, ...saved.stats } };
        if (!saved.stats) this.backfillStats();
      }
    } catch {
      /* storage unavailable: session-only */
    }
  }

  /** Older saves have no counters: rebuild what we can from the flight history. */
  backfillStats() {
    const st = this.data.stats;
    for (const f of this.data.flights) {
      st.flights++;
      if (f.success) st.landings++;
      else st.lost++;
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  getProfile() {
    const d = this.data;
    const today = todayKey();
    return {
      callsign: d.callsign,
      fp: d.fp,
      best: d.best,
      dailyBest: d.daily.date === today ? d.daily.best : 0,
      flights: d.flights,
      flewToday: d.lastFlightDate === today,
      stats: { ...d.stats },
    };
  }

  /** Persist a finished flight and its Flight Point awards. */
  recordFlight(flight, fpTotal) {
    const d = this.data;
    const today = todayKey();
    d.fp += fpTotal;
    if (flight.score > d.best) d.best = flight.score;
    if (d.daily.date !== today) d.daily = { date: today, best: 0 };
    if (flight.score > d.daily.best) d.daily.best = flight.score;
    d.lastFlightDate = today;
    const st = d.stats;
    st.flights++;
    if (flight.success) {
      st.landings++;
      if (flight.sink != null && (!st.bestSink || flight.sink < st.bestSink)) st.bestSink = Math.round(flight.sink);
      if (flight.grade === 'BUTTER LANDING') st.butter++;
      if (flight.grade === 'HARD LANDING') st.hard = (st.hard || 0) + 1;
    } else st.lost++;
    d.flights.unshift({ ...flight, fp: fpTotal, date: new Date().toISOString() });
    d.flights.length = Math.min(d.flights.length, 25);
    this.save();
    return this.getProfile();
  }

  setCallsign(name) {
    const clean = String(name).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
    if (clean) {
      this.data.callsign = clean;
      this.save();
    }
    return this.data.callsign;
  }

  reset() {
    const callsign = this.data.callsign;
    this.data = { ...defaults(), callsign };
    this.save();
  }
}
