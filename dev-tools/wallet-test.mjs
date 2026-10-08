// Dev tool: exercises the server-side reward rules over HTTP (payouts OFF, so
// nothing is ever sent). Use a throwaway data folder: it registers test pilots.
//
//   DATA_DIR=/tmp/wtdata PORT=8795 MIN_FLIGHT_MS=300 REWARD_MIN_FLIGHT_MS=300 \
//   MAX_REWARDS_PER_PILOT_PER_DAY=6 PAYOUT_SECRET_KEY= node server/index.mjs
//   node dev-tools/wallet-test.mjs http://localhost:8795
//
// (PAYOUT_SECRET_KEY must be empty/unset here.) The devnet payout flow is tested
// by dev-tools/payout-devnet-test.mjs.

const BASE = process.argv[2] || 'http://localhost:8795';
const LAMPORTS = 1e9;
const REWARD = 0.01 * LAMPORTS;
const CAP = 6;
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${extra}`}`);
};

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const land = async (token, over = {}) => {
  const f = await api('/api/flight/start', { method: 'POST', token });
  await sleep(400);
  return api('/api/flight/finish', { method: 'POST', token, body: { flightId: f.data.flightId, success: true, sink: 300, grade: 'SMOOTH LANDING', fp: 100, ...over } });
};

const name = `WT${Date.now().toString(36).slice(-6)}`;
const reg = await api('/api/register', { method: 'POST', body: { name } });
const token = reg.data.token;
check('register', reg.status === 201 && !!token);

const health = (await api('/api/health')).data;
check('health exposes the rules', health.rules?.reward === REWARD && health.rules?.cluster === 'devnet' && health.rules?.payoutsEnabled === false, JSON.stringify(health.rules));

let w = (await api('/api/wallet', { token })).data;
check('new pilot starts with 0 balance', w.balance === 0 && w.earned === 0, JSON.stringify(w));
check('no token → 401', (await api('/api/wallet')).status === 401);

// flights are free
let f = await api('/api/flight/start', { method: 'POST', token });
check('flight start is free', f.status === 201 && f.data.wallet.balance === 0);

// too-fast finish
let r = await api('/api/flight/finish', { method: 'POST', token, body: { flightId: f.data.flightId, success: true, sink: 300, grade: 'SMOOTH LANDING', fp: 100 } });
check('instant finish is rejected', r.status === 400, JSON.stringify(r.data));

// crash pays nothing
f = await api('/api/flight/start', { method: 'POST', token });
await sleep(400);
r = await api('/api/flight/finish', { method: 'POST', token, body: { flightId: f.data.flightId, success: false, fp: 0 } });
check('crash pays nothing', r.status === 200 && r.data.reward === 0 && r.data.wallet.balance === 0, JSON.stringify(r.data));

// safe landing pays 0.01
f = await api('/api/flight/start', { method: 'POST', token });
await sleep(400);
const landing = { flightId: f.data.flightId, success: true, sink: 300, grade: 'SMOOTH LANDING', fp: 100 };
r = await api('/api/flight/finish', { method: 'POST', token, body: landing });
check('safe landing pays +0.01', r.status === 200 && r.data.reward === REWARD && r.data.wallet.balance === REWARD, JSON.stringify(r.data.wallet?.balance));
r = await api('/api/flight/finish', { method: 'POST', token, body: landing });
check('same flight cannot be paid twice', r.status === 400);

// bad landing data
f = await api('/api/flight/start', { method: 'POST', token });
await sleep(400);
r = await api('/api/flight/finish', { method: 'POST', token, body: { flightId: f.data.flightId, success: true, sink: 5, grade: 'BUTTER LANDING', fp: 100 } });
check('impossible sink rate is rejected', r.status === 400);
r = await api('/api/flight/finish', { method: 'POST', token, body: { flightId: 'nope', success: true, sink: 300, grade: 'SAFE LANDING' } });
check('unknown flight id is rejected', r.status === 400);

// someone else's flight id
const other = await api('/api/register', { method: 'POST', body: { name: `${name}x`.slice(0, 16) } });
const fo = await api('/api/flight/start', { method: 'POST', token });
await sleep(400);
r = await api('/api/flight/finish', { method: 'POST', token: other.data.token, body: { flightId: fo.data.flightId, success: true, sink: 300, grade: 'SAFE LANDING' } });
check("another pilot can't settle my flight", r.status === 400);

// daily reward cap: landings keep counting, rewards stop
let paid = 1;
for (let i = 0; i < CAP + 2; i++) if ((await land(token)).data.reward === REWARD) paid++;
w = (await api('/api/wallet', { token })).data;
check(`rewards stop at the daily cap (${CAP})`, paid === CAP && w.balance === CAP * REWARD && w.rewardsToday === CAP, `paid=${paid} bal=${w.balance}`);
r = await land(token);
check('over the cap: landing recorded, reward 0, with a note', r.status === 200 && r.data.reward === 0 && /Daily reward limit/.test(r.data.rewardNote), JSON.stringify(r.data.rewardNote));

// address + withdraw gates (payouts are off here)
r = await api('/api/wallet/address', { method: 'POST', token, body: { address: 'not-an-address' } });
check('bad address is refused', r.status === 400);
const ADDR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'; // valid-format public address
r = await api('/api/wallet/address', { method: 'POST', token, body: { address: ADDR } });
check('valid address is saved', r.status === 200 && r.data.address === ADDR);
r = await api('/api/wallet/withdraw', { method: 'POST', token });
check('withdraw is refused while payouts are off (503) and nothing is deducted', r.status === 503 && r.data.wallet.balance === CAP * REWARD && r.data.wallet.withdrawn === 0, JSON.stringify(r.data.error));
check('the old top-up route is gone', (await api('/api/wallet/topup', { method: 'POST', token })).status === 404);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
