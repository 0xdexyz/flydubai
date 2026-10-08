// Reward payout queue (devnet test SOL: see solana.mjs). A withdrawal is
// written to disk as 'queued', then paid from the payout wallet by this queue.
// The signature of every transaction is saved BEFORE it is broadcast, so after
// a crash or a timeout the queue checks the chain instead of ever paying the
// same withdrawal twice:
//
//   queued -> sending (signature saved, broadcast) -> sent
//                         \-> back to queued only once its blockhash has expired
//   queued/sending -> failed (the pilot's balance is returned)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_ATTEMPTS = 5;
const RESERVE_LAMPORTS = 2_000_000; // the payout wallet must keep this much after paying (rent + fees)

export function createPayouts({ db, saveNow, sender, onFailed, onSettled, pollMs = 2000, log = console }) {
  db.payouts ||= {};
  let running = false;
  let timer = null;

  const list = () => Object.values(db.payouts);
  const today = () => new Date().toISOString().slice(0, 10);

  function fail(p, reason) {
    p.status = 'failed';
    p.error = reason;
    p.finishedAt = new Date().toISOString();
    saveNow();
    onFailed?.(p, reason);
    log.warn?.(`[payouts] ${p.id} failed: ${reason}`);
  }

  async function step(p) {
    if (p.status === 'sending') {
      const st = await sender.status(p.signature);
      if (st === 'confirmed') {
        p.status = 'sent';
        p.finishedAt = new Date().toISOString();
        saveNow();
        onSettled?.(p);
        return;
      }
      if (st === 'failed') return fail(p, 'The transaction was rejected by the network.');
      if ((await sender.blockHeight()) <= p.lastValidBlockHeight) return; // may still land: wait
      p.status = 'queued'; // blockhash expired and it never landed: safe to try again
      p.signature = '';
    }
    if (p.status !== 'queued') return;

    p.attempts = (p.attempts || 0) + 1;
    let prepared;
    try {
      const balance = await sender.balance();
      if (balance < p.lamports + RESERVE_LAMPORTS) return fail(p, 'Payouts are temporarily unavailable. Your balance was returned.');
      prepared = await sender.prepare(p.address, p.lamports);
    } catch (err) {
      if (p.attempts >= MAX_ATTEMPTS) return fail(p, 'The payout could not be prepared. Your balance was returned.');
      log.warn?.(`[payouts] ${p.id} prepare error: ${err.message}`);
      saveNow();
      return;
    }
    p.signature = prepared.signature;
    p.lastValidBlockHeight = prepared.lastValidBlockHeight;
    p.status = 'sending';
    saveNow(); // durable before the funds can move
    try {
      await sender.broadcast(prepared.raw);
    } catch (err) {
      log.warn?.(`[payouts] ${p.id} broadcast error: ${err.message}`); // it may still have landed: the status check decides
    }
    for (let i = 0; i < 20 && p.status === 'sending'; i++) {
      await sleep(pollMs);
      await step(p);
    }
  }

  async function process() {
    if (running || !sender.enabled) return;
    running = true;
    try {
      const open = list().filter((p) => p.status === 'queued' || p.status === 'sending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const p of open) {
        try {
          await step(p);
        } catch (err) {
          log.warn?.(`[payouts] ${p.id}: ${err.message}`);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    get enabled() {
      return !!sender.enabled;
    },
    get cluster() {
      return sender.cluster;
    },
    get problem() {
      return sender.problem || '';
    },

    /** Lamports queued or paid today (UTC), failed ones excluded: the daily budget counts against this. */
    spentToday: () => list().filter((p) => p.status !== 'failed' && p.createdAt.slice(0, 10) === today()).reduce((n, p) => n + p.lamports, 0),

    withdrawalsToday: (key) => list().filter((p) => p.key === key && p.status !== 'failed' && p.createdAt.slice(0, 10) === today()).length,

    hasOpen: (key) => list().some((p) => p.key === key && (p.status === 'queued' || p.status === 'sending')),

    forUser: (key, n = 10) => list().filter((p) => p.key === key).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n)
      .map((p) => ({ id: p.id, lamports: p.lamports, status: p.status, signature: p.signature || '', createdAt: p.createdAt, error: p.error || '' })),

    add(p) {
      db.payouts[p.id] = { attempts: 0, signature: '', lastValidBlockHeight: 0, error: '', ...p, status: 'queued', createdAt: new Date().toISOString() };
      saveNow();
      process();
      return db.payouts[p.id];
    },

    process,

    /** Resume anything left open by a restart, then keep checking. */
    start() {
      if (!sender.enabled) return;
      process();
      timer = setInterval(process, 15_000);
      timer.unref?.();
    },
  };
}
