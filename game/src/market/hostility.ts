// Task studio-market-rework-20261108-074144-01: the shared seam between the market's people (combat lane), its trade (stalls) and its owned
// displayed wares (theft lane). User: "If you shoot one, they all become hostile, about 70% will just run away, and the remaining ones will
// pull out random weapons and start firing back!" / "If the player picks those items up, the shop keeper will attack them".
// The combat lane implements it (Game.marketHostility); the others only call it (optional: inert where no market is built).
import type {MarketStallId} from '../gen/market/marketTypes';

/** What turned the settlement against the player. */
export interface MarketProvocation {
  kind: 'attack' | 'theft';
  /** Theft: the stall robbed (its trader must attack, never flee). Attack: the stall whose trader was hit, if a trader. */
  stall?: MarketStallId;
  /** Attack: the person hit (market/marketPeople id), when known. */
  person?: string;
}

export interface MarketHostilityApi {
  /** The local settlement is hostile (persisted per market station; no reset / bribe / reputation system). */
  readonly hostile: boolean;
  /** The player attacked someone / stole: the settlement turns hostile (idempotent; recorded at once). */
  provoke(cause: MarketProvocation): void;
  /** That stall's trader can trade now: alive, at the stall, not fled, the settlement not hostile. */
  canTrade(stall: MarketStallId): boolean;
}
