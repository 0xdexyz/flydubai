// FlyDubaiSim online service: pilot names + a real-time leaderboard of real
// players. Plain Node (no dependencies), data in server/data/online.json.
//
//   POST /api/register        { name }                      -> { name, token }
//   GET  /api/me              (Bearer token)                -> pilot stats
//   POST /api/flight/start    (Bearer token)                -> { flightId, wallet }
//   POST /api/flight/finish   (Bearer token) { flightId, success, sink, grade, fp } -> { ..., reward, wallet }
//   GET  /api/wallet          (Bearer token)                -> reward wallet + payout history
//   POST /api/wallet/address { address } | /withdraw        (Bearer token)
//   GET  /api/leaderboard?scope=all|today                   -> ranked pilots + recent feed
//   GET  /api/stream          Server-Sent Events: every landing / lost flight / new pilot
//
// A pilot name is claimed once and protected by a random token kept in the
// player's browser (only its hash is stored here). Flights are free: a safe
// landing earns a 0.01 SOL reward in the pilot's reward wallet, kept HERE and
// decided by this server (clearing browser data changes nothing). Withdrawing
// queues a real transfer from the payout wallet to the pilot's Phantom address.
//
// PAYOUTS ARE DEVNET TEST SOL ONLY. The payout wallet's secret key comes from
// .env (never committed); the sender refuses to enable itself unless the RPC
// really is devnet, so mainnet is never touched. Spend is capped per pilot and
// per day. Flight data is validated against the flight's start time, but the
// game runs in the browser, so it is checked, not cryptographically proven.

import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSolanaSender } from './solana.mjs';
import { createPayouts } from './payouts.mjs';
import { createStatic } from './static.mjs';

try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env')); // does not override variables already set
} catch {
  /* no .env: payouts stay off */
}

const PORT = Number(process.env.PORT || 8791);
const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data');
const DATA_FILE = join(DATA_DIR, 'online.json');
const MIN_FLIGHT_MS = Number(process.env.MIN_FLIGHT_MS || 60_000); // a flight can't be finished faster than this
const GRADES = new Set(['BUTTER LANDING', 'SMOOTH LANDING', 'SAFE LANDING', 'HARD LANDING']);
const RESERVED = new Set(['admin', 'flydubai', 'moderator', 'system', 'skydubai', 'fz1073', 'you']);
const NAME_RE = /^[A-Za-z0-9_-]{3,16}$/;

// Deployment settings (all optional; see .env.example)
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION = process.env.NODE_ENV === 'production';
const TRUST_PROXY = Number(process.env.TRUST_PROXY || 0); // number of reverse proxies in front (0 = none)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''; // only for a front-end served from another origin
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 300);
const OWNER_PANEL = process.env.OWNER_PANEL ? process.env.OWNER_PANEL === '1' : !PRODUCTION; // owner view is off by default in production
const staticFiles = createStatic(process.env.STATIC_DIR || join(ROOT_DIR, 'dist'));

// Reward wallet rules (lamports; 1 SOL = 1e9). Everything is configurable from .env.
const LAMPORTS = 1e9;
const lam = (envName, sol) => Math.round(Number(process.env[envName] || sol) * LAMPORTS);
const REWARD = lam('REWARD_SOL', 0.01); // paid per validated safe landing
const WITHDRAW_MIN = lam('WITHDRAW_MIN_SOL', 1);
const DAILY_BUDGET = lam('DAILY_BUDGET_SOL', 3); // all payouts together, per UTC day
const MAX_REWARDS_PER_DAY = Number(process.env.MAX_REWARDS_PER_PILOT_PER_DAY || 20);
const MAX_WITHDRAWALS_PER_DAY = Number(process.env.MAX_WITHDRAWALS_PER_PILOT_PER_DAY || 3);
const REWARD_MIN_FLIGHT_MS = Number(process.env.REWARD_MIN_FLIGHT_MS || 90_000); // faster than this earns no reward
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58 Solana address
const MAX_TXS = 60;
// Every pilot can earn rewards, so name creation is rate-limited per address.
const MAX_REGISTRATIONS = Number(process.env.MAX_REGISTRATIONS_PER_HOUR || 10);
const registrations = new Map(); // ip -> [timestamps]

/**
 * The real client address. With TRUST_PROXY=N the Nth entry from the right of X-Forwarded-For is used
 * (the proxies we trust append to the header; anything a client put in front of it is ignored).
 */
