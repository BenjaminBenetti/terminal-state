// Task studio-surface-map-tent-cab-20261119-025201-01 (lane TENT; user: "No free gas mask in the tent. Its free starter survival supply
// should be some finite filters ONLY, not masks or other free gear. Reuse the existing filter quantity if suitable; no repeat-visit refill
// or loot duplication ... Do not delete an acquired/equipped/carried or player-moved mask or unrelated saved belongings. Safely correct
// unclaimed generated tent stock where attributable without changing UIDs or refilling; flag a genuine saved-stock attribution question
// rather than inventing a destructive migration"): THE SURFACE RUN COMMAND TENT'S FREE STOCK = FINITE GAS FILTERS ONLY.
//  - Generation (gen/surface/checkpoint.ts dressCheckpoint): the supply table carries the ONE spare filter it always had (same spot, count
//    and record); the guaranteed mask is gone. layout.pickups = [filter, ...interiors] (it was [mask, filter, ...interiors]); every other
//    list, the grid and the main RNG stream are untouched (the mask's charge was the only draw of its own 'checkpoint-supply' fork).
//  - The in-tent crate (the srMilitaryCrate whose prop stands in the tent's area; the compound's outdoor crates are not the tent's): when
//    it is realized for the first time (no holder record) it keeps ONLY its gas-filter lots — trimTentCrateStock, Game.buildSectionSteps'
//    'damage' step right after dropNaturalFood (the same pattern): lots are only removed, never added (no filter is ever made up), and the
//    next capture records what is left, so every later build is that record exactly (no refill, no duplicate).
//  - A SAVED district (its run memory) is corrected only where the stock is the tent's own AND unclaimed — removal only, nothing else of the
//    memory touched, no uid issued or changed:
//    (a) dropUnclaimedTentMask (the 'pickups' step, before pickupPlan): the record of the old generated mask (layoutIndex 0, 'gas_mask',
//        one, not a spilled lot) whose anchor still lies at its old supply-table spot (TENT_STOCK: a few cm off it, on the table's top) is
//        dropped. A mask the player took (carried / worn: inventory, never a pickup record), dropped (no layoutIndex) or moved (off the spot)
//        stays exactly as remembered; each case is counted (TENT_STOCK_STATS). Its fitted charge plays no part (recorded for QA).
//    (b) trimTentCrateStock: a remembered in-tent crate whose record says it was never opened, never searched and no compartment ever seen
//        (run/memory.ts HolderRecord open / searched / seen; save/serialize.ts keeps all three) drops its non-filter lots (ids kept). A crate
//        the player opened / searched / saw into stays EXACT — an attribution question for the user, counted (TENT_STOCK_STATS.flagged).
// Only Surface Run districts (layout.surface) are touched: a host station or any other level returns at once. Version 1 and 2 districts
// both had the tent supply, so both follow the rule.
// Pure (no three.js / DOM).

import {Rng} from '../../core/rng';
import {FILTER_LIFE_S} from '../../items/gear';
import {GAS_FILTER_ID, GAS_MASK_ID, MASK_LOOT} from '../../gen/maskLoot';
import {tentGearSpot} from '../../gen/surface/checkpoint';
import {propHolderKey, type HolderRecord, type PickupRecord, type SectionMemory} from '../../run/memory';
import type {PickupPlacement, StationLayout} from '../../gen/stationTypes';

type TentLayout = Pick<StationLayout, 'seed' | 'props' | 'surface'>;

/** Attribution of the old generated mask: its record's anchor within `spotR` (m, level) of the old spot, `below` / `above` (m) of its y. */
export const TENT_STOCK = {spotR: 0.1, below: 0.05, above: 0.3} as const;

