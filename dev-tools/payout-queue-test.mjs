// Dev tool: tests the payout queue's safety logic with a FAKE sender (no network,
// no keys, no transfers):  node dev-tools/payout-queue-test.mjs

import { createPayouts } from '../server/payouts.mjs';

let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${extra}`}`);
};
const quiet = { warn() {} };
const until = async (fn, ms = 4000) => {
  const t = Date.now();
  while (!fn() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 20));
  return fn();
};

/** A scriptable fake chain. */
function fakeSender(opts = {}) {
  const s = {
    enabled: true, cluster: 'devnet', problem: '',
    sent: [], // raw payloads that were broadcast
    height: 100, balanceLamports: 5e9, prepared: 0,
    landed: new Set(), // signatures that confirm
    failedSigs: new Set(),
    broadcastError: null,
    async balance() { return s.balanceLamports; },
    async prepare(to, lamports) { s.prepared++; const signature = `sig${s.prepared}`; return { signature, raw: { to, lamports, signature }, lastValidBlockHeight: s.height + 150 }; },
    async broadcast(raw) { s.sent.push(raw); if (s.broadcastError) throw new Error(s.broadcastError); if (!opts.neverLand) s.landed.add(raw.signature); },
    async status(sig) { return s.failedSigs.has(sig) ? 'failed' : s.landed.has(sig) ? 'confirmed' : 'unknown'; },
    async blockHeight() { return s.height; },
  };
  return s;
}

const fresh = (sender, onFailed) => {
  const db = { users: {}, payouts: {} };
  let saves = 0;
  const q = createPayouts({ db, saveNow: () => saves++, sender, onFailed, pollMs: 5, log: quiet });
  return { db, q, saves: () => saves };
};
const ADDR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

// 1. happy path
{
  const s = fakeSender();
  const { db, q } = fresh(s);
  const p = q.add({ id: 'a', key: 'k', address: ADDR, lamports: 5e7 });
  await until(() => p.status === 'sent');
  check('happy path: queued → sent with a signature', p.status === 'sent' && p.signature === 'sig1' && s.sent.length === 1);
  await q.process();
  check('a sent payout is never paid again', s.sent.length === 1);
}

// 2. signature is saved to disk BEFORE the money moves
{
  const s = fakeSender();
  const { db, q } = fresh(s);
  let sigWhenBroadcast = null;
  const orig = s.broadcast;
  s.broadcast = async (raw) => { sigWhenBroadcast = db.payouts.a.signature + '|' + db.payouts.a.status; return orig(raw); };
  const p = q.add({ id: 'a', key: 'k', address: ADDR, lamports: 5e7 });
  await until(() => p.status === 'sent');
  check('signature + "sending" are recorded before broadcast', sigWhenBroadcast === 'sig1|sending', sigWhenBroadcast);
}

// 3. crash after broadcast, before confirmation: restart must NOT pay twice
{
  const s = fakeSender({ neverLand: true });
  const { db, q } = fresh(s);
  q.add({ id: 'a', key: 'k', address: ADDR, lamports: 5e7 });
  await until(() => db.payouts.a.status === 'sending' && s.sent.length === 1);
  // "restart": a new queue over the same db, while the first tx has now landed on chain
  s.landed.add('sig1');
  const q2 = createPayouts({ db, saveNow() {}, sender: s, pollMs: 5, log: quiet });
  await q2.process();
  check('after a restart a landed payout is marked sent, not re-sent', db.payouts.a.status === 'sent' && s.sent.length === 1 && s.prepared === 1, `${db.payouts.a.status} sent=${s.sent.length}`);
}

// 4. unconfirmed but blockhash still valid: wait, don't re-send
{
  const s = fakeSender({ neverLand: true });
  const db = { users: {}, payouts: { a: { id: 'a', key: 'k', address: ADDR, lamports: 5e7, status: 'sending', signature: 'sigX', lastValidBlockHeight: 250, attempts: 1, createdAt: new Date().toISOString() } } };
  const q = createPayouts({ db, saveNow() {}, sender: s, pollMs: 5, log: quiet });
  await q.process();
  check('still-valid unconfirmed tx is left alone (no double send)', db.payouts.a.status === 'sending' && s.sent.length === 0 && s.prepared === 0);
}

// 5. blockhash expired and never landed: safe to retry once
{
  const s = fakeSender();
  s.height = 400;
  const db = { users: {}, payouts: { a: { id: 'a', key: 'k', address: ADDR, lamports: 5e7, status: 'sending', signature: 'sigX', lastValidBlockHeight: 250, attempts: 1, createdAt: new Date().toISOString() } } };
  const q = createPayouts({ db, saveNow() {}, sender: s, pollMs: 5, log: quiet });
  await q.process();
  check('expired + never landed → paid exactly once with a new tx', db.payouts.a.status === 'sent' && s.sent.length === 1 && db.payouts.a.signature === 'sig1');
}

// 6. network rejects it → failed, onFailed (refund) called once
{
  const s = fakeSender({ neverLand: true });
  s.failedSigs.add('sig1');
  const refunds = [];
  const { db, q } = fresh(s, (p, why) => refunds.push([p.id, why]));
  const p = q.add({ id: 'a', key: 'k', address: ADDR, lamports: 5e7 });
  await until(() => p.status === 'failed');
  check('rejected transaction → failed and the pilot is refunded once', p.status === 'failed' && refunds.length === 1 && refunds[0][0] === 'a', JSON.stringify(refunds));
}

// 7. payout wallet too low → failed + refund, nothing sent
{
  const s = fakeSender();
  s.balanceLamports = 5e7; // not enough for amount + reserve
  const refunds = [];
  const { q } = fresh(s, (p) => refunds.push(p.id));
  const p = q.add({ id: 'a', key: 'k', address: ADDR, lamports: 5e7 });
  await until(() => p.status === 'failed');
  check('empty payout wallet → refunded, nothing broadcast', p.status === 'failed' && refunds.length === 1 && s.sent.length === 0);
}

// 8. RPC errors while preparing: retried, then failed after 5 attempts
{
  const s = fakeSender();
  s.prepare = async () => { s.prepared++; throw new Error('rpc down'); };
  const refunds = [];
  const { q } = fresh(s, (p) => refunds.push(p.id));
  const p = q.add({ id: 'a', key: 'k', address: ADDR, lamports: 5e7 });
  for (let i = 0; i < 40 && p.status !== 'failed'; i++) {
    await q.process();
    await new Promise((r) => setTimeout(r, 10));
  }
  check('persistent RPC failure → refunded after 5 attempts, never sent', p.status === 'failed' && s.prepared === 5 && s.sent.length === 0 && refunds.length === 1, `${p.status} prepared=${s.prepared}`);
}

// 9. disabled sender: nothing moves
{
  const s = fakeSender();
  s.enabled = false;
  const { q } = fresh(s);
  q.add({ id: 'a', key: 'k', address: ADDR, lamports: 5e7 });
  await q.process();
  check('disabled sender never sends', s.sent.length === 0 && s.prepared === 0);
}

// 10. budget helpers
{
  const s = fakeSender();
  const { q } = fresh(s);
  q.add({ id: 'a', key: 'k1', address: ADDR, lamports: 2e7 });
  q.add({ id: 'b', key: 'k1', address: ADDR, lamports: 3e7 });
  q.add({ id: 'c', key: 'k2', address: ADDR, lamports: 4e7 });
  check('spentToday / withdrawalsToday / hasOpen count correctly', q.spentToday() === 9e7 && q.withdrawalsToday('k1') === 2 && q.hasOpen('k2'));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
