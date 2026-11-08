// Task studio-skywalk-encounters-20261108-074144-01 (lane STORES; user: "To improve variety in store fronts, lift a few stores, from the
// mall level and sprinkle them in to this level to increase store variety."): MALL STORE FAMILIES in the Skywalk's ordinary storefront
// allocation — Skyways layout version >= SKYWAYS_ENCOUNTERS_MIN_VERSION (5) only. Pure data (no three.js), deterministic.
//
// What it is: a few of the Skywalk's ordinary glazed retail units (the base shop pools of gen/skyways/carve.ts shopsOn — never an anchor /
// major store, a food unit, the ramen restaurant or a station-storey unit) are let to a MALL PROGRAMME instead of their station shop use:
// the Mall's own store, not a sign over a generic box —
//  - the programme's fictional brand (gen/mall/shops.ts MALL_PROGRAMS brands, unique on the map) on the fascia, drawn in the Mall's brand
//    style (world/skywaysMallFascia.ts: plate colour, accent rule, pictogram, typeface — the Mall's BRAND_STYLE);
//  - the programme's Mall finish on the unit's walls / floor (world/mallFinishes.ts PROGRAM_FINISH, as reserved finish-table rows of the
//    small shops' per-vertex programs: world/skywaysMallFinish.ts — no draw call added);
//  - the programme's Mall interior: its focal display + RECIPE (gen/mall/shopsDress.ts dressMallRecipe — the Mall's fixtures, openable
//    storage, mannequins, garment groups, ottomans, suitcases … every kind already in both audits), through the shared placement
//    primitive; fixture-drawn merchandise follows the version-4 rule (gen/skyways/skywaysMerchSplit.ts runs after every dresser);
//  - the programme's Mall PURPOSE on the unit (`mall-<programme>`, gen/purposes.ts MALL_PURPOSES): its holders roll those context tables
//    under the SKYWAYS loot profile (BASE_TABLES + the additive base salvage — never the Mall's profile, tables, salvage, storage fill or
//    gear bias); no floor piles (Area.noFloorLoot, like the major stores).
// The pool: Mall families that fit the Skywalk's small units (their Mall minimum size AND the unit's inferred Mall lot family —
// gen/mall/lots.ts lotSuits) and add variety beside the base pools and the ten major stores (no gun shop, pharmacy, phone, florist, books,
// music, sports / outdoors, arcade): women's fashion, shoes, jewellery, beauty, optician, luggage, toys, pets. A map lets 2-4 of them (as
// far as fitting units exist), each family at most once, spread out (SKYWAYS_MALL_STORES.spacing on a storey).
//
// Streams: assignSkywaysMallStores draws on its own fork (`skyways-mall-stores`) BEFORE the station dresser (no carve / frame draw moves;
// the units' geometry is the carve's); dressSkywaysMallStores furnishes each unit on its own fork (`mall-store:<storefront id>`). The
// station dresser's stream shifts only by what the chosen units no longer draw (their generic fit-out: gen/storefronts.ts returns after
// the shopfront blockers, as for an anchor). Versions 1-4 never come here (skywaysGenVersion / the context's version < 5): byte-identical.

import type {Rng} from '../../core/rng';
import {CELL} from '../grid';
import type {Area, Side, StationLayout, Storefront} from '../stationTypes';
import type {MallProgram, MallShop} from '../mall/mallTypes';
import {MALL_PROGRAMS, inferLot, type MallShopFit} from '../mall/shops';
import {lotSuits, mallLot} from '../mall/lots';
import {ShopDresser, dressMallRecipe, frameOf, liftPlaced, shopLights} from '../mall/shopsDress';
import {makePlaceCtx} from '../placeKit';
import type {PropPlacement} from '../props';
import {SKYWAYS_ENCOUNTERS_MIN_VERSION, skywaysGenVersion} from './layoutVersion';
import {SKYWAYS_MALL_STORE_PROGRAMS, type SkywaysMallStoreProgram} from './skywaysMallPool';

export {SKYWAYS_MALL_STORE_PROGRAMS, type SkywaysMallStoreProgram} from './skywaysMallPool';

/** Per-map rules: how many Mall stores a map asks for (weighted), the least centre distance (m) of two on one storey, the light step. */
export const SKYWAYS_MALL_STORES = {
  count: [[2, 0.35], [3, 0.45], [4, 0.2]] as readonly (readonly [number, number])[],
  spacing: 14,
  lightStep: 6.0,
} as const;

/** One Mall store a map let: its storefront, unit area, programme, brand. */
export interface SkywaysMallStore {
  storefront: number;
  area: number;
  level: number;
  program: SkywaysMallStoreProgram;
  brand: string;
  /** The station shop use the unit had (what it replaced). */
  was: string;
  /** Sales floor (m²) and its frontage width / depth (m). */
  m2: number; width: number; depth: number;
}

