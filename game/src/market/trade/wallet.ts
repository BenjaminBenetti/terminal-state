// Task studio-survivor-market-20261108-005807-01 (lane TRADE): the Rail Ties wallet — a RunParticipant ('market.wallet', run/snapshot.ts).
// Task studio-market-rework-20261108-074144-01 (lane TRADE): Rail Ties are now a PHYSICAL item (items/railTies.ts) and there is NO balance
// any more. This participant only carries an OLD save's balance over, ONCE:
//  - LOAD {v: 1, ties: N} (a save / Retry snapshot / export made before the rework): N ties are OWED. Nothing is placed during the load
//    itself (the participants load in turn, and the player train's — its Lockbox and cargo — comes after this one): the trade controller
//    settles them at the next section build / frame (market/trade/tradeSystem.ts settleWallet -> payment.ts migrateTies): carried first,
//    then the Lockbox, then the parked car's floor, with a toast. Placing them and lowering `owed` happen in the same step.
//  - SAVE while ties are still owed: {v: 1, ties: owed} (an autosave before the settle loses nothing); once nothing is owed:
//    {v: 2, migrated: true} — a later load never mints anything again. New Game / an old save without the participant: nothing owed.
//  - RETRY: the entry snapshot's record with the entry inventory / Lockbox / cargo — a snapshot taken before the settle owes N to an
//    inventory without them (they are placed again into exactly that state), one taken after owes nothing: never lost, never doubled.
// Validated strictly (walletProblem, save/validate.ts: both versions). Pure (no three.js / DOM).
import type {RunParticipant} from '../../run/snapshot';

/** The participant id (save/validate.ts LANE_ID format). */
export const WALLET_PARTICIPANT = 'market.wallet';
/** The largest old balance a save may hold (whole ties). */
export const WALLET_MAX = 1_000_000_000;

/** v1: an old balance still owed as physical ties; v2: settled (nothing is ever minted from it again). */
export type WalletJSON = {v: 1; ties: number} | {v: 2; migrated: true};

/** Why a saved wallet record is malformed (null = fine). */
export function walletProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the wallet record must be an object';
  const o = v as Record<string, unknown>;
  if (o.v === 2) {
    for (const k of Object.keys(o)) if (k !== 'v' && k !== 'migrated') return `unexpected wallet field '${k}'`;
    return o.migrated === true ? null : 'a settled wallet record says migrated: true';
  }
  if (o.v !== 1) return 'unsupported wallet version';
  for (const k of Object.keys(o)) if (k !== 'v' && k !== 'ties') return `unexpected wallet field '${k}'`;
  if (!Number.isInteger(o.ties) || (o.ties as number) < 0 || (o.ties as number) > WALLET_MAX) return `wallet balance ${String(o.ties)} out of range (0 to ${WALLET_MAX} whole ties)`;
  return null;
}

/** An old save's market balance still to be handed over as physical Rail Ties. */
export class LegacyWallet {
  private due = 0;
  /** Bumped on every change. */
  version = 0;

  /** Ties still owed from an old balance (0 = nothing; the usual case). */
  get owed(): number {
    return this.due;
  }

  /** `n` of the owed ties were placed physically (the rest stays owed). */
  settle(n: number): void {
    const k = Math.max(0, Math.min(this.due, Math.floor(n)));
    if (!k) return;
    this.due -= k;
    this.version++;
  }

  toJSON(): WalletJSON {
    return this.due > 0 ? {v: 1, ties: this.due} : {v: 2, migrated: true};
  }

  /** Restore a saved record: {v: 1, ties} owes them, {v: 2} owes nothing; anything malformed owes nothing (never throws). */
  load(d: unknown): void {
    this.due = walletProblem(d) === null && (d as {v: number}).v === 1 ? (d as {ties: number}).ties : 0;
    this.version++;
  }

  /** New Game: nothing owed. */
  reset(): void {
    this.due = 0;
    this.version++;
  }

  participant(): RunParticipant {
    return {id: WALLET_PARTICIPANT, save: () => this.toJSON(), load: d => this.load(d), reset: () => this.reset()};
  }
}
