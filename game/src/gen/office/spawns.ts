// Iteration 16 (WORLD-GEN): enemies, loose floor supplies and weapon finds of an office section. Pure data.
//
// Modest density (the user: "not one full Subway population per floor"): 5-8 enemies in the street section (station + lobby),
// 3-6 per office floor, drawn from the same spawn rules as the station (shambler / coated 60 / 40, per-spawn archetype pick in
// ai/creatureSpawn.ts keeps the ~5 % rat / dog), spread over areas by the station's area weights, never within reach of the
// arrival points (platform spawn, elevator cab, stairwell door). Loose supplies scale the station's floor economy
// (items/lootEconomy.ts FLOOR_ECONOMY) to one section of a ~1-Subway-sized level: about one ammo box per section, a ~1-in-5
// dressing / kit, a torch battery or flare now and then — the established scarcity, room purposes deciding where.
// Weapon finds are planned ONCE per level (officeWeaponPlan: which section holds which non-start weapon), so the whole tower
// holds what one station would (0-2 per weapon), each found in a plausible room far from the arrivals.

import {Rng, hashString} from '../../core/rng';
import {CELL, FLOOR, type Grid} from '../grid';
import {levelDistance} from '../levelGen';
import {purposeById} from '../purposes';
import {clearAround} from '../stationDress';
import {BATTERY_ID, FLARE_ID, FLOOR_ECONOMY} from '../../items/lootEconomy';
import {ITEMS} from '../../items/items';
import {WEAPON_FIND_AMMO, findWeaponsFor, type StartWeaponId} from '../weaponFinds';
import type {Area, PickupPlacement, StationLayout, ZombieType} from '../stationTypes';
import {OFFICE_SECTIONS} from './frame';
import type {CarvedTower} from './tower';

export const OFFICE_ENEMIES = {street: [5, 8] as const, floor: [3, 6] as const};
/** Path distance (cells) every enemy keeps from the arrival points: platform spawn (street), elevator / stair arrivals. */
export const ENEMY_MIN_CELLS = {start: 36, arrival: 20};

export interface SpawnSources { cells: {level: number; x: number; y: number; min: number}[] }

/** Multi-level walking distance from several sources; per level, the min over sources of (dist - their keep-out). */
function keepOut(layout: StationLayout, src: SpawnSources): Int32Array[] {
  const out = layout.levels.map(L => new Int32Array(L.grid.cells.length).fill(-1 << 20));
  const reach = layout.levels.map(L => new Uint8Array(L.grid.cells.length));
  for (const s of src.cells) {
    const d = levelDistance(layout.levels, s.x, s.y, s.level);
    d.forEach((arr, L) => {
      const o = out[L], r = reach[L];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] < 0) continue;
        const slack = arr[i] - s.min;
        if (!r[i]) { r[i] = 1; o[i] = slack; } else if (slack < o[i]) o[i] = slack;
      }
    });
  }
  out.forEach((o, L) => { for (let i = 0; i < o.length; i++) if (!reach[L][i]) o[i] = -1 << 20; });
  return out;
}

const zombieWeight = (a: Area): number => a.kind === 'platform' ? 2.2 : a.type === 'exit-stair' || a.type === 'washroom' ? 0.5
  : a.type === 'office-elevator' || a.type === 'office-stair' || a.type === 'stair-core' ? 0
  : a.type === 'eatery' || a.type === 'shop' ? 0.5 : a.kind === 'closet' ? 0.5 : a.type === 'office-open' ? 1.6 : a.publicSpace ? 1 : 1.3;

