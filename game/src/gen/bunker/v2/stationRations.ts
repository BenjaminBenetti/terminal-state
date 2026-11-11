// Task gameplay-feedback-20261111 (lane FUEL-LOOT): BUNKER LAYOUT VERSION 3 — on the platform / elevator storey S (storey 0) ONLY, half
// the ammo spawn opportunities become food / drink ones. User: "On platform/elevator level S ONLY, replace half the ammo spawn
// opportunities with increased food/drink spawns. Leave underground floors unchanged."
//
// The version-2 generator runs unchanged; this pass runs after it, last among the populations, and reads NO random stream (a stable hash
// order), so storeys 1-5 (props, holder rolls, pickups, enemies) and every other S draw are exactly version 2's. Gated by the layout
// version (gen/bunker/layoutVersion.ts): a station first built as version 1 or 2 keeps regenerating that version, so its remembered
// holders / pickups / kills keep referring to the layout they were recorded on; an unvisited station builds version 3.
//
// An AMMO OPPORTUNITY on S: a loot holder whose resolved table (exposed or compartment roll) has an ammo row, or whose loot theme stocks
// ammo (the security theme re-themes its finds into ammo: items/lootEconomy.ts scarceFinds), and every loose ammo pickup of the S floor
// program (gen/mall/supplies.ts placeMallSupplies). Weapon finds and the ammo they bring are not opportunities (weaponFinds.ts keeps its
// per-weapon rules). floor(N / 2) of the N opportunities, in a stable hash order over the convertible ones, are converted. Only the
// AMMO changes (lead / user: no other supply moves):
//  - a holder keeps its loot key, table and theme and gets the placement's ammo swap AMMO_SWAP_STATION_RATIONS (gen/props.ts
//    PropPlacement.ammoSwap -> items/loot.ts swapAmmoLots): each ammo lot its roll produces (ammo rows, the security theme's re-themed
//    finds, a compartment's) becomes one serving of lootTables BUNKER_STATION_RATIONS_ROWS on the holder's own swap stream; every other
//    lot keeps its id, item, count and spot. Convertible = its kind may hold food or drink (HOLDER_ALLOW: the gun locker keeps its arms);
//  - a floor ammo pickup becomes one serving of the same rows (hash pick by weight), same spot.
// The natural food half (items/naturalFood.ts) applies to both when they are first realized, as for every natural food find.

import {hashString} from '../../../core/rng';
import {AMMO_SWAP_STATION_RATIONS, compartmentTable, holderTable, isLootHolderKind} from '../../../items/loot';
import {holderTheme} from '../../../items/lootEconomy';
import {BUNKER_STATION_RATIONS_ROWS, HOLDER_ALLOW, econCat, type LootProfile} from '../../../items/lootTables';
import type {PickupPlacement, StationLayout} from '../../stationTypes';
import type {PropPlacement} from '../../props';

/** The Bunker layout version that adds the storey-S rations (gen/bunker/layoutVersion.ts). */
export const BUNKER_S_RATIONS_VERSION = 3;
/** The storey the pass touches: S, the platform / elevator storey (gen/bunker/v2/liftPlan.ts LIFT_STOP_LABELS[0]). */
export const BUNKER_S_LEVEL = 0;
/** The share of the storey's ammo opportunities converted (floor(N * share)). */
export const BUNKER_S_RATIONS_SHARE = 0.5;

/** A holder prop's loot key (world/containers.ts: the prop's own, else its area's purpose, else the area type). */
export function lootKeyOf(layout: StationLayout, p: PropPlacement): string {
  const a = layout.areas[p.area];
  return p.purpose ?? a?.purpose ?? a?.type ?? 'default';
}

/** Can a holder of `kind` under loot key `key` spawn ammo (an ammo row in either roll, or an ammo-stocking theme with something to roll)? */
export function isAmmoOpportunity(kind: string, key: string, profile: LootProfile): boolean {
  if (!isLootHolderKind(kind)) return false;
  const t = holderTable(kind, key, profile), inside = compartmentTable(kind, key, profile);
  const ammoRow = (rows: readonly (readonly [string, number])[]) => rows.some(([id, w]) => w > 0 && econCat(id) === 'ammo');
  if (ammoRow(t.rows) || (inside && ammoRow(inside.rows))) return true;
  const themed = profile.tables.themes[holderTheme(kind, key)]?.cats.includes('ammo') ?? false;
  return themed && (t.rows.length > 0 || (inside?.rows.length ?? 0) > 0) && !t.exact && t.source !== 'reward';
}

