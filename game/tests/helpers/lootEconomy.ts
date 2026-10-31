// Iteration 12 (LOOT lane): world resource census over a fixed seed corpus — every finite item unit a station offers, from
// every source, exactly as the game builds it: loot-holder lots (containers / surfaces / openables, index + purpose key as
// world/containers.ts ContainerManager.build with every model loaded) and loose layout pickups (floor supplies, weapon finds and
// their ammo, level-moved supplies). Only APIs that already existed at d632ce8 are used, so the same file measures the baseline
// tree (git archive d632ce8) and the current tree with identical code.
import {generateStation, pickArchetype, type StationLayout} from '../../src/gen/station';
import type {Archetype} from '../../src/gen/stationTypes';
import * as propsModule from '../../src/gen/props';
import {PROP_DEFS} from '../../src/gen/props';
import {cutSurfaces} from '../../src/gen/props07';
import {createHolderState, isContainerKind, isLootHolderKind, type HolderKind, type Lot} from '../../src/items/loot';
import {compartmentTable, holderFinds, type LootEntry} from '../../src/items/loot'; // lane PROFILES (track3): layoutHolderDetails
import {DEFAULT_SHELF, holderSurfaces, type Dims, type SurfaceOptions} from '../../src/items/lootLayout';
import type {Surface} from '../../src/items/lootLayout'; // lane PROFILES (track3)
import {openableActive} from '../../src/world/openablesSpec';
import type {LootProfile} from '../../src/items/lootTables';

/**
 * Fixed corpus: the first 3 seeds of a fixed sequence that the generator itself turns into each of the 6 macro archetypes (every
 * station family; distinct seeds, so no two stations share holder RNG streams), pistol start (the shipped default). 18 stations.
 */
export const ECONOMY_ARCHETYPES: readonly Archetype[] = ['side-mezzanine', 'island-ends', 'express', 'interchange', 'split', 'deep'];
export const ECONOMY_CORPUS: readonly {seed: number; archetype: Archetype}[] = (() => {
  const out: {seed: number; archetype: Archetype}[] = [];
  const per = new Map<Archetype, number>();
  for (let k = 0; out.length < ECONOMY_ARCHETYPES.length * 3 && k < 10000; k++) {
    const seed = (1201 + k * 7919) >>> 0, archetype = pickArchetype(seed);
    if ((per.get(archetype) ?? 0) >= 3) continue;
    per.set(archetype, (per.get(archetype) ?? 0) + 1);
    out.push({seed, archetype});
  }
  return out.sort((a, b) => ECONOMY_ARCHETYPES.indexOf(a.archetype) - ECONOMY_ARCHETYPES.indexOf(b.archetype) || a.seed - b.seed);
})();

export type EconCat = 'food' | 'drink' | 'med' | 'ammo' | 'battery' | 'flare' | 'weapon' | 'other';
const FOOD = new Set(['chocolate', 'chips', 'beans', 'noodles']);
const DRINK = new Set(['water', 'cola', 'juice']);
// Iteration 16 (lane INJURY): the limb treatments are med finds too (a share of the old dressings; the med total is unchanged)
const MED = new Set(['bandage', 'medkit', 'leg_splint', 'arm_sling', 'trauma_kit']);
const WEAPONS = new Set(['rifle', 'shotgun', 'pistol']);
export function econCat(itemId: string): EconCat {
  if (FOOD.has(itemId)) return 'food';
  if (DRINK.has(itemId)) return 'drink';
  if (MED.has(itemId)) return 'med';
  if (itemId.startsWith('ammo_')) return 'ammo';
  if (itemId === 'battery') return 'battery';
  if (itemId === 'flare') return 'flare';
  if (WEAPONS.has(itemId)) return 'weapon';
  return 'other';
}

/** One finite stack in the world: what, how many units, where it came from, the room key it was rolled / placed with. */
export interface EconEntry { itemId: string; count: number; source: 'holder' | 'pickup'; holder?: string; area: string }

