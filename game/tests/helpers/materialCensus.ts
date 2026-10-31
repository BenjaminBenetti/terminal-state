// Task track3-eaton-centre-20261031 (lane PROFILES): the NORMALISED LOOT / MATERIAL CENSUS — reusable for any registered level.
// Task mall-playtest-revision-20261031 (lane PROFILES): + the mall's per-compartment storage fill (its lots are holder lots; its
// drawn-but-unpacked items count as fit failures — items/loot.ts STORAGE_FILL_STATS).
//
// For one generated layout under its level's loot profile it measures what a player can actually find:
//  - holder lots AFTER FIT (tests/helpers/lootEconomy.ts layoutHolderDetails = the ContainerManager.build roll + packing), with the
//    pre-fit entries (fit failures = entries the holder's finite surfaces could not take) and the surface area (finite capacity);
//  - loose layout pickups (floor programs, weapon finds + their ammo, rewards);
//  - ACCESSIBILITY: a walking-distance field from the level's arrival point over every storey (gen/levelGen.ts levelDistance with
//    the layout's level links — stairs / escalators carved into both grids, ladders): a holder is reachable when a walkable reached
//    cell lies within REACH_M of its footprint on its storey; a pickup when a reached cell lies within REACH_M of it;
//  - USABLE FLOOR: reached walkable cells (0.25 m² each) excluding stair runs (counted once), by zone.
// Normalised rates: units per REACHABLE holder and per 100 m² of usable floor — the same method for every level.
// Rare gear / gas masks (one roll per logical level, placed by levels/registry.ts withGear) are not part of the generated layout
// here: they are identical in kind for every level and reported separately.

import {levelDistance} from '../../src/gen/levelGen';
import {CELL} from '../../src/gen/grid';
import type {Area, StationLayout} from '../../src/gen/stationTypes';
import {arrivalPose} from '../../src/levels/registry';
import {ITEMS} from '../../src/items/items';
import {econCat, type LootProfile} from '../../src/items/lootTables';
import {MATERIAL_IDS} from '../../src/items/craftMaterials';
import {layoutHolderDetails} from './lootEconomy';
import {FILL_ID_BASE, STORAGE_FILL_STATS, isContainerKind} from '../../src/items/loot'; // task mall-playtest-revision-20261031 (lane PROFILES): storage-fill accounting
import {openableSpec} from '../../src/world/openablesSpec';

export const CENSUS_CATS = ['food', 'drink', 'med', 'ammo', 'battery', 'flare', 'material', 'weapon', 'gear', 'other'] as const;
export type CensusCat = (typeof CENSUS_CATS)[number];
/** Interaction reach (m) from a reached floor cell to a holder footprint / pickup. */
export const REACH_M = 1.0;

export function censusCat(itemId: string): CensusCat {
  const c = econCat(itemId);
  if (c) return c;
  const k = ITEMS[itemId]?.kind;
  return k === 'weapon' ? 'weapon' : k === 'gear' ? 'gear' : 'other';
}

const zeroCats = (): Record<CensusCat, number> => Object.fromEntries(CENSUS_CATS.map(c => [c, 0])) as Record<CensusCat, number>;
const zeroMats = (): Record<string, number> => Object.fromEntries(MATERIAL_IDS.map(m => [m, 0]));

export interface RunCensus {
  seed: number;
  /** Reached walkable floor (m²) and its split by zone (`zoneOf`). */
  usableM2: number;
  zoneM2: Record<string, number>;
  holders: {
    total: number; reachable: number; stocked: number;
    /**
     * Pre-fit entries / placed lots (all holders) and the lots the finite surfaces could not take. Task mall-playtest-revision-20261031
     * (lane PROFILES): the holder's own roll (entries vs its non-fill lots) PLUS the mall storage fill's drawn vs packed items
     * (items/loot.ts STORAGE_FILL_STATS) — `fillLots` = fill lots placed (part of `lots`).
     */
    entries: number; lots: number; fitFailures: number; unitsLostToFit: number; fillLots: number;
    /** Finite capacity: Σ surface area (m²) of every holder / of the reachable ones. */
    surfaceM2: number; reachableSurfaceM2: number;
  };
  /** Placed + reachable units (holder lots of reachable holders + reachable pickups), per category / per material item. */
  units: Record<CensusCat, number>;
  materials: Record<string, number>;
  /** Material units of reachable holder lots only (per item). */
  holderMaterials: Record<string, number>;
  /** The same, holder lots only / pickups only. */
  holderUnits: Record<CensusCat, number>;
  pickupUnits: Record<CensusCat, number>;
  /** Units placed but unreachable (holders / pickups the walking field never reaches). */
  unreachableUnits: number;
  /** Material lots (stacks) placed + reachable, and holders holding at least one. */
  materialLots: number;
  materialHolders: number;
  /** Material units per holder loot key (purpose / room type) — where they come from. */
  materialsByKey: Record<string, number>;
}