function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  if (!TRUST_PROXY) return peer;
  const list = String(req.headers['x-forwarded-for'] || '').split(',').map((a) => a.trim()).filter(Boolean);
  return list[list.length - TRUST_PROXY] || peer;
}

// --- storage --------------------------------------------------------------------------
let db = { users: {}, feed: [], payouts: {} };
if (existsSync(DATA_FILE)) {
  try {
    db = { users: {}, feed: [], payouts: {}, ...JSON.parse(readFileSync(DATA_FILE, 'utf8')) };
  } catch (err) {
    console.error('[online] could not read data file, starting empty:', err.message);
  }
}
let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(db));
  renameSync(tmp, DATA_FILE);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

// --- payouts (devnet) -------------------------------------------------------------------------
const sender = createSolanaSender({
  secret: process.env.PAYOUT_SECRET_KEY,
  rpc: process.env.SOLANA_RPC || 'https://api.devnet.solana.com',
  cluster: process.env.SOLANA_CLUSTER || 'devnet',
});
const payouts = createPayouts({
  db, saveNow, sender,
  pollMs: Number(process.env.PAYOUT_POLL_MS || 2000),
  onSettled: () => refreshPool(),
  // A failed payout returns the amount to the pilot's reward balance.
  onFailed(p, reason) {
    const u = db.users[p.key];
    if (!u) return;
    const w = walletOf(u);
    w.balance += p.lamports;
    w.withdrawn -= p.lamports;
    logTx(u, 'refund', p.lamports, `Payout failed, returned to your balance`, { payout: p.id });
    saveNow();
  },
});

function walletOf(u) {
  if (!u.wallet || u.wallet.v !== 2) u.wallet = { v: 2, balance: 0, earned: 0, withdrawn: 0, address: '', txs: [], rewardDay: '', rewardsToday: 0 };
  return u.wallet;
}

function txId() {
  return `fd-${randomBytes(6).toString('base64url')}`;
}

function logTx(u, type, amount, note, extra = {}) {
  const w = walletOf(u);
  w.txs.unshift({ id: txId(), type, amount, note, date: new Date().toISOString(), balance: w.balance, ...extra });
  w.txs.length = Math.min(w.txs.length, MAX_TXS);
}

const shortAddr = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');

// The payout wallet's devnet balance, shown on the wallet screen so the funding can be checked at a glance.
let poolLamports = null;
const POOL_RESERVE = 2_000_000; // same reserve the payout queue keeps (rent + fees)
async function refreshPool() {
  if (!payouts.enabled) {
    poolLamports = null;
    return;
  }
  try {
    poolLamports = await sender.balance();
  } catch {
    /* keep the last value */
  }
}
setInterval(refreshPool, 15_000).unref();

// --- owner view (this PC only) ------------------------------------------------------------
// The payout wallet's MAINNET balance, shown only to the owner. Read-only: nothing here can
// sign or send, and player payouts never use mainnet.
const MAINNET_RPC = process.env.OWNER_MAINNET_RPC || 'https://api.mainnet-beta.solana.com';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
let ownerCache = { at: 0, mainnet: null };

/**
 * True only for a browser on this PC. Requests arrive through the Vite proxy, which adds
 * X-Forwarded-For with the real client address (appended after anything the client sent),
 * so every address in it must be loopback. Without that header we refuse: fail closed.
 */
function isOwnerRequest(req) {
  if (!OWNER_PANEL) return false;
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false;
  const xff = String(req.headers['x-forwarded-for'] || '');
  if (!xff) return false;
  return xff.split(',').every((a) => LOOPBACK.has(a.trim()));
}

async function mainnetBalance(address) {
  if (Date.now() - ownerCache.at < 30_000) return ownerCache.mainnet;
  try {
    const res = await fetch(MAINNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    ownerCache = { at: Date.now(), mainnet: data?.result?.value ?? null };
  } catch {
    /* keep the last value */
  }
  return ownerCache.mainnet;
}

/** What every client needs to show: amounts and whether payouts are live. */
function publicRules() {
  return {
    pool: payouts.enabled && payouts.cluster === 'devnet' && poolLamports !== null ? { address: sender.address, balance: poolLamports } : null,
    reward: REWARD, withdrawMin: WITHDRAW_MIN, maxRewardsPerDay: MAX_REWARDS_PER_DAY,
    cluster: payouts.cluster, payoutsEnabled: payouts.enabled,
    payoutsNote: payouts.enabled ? '' : 'Withdrawals are currently unavailable.',
  };
}

function publicWallet(u, key) {
  const w = walletOf(u);
  return {
    balance: w.balance, earned: w.earned, withdrawn: w.withdrawn, address: w.address, txs: w.txs,
    payouts: payouts.forUser(key || Object.keys(db.users).find((k) => db.users[k] === u)),
    rewardsToday: w.rewardDay === today() ? w.rewardsToday : 0,
    rules: publicRules(),
  };
}

const hash = (token) => createHash('sha256').update(token).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const flights = new Map(); // flightId -> { key, started }

function userByToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const h = hash(token);
  for (const [key, u] of Object.entries(db.users)) if (u.tokenHash === h) return { key, u };
  return null;
}

