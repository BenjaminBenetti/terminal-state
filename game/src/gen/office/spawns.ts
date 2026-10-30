// Seamless Office Space (lane GEN): enemies, loose floor supplies and weapon finds of the ONE office layout. Pure data.
//
// Whole-level populations, placed storey by storey (iteration-16 totals): 5-8 enemies on the station + lobby, 3-6 on every office
// floor, drawn from the station's spawn rules (shambler / coated 60 / 40, per-spawn archetype pick in ai/creatureSpawn.ts keeps
// the ~5 % rat / dog), spread over areas by the station's area weights, never within 18 m walking distance of the platform start
// and kept a few metres off every storey's stair landing and elevator landing (nobody waits at the top of the stairs). Loose
// supplies scale the station's floor economy (items/lootEconomy.ts FLOOR_ECONOMY) to one storey of a ~1-Subway-sized level: about
// one ammo box per storey, a ~1-in-5 dressing / kit, a torch battery or flare now and then — the established scarcity, room
// purposes deciding where. Weapon finds are planned ONCE per level (officeWeaponPlan: which storey holds which non-start weapon),
// so the whole tower holds what one station would (0-2 per weapon), each found in a plausible room far from the start.
// One walking-distance field from the platform start (levelDistance over all 9 storeys) serves every placement.

import {Rng, hashString} from '../../core/rng';
import {FLOOR, type Grid} from '../grid';
import {purposeById} from '../purposes';
import {clearAround} from '../stationDress';
import {BATTERY_ID, FLARE_ID, FLOOR_ECONOMY} from '../../items/lootEconomy';
import {OFFICE_FLOOR, PUBLIC_FLOOR_WEIGHTS, econCat, floorChance, floorCount, lootProfile, type LootProfile, type OfficeFloorProgram} from '../../items/lootTables'; // Task loot-tables-20261030 (lane LOOT)
import {ITEMS} from '../../items/items';
import {WEAPON_FIND_AMMO, findWeaponsFor, type StartWeaponId} from '../weaponFinds';
import type {Area, PickupPlacement, StationLayout, ZombieType} from '../stationTypes';
import {OFFICE_FLOORS} from './frame';
import {COMPANIES, type LootTilt} from './companies';

/**
 * Task office-overhaul-20261030 (lane TENANTS): a company floor's loot tilt shifts the MIX of its scarce loose finds (same expected
 * count): the clinic's floor leans to dressings, the logistics / aerospace floors to torch batteries and flares, the security
 * firm's to flares and a surer ammo box, the food companies trade some battery chance for a snack. Multipliers per category
 * [med, battery, flare, food] (items/lootTables.ts OFFICE_FLOOR_TILT); renormalised to the untilted total.
 * Scarce loose-find odds of a floor [med, battery, flare, food] under a company's tilt (sum = the untilted sum: same count).
 */
export function scarceOdds(tilt: LootTilt, prog: OfficeFloorProgram = OFFICE_FLOOR): [number, number, number, number] {
  const base = prog.scarce.base, w = prog.tilt[tilt], cap = prog.scarce.cap;
  const sum = base[0] + base[1] + base[2];
  const k = sum / (base[0] * w[0] + base[1] * w[1] + base[2] * w[2] + base[1] * w[3]);
  return [Math.min(cap, base[0] * w[0] * k), Math.min(cap, base[1] * w[1] * k), Math.min(cap, base[2] * w[2] * k), Math.min(cap, base[1] * w[3] * k)];
}
function floorTilt(layout: StationLayout, levels: readonly number[]): LootTilt {
  const a = layout.areas.find(q => q.tenant && levels.includes(q.level ?? 0));
  return a?.tenant ? COMPANIES[a.tenant].loot : 'none';
}

export const OFFICE_ENEMIES = {street: [5, 8] as const, floor: [3, 6] as const};
/** Walking distance (cells) every enemy keeps from the platform start (18 m, the station rule). */
export const ENEMY_MIN_CELLS = {start: 36};
/** Straight-line keep-out (m) from a storey's stair landing / elevator landing: enemies, loose loot. */
export const LANDING_KEEP_M = {enemy: 5, loot: 2.0};

export interface SpawnField {
  /** Walking distance (cells) from the platform start on every level (-1 = unreachable). */
  dist: Int32Array[];
  /** Points enemies / loot keep a straight-line distance from (per level): stair landings, elevator landings. */
  keep: {level: number; x: number; z: number}[];
}

