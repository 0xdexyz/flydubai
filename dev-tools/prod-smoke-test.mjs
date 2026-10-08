// Dev tool: starts the server the way a host would (NODE_ENV=production, serving dist/)
// and checks static serving, security headers, path traversal, rate limits and the
// per-address sign-up limit behind a proxy.   npm run build && node dev-tools/prod-smoke-test.mjs

import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8801;
const dir = mkdtempSync(join(tmpdir(), 'fdsim-prod-'));
const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATA_DIR: dir, TRUST_PROXY: '1', RATE_LIMIT_PER_MIN: '60',
    MAX_REGISTRATIONS_PER_HOUR: '3', PAYOUT_SECRET_KEY: '', OWNER_PANEL: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${extra}`}`);
};

/** Raw request, so odd paths reach the server exactly as written. */
function raw(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

try {
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      if ((await raw('/api/health')).status === 200) break;
    } catch { /* not up yet */ }
  }

  // --- the game -----------------------------------------------------------------------------
  let r = await raw('/');
  check('GET / serves the game', r.status === 200 && /text\/html/.test(r.headers['content-type']) && /FlyDubaiSim/i.test(r.body.toString()));
  check('HTML is revalidated, not cached', /no-cache/.test(r.headers['cache-control'] || ''));
  check('security headers are set', r.headers['x-content-type-options'] === 'nosniff' && r.headers['x-frame-options'] === 'SAMEORIGIN' && !!r.headers['referrer-policy']);
  check('no wildcard CORS header', r.headers['access-control-allow-origin'] === undefined);

  const js = readdirSync(join(ROOT, 'dist', 'assets')).find((f) => /^index-.*\.js$/.test(f));
  r = await raw(`/assets/${js}`, { headers: { 'Accept-Encoding': 'gzip' } });
  check('JS asset is gzip-compressed and cached for a year', r.status === 200 && r.headers['content-encoding'] === 'gzip' && /immutable/.test(r.headers['cache-control']) && r.body.length < 400_000, `${r.status} ${r.headers['content-encoding']} ${r.body.length}`);
  const r2 = await raw(`/assets/${js}`, { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': r.headers.etag } });
  check('conditional request gets 304', r2.status === 304);
  r = await raw('/brand/logo-mark.png');
  check('brand images are served', r.status === 200 && r.headers['content-type'] === 'image/png');

  // --- path traversal and secrets -----------------------------------------------------------------
  const probes = ['/../server/index.mjs', '/%2e%2e/server/index.mjs', '/..%2fserver%2findex.mjs', '/assets/../../.env', '/.env', '/%2e%2e/.env', '/server/index.mjs', '/package.json', '/assets/%00.js'];
  let leaked = false;
  const statuses = [];
  for (const p of probes) {
    const x = await raw(p);
    statuses.push(x.status);
    const t = x.body.toString();
    if (/PAYOUT_SECRET_KEY|createSolanaSender|"dependencies"/.test(t) && !/FlyDubaiSim/i.test(t)) leaked = true;
  }
  check('traversal and secret-file probes never return file contents', !leaked, statuses.join(','));
  r = await raw('/missing-file.js');
  check('missing file with an extension is a 404', r.status === 404);
  r = await raw('/some/page');
  check('unknown navigation falls back to the game', r.status === 200 && /text\/html/.test(r.headers['content-type']));

  // --- API ---------------------------------------------------------------------------------------------
  r = await raw('/api/health');
  const health = JSON.parse(r.body.toString());
  check('API health works', r.status === 200 && health.ok === true && health.rules.cluster === 'devnet');
  r = await raw('/api/owner/wallet');
  check('owner wallet panel is OFF in production (403)', r.status === 403);
  r = await raw('/api/register', { method: 'OPTIONS' });
  check('preflight gets no CORS grant by default', r.status === 204 && r.headers['access-control-allow-origin'] === undefined);

  // --- rate limits ----------------------------------------------------------------------------------------
  const codes = [];
  for (let i = 0; i < 80; i++) codes.push((await raw('/api/leaderboard', { headers: { 'X-Forwarded-For': '203.0.113.9' } })).status);
  check('one address is rate-limited after the per-minute cap', codes.includes(429) && codes.indexOf(429) >= 55, `first 429 at ${codes.indexOf(429)}`);
  r = await raw('/api/leaderboard', { headers: { 'X-Forwarded-For': '203.0.113.77' } });
  check('a different address is not affected', r.status === 200);

  // --- sign-up limit behind a proxy ----------------------------------------------------------------------------
  const reg = (name, xff) => raw('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff }, body: JSON.stringify({ name }) });
  const a = [];
  for (let i = 0; i < 4; i++) a.push((await reg(`SmokeA${i}`, '198.51.100.1')).status);
  check('sign-ups: 3 allowed per address, the 4th is refused', a.join(',') === '201,201,201,429', a.join(','));
  const b = await reg('SmokeB0', '198.51.100.2');
  check('sign-ups: another address is independent', b.status === 201);
  const spoof = await reg('SmokeA9', 'spoofed-by-client, 198.51.100.1');
  check('a client cannot dodge the limit by faking X-Forwarded-For', spoof.status === 429, String(spoof.status));
} finally {
  child.kill();
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n--- server log ---\n' + log.trim());
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