function publicUser(u) {
  return {
    name: u.name, flights: u.flights, landings: u.landings, lost: u.lost, bestSink: u.bestSink || null,
    bestGrade: u.bestGrade || null, butter: u.butter, fp: u.fp, last: u.last, since: u.created,
  };
}

// --- real-time stream ---------------------------------------------------------------------
const clients = new Set();
function broadcast(event) {
  const line = `event: update\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
}
setInterval(() => {
  for (const res of clients) res.write(': keep-alive\n\n');
}, 25_000);

function pushFeed(item) {
  db.feed.unshift(item);
  db.feed.length = Math.min(db.feed.length, 40);
  broadcast({ ...item, online: clients.size });
}

// --- leaderboard ----------------------------------------------------------------------------
function leaderboard(scope) {
  const d = today();
  const rows = [];
  for (const u of Object.values(db.users)) {
    const best = scope === 'today' ? (u.todayDate === d ? u.todayBest : null) : u.bestSink;
    if (!best) continue;
    rows.push({ name: u.name, sink: best, landings: u.landings, flights: u.flights, grade: scope === 'today' ? u.todayGrade : u.bestGrade });
  }
  rows.sort((a, b) => a.sink - b.sink || b.landings - a.landings);
  return rows.slice(0, 50).map((r, i) => ({ rank: i + 1, ...r }));
}

// --- http helpers -----------------------------------------------------------------------------
const corsHeaders = ALLOWED_ORIGIN
  ? { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }
  : {};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders });
  res.end(JSON.stringify(body));
}

// Per-address request limit for the API (the live stream and the health check are exempt).
const hits = new Map(); // ip -> { n, reset }
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (h.reset < now) hits.delete(ip);
}, 60_000).unref();
function rateLimited(ip) {
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || h.reset < now) hits.set(ip, (h = { n: 0, reset: now + 60_000 }));
  return ++h.n > RATE_LIMIT_PER_MIN;
}
const streamsPerIp = new Map();
const MAX_STREAMS_PER_IP = 8;

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

// --- routes ---------------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }

  if (!path.startsWith('/api/')) {
    // The game itself (production build). In development Vite serves it and proxies /api here.
    if (staticFiles.handle(req, res, path)) return undefined;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }
  const ip = clientIp(req);
  if (path !== '/api/health' && path !== '/api/stream' && rateLimited(ip)) {
    res.setHeader('Retry-After', '60');
    return send(res, 429, { error: 'Too many requests. Slow down for a minute.' });
  }

  if (path === '/api/health') return send(res, 200, { ok: true, pilots: Object.keys(db.users).length, online: clients.size, rules: publicRules() });

  if (path === '/api/stream' && req.method === 'GET') {
    if ((streamsPerIp.get(ip) || 0) >= MAX_STREAMS_PER_IP) return send(res, 429, { error: 'Too many open connections.' });
    streamsPerIp.set(ip, (streamsPerIp.get(ip) || 0) + 1);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeaders,
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ online: clients.size + 1 })}\n\n`);
    clients.add(res);
    broadcast({ type: 'presence', online: clients.size });
    req.on('close', () => {
      clients.delete(res);
      streamsPerIp.set(ip, Math.max(0, (streamsPerIp.get(ip) || 1) - 1));
      broadcast({ type: 'presence', online: clients.size });
    });
    return undefined;
  }

  if (path === '/api/register' && req.method === 'POST') {
    const body = await readJson(req);
    const ip = clientIp(req);
    const recent = (registrations.get(ip) || []).filter((t) => Date.now() - t < 3600_000);
    if (recent.length >= MAX_REGISTRATIONS) return send(res, 429, { error: 'Too many new pilots from this connection. Try again later.' });
    const name = String(body?.name || '').trim();
    if (!NAME_RE.test(name)) return send(res, 400, { error: 'Use 3-16 letters, numbers, _ or -.' });
    const key = name.toLowerCase();
    if (RESERVED.has(key)) return send(res, 409, { error: 'That name is reserved. Try another.' });
    if (db.users[key]) return send(res, 409, { error: 'That pilot name is taken. Try another.' });
    const token = randomBytes(24).toString('hex');
    recent.push(Date.now());
    registrations.set(ip, recent);
    db.users[key] = {
      name, tokenHash: hash(token), created: new Date().toISOString(),
      flights: 0, landings: 0, lost: 0, bestSink: 0, bestGrade: null, butter: 0, fp: 0, last: null,
      todayDate: '', todayBest: 0, todayGrade: null,
    };
    save();
    pushFeed({ type: 'join', name, at: new Date().toISOString() });
    return send(res, 201, { name, token });
  }

  if (path === '/api/me' && req.method === 'GET') {
    const me = userByToken(req);
    if (!me) return send(res, 401, { error: 'Unknown pilot.' });
    return send(res, 200, publicUser(me.u));
  }

  if (path === '/api/flight/start' && req.method === 'POST') {
    const me = userByToken(req);
    if (!me) return send(res, 401, { error: 'Unknown pilot.' });
    for (const [id, f] of flights) if (f.key === me.key) flights.delete(id); // one open flight per pilot
    const flightId = randomBytes(12).toString('hex');
    flights.set(flightId, { key: me.key, started: Date.now() });
    return send(res, 201, { flightId, wallet: publicWallet(me.u, me.key) });
  }

  if (path === '/api/flight/finish' && req.method === 'POST') {
    const me = userByToken(req);
    if (!me) return send(res, 401, { error: 'Unknown pilot.' });
    const body = await readJson(req);
    const f = flights.get(body?.flightId);
    if (!f || f.key !== me.key) return send(res, 400, { error: 'No flight in progress.' });
    flights.delete(body.flightId);
    if (Date.now() - f.started < MIN_FLIGHT_MS) return send(res, 400, { error: 'Flight too short to record.' });
    const success = body.success === true;
    const sink = Math.round(Number(body.sink));
    const grade = String(body.grade || '');
    const fp = Math.max(0, Math.min(2000, Math.round(Number(body.fp) || 0)));
    if (success && (!Number.isFinite(sink) || sink < 20 || sink > 1300 || !GRADES.has(grade))) {
      return send(res, 400, { error: 'Landing data out of range.' });
    }
    const u = me.u;
    const now = new Date().toISOString();
    u.flights++;
    u.last = now;
    let reward = 0;
    let rewardNote = '';
    if (success) {
      const w = walletOf(u);
      if (w.rewardDay !== today()) {
        w.rewardDay = today();
        w.rewardsToday = 0;
      }
      if (Date.now() - f.started < REWARD_MIN_FLIGHT_MS) rewardNote = 'This flight was too short to earn a reward.';
      else if (w.rewardsToday >= MAX_REWARDS_PER_DAY) rewardNote = `Daily reward limit reached (${MAX_REWARDS_PER_DAY} landings). Come back tomorrow.`;
      else {
        reward = REWARD;
        w.rewardsToday++;
        w.balance += reward;
        w.earned += reward;
        logTx(u, 'reward', reward, 'Safe landing reward · Tabuk');
      }
      u.landings++;
      u.fp += fp;
      if (grade === 'BUTTER LANDING') u.butter++;
      if (!u.bestSink || sink < u.bestSink) {
        u.bestSink = sink;
        u.bestGrade = grade;
      }
      const d = today();
      if (u.todayDate !== d) {
        u.todayDate = d;
        u.todayBest = 0;
      }
      if (!u.todayBest || sink < u.todayBest) {
        u.todayBest = sink;
        u.todayGrade = grade;
      }
    } else u.lost++;
    save();
    pushFeed(success ? { type: 'landing', name: u.name, sink, grade, at: now } : { type: 'lost', name: u.name, at: now });
    return send(res, 200, { ok: true, me: publicUser(u), rank: leaderboard('all').find((r) => r.name === u.name)?.rank ?? null, reward, rewardNote, wallet: publicWallet(u, me.key) });
  }

  if (path === '/api/owner/wallet' && req.method === 'GET') {
    if (!isOwnerRequest(req)) return send(res, 403, { error: 'Owner view is only available on the server PC.' });
    if (!sender.address) return send(res, 200, { address: '', mainnet: null, devnet: null });
    return send(res, 200, { address: sender.address, mainnet: await mainnetBalance(sender.address), devnet: poolLamports });
  }

  if (path.startsWith('/api/wallet')) {
    const me = userByToken(req);
    if (!me) return send(res, 401, { error: 'Unknown pilot.' });
    const u = me.u;
    const w = walletOf(u);
    if (path === '/api/wallet' && req.method === 'GET') return send(res, 200, publicWallet(u, me.key));
    if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });

    if (path === '/api/wallet/address') {
      const body = await readJson(req);
      const address = String(body?.address || '').trim();
      if (address && !ADDRESS_RE.test(address)) return send(res, 400, { error: 'That is not a valid Solana address.' });
      w.address = address;
      save();
      return send(res, 200, publicWallet(u, me.key));
    }
    if (path === '/api/wallet/withdraw') {
      const refuse = (status, error) => send(res, status, { error, wallet: publicWallet(u, me.key) });
      if (!payouts.enabled) return refuse(503, publicRules().payoutsNote || 'Withdrawals are currently unavailable.');
      if (w.balance < WITHDRAW_MIN) return refuse(400, `Withdrawals open at ${(WITHDRAW_MIN / LAMPORTS).toFixed(2)} SOL.`);
      if (!w.address) return refuse(400, 'Connect Phantom first.');
      if (payouts.hasOpen(me.key)) return refuse(409, 'You already have a withdrawal in progress.');
      if (payouts.withdrawalsToday(me.key) >= MAX_WITHDRAWALS_PER_DAY) return refuse(429, 'Daily withdrawal limit reached. Try again tomorrow.');
      if (payouts.spentToday() + w.balance > DAILY_BUDGET) return refuse(429, 'The daily payout budget has been used up. Try again tomorrow.');
      // Only accept a request the payout wallet can actually pay, so "requested" always means "on its way".
      await refreshPool();
      if (poolLamports === null || poolLamports < w.balance + POOL_RESERVE) return refuse(503, 'Payouts are temporarily unavailable. Your balance is safe; please try again later.');
      const amount = w.balance;
      w.balance = 0;
      w.withdrawn += amount;
      const id = randomBytes(8).toString('hex');
      logTx(u, 'withdraw', -amount, `Withdrawal to ${shortAddr(w.address)}`, { payout: id });
      payouts.add({ id, key: me.key, name: u.name, address: w.address, lamports: amount });
      saveNow();
      return send(res, 202, { ...publicWallet(u, me.key), amount });
    }
    return send(res, 404, { error: 'Not found' });
  }

  if (path === '/api/leaderboard' && req.method === 'GET') {
    const scope = url.searchParams.get('scope') === 'today' ? 'today' : 'all';
    return send(res, 200, {
      scope, rows: leaderboard(scope), feed: db.feed.slice(0, 12),
      pilots: Object.keys(db.users).length, online: clients.size,
    });
  }

  return send(res, 404, { error: 'Not found' });
});

