// Task track3-eaton-centre-20261031 (lane SHOPS): THE MALL WEAPON PLAN — real guns + matching-calibre ammo in the mall's gun shop(s).
// Pure data, deterministic. An EXPLICIT EXCEPTION to the loot tables (like gen/weaponFinds.ts / gen/office/spawns.ts officeWeaponPlan,
// docs/loot-tables.md "Explicit exceptions"): weapon finds are layout pickups, never holder rolls.
//
// Task mall-playtest-revision-20261031 (lane SHOPS, U11 — user: "gun store didn't have a gun! I think it should have on average 1
// gun"). The track-3 plan was ONE mall-wide quota (every gun the player did NOT start with, 1-2 copies: ~2.3 guns per mall), hosted
// by the first gun shop; a second gun shop only got a planned SECOND copy (~14 % per gun), so it was usually empty, and copies could
// land in the outfitter / security office instead. The plan also filtered the stock by the run's start weapon (stream
// `mall-weapons:<start>`): physical shop stock depended on the player's loadout. Replaced by a PER-GUN-SHOP allocation:
//  - STOCK (gunShopStock): every gun shop draws its OWN stock from (level seed, shop id) — stream `mall-gunshop:<shop id>`, independent
//    per shop: 0 guns with p GUN_SHOP_STOCK.none (5 %), 1 with 90 %, 2 with 5 % => exactly 1.0 gun per gun shop in expectation,
//    bounded (MAX_GUNS_PER_SHOP 2; P(empty) 5 %, documented). Which guns: GUN_SHOP_WEAPONS weights (pistol / shotgun / rifle), two
//    different guns when it stocks two. At most MAX_STOCKED_GUN_SHOPS (2) gun shops per mall are stocked (the catalogue caps gun shops
//    at 2 anyway), so a mall holds 0..4 shop guns, ~1.35 on average with the catalogue's ~35 % second gun shop.
//  - LOADOUT-FREE: the start weapon, the inventory, a Travel arrival and earlier visits never enter the plan — the stock is a fact of
//    the level seed (the start-weapon argument of placeMallWeapons is accepted and IGNORED). Runtime never filters layout pickups by
//    the player's inventory either (game.ts buildSection spawns every layout pickup on a first visit: run/memory.ts pickupPlan; after
//    that exactly the remembered loose items: taken stays taken).
//  - WHERE (placeMallWeapons): each gun on one of ITS shop's display benches (gen/mall/kinds.ts gunDisplay: a static non-holder bench,
//    no loot lot competes for its top; the bench's customer side reachable from the shop entry on its storey grid), lying along the
//    bench (PickupPlacement.yaw) with ONE box of its own calibre beside it (WEAPON_FIND_AMMO); benches full -> the lower cradle shelf
//    of the shop's gun rack (M14, its front reachable); else the shop floor near its counter (reported 'floor'); else not placed
//    (reported `missed` — tests require none on the fixtures).
//  - FINITE + PERSISTED: ordinary layout pickups appended in shop order (run/memory.ts remembers taken layout pickup indices: taken stays
//    taken across revisits / saves; a New Game seed rolls a new plan). Nothing re-rolls.
// Call after the dressing is final (absolute prop heights), before gear placement.

import {Rng, hashString} from '../../core/rng';
import {CELL, FLOOR, type Grid} from '../grid';
import {PROP_DEFS, type PropPlacement} from '../props';
import {levelGrid} from '../placeKit';
import {WEAPON_FIND_AMMO, type StartWeaponId} from '../weaponFinds';
import type {PickupPlacement, StationLayout} from '../stationTypes';
import type {MallShop} from './mallTypes';
import {GUN_DISPLAY_TOP, GUN_RACK_SHELF_Y} from './kinds';
import {shopFit} from './shops';
import {frameOf, frontageSide, uvXZ} from './shopsDress';

/** The real guns a mall gun shop can stock (the knife is melee, never a find). */
export const MALL_FIND_WEAPONS = ['pistol', 'shotgun', 'rifle'] as const;
/** Per-gun-shop stock draw r: r < none -> 0 guns, r < one -> 1 gun, else MAX_GUNS_PER_SHOP. E = 0.90 + 2 x 0.05 = 1.0. */
export const GUN_SHOP_STOCK = {none: 0.05, one: 0.95} as const;
export const MAX_GUNS_PER_SHOP = 2;
/** Gun shops stocked per mall (sorted by shop id; the catalogue never makes more than 2). */
export const MAX_STOCKED_GUN_SHOPS = 2;
/** Which gun a shop stocks (weights; a second gun is drawn from the rest). */
export const GUN_SHOP_WEAPONS: readonly (readonly [(typeof MALL_FIND_WEAPONS)[number], number])[] = [['pistol', 0.4], ['shotgun', 0.35], ['rifle', 0.25]];