/** The tent's supply table: the one srMapTable in the tent's area that is not the planning-map table (a layout.props index); -1 none. */
export function tentSupplyTable(layout: Pick<StationLayout, 'props' | 'surface'>): number {
  const c = layout.surface?.checkpoint;
  if (!c) return -1;
  const found: number[] = [];
  layout.props.forEach((p, i) => { if (p.kind === 'srMapTable' && p.area === c.tent.area && (p.level ?? 0) === 0 && i !== c.mapTable.prop) found.push(i); });
  return found.length === 1 ? found[0] : -1;
}

/**
 * The tent's free mask EXACTLY as main's dressCheckpoint generated it before this task (layout.pickups[0] of every district with a supply
 * table: the same keys in the same order, its fitted charge the first draw of the district's 'checkpoint-supply' fork) — the old spot for
 * attribution, and the "before" the pin tests put back to prove nothing else of a layout moved. Null: no supply table (no mask was made).
 */
export function legacyTentMask(layout: TentLayout): PickupPlacement | null {
  const i = tentSupplyTable(layout);
  if (i < 0) return null;
  const sp = layout.props[i], w = tentGearSpot(sp, 'mask'), [f0, f1] = MASK_LOOT.foundFilter;
  const filter = Math.round(FILTER_LIFE_S * (f0 + (f1 - f0) * new Rng(layout.seed).fork('checkpoint-supply').next()) * 10) / 10;
  return {itemId: GAS_MASK_ID, count: 1, x: w.x, y: w.y, z: w.z, area: sp.area, yaw: sp.rot, filter};
}

/** A remembered loose item that is the old generated tent mask still lying unclaimed at its supply-table spot. */
export function isUnclaimedTentMask(layout: TentLayout, rec: PickupRecord, spot: {x: number; y: number; z: number} | null = legacySpot(layout)): boolean {
  if (!spot || rec.layoutIndex !== 0 || rec.fromLot || rec.stack.itemId !== GAS_MASK_ID || rec.stack.count !== 1) return false;
  const [x, y, z] = rec.anchor;
  return Math.hypot(x - spot.x, z - spot.z) <= TENT_STOCK.spotR && y >= spot.y - TENT_STOCK.below && y <= spot.y + TENT_STOCK.above;
}

function legacySpot(layout: Pick<StationLayout, 'props' | 'surface'>): {x: number; y: number; z: number} | null {
  const i = tentSupplyTable(layout);
  return i < 0 ? null : tentGearSpot(layout.props[i], 'mask');
}

/** What dropUnclaimedTentMask did (QA). The masks a player carries / wears are no pickup record: never seen here, never touched. */
export interface TentMaskCorrection {
  /** Old generated masks still lying at their spot: not restored (and their fitted charges, s). */
  dropped: number; charges: number[];
  /** Kept exactly: the old generated mask moved off its spot / any dropped mask (no layoutIndex) / a generated mask of another index. */
  keptMoved: number; keptDropped: number; keptOther: number;
  /** A layoutIndex-0 mask in a district without a supply table (nothing to attribute it to): kept. */
  unattributed: number;
}

/** What trimTentCrateStock did (QA). */
export interface TentCrateCorrection {
  /** In-tent crates realized now for the first time (filter lots only), remembered untouched ones corrected, opened / searched / seen ones kept exact. */
  fresh: number; corrected: number; flagged: number;
  /** Lots removed; the flagged crates' holder keys (the user's attribution question). */
  removed: number; flaggedKeys: string[];
}

/** Running totals of both rules over this page's builds (QA: the last results and the sums). */
export const TENT_STOCK_STATS = {
  masks: {dropped: 0, keptMoved: 0, keptDropped: 0, keptOther: 0, unattributed: 0},
  crates: {fresh: 0, corrected: 0, flagged: 0, removed: 0},
  lastMask: null as TentMaskCorrection | null,
  lastCrate: null as TentCrateCorrection | null,
};

/**
 * (a) Before pickupPlan: a Surface district's remembered loose items lose the old generated tent mask still lying unclaimed at its spot
 * (mem.pickups replaced by the list without it; nothing else changes, nothing is added). A first visit (pickups null), a host station or
 * any other level: nothing.
 */
