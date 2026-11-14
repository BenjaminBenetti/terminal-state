// Task studio-corpse-market-shop-20261114-031614-01 (user: "Spooky tucked-away shop / creepy guy buying zombie corpses only; floor chute
// deposit / physical Rail Ties payout / no corpse purchases"): THE CORPSE BUYER's SALE RECORD — pure (no three.js / DOM). The runtime is
// market/corpseShop/corpseShop.ts; the den itself is the Market layout's version 4 (gen/market/marketTypes.ts MarketDen).
//
// PRICE. A flat CORPSE_SHOP.price Rail Ties for every accepted body (whatever it was: an ordinary infected, a Blightbelly, a Strainer, a
// BB…). The buyer only BUYS: he sells nothing, holds no stock and never pays into a wallet — the ties are dropped as a physical world
// item (items/railTies.ts `rail_ties`) the player picks up.
//
// ELIGIBILITY. Exactly the carriable bodies (ai/corpseTrait.ts corpseCarriable: every dead undead body, BB's small one too). A living
// enemy is never carriable (corpses: dead only); Market people, the player and animals (the rat-dog) are not undead bodies; loose parts
// (flesh chunks, limbs) are not bodies at all — nothing but a whole body record in the hands is ever offered.
//
// FLOW (all in place on ONE CorpseShopJSON, the Market station's lane CORPSE_SHOP_LANE):
//  - sell:     startSale — the body record moves into the sale (`job`: its ONLY copy; the hands are empty in the same call) with a stable
//              uid (seq). One body at a time; refused while a sale runs (the player keeps the body).
//  - advance:  advanceSale(dtMs) — the sale's milliseconds (the body goes down the chute, the buyer counts, then drops the ties). At the
//              completion instant, in the SAME call, the body is consumed (the job is gone), the sale is counted (done, last) and its id
//              joins `sold`; the caller drops the ties as a world pickup in that same synchronous step. No save can see one without the other.
// Saved with the station's memory (strict: save/validate.ts corpseShopProblem + the one-body-one-place check over job + sold). NewGame:
// none; Travel / Continue keep it (a sale in progress resumes where it stood when the station is built again); Retry restores the level-
// entry memory together with the body where it was then (never ties AND the body).

import {bodyProblem, copyBody, BODY_ID_RE, type BodyRecordJSON} from '../../corpse/bodyRecord';

export const CORPSE_SHOP = {
  /** Rail Ties paid per accepted body (flat). */
  price: 10,
  /** A sale's phases (ms from the take): the body goes down the chute until swallowMs, the buyer counts until dropMs, the ties fall until
   *  saleMs (the completion instant: they land and are a pickup). */
  swallowMs: 1600,
  dropMs: 3000,
  saleMs: 3600,
  /** The newest sold ids kept for the one-body-one-place check (older ones can never come back either: their deaths are remembered). */
  soldKeep: 64,
  /** Input safety bounds. */
  maxSeq: 1e9,
  maxDone: 1e9,
} as const;

/** The Market station lane holding the buyer's record (save/validate.ts lanes()). */
export const CORPSE_SHOP_LANE = 'market.corpseShop';

export interface CorpseSaleJSON {
  /** Stable sale uid (seq - 1 when issued). */
  uid: number;
  /** The body being bought (its only copy: it exists nowhere else). A station record (world pose at the chute, storey). */
  body: BodyRecordJSON;
  /** Sale time done (integer ms, 0 .. CORPSE_SHOP.saleMs - 1: a sale at saleMs has paid out and is gone). */
  ms: number;
}

export interface CorpseShopJSON {
  v: 1;
  /** The next sale uid. */
  seq: number;
  /** Bodies bought (each paid exactly once). */
  done: number;
  /** The uid of the last completed sale (0 = none): a running sale's uid is always above it. */
  last: number;
  job: CorpseSaleJSON | null;
  /** The newest bought bodies' ids (oldest first, at most CORPSE_SHOP.soldKeep): they exist nowhere else. */
  sold: string[];
}

export const freshCorpseShop = (): CorpseShopJSON => ({v: 1, seq: 1, done: 0, last: 0, job: null, sold: []});

const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const KEYS = ['v', 'seq', 'done', 'last', 'job', 'sold'];
const JOB_KEYS = ['uid', 'body', 'ms'];

