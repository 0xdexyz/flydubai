// Placeholder adapter for a possible future Solana integration.
//
// It is intentionally NOT wired up. It documents the interface a real
// adapter would implement so RewardsService can switch providers without
// touching game code.
//
// Security model for any future integration:
//  - The frontend NEVER holds private keys, seed phrases or signing secrets.
//    Nothing secret belongs in this repository or in the browser bundle.
//  - A player would connect their own wallet through a standard wallet
//    adapter; the wallet app asks the player to approve anything it signs.
//  - Scores would be validated server-side (anti-cheat) before anything is
//    recorded on-chain; any program authority key lives only on that server.
//  - Flight Points remain non-withdrawable in-game points. No deposits,
//    wagering or purchases are required to play.

export class SolanaRewardsProvider {
  constructor(config = {}) {
    this.name = 'solana';
    this.config = config; // e.g. { cluster: 'devnet', apiBase: 'https://your-backend.example' }
    this.available = false;
  }

  /** Would request a wallet connection via a wallet adapter (public key only). */
  async connect() {
    throw new Error('Solana rewards are not configured in this build.');
  }

  getProfile() {
    throw new Error('Solana rewards are not configured in this build.');
  }

  /** Would POST the flight summary to a backend that validates and records it. */
  async recordFlight() {
    throw new Error('Solana rewards are not configured in this build.');
  }
}
