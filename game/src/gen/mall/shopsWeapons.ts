// Task track3-eaton-centre-20261031 (lane SHOPS): THE MALL WEAPON PLAN — real guns + matching-calibre ammo in The Eaton's Center's gun
// shop(s). Pure data, deterministic. An EXPLICIT EXCEPTION to the loot tables (like gen/weaponFinds.ts / gen/office/spawns.ts officeWeaponPlan,
// docs/loot-tables.md "Explicit exceptions"): weapon finds are layout pickups, never holder rolls.
//
// User (track 3): "you go to like the gun shop and there's guns right". Coordination brief §3: "Gun shops must contain finite
// accessible real weapon find(s) and matching ammo, not just signs or rolls that fail fit. Multiple duplicate gun shops cannot farm
// unlimited guaranteed weapons: bounded, once-per-logical-run sources with persistence."
//
//  - PLAN (mallWeaponPlan): ONE plan per logical mall run, from the level seed + the run's start weapon (stream
//    `mall-weapons:<start>`): every real gun the player did NOT start with (pistol / shotgun / rifle) gets copies from the station's
//    copy draw (gen/weaponFinds.ts FIND_COPY_THRESHOLDS: ~86 % one, ~14 % FIND_MAX_PER_WEAPON = 2) — but never 0: the mall's gun shop
//    always stocks it. So the whole mall holds at most 2 of each non-start gun however many gun shops it has (a second gun shop
//    shares the same plan: it gets a planned second copy or none — duplicates never multiply the finds).
//  - WHERE (placeMallWeapons): copy 1 of every planned gun lies on a gun shop's DISPLAY BENCH (gen/mall/kinds.ts gunDisplay: a static,
//    non-holder bench, so no loot lot competes for its top) with a box of its OWN calibre beside it (WEAPON_FIND_AMMO: 15 x 9 mm /
//    6 x 12-gauge / 20 x 5.56); benches fill in order, then the gun shop's open floor near its counter. Second copies go to the
//    second gun shop, else the outdoor outfitter, else the mall security office, else they are not placed (bounded, reported).
//    Every spot is ACCESSIBLE: the bench's customer side / the floor cell is walkable and reachable from the shop's entry on its
//    storey grid (distance field), and on the floor 1 m clear of other pickups.
//  - FINITE + PERSISTED: ordinary layout pickups appended in plan order (run/memory.ts remembers taken layout pickup indices: taken stays
//    taken across revisits / saves; a New Game seed rolls a new plan). Nothing re-rolls.
// Call after the dressing is final (absolute prop heights: after stationDress.dress() lifted the pre-dress), before gear placement.

import {Rng, hashString} from '../../core/rng';
import {CELL, FLOOR, type Grid} from '../grid';
import {PROP_DEFS, type PropPlacement} from '../props';
import {levelGrid} from '../placeKit';
import {FIND_COPY_THRESHOLDS, FIND_MAX_PER_WEAPON, WEAPON_FIND_AMMO, type StartWeaponId} from '../weaponFinds';
import type {PickupPlacement, StationLayout} from '../stationTypes';
import type {MallShop} from './mallTypes';
import {GUN_DISPLAY_TOP} from './kinds';
import {shopFit} from './shops';
import {frameOf, frontageSide, uvXZ} from './shopsDress';

/** The real guns a mall gun shop can stock (the knife is melee, never a find). */
export const MALL_FIND_WEAPONS = ['pistol', 'shotgun', 'rifle'] as const;

export interface MallWeaponPlanEntry {
  weapon: string;
  /** 0 = the gun shop's guaranteed copy, 1 = a planned second copy. */
  copy: number;
}