/**
 * Census of one layout under `profile` (the level's loot profile — ContainerManager.build's). `zoneOf` names the usable-floor zone
 * of an area (default: public / room).
 */
export function runCensus(layout: StationLayout, profile: LootProfile, zoneOf: (a: Area) => string = a => (a.publicSpace ? 'public' : 'room'),
  opts: {exclude?: (a: Area) => boolean} = {}): RunCensus {
  // (task mall-playtest-revision-20261031, lane PROFILES) `exclude`: areas left out entirely — their floor, holders and pickups (e.g. the
  // Track2 extension areas for a core-to-core comparison; the rolls of every other holder are unchanged: indices follow the full prop
  // order). The storage fill's fit failures are a level-wide tally (items/loot.ts STORAGE_FILL_STATS).
  const skip = (id: number): boolean => { const a = layout.areas[id]; return !!(a && opts.exclude?.(a)); };
  const start = layout.mall?.start ?? arrivalPose(layout, {kind: 'start'});
  const g0 = layout.grid;
  const [sx, sy] = g0.cellOf(start.x, start.z);
  const dist = levelDistance(layout.levels, sx, sy, start.level ?? 0, layout.levelLinks);
  const cellM2 = CELL * CELL;
  // usable floor
  const zoneM2: Record<string, number> = {};
  const zoneCache = new Map<number, string>();
  const zone = (a: Area): string => { let z = zoneCache.get(a.id); if (z === undefined) zoneCache.set(a.id, (z = zoneOf(a))); return z; };
  let usable = 0;
  layout.levels.forEach((L, lv) => {
    const g = L.grid, d = dist[lv];
    if (!d) return;
    for (let i = 0; i < d.length; i++) {
      if (d[i] < 0) continue;
      const a = layout.areas[g.area[i]];
      if (!a || a.role === 'stair' || (a.level ?? 0) !== lv || opts.exclude?.(a)) continue;
      usable += cellM2;
      const z = zone(a);
      zoneM2[z] = (zoneM2[z] ?? 0) + cellM2;
    }
  });
  const reached = (lv: number, x0: number, z0: number, x1: number, z1: number): boolean => {
    const L = layout.levels[lv], d = dist[lv];
    if (!L || !d) return false;
    const g = L.grid;
    const [ax, ay] = g.cellOf(x0 - REACH_M, z0 - REACH_M), [bx, by] = g.cellOf(x1 + REACH_M, z1 + REACH_M);
    for (let y = Math.max(0, ay); y <= Math.min(g.h - 1, by); y++) for (let x = Math.max(0, ax); x <= Math.min(g.w - 1, bx); x++) if (d[g.idx(x, y)] >= 0) return true;
    return false;
  };
  const out: RunCensus = {
    seed: layout.seed, usableM2: usable, zoneM2,
    holders: {total: 0, reachable: 0, stocked: 0, entries: 0, lots: 0, fitFailures: 0, unitsLostToFit: 0, fillLots: 0, surfaceM2: 0, reachableSurfaceM2: 0},
    units: zeroCats(), materials: zeroMats(), holderMaterials: zeroMats(), holderUnits: zeroCats(), pickupUnits: zeroCats(), unreachableUnits: 0, materialLots: 0, materialHolders: 0, materialsByKey: {},
  };
  const fill0 = {...STORAGE_FILL_STATS};
  const details = layoutHolderDetails(layout, profile);
  const fillEntries = STORAGE_FILL_STATS.entries - fill0.entries, fillPlaced = STORAGE_FILL_STATS.placed - fill0.placed;
  out.holders.entries += fillEntries;
  out.holders.fitFailures += Math.max(0, fillEntries - fillPlaced);
  for (const h of details) {
    if (skip(h.prop.area)) continue;
    const p = h.prop, lv = p.level ?? layout.areas[p.area]?.level ?? 0;
    const ok = reached(lv, p.x - p.hx, p.z - p.hz, p.x + p.hx, p.z + p.hz);
    const area = h.surfaces.reduce((s, f) => s + Math.max(0, f.x1 - f.x0) * Math.max(0, f.z1 - f.z0), 0);
    const H = out.holders;
    // (lane PROFILES, mall revision) the holder's own roll is compared with its own lots; storage-fill lots are counted above
    const own = h.lots.filter(l => l.id % 1000 < FILL_ID_BASE);
    H.total++; H.entries += h.entries.length; H.lots += h.lots.length; H.fillLots += h.lots.length - own.length; H.surfaceM2 += area;
    const placedUnits = own.reduce((s, l) => s + l.count, 0), rolledUnits = h.entries.reduce((s, e) => s + e.count, 0);
    H.fitFailures += Math.max(0, h.entries.length - own.length);
    H.unitsLostToFit += Math.max(0, rolledUnits - placedUnits);
    if (!ok) { out.unreachableUnits += h.lots.reduce((s, l) => s + l.count, 0); continue; }
    H.reachable++; H.reachableSurfaceM2 += area;
    if (h.lots.length) H.stocked++;
    let mat = false;
    for (const l of h.lots) {
      const c = censusCat(l.itemId);
      out.units[c] += l.count; out.holderUnits[c] += l.count;
      if (c === 'material') {
        out.materials[l.itemId] = (out.materials[l.itemId] ?? 0) + l.count; out.materialLots++; mat = true;
        out.holderMaterials[l.itemId] = (out.holderMaterials[l.itemId] ?? 0) + l.count;
        out.materialsByKey[h.areaType] = (out.materialsByKey[h.areaType] ?? 0) + l.count;
      }
    }
    if (mat) out.materialHolders++;
  }
  for (const q of layout.pickups) {
    if (skip(q.area)) continue;
    const lv = q.level ?? 0;
    const c = censusCat(q.itemId);
    if (!reached(lv, q.x, q.z, q.x, q.z)) { out.unreachableUnits += q.count; continue; }
    out.units[c] += q.count; out.pickupUnits[c] += q.count;
    if (c === 'material') {
      out.materials[q.itemId] = (out.materials[q.itemId] ?? 0) + q.count; out.materialLots++;
      out.materialsByKey['(loose floor)'] = (out.materialsByKey['(loose floor)'] ?? 0) + q.count;
    }
  }
  return out;
}

