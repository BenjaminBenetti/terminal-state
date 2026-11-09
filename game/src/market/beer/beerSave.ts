// Task studio-market-bar-20261108-225231-01 (lane BEER): the beers' RUN record — the run participant 'market.beer' (market/beer/beerEffects.ts)
// that saves / loads with every save, Continue, Retry snapshot (taken at level entry), import / export and a pending journey, and its
// strict validator (save/validate.ts participants()). Pure data, no three.js / DOM.
//
//   {v: 1, active: {itemId, remaining} | null, rolled: number[]}
//  - active: the ONE timed beer (a timed beer id: never Second Supper Bock, which is instant) and its ACTIVE gameplay seconds left
//    (0 < remaining <= BEER_TUNING.activeSeconds), kept exactly (no rounding);
//  - rolled: Lucky Switch Pilsner's durable roll memory — one uint32 per acquisition source already rolled in this run (beerEffects.ts
//    sourceHash: station + section + holder key + lot id / layout pickup index / stall + ware uid / found-bag id), oldest first, at most
//    BEER_ROLLED_MAX (the oldest drop out): re-grabbing a rolled source never rolls again.
import {BEERS, BEER_TUNING, isBeer, type BeerId} from '../../items/beers';

export const BEER_PARTICIPANT = 'market.beer';
/** Most remembered roll sources (FIFO; ~10 Pilsners' worth of finds). */
export const BEER_ROLLED_MAX = 1024;

export interface BeerSaveV1 {
  v: 1;
  active: {itemId: BeerId; remaining: number} | null;
  rolled: number[];
}

export const emptyBeerSave = (): BeerSaveV1 => ({v: 1, active: null, rolled: []});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Why a value is not a valid beer record (null: valid). */
export function beerSaveProblem(v: unknown): string | null {
  if (!isObj(v)) return 'not an object';
  for (const k of Object.keys(v)) if (k !== 'v' && k !== 'active' && k !== 'rolled') return `unexpected key ${k.slice(0, 24)}`;
  if (v.v !== 1) return 'unsupported beer record version';
  const a = v.active;
  if (a !== null) {
    if (!isObj(a)) return 'active is not an object';
    for (const k of Object.keys(a)) if (k !== 'itemId' && k !== 'remaining') return `unexpected active key ${k.slice(0, 24)}`;
    if (typeof a.itemId !== 'string' || !isBeer(a.itemId)) return 'active is not a beer';
    if (BEERS[a.itemId].effect === 'overfill') return 'an instant beer is never the active timed beer';
    const r = a.remaining;
    if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0 || r > BEER_TUNING.activeSeconds) return 'active remaining out of range';
  }
  if (!Array.isArray(v.rolled)) return 'rolled is not a list';
  if (v.rolled.length > BEER_ROLLED_MAX) return 'too many rolled sources';
  const seen = new Set<number>();
  for (const h of v.rolled) {
    if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 0xffffffff) return 'a rolled source is not a uint32';
    if (seen.has(h)) return 'a rolled source is listed twice';
    seen.add(h);
  }
  return null;
}