/** The mall's weapon plan for one logical run (deterministic per level seed + start weapon). */
export function mallWeaponPlan(levelSeed: number, start: StartWeaponId): MallWeaponPlanEntry[] {
  const rng = new Rng(hashString(`mall-weapons:${start}`, levelSeed >>> 0));
  const out: MallWeaponPlanEntry[] = [];
  for (const w of MALL_FIND_WEAPONS) {
    if (w === start) continue;
    const r = rng.next();
    const n = r < FIND_COPY_THRESHOLDS.one ? 1 : FIND_MAX_PER_WEAPON;
    for (let k = 0; k < n; k++) out.push({weapon: w, copy: k});
  }
  return out;
}

export interface MallWeaponFind {
  weapon: string;
  copy: number;
  shop: string;
  area: number;
  level: number;
  on: 'display' | 'floor';
  /** layout.pickups indices of the gun and its ammo box. */
  pickups: [number, number];
}
export interface MallWeaponReport {
  plan: MallWeaponPlanEntry[];
  finds: MallWeaponFind[];
  /** Planned copies with no host shop / no accessible spot (bounded: simply not placed). */
  missed: MallWeaponPlanEntry[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Places the plan's guns + matching ammo (see header). Appends to layout.pickups; returns what went where. */
export function placeMallWeapons(layout: StationLayout, levelSeed: number, start: StartWeaponId): MallWeaponReport {
  const plan = mallWeaponPlan(levelSeed, start);
  const report: MallWeaponReport = {plan, finds: [], missed: []};
  const mall = layout.mall;
  if (!mall) { report.missed.push(...plan); return report; }
  const byProgram = (p: string) => mall.shops.filter(s => shopFit(s)?.program === p || (p === 'security' && shopFit(s)?.recipe === 'security')).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const guns = byProgram('guns');
  const second = [...guns.slice(1), ...byProgram('outdoors'), ...byProgram('security')];
  const benchUsed = new Set<PropPlacement>();
  for (const e of plan) {
    const hosts = e.copy === 0 ? [...guns, ...byProgram('outdoors'), ...byProgram('security')] : second;
    let done = false;
    for (const s of hosts) {
      const f = placeIn(layout, s, e, benchUsed);
      if (f) { report.finds.push(f); done = true; break; }
    }
    if (!done) report.missed.push(e);
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

function placeIn(layout: StationLayout, s: MallShop, e: MallWeaponPlanEntry, benchUsed: Set<PropPlacement>): MallWeaponFind | null {
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
  // 1. a display bench of this shop (its customer side reachable)
  for (const b of layout.props.filter(p => p.kind === 'gunDisplay' && p.area === s.area && !benchUsed.has(p))) {
    const fx = Math.sin(b.rot), fz = Math.cos(b.rot), d = PROP_DEFS.gunDisplay.d;
    // the cell row just outside the bench's footprint on its customer (front) side
    if (!reach(b.x + fx * (d / 2 + 0.75), b.z + fz * (d / 2 + 0.75))) continue;
    // local x of the bench: (cos rot, -sin rot); the gun left of centre, its ammo box at the right end
    const lx = Math.cos(b.rot), lz = -Math.sin(b.rot), y = r3(b.y + GUN_DISPLAY_TOP);
    benchUsed.add(b);
    const gi = push({itemId: e.weapon, count: 1, x: r3(b.x - lx * 0.15), y, z: r3(b.z - lz * 0.15), area: a.id, ...(level ? {level} : {})});
    const ai = push({itemId: ammo, count: cnt, x: r3(b.x + lx * 0.52), y, z: r3(b.z + lz * 0.52), area: a.id, ...(level ? {level} : {})});
    return {weapon: e.weapon, copy: e.copy, shop: s.id, area: a.id, level, on: 'display', pickups: [gi, ai]};
  }
  // 2. the shop's open floor: a reachable cell with a clear 1-cell ring, 1.2 m from other pickups, nearest the shop's counters
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
  const gi = push({itemId: e.weapon, count: 1, x: r3(x), y: r3(fy), z: r3(z), area: a.id, ...(level ? {level} : {})});
  const ai = push({itemId: ammo, count: cnt, x: r3(x + 0.45), y: r3(fy), z: r3(z), area: a.id, ...(level ? {level} : {})});
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