export interface CensusSummary {
  runs: number;
  /** Mean per run. */
  perRun: {usableM2: number; holders: number; reachableHolders: number; stockedHolders: number; fitFailures: number; unitsLostToFit: number; fillLots: number;
    surfaceM2: number; unreachableUnits: number; units: Record<CensusCat, number>; materials: Record<string, number>; materialLots: number; materialHolders: number};
  /** Units per reachable holder (holder lots only) and per 100 m² of usable floor (holders + pickups). */
  perHolder: {units: Record<CensusCat, number>; materials: Record<string, number>};
  per100m2: {units: Record<CensusCat, number>; materials: Record<string, number>};
  /** Share of rolled entries lost to fit, and of holders reachable. */
  fitLossShare: number;
  reachableShare: number;
  zoneM2: Record<string, number>;
  materialsByKey: Record<string, number>;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function summarize(runs: readonly RunCensus[]): CensusSummary {
  const n = Math.max(1, runs.length);
  const sum = (f: (r: RunCensus) => number) => runs.reduce((s, r) => s + f(r), 0);
  const cats = (f: (r: RunCensus) => Record<string, number>, keys: readonly string[]) => Object.fromEntries(keys.map(k => [k, sum(r => f(r)[k] ?? 0)])) as Record<string, number>;
  const units = cats(r => r.units, CENSUS_CATS), hUnits = cats(r => r.holderUnits, CENSUS_CATS);
  const mats = cats(r => r.materials, MATERIAL_IDS), hMats = cats(r => r.holderMaterials, MATERIAL_IDS);
  const usable = sum(r => r.usableM2), reachH = sum(r => r.holders.reachable);
  const zoneM2: Record<string, number> = {};
  const byKey: Record<string, number> = {};
  for (const r of runs) {
    for (const [z, m] of Object.entries(r.zoneM2)) zoneM2[z] = r3((zoneM2[z] ?? 0) + m / n);
    for (const [k, v] of Object.entries(r.materialsByKey)) byKey[k] = r3((byKey[k] ?? 0) + v / n);
  }
  const per = (o: Record<string, number>, d: number, k = 1) => Object.fromEntries(Object.entries(o).map(([key, v]) => [key, d > 0 ? r3(v * k / d) : 0]));
  return {
    runs: runs.length,
    perRun: {
      usableM2: r3(usable / n), holders: r3(sum(r => r.holders.total) / n), reachableHolders: r3(reachH / n), stockedHolders: r3(sum(r => r.holders.stocked) / n),
      fitFailures: r3(sum(r => r.holders.fitFailures) / n), unitsLostToFit: r3(sum(r => r.holders.unitsLostToFit) / n), fillLots: r3(sum(r => r.holders.fillLots) / n), surfaceM2: r3(sum(r => r.holders.surfaceM2) / n),
      unreachableUnits: r3(sum(r => r.unreachableUnits) / n), units: per(units, n) as Record<CensusCat, number>, materials: per(mats, n),
      materialLots: r3(sum(r => r.materialLots) / n), materialHolders: r3(sum(r => r.materialHolders) / n),
    },
    perHolder: {units: per(hUnits, reachH) as Record<CensusCat, number>, materials: per(hMats, reachH)},
    per100m2: {units: per(units, usable, 100) as Record<CensusCat, number>, materials: per(mats, usable, 100)},
    fitLossShare: r3(sum(r => r.holders.fitFailures) / Math.max(1, sum(r => r.holders.entries))),
    reachableShare: r3(reachH / Math.max(1, sum(r => r.holders.total))),
    zoneM2, materialsByKey: byKey,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Task mall-playtest-revision-20261031 (lane PROFILES, U10 follow-up): STORAGE COMPARTMENT census — how many drawers / cupboards /
// lidded compartments hold something once opened (the holder's own roll + the level's storage fill), by holder kind.

export interface CompartmentCensus {
  /** Per holder kind: holders, compartments (openable parts; a one-door / one-lid container = 1), stocked compartments, of which only
   * storage-fill lots (the holder's own roll left them empty). */
  byKind: Record<string, {holders: number; comps: number; stocked: number; fillOnly: number}>;
  /** Units of the storage-fill lots by census category (what the fill put inside), and by holder kind. */
  fillUnits: Record<CensusCat, number>;
  fillByKind: Record<string, Partial<Record<CensusCat, number>>>;
}

export function compartmentCensus(layout: StationLayout, profile: LootProfile, keep: (a: Area | undefined) => boolean = () => true): CompartmentCensus {
  const out: CompartmentCensus = {byKind: {}, fillUnits: zeroCats(), fillByKind: {}};
  for (const h of layoutHolderDetails(layout, profile)) {
    if (!keep(layout.areas[h.prop.area])) continue;
    const kind = h.kind as string;
    const single = !openableSpec(kind) && isContainerKind(kind);
    const comps = new Set<number>();
    for (const s of h.surfaces) { const c = s.part ?? (single ? -1 : undefined); if (c !== undefined) comps.add(c); }
    if (!comps.size) continue;
    const e = (out.byKind[kind] ??= {holders: 0, comps: 0, stocked: 0, fillOnly: 0});
    e.holders++;
    for (const c of comps) {
      e.comps++;
      const lots = h.lots.filter(l => single || l.part === c);
      if (!lots.length) continue;
      e.stocked++;
      if (lots.every(l => l.id % 1000 >= FILL_ID_BASE)) e.fillOnly++;
    }
    for (const l of h.lots) if (l.id % 1000 >= FILL_ID_BASE) { const c = censusCat(l.itemId); out.fillUnits[c] += l.count; const k = (out.fillByKind[kind] ??= {}); k[c] = (k[c] ?? 0) + l.count; }
  }
  return out;
}

/** Stocked share of the compartments of `kinds` (all kinds when absent) over several censuses. */
export function stockedRate(list: readonly CompartmentCensus[], kinds?: readonly string[]): {comps: number; stocked: number; rate: number} {
  let comps = 0, stocked = 0;
  for (const c of list) for (const [k, e] of Object.entries(c.byKind)) if (!kinds || kinds.includes(k)) { comps += e.comps; stocked += e.stocked; }
  return {comps, stocked, rate: comps ? stocked / comps : 0};
}