const optional = propsModule as unknown as Record<string, unknown>;
const numList = (v: unknown): number[] | undefined => (Array.isArray(v) && v.length && v.every(x => typeof x === 'number') ? v as number[] : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const zRange = (v: unknown, hd: number): [number, number] | undefined => {
  const l = numList(v);
  if (l && l.length === 2) return [Math.min(l[0], l[1]), Math.max(l[0], l[1])];
  const c = num(v);
  return c === undefined ? undefined : [c - hd, c + hd];
};
/** world/containers.ts surfaceOptions() (+ the crate model's lid split): the surfaces the game rolls onto. */
function surfaceOpts(): SurfaceOptions {
  const d = (PROP_DEFS as unknown as Record<string, Dims | undefined>).shelf ?? DEFAULT_SHELF;
  return {
    shelf: {tierY: numList(optional.SHELF_TIER_Y) ?? DEFAULT_SHELF.tierY, w: d.w, d: d.d, h: d.h},
    stallCounterY: num(optional.STALL_COUNTER_Y), stallBackShelfY: numList(optional.STALL_BACK_SHELF_Y),
    stallCounterZ: zRange(optional.STALL_COUNTER_Z, 0.16), stallBackShelfZ: zRange(optional.STALL_BACK_SHELF_Z, 0.13),
    tableTopY: num(optional.TABLE_TOP_Y), tableTopD: num(optional.TABLE_TOP_D),
    crateSplitY: 0.817 * PROP_DEFS.crate.h,
  };
}
const FALLBACK: Record<string, Dims> = {
  shelf: {w: 1.2, d: 0.45, h: 1.85}, stall: {w: 2.4, d: 1.2, h: 2.4}, vending: {w: 0.95, d: 0.85, h: 1.85}, table: {w: 1.4, d: 1.6, h: 0.76}, desk: {w: 1.5, d: 0.75, h: 0.76},
};
/** Every runtime model present (the shipped build loads them all): surface openables with a model get their own index stream. */
const ALL_MODELS = new Proxy({}, {get: () => ({}), has: () => true}) as Record<string, unknown>;

/** Task loot-tables-20261030 (lane LOOT): one loot holder of a layout as the game rolls it (golden hashes, per-level corpora). */
export interface LayoutHolder { kind: HolderKind; index: number; areaType: string; lots: readonly Lot[] }

/**
 * Every loot holder of a layout, in layout order, rolled as ContainerManager.build does (index + purpose key, every model loaded);
 * `profile`: the logical level's loot profile (default: the baseline = today's tables, like ContainerManager.build's default).
 */
export function layoutHolders(layout: StationLayout, profile?: LootProfile): LayoutHolder[] {
  const out: LayoutHolder[] = [];
  const opts = surfaceOpts();
  let ci = 0, si = 0;
  const openIdx = new Map<string, number>();
  for (const p of layout.props) {
    const kind = p.kind as string;
    if (!isLootHolderKind(kind)) continue;
    const isC = isContainerKind(kind);
    const def = (PROP_DEFS as unknown as Record<string, Dims | undefined>)[kind] ?? FALLBACK[kind] ?? {w: 1, d: 1, h: 1};
    const surfaces = cutSurfaces(holderSurfaces(kind as never, def, opts), p.cut);
    const area = layout.areas[p.area];
    const areaType = p.purpose ?? area?.purpose ?? area?.type ?? 'default';
    let index: number;
    if (isC && openableActive(kind, ALL_MODELS)) { index = openIdx.get(kind) ?? 0; openIdx.set(kind, index + 1); } else index = isC ? ci++ : si++;
    const st = createHolderState(layout.seed, index, kind as HolderKind, areaType, surfaces, undefined, profile);
    out.push({kind: kind as HolderKind, index, areaType, lots: st.lots});
  }
  return out;
}

/**
 * Task track3-eaton-centre-20261031 (lane PROFILES): every loot holder with what the material census needs — the SAME index /
 * purpose-key / surface rules as layoutHolders (unchanged above), plus the holder's prop (position / footprint / storey), its
 * surfaces (finite capacity) and its PRE-FIT entries (the exact rollHolderLots roll before packing: items/loot.ts holderFinds with
 * the compartment roll when the holder has compartment surfaces), so fit failures = entries − placed lots.
 */
export interface LayoutHolderDetail extends LayoutHolder { prop: StationLayout['props'][number]; surfaces: readonly Surface[]; entries: readonly LootEntry[] }
export function layoutHolderDetails(layout: StationLayout, profile?: LootProfile): LayoutHolderDetail[] {
  const out: LayoutHolderDetail[] = [];
  const opts = surfaceOpts();
  let ci = 0, si = 0;
  const openIdx = new Map<string, number>();
  for (const p of layout.props) {
    const kind = p.kind as string;
    if (!isLootHolderKind(kind)) continue;
    const isC = isContainerKind(kind);
    const def = (PROP_DEFS as unknown as Record<string, Dims | undefined>)[kind] ?? FALLBACK[kind] ?? {w: 1, d: 1, h: 1};
    const surfaces = cutSurfaces(holderSurfaces(kind as never, def, opts), p.cut);
    const area = layout.areas[p.area];
    const areaType = p.purpose ?? area?.purpose ?? area?.type ?? 'default';
    let index: number;
    if (isC && openableActive(kind, ALL_MODELS)) { index = openIdx.get(kind) ?? 0; openIdx.set(kind, index + 1); } else index = isC ? ci++ : si++;
    const st = createHolderState(layout.seed, index, kind as HolderKind, areaType, surfaces, undefined, profile);
    const inside = !!compartmentTable(kind as HolderKind, areaType, profile) && surfaces.some(s => s.part !== undefined);
    const entries = holderFinds(layout.seed, index, kind as HolderKind, areaType, inside, profile).map(e => ({itemId: e.itemId, count: e.count}));
    out.push({kind: kind as HolderKind, index, areaType, lots: st.lots, prop: p, surfaces, entries});
  }
  return out;
}

/** Every finite stack of a generated station (holder lots + layout pickups); `profile` as layoutHolders. */
export function stationEconomy(layout: StationLayout, profile?: LootProfile): EconEntry[] {
  const out: EconEntry[] = [];
  for (const h of layoutHolders(layout, profile)) for (const l of h.lots) out.push({itemId: l.itemId, count: l.count, source: 'holder', holder: h.kind, area: h.areaType});
  for (const q of layout.pickups) {
    const a = layout.areas[q.area];
    out.push({itemId: q.itemId, count: q.count, source: 'pickup', area: a?.purpose ?? a?.type ?? 'default'});
  }
  return out;
}

export interface EconTotals {
  stations: number;
  /** Units per category over the corpus. */
  units: Record<EconCat, number>;
  /** Units per item id. */
  items: Record<string, number>;
  /** Units per category and source. */
  bySource: Record<'holder' | 'pickup', Record<EconCat, number>>;
  /** Stacks (lots / pickups) per category. */
  stacks: Record<EconCat, number>;
  /** Holders / holders with at least one lot. */
  holders: number;
  stockedHolders: number;
}

const zero = (): Record<EconCat, number> => ({food: 0, drink: 0, med: 0, ammo: 0, battery: 0, flare: 0, weapon: 0, other: 0});

export function generateCorpus(): StationLayout[] {
  return ECONOMY_CORPUS.map(c => generateStation(c.seed, {startWeapon: 'pistol'}));
}

export function corpusTotals(layouts: readonly StationLayout[], econ: (l: StationLayout) => EconEntry[] = stationEconomy): EconTotals {
  const t: EconTotals = {stations: layouts.length, units: zero(), items: {}, bySource: {holder: zero(), pickup: zero()}, stacks: zero(), holders: 0, stockedHolders: 0};
  for (const l of layouts) {
    const list = econ(l);
    for (const e of list) {
      const c = econCat(e.itemId);
      t.units[c] += e.count;
      t.stacks[c]++;
      t.items[e.itemId] = (t.items[e.itemId] ?? 0) + e.count;
      t.bySource[e.source][c] += e.count;
    }
    t.holders += l.props.filter(p => isLootHolderKind(p.kind)).length;
  }
  return t;
}

/** Non-ammo resource units (food + drink + meds [+ the new light items]); weapons are not a resource count. */
export const nonAmmo = (u: Record<EconCat, number>, withLight = false): number => u.food + u.drink + u.med + u.other + (withLight ? u.battery + u.flare : 0);
