// Reward wallet. Flights are free; a safe landing earns a SOL reward, and a
// withdrawal pays a real transfer from the payout wallet to the Phantom address
// the pilot connected. Everything is decided by the online service
// (server/index.mjs), which holds each pilot's balance and the payout queue:
// the browser only shows it and asks. No transaction is ever signed here: Phantom
// is used to read the player's public address, nothing else.
//
// Payouts are Solana DEVNET (test SOL). The wallet screen shows the network.

export const LAMPORTS = 1e9;
export const sol = (lamports, digits = 2) => `${(lamports / LAMPORTS).toFixed(digits)} SOL`;

// What the server tells us at /api/health and /api/wallet; these are used until it answers.
export const DEFAULT_RULES = { reward: 0.01 * LAMPORTS, withdrawMin: 1 * LAMPORTS, maxRewardsPerDay: 20, cluster: 'devnet', payoutsEnabled: false, payoutsNote: '' };

const EMPTY = { balance: 0, earned: 0, withdrawn: 0, address: '', txs: [], payouts: [], rewardsToday: 0 };

export class GameWallet {
  constructor() {
    this.listeners = new Set();
    this.cloud = null; // the pilot's reward wallet, as the server reports it
    this.online = null;
    this.error = '';
  }

  /** Connect to the online service. */
  attach(online) {
    this.online = online;
    online.on((ev) => {
      if (ev.type === 'status' || ev.type === 'me') this.refresh();
    });
    setInterval(() => {
      if (this.remote && this.pending) this.refresh(); // follow a payout until it lands
    }, 4000);
  }

  /** Signed in and the service is reachable. */
  get remote() {
    return !!this.online?.live;
  }

  get data() {
    return this.remote && this.cloud ? this.cloud : EMPTY;
  }

  get rules() {
    return this.cloud?.rules || this.online?.rules || DEFAULT_RULES;
  }

  /** A payout that is not finished yet. */
  get pending() {
    return !!this.data.payouts?.some((p) => p.status === 'queued' || p.status === 'sending');
  }

  get balance() {
    return this.data.balance;
  }

  get canWithdraw() {
    const d = this.data;
    return this.remote && this.rules.payoutsEnabled && d.balance >= this.rules.withdrawMin && !!d.address && !this.pending;
  }

  /** Pull the pilot's wallet from the server. */
  async refresh() {
    if (!this.remote) {
      this.cloud = null;
      this.notify();
      return;
    }
    const r = await this.online.req('/wallet');
    if (r.ok) this.cloud = r.data;
    this.notify();
  }

  adopt(wallet) {
    if (wallet) this.cloud = wallet;
    this.notify();
  }

  notify() {
    for (const fn of this.listeners) fn(this);
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  /** Open a flight on the server (free). Flying without a server just means no reward. */
  async begin() {
    if (!this.remote) return;
    const r = await this.online.startFlight();
    if (r.wallet) this.cloud = r.wallet;
    this.notify();
  }

  async call(path, body) {
    const r = await this.online.req(`/wallet/${path}`, { method: 'POST', body });
    if (r.unreachable) this.online.status = 'offline';
    if (r.data?.wallet || r.ok) this.cloud = r.data.wallet || r.data;
    this.error = r.ok ? '' : r.data?.error || 'Something went wrong.';
    this.notify();
    return r;
  }

  /** Request a payout of the whole balance to the connected address. Resolves { amount } or null. */
  async withdraw() {
    if (!this.remote) {
      this.error = 'Sign in with a pilot name and connect to the server to withdraw.';
      return null;
    }
    const r = await this.call('withdraw');
    return r.ok ? { amount: r.data.amount } : null;
  }

  async setAddress(address) {
    if (!this.remote) return;
    await this.call('address', { address: address || '' });
  }
}

export const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');

export const explorerTx = (signature, cluster) => `https://explorer.solana.com/tx/${signature}${cluster && cluster !== 'mainnet-beta' ? `?cluster=${cluster}` : ''}`;

/**
 * Phantom is only used to read the player's PUBLIC address. The game never asks it
 * to sign or send anything.
 */
export function phantomProvider() {
  const p = window.phantom?.solana ?? window.solana;
  return p?.isPhantom ? p : null;
}

export async function connectPhantom() {
  const p = phantomProvider();
  if (!p) return { error: 'missing' };
  try {
    const res = await p.connect();
    return { address: res.publicKey.toString() };
  } catch {
    return { error: 'rejected' };
  }
}

export async function disconnectPhantom() {
  try {
    await phantomProvider()?.disconnect();
  } catch {
    /* ignore */
  }
}