export function placeOfficeEnemies(layout: StationLayout, rng: Rng, src: SpawnSources, range: readonly [number, number]): void {
  const count = rng.int(range[0], range[1]);
  const slack = keepOut(layout, src);
  const types: ZombieType[] = [];
  for (let i = 0; i < count; i++) types.push(rng.chance(0.4) ? 'coated' : 'shambler');
  if (!types.includes('coated')) types[0] = 'coated';
  if (count > 1 && !types.includes('shambler')) types[1] = 'shambler';
  const byArea = new Map<number, [number, number, number][]>();
  for (const L of layout.levels) {
    const g = L.grid, sl = slack[L.id];
    for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
      const i = g.idx(x, y);
      if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || sl[i] < 0 || !clearAround(g, x, y, 1)) continue;
      const a = layout.areas[g.area[i]];
      if (!a || (a.level ?? 0) !== L.id || a.role === 'stair' || zombieWeight(a) <= 0) continue;
      let l = byArea.get(a.id);
      if (!l) byArea.set(a.id, (l = []));
      l.push([L.id, x, y]);
    }
  }
  const order = [...byArea.keys()].map(id => ({id, k: Math.pow(rng.next(), 1 / zombieWeight(layout.areas[id]))})).sort((p, q) => q.k - p.k).map(o => o.id);
  const perArea = new Map<number, number>();
  for (const cap of [1, 2]) {
    for (const id of order) {
      if (layout.zombies.length >= count) break;
      const a = layout.areas[id];
      if ((perArea.get(id) ?? 0) >= (a.kind === 'platform' ? cap + 1 : a.kind === 'closet' ? 1 : cap)) continue;
      const cells = byArea.get(id)!;
      for (let t = 0; t < 14; t++) {
        const [lv, x, y] = rng.pick(cells);
        const g = layout.levels[lv].grid;
        const [zx, zz] = g.center(x, y);
        if (layout.zombies.some(z => (z.level ?? 0) === lv && Math.hypot(z.x - zx, z.z - zz) < 4)) continue;
        perArea.set(id, (perArea.get(id) ?? 0) + 1);
        layout.zombies.push({x: zx, z: zz, yaw: rng.range(-Math.PI, Math.PI), type: types[layout.zombies.length], area: id, ...(lv ? {level: lv, y: g.floorOf(g.idx(x, y))} : {})});
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Loose floor supplies

const PUBLIC_FLOOR: Partial<Record<string, number>> = {'fare-hall': 0.4, 'concourse': 0.4, 'passage': 0.25, 'platform': 0.5, 'exit-stair': 0.2};

export function placeOfficeSupplies(layout: StationLayout, rng: Rng, src: SpawnSources, street: boolean): void {
  const slack = keepOut(layout, {cells: src.cells.map(c => ({...c, min: 16}))});
  const used = new Set<string>();
  const weight = (a: Area, cat: 'ammo' | 'med'): number => {
    const p = purposeById(a.purpose);
    if (p) return p.floor?.[cat] ?? 0;
    return PUBLIC_FLOOR[a.type] ?? 0;
  };
  const cellsOf = (a: Area): [number, number, number][] => {
    const lv = a.level ?? 0, g = layout.levels[lv]?.grid;
    if (!g) return [];
    const out: [number, number, number][] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = g.idx(x, y);
      if (!g.walkable(x, y) || g.area[i] !== a.id || g.rampIdx[i] >= 0 || slack[lv][i] < 0 || used.has(`${lv}:${i}`)) continue;
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
      if (a.role === 'stair' || a.type === 'stair-core' || a.type === 'office-elevator') continue;
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
  const pools = (cat: 'ammo' | 'med'): [Area, number][] => layout.areas.filter(a => a.storefront === undefined).map(a => [a, weight(a, cat)] as [Area, number]).filter(e => e[1] > 0);
  const ammo = pools('ammo'), med = pools('med');
  const light = layout.areas.filter(a => a.storefront === undefined && a.type !== 'stair-core').map(a => [a, FLOOR_ECONOMY.themeWeight[(purposeById(a.purpose)?.theme ?? 'public')]] as [Area, number]).filter(e => e[1] > 0);
  // Ammo: one box per section (street: one rifle box and maybe shells — it is a small station), 9 mm leads in the tower.
  if (street) {
    place('ammo_rifle', 30, ammo);
    if (rng.chance(0.6)) place('ammo_shells', 8, ammo);
  } else {
    const r = rng.next();
    if (r < 0.55) place('ammo_pistol', 15, ammo); else if (r < 0.8) place('ammo_rifle', 30, ammo); else if (r < 0.93) place('ammo_shells', 8, ammo);
  }
  const scarce = rng.fork('scarce-floor');
  if (scarce.chance(FLOOR_ECONOMY.medKeep * 1.5)) place(scarce.chance(0.3) ? 'medkit' : 'bandage', 1, med);
  if (scarce.chance(0.35)) place(BATTERY_ID, 1, light);
  if (scarce.chance(0.14)) place(FLARE_ID, 1, light);
}

// ---------------------------------------------------------------------------------------------
// Weapon finds (level-wide plan)

/** Which section holds each copy of each non-start weapon (deterministic per level seed + start weapon). */
export function officeWeaponPlan(levelSeed: number, start: StartWeaponId): Record<string, string[]> {
  const rng = new Rng(hashString(`office-weapons:${start}`, levelSeed >>> 0));
  const plan: Record<string, string[]> = Object.fromEntries(OFFICE_SECTIONS.map(s => [s, []]));
  // Security office (lobby / street) and the upper floors weigh more.
  const w: [string, number][] = OFFICE_SECTIONS.map((s, i) => [s, s === 'street' ? 1.6 : 0.8 + i * 0.08]);
  for (const wid of findWeaponsFor(start)) {
    const r = rng.next();
    const n = r < 0.06 ? 0 : r < 0.86 ? 1 : 2;
    const taken = new Set<string>();
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
  'agent-office': 2, 'storage': 2, 'utility': 1, 'office-break': 0.6, 'janitor-closet': 0.4, 'supply-closet': 0.6, 'electrical-closet': 0.4,
};

/** Places this section's planned weapon finds (+ matching ammo beside each) at least `minCells` from the arrivals. */
export function placeOfficeWeapons(layout: StationLayout, rng: Rng, weapons: readonly string[], src: SpawnSources, minCells: number, tower: CarvedTower): PickupPlacement[] {
  const placed: PickupPlacement[] = [];
  if (!weapons.length) return placed;
  const slack = keepOut(layout, {cells: src.cells.map(c => ({...c, min: minCells}))});
  const pool = layout.areas.map(a => [a, FIND_W[a.purpose ?? a.type] ?? 0] as [Area, number]).filter(e => e[1] > 0);
  const gridOf = (lv: number): Grid => layout.levels[lv].grid;
  const clear1 = (g: Grid, x: number, y: number) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!g.walkable(x + ox, y + oy) || g.rampIdx[g.idx(x + ox, y + oy)] >= 0) return false;
    return true;
  };
  for (const wid of weapons) {
    for (let t = 0; t < 16; t++) {
      if (!pool.length) break;
      const a = rng.weighted(pool);
      const lv = a.level ?? 0, g = gridOf(lv);
      const cells: number[] = [];
      for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
        const i = g.idx(x, y);
        if (g.area[i] !== a.id || !g.walkable(x, y) || slack[lv][i] < 0 || !clear1(g, x, y)) continue;
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
      const [ammo, cnt] = WEAPON_FIND_AMMO[wid] ?? ['ammo_pistol', 15];
      const near = cells.filter(c => { const [cx, cz] = g.center(c % g.w, (c / g.w) | 0), dd = Math.hypot(cx - x, cz - z); return dd >= 0.9 && dd <= 2.4; });
      const q = near.length ? near[rng.int(0, near.length - 1)] : i;
      const [ax, az] = g.center(q % g.w, (q / g.w) | 0);
      const ap: PickupPlacement = {itemId: ammo, count: cnt, x: q === i ? ax + 0.25 : ax, y: p.y, z: az, area: a.id, ...(lv ? {level: lv} : {})};
      layout.pickups.push(ap);
      placed.push(ap);
      break;
    }
  }
  void tower;
  void CELL;
  return placed;
}