/** Exact per-gun-shop distribution of the number of guns (documentation / tests / the loot reference). */
export function gunShopStockDistribution(): {guns: number; p: number}[] {
  return [{guns: 0, p: GUN_SHOP_STOCK.none}, {guns: 1, p: GUN_SHOP_STOCK.one - GUN_SHOP_STOCK.none}, {guns: MAX_GUNS_PER_SHOP, p: 1 - GUN_SHOP_STOCK.one}];
}
/** One-line description of the plan (tools/pages/lootReference.ts reads it). */
export const MALL_WEAPON_PLAN_SUMMARY = `Per gun shop (gen/mall/shopsWeapons.ts gunShopStock / placeMallWeapons): every gun shop draws its own stock from the level seed and its shop id (stream mall-gunshop:<shop id>, independent per shop): 0 guns ${GUN_SHOP_STOCK.none * 100} %, 1 gun ${Math.round((GUN_SHOP_STOCK.one - GUN_SHOP_STOCK.none) * 100)} %, ${MAX_GUNS_PER_SHOP} different guns ${Math.round((1 - GUN_SHOP_STOCK.one) * 100)} % (1.0 per gun shop on average; pistol / shotgun / rifle weights ${GUN_SHOP_WEAPONS.map(w => w[1]).join(' / ')}), at most ${MAX_STOCKED_GUN_SHOPS} gun shops stocked. Each gun lies on one of its shop's display benches (else its gun rack's cradle shelf, else its floor near the counter) with ONE box of its own calibre beside it. Independent of the start weapon, the inventory and Travel; layout pickups, so taken stays taken.`;

export interface MallWeaponPlanEntry {
  weapon: string;
  /** The gun shop (MallShop.id) stocking it. */
  shop: string;
  /** 0 = the shop's first gun, 1 = its second. */
  copy: number;
}

/** The stock of ONE gun shop: deterministic per (level seed, shop id), independent of every other shop and of the loadout. */
export function gunShopStock(levelSeed: number, shopId: string): string[] {
  const rng = new Rng(hashString(`mall-gunshop:${shopId}`, levelSeed >>> 0));
  const r = rng.next();
  const n = r < GUN_SHOP_STOCK.none ? 0 : r < GUN_SHOP_STOCK.one ? 1 : MAX_GUNS_PER_SHOP;
  const out: string[] = [];
  let pool = GUN_SHOP_WEAPONS.slice();
  for (let k = 0; k < n && pool.length; k++) {
    const w = rng.weighted(pool);
    out.push(w);
    pool = pool.filter(e => e[0] !== w);
  }
  return out;
}

/** The mall's gun shops (sorted by id) that get a stock draw. */
export function stockedGunShops(shops: readonly MallShop[]): MallShop[] {
  return shops.filter(s => (shopFit(s)?.program ?? s.program) === 'guns').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, MAX_STOCKED_GUN_SHOPS);
}

/** The mall's weapon plan: every stocked gun shop's own stock, in shop order (deterministic per level seed; loadout-free). */
export function mallWeaponPlan(levelSeed: number, shops: readonly MallShop[]): MallWeaponPlanEntry[] {
  return stockedGunShops(shops).flatMap(s => gunShopStock(levelSeed, s.id).map((weapon, copy) => ({weapon, shop: s.id, copy})));
}