/** QA / tests: the last assignment's census (candidates, the count asked for, the stores let). */
export const SKYWAYS_MALL_STORE_STATS: {last: {candidates: number; target: number; stores: SkywaysMallStore[]} | null} = {last: null};

const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The unit's own wall holding the shopfront (a storefront's `side` is the HALL wall: the unit lies beyond it). */
export function mallStoreFront(sf: Storefront): Side { return OPP[sf.side]; }

/** Frontage width (m along the opening) and depth (m) of a storefront's unit. */
function unitSize(layout: StationLayout, sf: Storefront): {width: number; depth: number} {
  const a = layout.areas[sf.unit], alongX = sf.side === 'N' || sf.side === 'S';
  return {width: (alongX ? a.w : a.h) * CELL, depth: (alongX ? a.h : a.w) * CELL};
}

/** May this storefront's unit be let to a Mall family (an ordinary glazed retail unit above the station storey, a plain room)? */
export function mallStoreEligible(layout: StationLayout, sf: Storefront): boolean {
  if (sf.unit < 0 || sf.anchor || sf.food || sf.ownDress || sf.mall || !sf.glazed || sf.shutter !== 'open' || !(sf.level ?? 0)) return false;
  const a = layout.areas[sf.unit];
  return !!a && a.type === 'shop' && a.storefront === sf.id && !layout.areas.some(q => q.parent === a.id && q.id !== a.id);
}

/** Does Mall programme `p` fit a unit (its Mall minimum sales area / depth / width, and the Mall lot family the unit reads as)? */
export function mallStoreFits(p: MallProgram, width: number, depth: number): boolean {
  const d = MALL_PROGRAMS[p], m2 = width * depth;
  if (m2 < d.min.area - 1e-6 || depth < d.min.depth - 1e-6 || width < d.min.width - 1e-6) return false;
  return lotSuits(inferLot({width, depth} as MallShop, m2), p);
}

/**
 * Version >= 5, BEFORE the station dresser: lets 2-4 ordinary units to Mall store families (see the header) — the storefront's `mall`
 * programme, its brand (name), sign colour; the unit's purpose / label and `noFloorLoot`. Draws only on `rng` (fork it at the call site).
 * Returns the stores let (none below version 5).
 */
export function assignSkywaysMallStores(layout: StationLayout, rng: Rng, version: number): SkywaysMallStore[] {
  if (version < SKYWAYS_ENCOUNTERS_MIN_VERSION) return [];
  const cands = layout.storefronts.filter(sf => mallStoreEligible(layout, sf)).map(sf => ({sf, ...unitSize(layout, sf)}));
  const target = rng.weighted(SKYWAYS_MALL_STORES.count);
  const order = rng.shuffle([...SKYWAYS_MALL_STORE_PROGRAMS]);
  const taken = new Set<number>(), out: SkywaysMallStore[] = [];
  const used = new Set(layout.storefronts.map(sf => sf.name));
  const centre = (sf: Storefront) => { const a = layout.areas[sf.unit]; return {x: (a.x + a.w / 2) * CELL, z: (a.y + a.h / 2) * CELL, level: sf.level ?? 0}; };
  const spaced = (sf: Storefront) => {
    const c = centre(sf);
    return out.every(s => { const q = centre(layout.storefronts[s.storefront]); return q.level !== c.level || Math.hypot(q.x - c.x, q.z - c.z) >= SKYWAYS_MALL_STORES.spacing; });
  };
  for (const p of order) {
    if (out.length >= target) break;
    const d = MALL_PROGRAMS[p];
    // the unit nearest the programme's comfortable size (the Mall's own size match: ~1.8 x its minimum), seeded within
    let best: (typeof cands)[number] | null = null, bs = -1;
    for (const c of cands) {
      if (taken.has(c.sf.id) || !mallStoreFits(p, c.width, c.depth) || !spaced(c.sf)) continue;
      const v = (1 / (1 + Math.abs(c.width * c.depth - d.min.area * 1.8) / (d.min.area + 20))) * (0.85 + 0.3 * rng.next());
      if (v > bs) { bs = v; best = c; }
    }
    if (!best) continue;
    const sf = best.sf, a = layout.areas[sf.unit];
    const free = d.brands.filter(b => !used.has(b));
    const brand = free.length ? rng.pick(free) : `${rng.pick(d.brands)} ${sf.level === 2 ? 'Skywalk' : 'Street'}`;
    used.add(brand);
    const was = sf.use;
    sf.mall = p;
    sf.name = brand;
    sf.color = d.sign.bg;
    a.label = brand;
    a.purpose = d.purpose;
    a.noFloorLoot = true;
    taken.add(sf.id);
    out.push({storefront: sf.id, area: a.id, level: sf.level ?? 0, program: p, brand, was, m2: r2(best.width * best.depth), width: r2(best.width), depth: r2(best.depth)});
  }
  SKYWAYS_MALL_STORE_STATS.last = {candidates: cands.length, target, stores: out};
  return out;
}