const nearKeep = (f: SpawnField, lv: number, x: number, z: number, r: number): boolean => f.keep.some(k => k.level === lv && Math.hypot(k.x - x, k.z - z) < r);
const NO_SPAWN_TYPES = new Set(['office-stair', 'stair-core', 'office-elevator']);

const zombieWeight = (a: Area): number => a.kind === 'platform' ? 2.2 : a.type === 'exit-stair' || a.type === 'washroom' ? 0.5
  : NO_SPAWN_TYPES.has(a.type) ? 0
  : a.type === 'eatery' || a.type === 'shop' ? 0.5 : a.kind === 'closet' ? 0.5 : a.type === 'office-open' ? 1.6 : a.publicSpace ? 1 : 1.3;

/** Enemies of the storeys `levels` (station + lobby: [0, 1]; office floor n: [n]); `range` = count range. Returns the count. */
export function placeOfficeEnemies(layout: StationLayout, rng: Rng, field: SpawnField, levels: readonly number[], range: readonly [number, number]): number {
  const count = rng.int(range[0], range[1]);
  const types: ZombieType[] = [];
  for (let i = 0; i < count; i++) types.push(rng.chance(0.4) ? 'coated' : 'shambler');
  if (!types.includes('coated')) types[0] = 'coated';
  if (count > 1 && !types.includes('shambler')) types[1] = 'shambler';
  const byArea = new Map<number, [number, number, number][]>();
  for (const lvId of levels) {
    const L = layout.levels[lvId], g = L.grid, d = field.dist[L.id];
    for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
      const i = g.idx(x, y);
      if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || d[i] < ENEMY_MIN_CELLS.start || !clearAround(g, x, y, 1)) continue;
      const a = layout.areas[g.area[i]];
      if (!a || (a.level ?? 0) !== L.id || a.role === 'stair' || zombieWeight(a) <= 0) continue;
      const [cx, cz] = g.center(x, y);
      if (nearKeep(field, L.id, cx, cz, LANDING_KEEP_M.enemy)) continue;
      let l = byArea.get(a.id);
      if (!l) byArea.set(a.id, (l = []));
      l.push([L.id, x, y]);
    }
  }
  const order = [...byArea.keys()].map(id => ({id, k: Math.pow(rng.next(), 1 / zombieWeight(layout.areas[id]))})).sort((p, q) => q.k - p.k).map(o => o.id);
  const perArea = new Map<number, number>();
  let placed = 0;
  for (const cap of [1, 2, 3]) {
    for (const id of order) {
      if (placed >= count) break;
      const a = layout.areas[id];
      if ((perArea.get(id) ?? 0) >= (a.kind === 'platform' ? cap + 1 : a.kind === 'closet' ? 1 : cap)) continue;
      const cells = byArea.get(id)!;
      for (let t = 0; t < 14; t++) {
        const [lv, x, y] = rng.pick(cells);
        const g = layout.levels[lv].grid;
        const [zx, zz] = g.center(x, y);
        if (layout.zombies.some(z => (z.level ?? 0) === lv && Math.hypot(z.x - zx, z.z - zz) < 4)) continue;
        perArea.set(id, (perArea.get(id) ?? 0) + 1);
        layout.zombies.push({x: zx, z: zz, yaw: rng.range(-Math.PI, Math.PI), type: types[placed], area: id, ...(lv ? {level: lv, y: g.floorOf(g.idx(x, y))} : {})});
        placed++;
        break;
      }
    }
  }
  return placed;
}

// ---------------------------------------------------------------------------------------------
// Loose floor supplies

const PUBLIC_FLOOR = PUBLIC_FLOOR_WEIGHTS.officeStorey;

/**
 * Loose supplies of the storeys `levels`; `street` = the station + lobby storeys (a rifle box, maybe shells). Task
 * loot-tables-20261030 (lane LOOT): the per-storey program is data (lootTables OFFICE_FLOOR) under the ONE office profile `loot`
 * (per logical level: no per-storey profile), interpreted in exactly the historical draw order.
 */