server.listen(PORT, async () => {
  console.log(`[online] FlyDubaiSim on http://localhost:${PORT} (${PRODUCTION ? 'production' : 'development'})`);
  console.log(staticFiles.available ? `[web] serving the game from ${staticFiles.root}` : '[web] no build found (run "npm run build"); only /api is served here');
  if (PRODUCTION && !process.env.DATA_DIR) console.warn('[data] DATA_DIR is not set: data lives inside the app folder and is lost on redeploy. Point DATA_DIR at a persistent disk.');
  if (PRODUCTION && !TRUST_PROXY) console.warn('[net] TRUST_PROXY is 0: behind a reverse proxy every player would share one address (rate limits, sign-up limit). Set it to the number of proxies in front.');
  await sender.verify();
  console.log(payouts.enabled ? `[payouts] devnet payouts ON from ${sender.address}` : `[payouts] off: ${payouts.problem}`);
  await refreshPool();
  payouts.start();
});

// Flush data on shutdown so a redeploy never loses the last few seconds of results.
function shutdown(signal) {
  console.log(`[online] ${signal}: saving and shutting down`);
  try {
    saveNow();
  } catch (err) {
    console.error('[online] save failed:', err.message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('[online] unhandled rejection:', err));
process.on('uncaughtException', (err) => {
  console.error('[online] uncaught exception:', err);
  try {
    saveNow();
  } catch {
    /* nothing more to do */
  }
  process.exit(1);
});