/** The cells the station dresser keeps clear for the Mall stores' own dresser (every unit cell; holdCells form). */
export function skywaysMallStoreHolds(layout: StationLayout): {level: number; cells: number[]}[] {
  const out: {level: number; cells: number[]}[] = [];
  for (const sf of layout.storefronts) {
    if (!sf.mall || sf.unit < 0) continue;
    const a = layout.areas[sf.unit], lv = sf.level ?? 0, g = layout.levels[lv]?.grid;
    if (!a || !g) continue;
    const cells: number[] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (g.inBounds(x, y) && g.area[g.idx(x, y)] === a.id) cells.push(g.idx(x, y));
    out.push({level: lv, cells});
  }
  return out;
}

/** The Mall stores of a layout (from its storefronts: the one source of truth). */
export function skywaysMallStoresOf(layout: StationLayout): Storefront[] {
  return layout.storefronts.filter(sf => !!sf.mall && sf.unit >= 0);
}

/** QA / tests: what the dresser placed per store. */
export interface SkywaysMallStoreDress { storefront: number; area: number; program: MallProgram; recipe: string; props: PropPlacement[]; lot: string | undefined }
const DRESSED = new WeakMap<StationLayout, SkywaysMallStoreDress[]>();
export function skywaysMallStoreDressOf(layout: StationLayout): readonly SkywaysMallStoreDress[] { return DRESSED.get(layout) ?? []; }

/** The fit of a Skywalk Mall store (the parts of the Mall's MallShopFit its recipe / focal display read). */
function fitOf(sf: Storefront, entry: readonly [number, number]): MallShopFit {
  const p = sf.mall!, d = MALL_PROGRAMS[p];
  return {program: p, kind: 'store', brand: sf.name, purpose: d.purpose, recipe: d.recipe, finish: d.finishes[0],
    sign: {text: sf.name, style: d.sign, lit: sf.sign, blade: false}, front: 'glazed', shutter: 'open', entry};
}

/**
 * Version >= 5, AFTER the station dresser (its liftLevels): furnishes every Mall store with its programme's Mall interior (see the
 * header) on `rng`'s per-store forks, lifted onto its storey floor, with the Mall's warm ceiling fixtures (applyLighting decides their
 * state from the purpose's odds later). Restores the unit's Mall purpose (the station dresser's generic pass names it first). Returns the
 * props placed per store.
 */
export function dressSkywaysMallStores(layout: StationLayout, rng: Rng): SkywaysMallStoreDress[] {
  const out: SkywaysMallStoreDress[] = [];
  if (skywaysGenVersion(layout) < SKYWAYS_ENCOUNTERS_MIN_VERSION) return out;
  for (const sf of skywaysMallStoresOf(layout)) {
    const a: Area | undefined = layout.areas[sf.unit];
    if (!a) continue;
    const p = sf.mall!, def = MALL_PROGRAMS[p];
    a.purpose = def.purpose;
    a.label = sf.name;
    a.noFloorLoot = true;
    const level = sf.level ?? 0, srng = rng.fork(`mall-store:${sf.id}`);
    const ctx = makePlaceCtx(layout, srng, level, {x0: a.x - 2, y0: a.y - 2, x1: a.x + a.w + 1, y1: a.y + a.h + 1});
    const front = mallStoreFront(sf), alongX = front === 'N' || front === 'S';
    const frontStart = (alongX ? sf.ox : sf.oy) * CELL, ow = (alongX ? sf.ow : sf.oh) * CELL;
    const entry: [number, number] = sf.glazed ? [sf.entry[0] * CELL, sf.entry[1] * CELL] : [0, ow];
    const fr = frameOf(a, front, entry, frontStart);
    const d = new ShopDresser(layout, ctx, fr, srng);
    d.lot = mallLot(inferLot({width: fr.W, depth: fr.D} as MallShop, fr.W * fr.D));
    const first = layout.props.length;
    // the way in stays open (the Mall's glazed-front rule): a 2 m deep keep-out behind the entry span
    d.keep(fr.entry[0] - 0.25, fr.entry[1] + 0.25, 0, Math.min(2.0, fr.D * 0.4));
    dressMallRecipe(d, fitOf(sf, entry));
    liftPlaced(layout, first);
    shopLights(layout, a, SKYWAYS_MALL_STORES.lightStep);
    out.push({storefront: sf.id, area: a.id, program: p, recipe: def.recipe, props: layout.props.slice(first), lot: d.lot?.id});
  }
  DRESSED.set(layout, out);
  return out;
}
