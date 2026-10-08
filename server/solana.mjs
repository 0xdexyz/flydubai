// Solana sender for reward payouts. It signs plain SOL transfers from the
// payout wallet whose secret key lives ONLY in the server's environment
// (.env, never committed). Nothing here ever logs the key.
//
// DEVNET ONLY: payouts are test SOL. The sender refuses to enable itself unless
// the cluster is "devnet" AND the RPC endpoint reports devnet's genesis hash, so
// a wrong URL or setting can never move real money. Mainnet is not supported.
//
// The payouts queue (payouts.mjs) talks to this through a small interface so
// it can be tested with a fake sender:
//   enabled, cluster, address, problem
//   verify()              -> checks the network, sets enabled
//   prepare(to, lamports) -> { signature, raw, lastValidBlockHeight }   (signs, does not send)
//   broadcast(raw)
//   status(signature)     -> 'confirmed' | 'failed' | 'unknown'
//   blockHeight()
//   balance()

import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

/** Accepts a base58 secret key or a JSON array of bytes (Solana CLI keypair file contents). */
export function loadKeypair(secret) {
  const s = String(secret || '').trim();
  if (!s) return null;
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s);
  return Keypair.fromSecretKey(bytes);
}

export function createSolanaSender({ secret, rpc, cluster = 'devnet' }) {
  let keypair = null;
  let problem = '';
  if (cluster !== 'devnet') {
    problem = 'Only devnet payouts are supported. Mainnet payouts are not active.';
  } else {
    try {
      keypair = loadKeypair(secret);
    } catch {
      problem = 'PAYOUT_SECRET_KEY is set but is not a valid Solana secret key.';
    }
    if (!keypair && !problem) problem = 'No payout wallet configured.';
  }

  const state = { enabled: false, problem };
  if (!keypair) return { get enabled() { return false; }, cluster, address: '', get problem() { return state.problem; }, verify: async () => false };

  const conn = new Connection(rpc, 'confirmed');
  return {
    get enabled() {
      return state.enabled;
    },
    get problem() {
      return state.problem;
    },
    cluster,
    address: keypair.publicKey.toBase58(),

    /** Turn payouts on only if the RPC really is devnet. */
    async verify() {
      try {
        const genesis = await conn.getGenesisHash();
        state.enabled = genesis === DEVNET_GENESIS;
        state.problem = state.enabled ? '' : 'The RPC endpoint is not Solana devnet, so payouts stay off.';
      } catch {
        state.enabled = false;
        state.problem = 'Could not reach the Solana RPC endpoint.';
      }
      return state.enabled;
    },

    async prepare(to, lamports) {
      if (!state.enabled) throw new Error('payouts are not enabled');
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = new Transaction({ feePayer: keypair.publicKey, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: new PublicKey(to), lamports }),
      );
      tx.sign(keypair);
      return { signature: bs58.encode(tx.signature), raw: tx.serialize(), lastValidBlockHeight };
    },

    async broadcast(raw) {
      if (!state.enabled) throw new Error('payouts are not enabled');
      await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
    },

    async status(signature) {
      const res = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const v = res.value[0];
      if (!v) return 'unknown';
      if (v.err) return 'failed';
      return v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized' ? 'confirmed' : 'unknown';
    },

    blockHeight: () => conn.getBlockHeight('confirmed'),
    balance: () => conn.getBalance(keypair.publicKey, 'confirmed'),
  };
}