/** May a holder of `kind` take the station rations in place of its ammo (a loot holder that may hold food or drink: HOLDER_ALLOW)? */
export function takesRations(kind: string): boolean {
  if (!isLootHolderKind(kind)) return false;
  const allow = HOLDER_ALLOW[kind];
  return !allow || allow.includes('food') || allow.includes('drink');
}

/** The pass's record (QA / tests). */
export interface StationRationsResult {
  /** Ammo opportunities on S before the pass (holders + floor ammo pickups). */
  opportunities: number;
  /** Prop indices of the converted holders. */
  holders: number[];
  /** Pickup indices of the converted floor pickups. */
  pickups: number[];
}

/** QA / tests: the last pass's result (the returned layout's unless generation fell back to an earlier, invalid attempt). */
export const BUNKER_S_RATIONS_STATS: {last: StationRationsResult | null} = {last: null};

const unit = (key: string, seed: number): number => (hashString(`bunker-s-rations|${key}`, seed >>> 0) >>> 0) / 4294967296;
const pos = (x: number, z: number) => `${Math.round(x * 100)}:${Math.round(z * 100)}`;

/**
 * Convert floor(N / 2) of storey S's N ammo opportunities into food / drink ones (see the header). `floorAmmo`: the S floor program's
 * pickups (placeMallSupplies' return for storey 0; only its ammo ones count). `seed`: the layout seed. Mutates `layout` (the converted
 * holders' ammoSwap, the converted pickups' item); reads no random stream.
 */
export function placeStationRations(layout: StationLayout, profile: LootProfile, floorAmmo: readonly PickupPlacement[], seed: number): StationRationsResult {
  type Op = {order: number; holder?: number; pickup?: number; convertible: boolean};
  const ops: Op[] = [];
  layout.props.forEach((p, i) => {
    if ((p.level ?? 0) !== BUNKER_S_LEVEL || !isAmmoOpportunity(p.kind, lootKeyOf(layout, p), profile)) return;
    const key = lootKeyOf(layout, p), reward = holderTable(p.kind as never, key, profile).source === 'reward';
    ops.push({order: unit(`holder|${p.kind}|${pos(p.x, p.z)}|${i}`, seed), holder: i, convertible: !reward && takesRations(p.kind)});
  });
  const mine = new Set(floorAmmo);
  layout.pickups.forEach((q, i) => {
    if (!mine.has(q) || (q.level ?? 0) !== BUNKER_S_LEVEL || q.reward || econCat(q.itemId) !== 'ammo') return;
    ops.push({order: unit(`pickup|${q.itemId}|${pos(q.x, q.z)}|${i}`, seed), pickup: i, convertible: true});
  });
  const want = Math.floor(ops.length * BUNKER_S_RATIONS_SHARE);
  const pick = ops.filter(o => o.convertible).sort((a, b) => a.order - b.order).slice(0, want);
  const out: StationRationsResult = {opportunities: ops.length, holders: [], pickups: []};
  const rows = BUNKER_STATION_RATIONS_ROWS, total = rows.reduce((s, r) => s + r[1], 0);
  for (const o of pick) {
    if (o.holder !== undefined) { layout.props[o.holder].ammoSwap = AMMO_SWAP_STATION_RATIONS; out.holders.push(o.holder); continue; }
    const q = layout.pickups[o.pickup!];
    let x = unit(`item|${o.pickup}|${pos(q.x, q.z)}`, seed) * total, itemId = rows[rows.length - 1][0];
    for (const [id, w] of rows) { if (x < w) { itemId = id; break; } x -= w; }
    q.itemId = itemId;
    q.count = 1;
    out.pickups.push(o.pickup!);
  }
  out.holders.sort((a, b) => a - b);
  out.pickups.sort((a, b) => a - b);
  BUNKER_S_RATIONS_STATS.last = out;
  return out;
}
