// Creates a NEW payout wallet for devnet and saves its secret key into .env.
// The secret key is never printed. Only the public address is shown, so you can
// fund it with devnet test SOL at https://faucet.solana.com (choose "devnet").
//
//   node dev-tools/make-payout-wallet.mjs
//
// It will not overwrite a key that is already in .env.

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = join(ROOT, '.env');
const EXAMPLE = join(ROOT, '.env.example');

if (!existsSync(ENV)) copyFileSync(EXAMPLE, ENV);
let text = readFileSync(ENV, 'utf8');

const current = /^PAYOUT_SECRET_KEY=(.*)$/m.exec(text)?.[1]?.trim();
if (current) {
  console.log('.env already has a PAYOUT_SECRET_KEY, so nothing was changed.');
  console.log('To start over, clear that line in .env yourself and run this again.');
  process.exit(0);
}

const kp = Keypair.generate();
const line = `PAYOUT_SECRET_KEY=${bs58.encode(kp.secretKey)}`;
text = /^PAYOUT_SECRET_KEY=.*$/m.test(text) ? text.replace(/^PAYOUT_SECRET_KEY=.*$/m, line) : `${text.trimEnd()}\n${line}\n`;
writeFileSync(ENV, text);

console.log('New devnet payout wallet created. Its secret key is saved in .env (and nowhere else).');
console.log('');
console.log('  Public address:', kp.publicKey.toBase58());
console.log('');
console.log('Next: fund that address with devnet SOL at https://faucet.solana.com (pick "devnet"),');
console.log('then restart the server (npm run server). The log should say "devnet payouts ON".');
