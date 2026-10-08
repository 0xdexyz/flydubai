// Client for the FlyDubaiSim online service (server/index.mjs): pilot names,
// flight results and the real-time leaderboard (Server-Sent Events).
// Everything degrades gracefully: if the service is unreachable the game
// plays exactly as before and the leaderboard says it is offline.

const KEY = 'skyrecovery.online.v1';

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && v.name && v.token ? v : null;
  } catch {
    return null;
  }
}

export class OnlineService {
  constructor(base = '/api') {
    this.base = base;
    this.me = load();
    this.status = 'unknown'; // unknown | online | offline
    this.online = 0;
    this.pilots = 0;
    this.feed = [];
    this.flightId = null;
    this.rules = null; // reward rules + payout network, from /health
    this.listeners = new Set();
    this.source = null;
  }

  get registered() {
    return !!this.me;
  }

  get name() {
    return this.me?.name || '';
  }

  on(fn) {
    this.listeners.add(fn);
  }

  emit(event) {
    for (const fn of this.listeners) fn(event);
  }

  async req(path, { method = 'GET', body } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(this.base + path, {
        method,
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.me ? { Authorization: `Bearer ${this.me.token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data, unreachable: res.status >= 500 }; // a dev proxy answers 5xx when the service is down
    } catch {
      return { ok: false, status: 0, data: { error: 'The leaderboard server is not reachable.' }, unreachable: true };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Check the service and that our saved pilot still exists. */
  async init() {
    const h = await this.req('/health');
    this.status = h.ok ? 'online' : 'offline';
    if (h.ok) {
      this.pilots = h.data.pilots;
      this.rules = h.data.rules || null;
      if (this.me) {
        const me = await this.req('/me');
        if (me.status === 401) this.signOut();
      }
      this.connect();
    }
    this.emit({ type: 'status' });
    return this.status;
  }

  async register(name) {
    const r = await this.req('/register', { method: 'POST', body: { name } });
    if (!r.ok) return { error: r.data.error || 'Could not register that name.' };
    this.me = { name: r.data.name, token: r.data.token };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.me));
    } catch {
      /* session only */
    }
    this.emit({ type: 'me' });
    return { name: this.me.name };
  }

  signOut() {
    this.me = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    this.emit({ type: 'me' });
  }

  /** Whether this pilot's wallet and flights live on the server. */
  get live() {
    return !!this.me && this.status === 'online';
  }

  /** The server charges the experience fee here. Resolves { ok, error, wallet, unreachable }. */
  async startFlight() {
    this.flightId = null;
    const r = await this.req('/flight/start', { method: 'POST' });
    if (r.ok) this.flightId = r.data.flightId;
    return { ok: r.ok, error: r.data.error, wallet: r.data.wallet, unreachable: r.unreachable };
  }

  /** Report the result; resolves with { rank, me } when recorded. */
  async finishFlight(result) {
    if (!this.me || !this.flightId) return null;
    const flightId = this.flightId;
    this.flightId = null;
    const r = await this.req('/flight/finish', { method: 'POST', body: { flightId, ...result } });
    return r.ok ? r.data : null;
  }

  async leaderboard(scope = 'all') {
    const r = await this.req(`/leaderboard?scope=${scope}`);
    if (!r.ok) {
      this.status = 'offline';
      return null;
    }
    this.status = 'online';
    this.online = r.data.online;
    this.pilots = r.data.pilots;
    this.feed = r.data.feed;
    return r.data;
  }

  /** Live updates: every landing, lost flight, new pilot and presence change. */
  connect() {
    if (this.source || typeof EventSource === 'undefined') return;
    const es = new EventSource(`${this.base}/stream`);
    this.source = es;
    es.addEventListener('hello', (e) => {
      this.online = JSON.parse(e.data).online;
      this.emit({ type: 'presence' });
    });
    es.addEventListener('update', (e) => {
      const ev = JSON.parse(e.data);
      if (ev.online != null) this.online = ev.online;
      if (ev.type !== 'presence') {
        this.feed.unshift(ev);
        this.feed.length = Math.min(this.feed.length, 12);
      }
      this.emit(ev);
    });
    es.onerror = () => {
      this.status = es.readyState === EventSource.CLOSED ? 'offline' : this.status;
    };
  }
}

export function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
