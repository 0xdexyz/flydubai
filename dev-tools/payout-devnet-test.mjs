// Dev tool: end-to-end payout test on Solana DEVNET (free test SOL, no value).
//
//   node dev-tools/payout-devnet-test.mjs
//
// It creates a throwaway payout wallet in memory (never written to disk), funds it
// with a devnet airdrop, starts the server against it, earns rewards through the
// HTTP API, withdraws to a fresh devnet address and verifies the transfer on chain.
// It also checks that a mainnet setting, or an RPC that is not devnet, keeps the
// sender OFF. Nothing here ever touches mainnet funds.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEVNET = 'https://api.devnet.solana.com';
const conn = new Connection(DEVNET, 'confirmed');
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${extra}`}`);
};

function startServer(port, env) {
  const dir = mkdtempSync(join(tmpdir(), 'fdsim-'));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), MIN_FLIGHT_MS: '300', REWARD_MIN_FLIGHT_MS: '300', PAYOUT_POLL_MS: '1500', WITHDRAW_MIN_SOL: '0.05', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  return { child, dir, log: () => log, stop: () => { child.kill(); rmSync(dir, { recursive: true, force: true }); } };
}

async function api(base, path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function waitHealth(base, want) {
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const h = (await api(base, '/api/health')).data;
      if (h.rules && (want === undefined || h.rules.payoutsEnabled === want)) return h;
    } catch { /* not up yet */ }
  }
  return null;
}

// --- 1. the safety guards: mainnet and non-devnet RPCs keep payouts OFF -------------------------------
{
  const dummy = bs58.encode(Keypair.generate().secretKey);
  const a = startServer(8797, { PAYOUT_SECRET_KEY: dummy, SOLANA_CLUSTER: 'mainnet-beta', SOLANA_RPC: 'https://api.mainnet-beta.solana.com' });
  const h = await waitHealth('http://localhost:8797');
  check('cluster=mainnet-beta keeps payouts OFF', h && h.rules.payoutsEnabled === false, JSON.stringify(h?.rules));
  a.stop();

  const b = startServer(8798, { PAYOUT_SECRET_KEY: dummy, SOLANA_CLUSTER: 'devnet', SOLANA_RPC: 'https://api.mainnet-beta.solana.com' });
  await sleep(4000);
  const h2 = (await api('http://localhost:8798', '/api/health')).data;
  check('devnet setting + a mainnet RPC (wrong genesis hash) keeps payouts OFF', h2.rules.payoutsEnabled === false, JSON.stringify(h2.rules));
  check('server log says payouts are off', /\[payouts\] off/.test(b.log()), b.log());
  b.stop();
}

// --- 2. the real devnet flow -----------------------------------------------------------------------------------
const payoutWallet = Keypair.generate();
const recipient = Keypair.generate();
console.log('throwaway payout wallet (devnet):', payoutWallet.publicKey.toBase58());
console.log('recipient (devnet):            ', recipient.publicKey.toBase58());

let funded = false;
for (let i = 0; i < 4 && !funded; i++) {
  try {
    const sig = await conn.requestAirdrop(payoutWallet.publicKey, 0.5 * LAMPORTS_PER_SOL);
    const latest = await conn.getLatestBlockhash();
    await conn.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
    funded = (await conn.getBalance(payoutWallet.publicKey)) >= 0.2 * LAMPORTS_PER_SOL;
  } catch (err) {
    console.log(`airdrop attempt ${i + 1} failed: ${String(err.message).slice(0, 90)}`);
    await sleep(3000);
  }
}
check('payout wallet funded by a devnet airdrop', funded);
if (!funded) {
  console.log('\nThe devnet faucet is rate-limited right now. Try again later or fund the printed address at https://faucet.solana.com (devnet).');
  process.exit(2);
}

const BASE = 'http://localhost:8796';
const srv = startServer(8796, { PAYOUT_SECRET_KEY: bs58.encode(payoutWallet.secretKey), SOLANA_CLUSTER: 'devnet', SOLANA_RPC: DEVNET });
try {
  const h = await waitHealth(BASE, true);
  check('server turns payouts ON for real devnet', !!h && h.rules.cluster === 'devnet', srv.log());
  if (!h) throw new Error('server did not start');

  const reg = await api(BASE, '/api/register', { method: 'POST', body: { name: `Dev${Date.now().toString(36).slice(-6)}` } });
  const token = reg.data.token;
  const land = async () => {
    const f = await api(BASE, '/api/flight/start', { method: 'POST', token });
    await sleep(400);
    return api(BASE, '/api/flight/finish', { method: 'POST', token, body: { flightId: f.data.flightId, success: true, sink: 300, grade: 'SMOOTH LANDING', fp: 100 } });
  };

  let r = await api(BASE, '/api/wallet/withdraw', { method: 'POST', token });
  check('withdraw with nothing earned is refused', r.status === 400, JSON.stringify(r.data.error));
  for (let i = 0; i < 5; i++) await land();
  let w = (await api(BASE, '/api/wallet', { token })).data;
  check('5 safe landings earned 0.05 SOL', w.balance === 0.05 * LAMPORTS_PER_SOL, String(w.balance));

  r = await api(BASE, '/api/wallet/withdraw', { method: 'POST', token });
  check('withdraw without a connected address is refused', r.status === 400 && /Phantom/.test(r.data.error));
  r = await api(BASE, '/api/wallet/address', { method: 'POST', token, body: { address: recipient.publicKey.toBase58() } });
  check('recipient address saved', r.status === 200);

  const before = await conn.getBalance(recipient.publicKey);
  r = await api(BASE, '/api/wallet/withdraw', { method: 'POST', token });
  check('withdraw accepted (202), balance moved out of the reward wallet', r.status === 202 && r.data.balance === 0 && r.data.withdrawn === 0.05 * LAMPORTS_PER_SOL, JSON.stringify(r.data.error));
  r = await api(BASE, '/api/wallet/withdraw', { method: 'POST', token });
  check('a second withdraw right away is refused', r.status === 400 || r.status === 409);

  let p = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    w = (await api(BASE, '/api/wallet', { token })).data;
    p = w.payouts[0];
    if (p && (p.status === 'sent' || p.status === 'failed')) break;
  }
  check('payout status becomes "sent" with a signature', p?.status === 'sent' && p.signature.length > 40, JSON.stringify(p) + srv.log());
  if (p?.signature) {
    const st = await conn.getSignatureStatuses([p.signature], { searchTransactionHistory: true });
    check('the transaction is confirmed on devnet', ['confirmed', 'finalized'].includes(st.value[0]?.confirmationStatus));
    console.log('explorer:', `https://explorer.solana.com/tx/${p.signature}?cluster=devnet`);
  }
  const after = await conn.getBalance(recipient.publicKey);
  check('recipient received exactly 0.05 SOL on chain', after - before === 0.05 * LAMPORTS_PER_SOL, `${before} -> ${after}`);
  check('reward wallet ledger shows the withdrawal and zero balance', w.balance === 0 && w.withdrawn === 0.05 * LAMPORTS_PER_SOL && w.txs[0].type === 'withdraw');
} finally {
  srv.stop();
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