export function dropUnclaimedTentMask(layout: TentLayout, mem: Pick<SectionMemory, 'pickups'>): TentMaskCorrection {
  const out: TentMaskCorrection = {dropped: 0, charges: [], keptMoved: 0, keptDropped: 0, keptOther: 0, unattributed: 0};
  if (!layout.surface || !mem.pickups) return out;
  const spot = legacySpot(layout), keep: PickupRecord[] = [];
  for (const rec of mem.pickups) {
    if (rec.stack.itemId === GAS_MASK_ID) {
      if (isUnclaimedTentMask(layout, rec, spot)) { out.dropped++; out.charges.push(typeof rec.stack.filter === 'number' ? rec.stack.filter : NaN); continue; }
      if (rec.layoutIndex === undefined) out.keptDropped++;
      else if (rec.layoutIndex !== 0) out.keptOther++;
      else if (spot) out.keptMoved++;
      else out.unattributed++;
    }
    keep.push(rec);
  }
  if (out.dropped) mem.pickups = keep;
  const s = TENT_STOCK_STATS.masks;
  s.dropped += out.dropped; s.keptMoved += out.keptMoved; s.keptDropped += out.keptDropped; s.keptOther += out.keptOther; s.unattributed += out.unattributed;
  TENT_STOCK_STATS.lastMask = out;
  return out;
}

/** A holder as trimTentCrateStock reads it (world/containers.ts Holder). */
export interface TentStockHolder {
  kind: string;
  prop: {area: number; level?: number; x: number; z: number; memAt?: {x: number; z: number}};
  state: {lots: {id: number; itemId: string}[]};
}

/** The in-tent crate: an srMilitaryCrate standing in the tent's area (street level). */
export const isTentCrate = (layout: Pick<StationLayout, 'surface'>, h: Pick<TentStockHolder, 'kind' | 'prop'>): boolean =>
  h.kind === 'srMilitaryCrate' && !!layout.surface && h.prop.area === layout.surface.checkpoint.tent.area && (h.prop.level ?? 0) === 0;

/** A holder record of a crate the player never opened, never searched and never saw into. */
export const untouchedHolder = (rec: HolderRecord): boolean => !rec.open && !rec.searched && !(rec.seen ?? []).some(Boolean);

/**
 * (b) Right after applyHolders / dropNaturalFood: the in-tent crate keeps only its gas-filter lots when it is realized for the first time
 * (no record) or remembered untouched (its record: never opened / searched / seen); remembered opened / searched / seen = exact (flagged).
 * Removal only (lot ids kept); the records are not written here — the next capture records what is left.
 */
export function trimTentCrateStock(layout: Pick<StationLayout, 'surface'>, holders: Iterable<TentStockHolder>, recs: Readonly<Record<string, HolderRecord>>): TentCrateCorrection {
  const out: TentCrateCorrection = {fresh: 0, corrected: 0, flagged: 0, removed: 0, flaggedKeys: []};
  if (!layout.surface) return out;
  for (const h of holders) {
    if (!isTentCrate(layout, h)) continue;
    const key = propHolderKey(h.kind, h.prop), rec = recs[key];
    if (rec && !untouchedHolder(rec)) { out.flagged++; out.flaggedKeys.push(key); continue; }
    const before = h.state.lots.length;
    h.state.lots = h.state.lots.filter(l => l.itemId === GAS_FILTER_ID);
    out.removed += before - h.state.lots.length;
    if (rec) out.corrected++; else out.fresh++;
  }
  const s = TENT_STOCK_STATS.crates;
  s.fresh += out.fresh; s.corrected += out.corrected; s.flagged += out.flagged; s.removed += out.removed;
  TENT_STOCK_STATS.lastCrate = out;
  return out;
}