export function placeOfficeSupplies(layout: StationLayout, rng: Rng, field: SpawnField, levels: readonly number[], street: boolean, loot: LootProfile = lootProfile('office')): void {
  const on = new Set(levels);
  const used = new Set<string>();
  const weight = (a: Area, cat: 'ammo' | 'med'): number => {
    const p = purposeById(a.purpose);
    if (p) return p.floor?.[cat] ?? 0;
    return PUBLIC_FLOOR[a.type] ?? 0;
  };
  const cellsOf = (a: Area): [number, number, number][] => {
    const lv = a.level ?? 0, g = layout.levels[lv]?.grid, d = field.dist[lv];
    if (!g) return [];
    const out: [number, number, number][] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = g.idx(x, y);
      if (!g.walkable(x, y) || g.area[i] !== a.id || g.rampIdx[i] >= 0 || d[i] < 16 || used.has(`${lv}:${i}`)) continue;
      const [cx, cz] = g.center(x, y);
      if (nearKeep(field, lv, cx, cz, LANDING_KEEP_M.loot)) continue;
      let near = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!g.walkable(x + ox, y + oy)) near++;
      out.push([lv, x, y]);
      if (near) out.push([lv, x, y], [lv, x, y]);
    }
    return out;
  };
  const place = (itemId: string, count: number, pool: [Area, number][]): void => {
    if (!pool.length || !(itemId in ITEMS)) return;
    for (let t = 0; t < 10; t++) {
      const a = rng.weighted(pool);
      const cells = cellsOf(a);
      if (!cells.length) continue;
      const [lv, x, y] = rng.pick(cells);
      const g = layout.levels[lv].grid;
      used.add(`${lv}:${g.idx(x, y)}`);
      const [wx, wz] = g.center(x, y);
      const p: PickupPlacement = {itemId, count, x: wx + rng.range(-0.1, 0.1), y: lv ? g.floorOf(g.idx(x, y)) : 0, z: wz + rng.range(-0.1, 0.1), area: a.id};
      if (lv) p.level = lv;
      layout.pickups.push(p);
      return;
    }
  };
  const mine = layout.areas.filter(a => on.has(a.level ?? 0) && a.storefront === undefined && a.role !== 'stair' && !NO_SPAWN_TYPES.has(a.type));
  const pools = (cat: 'ammo' | 'med'): [Area, number][] => mine.map(a => [a, weight(a, cat)] as [Area, number]).filter(e => e[1] > 0);
  const ammo = pools('ammo'), med = pools('med');
  const light = mine.map(a => [a, FLOOR_ECONOMY.themeWeight[(purposeById(a.purpose)?.theme ?? 'public')]] as [Area, number]).filter(e => e[1] > 0);
  // Ammo: one box per storey (station + lobby: one rifle box and maybe shells — it is a small station), 9 mm leads in the tower.
  const tilt = street ? 'none' : floorTilt(layout, levels);
  const prog = loot.tables.floor.office;
  if (street) {
    const {box, extra} = prog.street;
    const [lo, hi] = floorCount(loot, econCat(box.itemId), [1, 1]);
    for (let i = 0, n = lo === hi ? lo : rng.int(lo, hi); i < n; i++) place(box.itemId, box.count, ammo);
    if (rng.chance(floorChance(loot, econCat(extra.itemId), extra.chance))) place(extra.itemId, extra.count, ammo);
  } else {
    // TENANTS: a security company's floor rarely lacks its box and leans to rifle / shells (same draw, shifted thresholds).
    // lane AMMO (knife-melee-20261030): caliber items (9mm / 5.56×45mm / 12-gauge) — lootTables OFFICE_FLOOR.
    const r = rng.next(), th = tilt === 'ammo' ? prog.tower.ammoThresholds : prog.tower.thresholds;
    const i = th.findIndex((t, k) => r < floorChance(loot, econCat(prog.tower.boxes[k].itemId), t));
    if (i >= 0) place(prog.tower.boxes[i].itemId, prog.tower.boxes[i].count, ammo);
  }
  const scarce = rng.fork('scarce-floor');
  const odds = scarceOdds(tilt, prog);
  const pMed = floorChance(loot, 'med', odds[0]), pBat = floorChance(loot, 'battery', odds[1]), pFlare = floorChance(loot, 'flare', odds[2]), pFood = floorChance(loot, 'food', odds[3]);
  if (scarce.chance(pMed)) place(scarce.chance(prog.scarce.medkit) ? 'medkit' : 'bandage', 1, med);
  if (scarce.chance(pBat)) place(BATTERY_ID, 1, light);
  if (scarce.chance(pFlare)) place(FLARE_ID, 1, light);
  if (pFood > 0 && scarce.chance(pFood)) place(scarce.pick(prog.scarce.food), 1, light);
}

// ---------------------------------------------------------------------------------------------
// Weapon finds (level-wide plan)