/** Why a buyer record is malformed (null = fine). `carriable`: ai/corpseTrait.ts corpseCarriable. */
export function corpseShopProblem(v: unknown, carriable: (arch: string) => boolean): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the corpse buyer record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) return `unexpected corpse buyer field '${k}'`;
  if (o.v !== 1) return 'unsupported corpse buyer record version';
  if (!int(o.seq, 1, CORPSE_SHOP.maxSeq)) return 'corpse buyer sale uid out of range';
  if (!int(o.done, 0, CORPSE_SHOP.maxDone)) return 'corpse buyer body count out of range';
  if (!int(o.last, 0, o.seq - 1)) return 'corpse buyer last sale uid out of range';
  if (o.done > o.seq - 1) return 'the corpse buyer paid for more bodies than it took';
  if (!Array.isArray(o.sold) || o.sold.length > CORPSE_SHOP.soldKeep || o.sold.length > o.done) return `the corpse buyer keeps at most ${CORPSE_SHOP.soldKeep} sold ids (never more than it bought)`;
  const seen = new Set<string>();
  for (const id of o.sold) {
    if (typeof id !== 'string' || !BODY_ID_RE.test(id)) return 'a sold body needs its identity';
    if (seen.has(id)) return `body ${id} was sold twice`;
    seen.add(id);
  }
  if (o.job !== null) {
    if (!o.job || typeof o.job !== 'object' || Array.isArray(o.job)) return 'a corpse sale must be an object';
    const j = o.job as Record<string, unknown>;
    for (const k of Object.keys(j)) if (!JOB_KEYS.includes(k)) return `unexpected corpse sale field '${k}'`;
    if (j.uid !== o.seq - 1 || !int(j.uid, 1, CORPSE_SHOP.maxSeq) || j.uid <= o.last) return 'the corpse sale uid is not its newest unpaid one';
    if (!int(j.ms, 0, CORPSE_SHOP.saleMs - 1)) return 'corpse sale progress out of range';
    const bp = bodyProblem(j.body, {world: true, feedable: carriable});
    if (bp) return bp;
    if (seen.has((j.body as BodyRecordJSON).id)) return `body ${(j.body as BodyRecordJSON).id} is being sold again`;
  }
  return null;
}

export const copyCorpseShop = (c: CorpseShopJSON): CorpseShopJSON =>
  ({v: 1, seq: c.seq, done: c.done, last: c.last, job: c.job ? {uid: c.job.uid, body: copyBody(c.job.body), ms: c.job.ms} : null, sold: [...c.sold]});

/** Prompt / toast texts (one place). */
export const CORPSE_SHOP_TEXT = {
  sell: `<b>[E]</b> Drop the body down the chute · ${CORPSE_SHOP.price} Rail Ties`,
  busy: 'He is still dealing with the last one — wait',
  closed: 'The booth is dark — nobody is buying now',
  notUndead: 'He only buys whole dead undead bodies',
  already: 'He already bought that one',
  sold: `Body sold — ${CORPSE_SHOP.price} Rail Ties dropped at the booth`,
  /** The look-at line at the den (not carrying): what he buys and for how much. */
  hint: `Corpse buyer — whole dead undead bodies, ${CORPSE_SHOP.price} Rail Ties each, down the chute. He sells nothing.`,
  counting: 'The buyer is counting out your Rail Ties…',
} as const;

/** Why the buyer cannot take a body now (null = he can). The body is never taken on a refusal. */
export function corpseShopRefusal(c: CorpseShopJSON, o: {hostile: boolean}): string | null {
  if (o.hostile) return CORPSE_SHOP_TEXT.closed;
  if (c.job || c.seq >= CORPSE_SHOP.maxSeq || c.done >= CORPSE_SHOP.maxDone) return CORPSE_SHOP_TEXT.busy;
  return null;
}

/** Sell: the body record becomes the sale (its only copy). Throws on a busy record (callers check corpseShopRefusal first). */
export function startSale(c: CorpseShopJSON, body: BodyRecordJSON): CorpseSaleJSON {
  if (c.job || c.seq >= CORPSE_SHOP.maxSeq) throw new Error(CORPSE_SHOP_TEXT.busy);
  if (c.sold.includes(body.id)) throw new Error(`body ${body.id} was already sold`);
  const job = {uid: c.seq, body: copyBody(body), ms: 0};
  c.seq += 1;
  c.job = job;
  return job;
}

/** A completed sale: its uid, the body's identity, the Rail Ties to drop. */
export interface CorpsePayout { uid: number; id: string; ties: number }

/**
 * Advance the running sale `dtMs` (integer, >= 0). At the completion instant the body is consumed and the sale counted in this same
 * mutation; returns the payout then (the caller drops it as a world pickup in the same step), else null.
 */
export function advanceSale(c: CorpseShopJSON, dtMs: number): CorpsePayout | null {
  if (!c.job || !(dtMs > 0)) return null;
  const ms = c.job.ms + Math.floor(dtMs);
  if (ms < CORPSE_SHOP.saleMs) { c.job.ms = ms; return null; }
  const job = c.job;
  c.job = null;
  c.done += 1;
  c.last = job.uid;
  c.sold.push(job.body.id);
  if (c.sold.length > CORPSE_SHOP.soldKeep) c.sold.splice(0, c.sold.length - CORPSE_SHOP.soldKeep);
  return {uid: job.uid, id: job.body.id, ties: CORPSE_SHOP.price};
}

/** Where a sale stands (from its ms): the body going down, the buyer counting, the ties falling. */
export function salePhase(ms: number): 'swallow' | 'count' | 'drop' {
  return ms < CORPSE_SHOP.swallowMs ? 'swallow' : ms < CORPSE_SHOP.dropMs ? 'count' : 'drop';
}