export interface MallWeaponFind {
  weapon: string;
  copy: number;
  shop: string;
  area: number;
  level: number;
  on: 'display' | 'rack' | 'floor';
  /** layout.pickups indices of the gun and its ammo box. */
  pickups: [number, number];
}
export interface MallWeaponReport {
  plan: MallWeaponPlanEntry[];
  finds: MallWeaponFind[];
  /** Planned guns with no accessible spot in their shop (bounded: simply not placed). */
  missed: MallWeaponPlanEntry[];
  /** Per stocked gun shop: what it drew and what was placed (QA / tests / lanes/SHOPS.done). */
  shops: {shop: string; stock: string[]; placed: number}[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Places every stocked gun shop's guns + matching ammo (see header). Appends to layout.pickups; returns what went where. `_start` is
 * accepted for the old call sites and IGNORED: the shop stock never depends on the player's loadout.
 */
export function placeMallWeapons(layout: StationLayout, levelSeed: number, _start?: StartWeaponId): MallWeaponReport {
  void _start;
  const mall = layout.mall;
  const report: MallWeaponReport = {plan: [], finds: [], missed: [], shops: []};
  if (!mall) return report;
  report.plan = mallWeaponPlan(levelSeed, mall.shops);
  const used = new Set<PropPlacement>();
  for (const s of stockedGunShops(mall.shops)) {
    const entries = report.plan.filter(e => e.shop === s.id);
    let placed = 0;
    for (const e of entries) {
      const f = placeIn(layout, s, e, used);
      if (f) { report.finds.push(f); placed++; } else report.missed.push(e);
    }
    report.shops.push({shop: s.id, stock: entries.map(e => e.weapon), placed});
  }
  return report;
}

/** Entry stand cell of a shop on its storey grid (the frame's entry midpoint, just inside the frontage). */
function entryCell(layout: StationLayout, s: MallShop, g: Grid): number {
  const a = layout.areas[s.area];
  const fit = shopFit(s);
  const side = frontageSide(a, s);
  const fs = side === 'N' || side === 'S' ? Math.min(s.frontage.x0, s.frontage.x1) : Math.min(s.frontage.z0, s.frontage.z1);
  const fr = frameOf(a, side, fit?.entry, fs);
  for (const v of [0.25, 0.75, 1.25, 1.75]) {
    const [x, z] = uvXZ(fr, (fr.entry[0] + fr.entry[1]) / 2, v);
    const [cx, cy] = g.cellOf(x, z);
    if (g.walkable(cx, cy)) return g.idx(cx, cy);
  }
  return -1;
}

/** World point of a host-local (x, z) offset (prop frame: local x = (cos rot, -sin rot), local +z = (sin rot, cos rot)). */
const local = (p: PropPlacement, lx: number, lz: number): [number, number] =>
  [p.x + Math.cos(p.rot) * lx + Math.sin(p.rot) * lz, p.z - Math.sin(p.rot) * lx + Math.cos(p.rot) * lz];

function placeIn(layout: StationLayout, s: MallShop, e: MallWeaponPlanEntry, used: Set<PropPlacement>): MallWeaponFind | null {
  const a = layout.areas[s.area];
  if (!a) return null;
  const level = a.level ?? 0;
  const g = levelGrid(layout, level);
  const start = entryCell(layout, s, g);
  if (start < 0) return null;
  const dist = g.distanceField(start % g.w, (start / g.w) | 0);
  const reach = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) && dist[g.idx(cx, cy)] >= 0; };
  const [ammo, cnt] = WEAPON_FIND_AMMO[e.weapon] ?? ['ammo_9mm', 15];
  const push = (p: PickupPlacement): number => { layout.pickups.push(p); return layout.pickups.length - 1; };
  const lv = level ? {level} : {};
  // a gun + its box on a host top at prop-relative height `top`: the gun along the host's long axis (yaw = host rot) left of centre
  const onHost = (h: PropPlacement, top: number, gx: number, ax: number, lz: number, on: 'display' | 'rack'): MallWeaponFind => {
    used.add(h);
    const y = r3(h.y + top), [gxw, gzw] = local(h, gx, lz), [axw, azw] = local(h, ax, lz);
    const gi = push({itemId: e.weapon, count: 1, x: r3(gxw), y, z: r3(gzw), area: a.id, yaw: r3(h.rot), ...lv});
    const ai = push({itemId: ammo, count: cnt, x: r3(axw), y, z: r3(azw), area: a.id, yaw: r3(h.rot), ...lv});
    return {weapon: e.weapon, copy: e.copy, shop: s.id, area: a.id, level, on, pickups: [gi, ai]};
  };
  const front = (h: PropPlacement, d: number) => local(h, 0, d / 2 + 0.75);
  // 1. a display bench of this shop (its customer side reachable)
  for (const b of layout.props.filter(p => p.kind === 'gunDisplay' && p.area === s.area && !used.has(p))) {
    if (!reach(...front(b, PROP_DEFS.gunDisplay.d))) continue;
    return onHost(b, GUN_DISPLAY_TOP, -0.15, 0.52, 0, 'display');
  }
  // 2. the lower cradle shelf of one of its gun racks (M14; its front reachable: the staff zone behind the counter has a gap)
  for (const r of layout.props.filter(p => p.kind === 'gunRack' && p.area === s.area && !used.has(p))) {
    if (!reach(...front(r, PROP_DEFS.gunRack.d))) continue;
    return onHost(r, GUN_RACK_SHELF_Y, -0.35, 0.65, 0.02, 'rack');
  }
  // 3. the shop's open floor: a reachable cell with a clear 1-cell ring, 1.2 m from other pickups, nearest the shop's counters
  const counters = layout.props.filter(p => p.area === s.area && (p.kind === 'glassCounter' || p.kind === 'shopCounter'));
  const cells: [number, number][] = [];
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    const i = g.idx(x, y);
    if (g.area[i] !== a.id || g.cells[i] !== FLOOR || dist[i] < 0 || g.rampIdx[i] >= 0) continue;
    let clear = true;
    for (let oy = -1; oy <= 1 && clear; oy++) for (let ox = -1; ox <= 1; ox++) if (!g.walkable(x + ox, y + oy)) { clear = false; break; }
    if (!clear) continue;
    const [cx, cz] = g.center(x, y);
    if (layout.pickups.some(p => (p.level ?? 0) === level && Math.hypot(p.x - cx, p.z - cz) < 1.2)) continue;
    const near = counters.length ? Math.min(...counters.map(c => Math.hypot(c.x - cx, c.z - cz))) : dist[i] * CELL;
    cells.push([i, near]);
  }
  if (!cells.length) return null;
  cells.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  const i = cells[0][0];
  const [x, z] = g.center(i % g.w, (i / g.w) | 0);
  const fy = g.floorOf(i);
  const gi = push({itemId: e.weapon, count: 1, x: r3(x), y: r3(fy), z: r3(z), area: a.id, ...lv});
  const ai = push({itemId: ammo, count: cnt, x: r3(x + 0.45), y: r3(fy), z: r3(z), area: a.id, ...lv});
  return {weapon: e.weapon, copy: e.copy, shop: s.id, area: a.id, level, on: 'floor', pickups: [gi, ai]};
}

