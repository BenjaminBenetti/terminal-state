// Task studio-survivor-market-20261108-005807-01 (lane TRADE): THE WALLET — the run's Rail Ties balance (market/trade/ties.ts), a
// RunParticipant ('market.wallet', run/snapshot.ts):
//  - New Game: 0 (no windfall). An old save without the participant loads 0 (save/serialize.ts installRestore calls reset()).
//  - Retry: the level-entry snapshot's balance (restoreParticipants), together with that station's stock memory and the carried
//    inventory as they were then (a trade made after entry is undone on all three sides).
//  - Save / Continue / export / departure / arrival: saved as {v: 1, ties} and validated strictly (walletProblem, save/validate.ts).
// Only the atomic trade transactions (market/trade/transactions.ts) change the balance: no scenery, pickup or level ever grants ties.
// Pure (no three.js / DOM).
import type {RunParticipant} from '../../run/snapshot';

/** The participant id (save/validate.ts LANE_ID format). */
export const WALLET_PARTICIPANT = 'market.wallet';
/** The largest balance a save may hold (whole ties). */
export const WALLET_MAX = 1_000_000_000;

export interface WalletJSON { v: 1; ties: number }

/** Why a saved wallet record is malformed (null = fine). */
export function walletProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the wallet record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'v' && k !== 'ties') return `unexpected wallet field '${k}'`;
  if (o.v !== 1) return 'unsupported wallet version';
  if (!Number.isInteger(o.ties) || (o.ties as number) < 0 || (o.ties as number) > WALLET_MAX) return `wallet balance ${String(o.ties)} out of range (0 to ${WALLET_MAX} whole ties)`;
  return null;
}

export class MarketWallet {
  private value = 0;
  /** Bumped on every change (the open trade view redraws). */
  version = 0;

  /** The balance in whole ties. */
  get ties(): number {
    return this.value;
  }

  /** Whether `n` ties can be paid. */
  canPay(n: number): boolean {
    return Number.isInteger(n) && n >= 0 && n <= this.value;
  }

  /** Pay `n` ties (a buy). False, nothing changes, when short or `n` is not a whole non-negative amount. */
  pay(n: number): boolean {
    if (!this.canPay(n)) return false;
    this.value -= n;
    this.version++;
    return true;
  }

  /** Receive `n` ties (a sale). False, nothing changes, for a bad amount or one that would pass WALLET_MAX. */
  receive(n: number): boolean {
    if (!Number.isInteger(n) || n < 0 || this.value + n > WALLET_MAX) return false;
    this.value += n;
    this.version++;
    return true;
  }

  toJSON(): WalletJSON {
    return {v: 1, ties: this.value};
  }

  /** Restore a saved record; anything malformed loads as 0 (never throws; a validated save never gets here malformed). */
  load(d: unknown): void {
    this.value = walletProblem(d) === null ? (d as WalletJSON).ties : 0;
    this.version++;
  }

  /** New Game: 0. */
  reset(): void {
    this.value = 0;
    this.version++;
  }

  participant(): RunParticipant {
    return {id: WALLET_PARTICIPANT, save: () => this.toJSON(), load: d => this.load(d), reset: () => this.reset()};
  }
}