/** Which storey (1 = station + lobby, 2..8 = office floors) holds each copy of each non-start weapon (deterministic). */
export function officeWeaponPlan(levelSeed: number, start: StartWeaponId): Record<number, string[]> {
  const rng = new Rng(hashString(`office-weapons:${start}`, levelSeed >>> 0));
  const plan: Record<number, string[]> = Object.fromEntries(OFFICE_FLOORS.map(f => [f, []]));
  // The security office (lobby) and the upper floors weigh more.
  const w: [number, number][] = OFFICE_FLOORS.map((f, i) => [f, f === 1 ? 1.6 : 0.8 + i * 0.08]);
  for (const wid of findWeaponsFor(start)) {
    const r = rng.next();
    const n = r < 0.06 ? 0 : r < 0.86 ? 1 : 2;
    const taken = new Set<number>();
    for (let k = 0; k < n; k++) {
      const pool = w.filter(([s]) => !taken.has(s));
      const s = rng.weighted(pool.length ? pool : w);
      taken.add(s);
      plan[s].push(wid);
    }
  }
  return plan;
}

const FIND_W: Partial<Record<string, number>> = {
  'office-security': 4, 'office-storage': 2, 'office-exec': 2, 'office-server': 1.2, 'office-copy': 1, 'office-private': 0.8,
  // TENANTS: company rooms where a weapon plausibly turns up.
  'office-control': 4, 'office-armory': 4, 'office-vault': 2, 'office-archive': 1, 'office-mailroom': 1, 'office-workshop': 0.8, 'office-coldroom': 0.6,
  'agent-office': 2, 'storage': 2, 'utility': 1, 'office-break': 0.6, 'janitor-closet': 0.4, 'supply-closet': 0.6, 'electrical-closet': 0.4,
};

/** Places a storey's planned weapon finds (+ matching ammo beside each) at least `minCells` walking from the platform start. */
export function placeOfficeWeapons(layout: StationLayout, rng: Rng, weapons: readonly string[], field: SpawnField, levels: readonly number[], minCells: number): PickupPlacement[] {
  const placed: PickupPlacement[] = [];
  if (!weapons.length) return placed;
  const on = new Set(levels);
  const pool = layout.areas.filter(a => on.has(a.level ?? 0)).map(a => [a, FIND_W[a.purpose ?? a.type] ?? 0] as [Area, number]).filter(e => e[1] > 0);
  const gridOf = (lv: number): Grid => layout.levels[lv].grid;
  const clear1 = (g: Grid, x: number, y: number) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!g.walkable(x + ox, y + oy) || g.rampIdx[g.idx(x + ox, y + oy)] >= 0) return false;
    return true;
  };
  for (const wid of weapons) {
    for (let t = 0; t < 16; t++) {
      if (!pool.length) break;
      const a = rng.weighted(pool);
      const lv = a.level ?? 0, g = gridOf(lv), d = field.dist[lv];
      const cells: number[] = [];
      for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
        const i = g.idx(x, y);
        if (g.area[i] !== a.id || !g.walkable(x, y) || d[i] < minCells || !clear1(g, x, y)) continue;
        const [cx, cz] = g.center(x, y);
        if (layout.pickups.some(p => (p.level ?? 0) === lv && Math.hypot(p.x - cx, p.z - cz) < 1.2)) continue;
        cells.push(i);
      }
      if (!cells.length) continue;
      const i = rng.pick(cells);
      const [x, z] = g.center(i % g.w, (i / g.w) | 0);
      const p: PickupPlacement = {itemId: wid, count: 1, x, y: lv ? g.floorOf(i) : 0, z, area: a.id, ...(lv ? {level: lv} : {})};
      layout.pickups.push(p);
      placed.push(p);
      const [ammo, cnt] = WEAPON_FIND_AMMO[wid] ?? ['ammo_9mm', 15];
      const near = cells.filter(c => { const [cx, cz] = g.center(c % g.w, (c / g.w) | 0), dd = Math.hypot(cx - x, cz - z); return dd >= 0.9 && dd <= 2.4; });
      const q = near.length ? near[rng.int(0, near.length - 1)] : i;
      const [ax, az] = g.center(q % g.w, (q / g.w) | 0);
      const ap: PickupPlacement = {itemId: ammo, count: cnt, x: q === i ? ax + 0.25 : ax, y: p.y, z: az, area: a.id, ...(lv ? {level: lv} : {})};
      layout.pickups.push(ap);
      placed.push(ap);
      break;
    }
  }
  return placed;
}