// ---------------------------------------------------------------------------------------------
// Themed spots (QA / gear): stand poses into a shop, and candidate rare-gear spots in the outfitting shops.

/** Stand pose at a shop's entry looking in (QA hook `__LL.goShop('<program>')`): world x / z, camera yaw (forward = (-sin, -cos)), level. */
export function mallShopPose(layout: StationLayout, program: string, nth = 0): {x: number; z: number; yaw: number; level: number; shop: string} | null {
  const s = layout.mall?.shops.filter(q => q.program === program || shopFit(q)?.recipe === program)[nth];
  if (!s) return null;
  const a = layout.areas[s.area];
  const side = frontageSide(a, s);
  const fs = side === 'N' || side === 'S' ? Math.min(s.frontage.x0, s.frontage.x1) : Math.min(s.frontage.z0, s.frontage.z1);
  const fr = frameOf(a, side, shopFit(s)?.entry, fs);
  const [x, z] = uvXZ(fr, (fr.entry[0] + fr.entry[1]) / 2, 0.75);
  // looking into the unit: forward = the frame's inward direction; camera yaw convention forward = (-sin yaw, -cos yaw)
  const [ix, iz] = [Math.sin(fr.inward), Math.cos(fr.inward)];
  return {x: r3(x), z: r3(z), yaw: Math.atan2(-ix, -iz), level: a.level ?? 0, shop: s.id};
}

/** Programs whose sales floors suit a rare-gear find (boots, gloves, a backpack, a vest, a helmet, a chest rig). */
export const GEAR_SHOP_PROGRAMS: readonly string[] = ['outdoors', 'sports', 'clothing', 'shoes', 'department', 'luggage', 'guns'];

/** Candidate rare-gear spots (flat, reachable from the shop entry, clear) in the outfitting shops: lane GEN / PROFILES may use them. */
export function mallGearSpots(layout: StationLayout): {x: number; y: number; z: number; level: number; area: number}[] {
  const out: {x: number; y: number; z: number; level: number; area: number}[] = [];
  for (const s of layout.mall?.shops ?? []) {
    if (!GEAR_SHOP_PROGRAMS.includes(s.program)) continue;
    const a = layout.areas[s.area];
    if (!a) continue;
    const level = a.level ?? 0, g = levelGrid(layout, level);
    const st = entryCell(layout, s, g);
    if (st < 0) continue;
    const dist = g.distanceField(st % g.w, (st / g.w) | 0);
    let best = -1, bd = -1;
    for (let y = a.y + 1; y < a.y + a.h - 1; y++) for (let x = a.x + 1; x < a.x + a.w - 1; x++) {
      const i = g.idx(x, y);
      if (g.area[i] !== a.id || dist[i] < 0 || !g.walkable(x, y) || g.rampIdx[i] >= 0) continue;
      if (dist[i] > bd) { bd = dist[i]; best = i; } // the deepest reachable cell: in the shop, not on its threshold
    }
    if (best < 0) continue;
    const [x, z] = g.center(best % g.w, (best / g.w) | 0);
    out.push({x: r3(x), y: r3(g.floorOf(best)), z: r3(z), level, area: a.id});
  }
  return out;
}
