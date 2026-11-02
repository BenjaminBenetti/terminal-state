// Iteration 16 (lane GEAR): level-wide gear loot — rare character gear (items/gear.ts) for a whole LOGICAL level.
//
// rollLevelGear: ONE roll per logical level (the subway; the office tower as a whole, not per floor). The count is a
// Poisson(1) draw capped at GEAR_CAP_PER_LEVEL: mean ~1.0, zero in ~37 % of levels, two or more in ~26 %, five at most.
// Items are drawn by GEAR_WEIGHTS (a repeat of the same piece within one level is half as likely each time) and dealt
// to the level's sections uniformly. There is no guaranteed starter backpack (or any other piece).
// Seamless office (lane GEN): every level is ONE section ('main'), so the one roll lands in the one layout; its storeys are
// layout levels, and placement below works across all of them (shaft / elevator-landing exclusion on every tower storey, the
// spawn distance in 3D for the office, where the start is on the station platform far below the tower floors).
//
// placeGear: puts a section's assigned items into the layout as ordinary layout pickups (so the run's per-section memory
// of "layout pickup index taken" covers them) in plausible spots: back-of-house / storage / staff / office rooms, beside
// a locker / cabinet / shelf / crate / desk when the room has one, on a flat walkable floor cell reachable from the
// spawn, away from doorways, stairs and other pickups, never in passages, concourses, platforms or stair cores.
// A backpack placed this way becomes a grounded bag in game (gear/system.ts converts it: E opens it).
// Both are pure data and deterministic.
// Task mall-round3-20261031 (lane SHOPS, R6): a level whose loot profile carries a placement bias (LootTables.gearPlace: the mall's
// MALL_GEAR_PLACE) multiplies each area's spot weight by purpose / piece (gearPlaceFactor) — clothing / outdoors / sports / shoe /
// luggage / department stores and their stock rooms, per-piece affinities. No bias (the Subway / Office tables, the mask loot) =
// exactly the same pool and rng draws as before.

import {Rng, hashString} from '../core/rng';
import {CELL, FLOOR, type Grid} from './grid';
import {levelDistance} from './levelGen';
import type {Area, PickupPlacement, StationLayout} from './stationTypes';
import {GEAR_ITEMS} from '../items/gear';
import {GEAR_CAP_PER_LEVEL, GEAR_MEAN_PER_LEVEL, gearParams, lootProfile, type GearPlacement, type LootProfile} from '../items/lootTables';
import type {LevelId} from '../levels/types';
import {isExtensionArea} from './trackExt/types'; // Track 2 (lane GEN)
import {coreView, hasExtensionGrowth} from './trackExt/core';

/** Task gasmask-breach-20261030 (mask lane): `filter` = a found gas mask's seeded filter charge (s), copied onto its placement. */
export interface GearAssignment { itemId: string; filter?: number }

// Task loot-tables-20261030 (lane LOOT): the rarity data (mean / cap / weights) lives in items/lootTables.ts GEAR_LOOT (re-exported
// here as the same values); the roll reads it through the logical level's loot profile — still ONE roll per logical level.
export {GEAR_CAP_PER_LEVEL, GEAR_MEAN_PER_LEVEL, GEAR_WEIGHTS} from '../items/lootTables';
/** Minimum straight-line distance (m) of a gear find from the section's player spawn (3D for the office level). */
export const GEAR_MIN_SPAWN_M = 6;

/** Inverse-CDF Poisson(mean) draw from a uniform u in [0, 1), capped. */
export function gearCountFor(u: number, mean = GEAR_MEAN_PER_LEVEL, cap = GEAR_CAP_PER_LEVEL): number {
  let k = 0, p = Math.exp(-mean), cdf = p;
  while (u >= cdf && k < cap) {
    k++;
    p *= mean / k;
    cdf += p;
  }
  return k;
}

/**
 * The level-wide gear roll: section -> the gear items assigned to it. Every section key is present (possibly []).
 * Deterministic in (levelSeed, levelId, sections order). `profile`: the level's loot profile (default: that level's; its gear data
 * and overrides — the RNG key stays `gear-roll:${levelId}`, one roll per logical level).
 */
export function rollLevelGear(levelSeed: number, levelId: LevelId, sections: readonly string[], profile: LootProfile = lootProfile(levelId)): Record<string, GearAssignment[]> {
  const out: Record<string, GearAssignment[]> = {};
  for (const s of sections) out[s] = [];
  if (!sections.length) return out;
  const g = gearParams(profile);
  const rng = new Rng(hashString(`gear-roll:${levelId}`, (levelSeed >>> 0) ^ 0x6a09e667));
  const n = gearCountFor(rng.next(), g.mean, g.cap);
  const w: Record<string, number> = {...g.weights};
  for (const id of Object.keys(w)) if (!GEAR_ITEMS[id] || !(w[id] > 0)) delete w[id];
  for (let k = 0; k < n && Object.keys(w).length; k++) {
    const itemId = rng.weighted(Object.entries(w));
    w[itemId] *= 0.5;
    const section = sections[Math.min(sections.length - 1, Math.floor(rng.next() * sections.length))];
    out[section].push({itemId});
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Placement

/** Back-of-house purposes (gen/purposes.ts) and their weight as a gear spot. */
const PURPOSE_W: Record<string, number> = {
  'security-office': 3, 'locker-room': 3, 'lost-property': 3, 'storage': 2.5, 'staff-room': 2, 'workshop': 2,
  'revenue-room': 1.5, 'agent-office': 1.5, 'first-aid-room': 1.5, 'stock-room': 1.5, 'supply-closet': 1.2,
  'electrical-room': 1, 'signal-room': 1, 'custodial-room': 1, 'janitor-closet': 1, 'pump-room': 0.8,
  'electrical-closet': 0.6, 'service-corridor': 0.5, 'washroom': 0.4,
};
const TYPE_W: Partial<Record<string, number>> = {
  'storage': 2, 'crew-room': 2, 'stock-room': 1.5, 'agent-office': 1.5, 'utility': 1, 'supply-closet': 1, 'janitor-closet': 1,
  'service-corridor': 0.5, 'washroom': 0.4, 'shop': 0.4, 'eatery': 0.25,
  // office tower (lane WORLD-GEN, gen/office/*): enclosed rooms by purpose below; the lobby hall is a public reception space
  'office-room': 1, 'office-open': 0.9, 'office-lobby': 0.3,
};
/** Office room purposes (gen/office/tower.ts ROOM_INFO): storage and back rooms first, open-plan / meeting rooms rarely. */
const OFFICE_PURPOSE_W: Record<string, number> = {
  'office-storage': 3, 'office-copy': 1.8, 'office-server': 1.6, 'office-break': 1.6, 'office-exec': 1.6, 'office-private': 1.3,
  'office-open': 0.9, 'office-meeting': 0.6,
};
/** Unknown future room words -> weight factor (only ever raises a weight). */
const WORD_W: [RegExp, number][] = [
  [/storage|supply|store ?room|locker|closet|archive|janitor/i, 3],
  [/security|guard|facilit|maint/i, 3],
  [/server|copy|mail|break|kitchen|pantry|lounge|staff/i, 1.6],
  [/cubicle|open-plan|workstation|bullpen/i, 1],
  [/meeting|conference|board/i, 0.6],
  [/reception|lobby|waiting/i, 0.3],
];
/** Never: walkways and vertical circulation. */
const EXCLUDED = /stair|elevator|lift|escalator|landing|passage|underpass|concourse|platform|fare-hall|exit|corridor-public|walkway|bridge|catwalk|crossover|overlook/i;
/** Props a find is put beside. */
const ANCHOR = /locker|cabinet|shelf|crate|safe|carton|rack|filing|desk|counter|bench|table|stock/i;

/** How likely an area is to hold a gear find (0 = never). Exported for tests. */
export function gearAreaWeight(a: Area): number {
  // Track 2 (lane GEN): the level's ONE gear roll stays in the core station (track tunnels / service annexes never multiply it).
  if (isExtensionArea(a)) return 0;
  if (a.kind === 'platform' || a.kind === 'passage' || a.kind === 'concourse') return 0;
  if (a.storefront !== undefined && a.type !== 'shop' && a.type !== 'eatery') return 0;
  const words = `${a.type} ${a.role ?? ''} ${a.purpose ?? ''}`;
  if (a.role === 'stair' || a.type === 'stair-core' || a.type === 'exit-stair' || EXCLUDED.test(words)) return 0;
  const known = a.purpose ? PURPOSE_W[a.purpose] ?? OFFICE_PURPOSE_W[a.purpose] : undefined;
  if (known !== undefined) return known;
  let w = TYPE_W[a.type] ?? (a.publicSpace ? 0.25 : 1);
  for (const [re, f] of WORD_W) if (re.test(`${words} ${a.label}`)) { w = Math.max(w, f * (a.publicSpace ? 0.4 : 1)); break; }
  return w;
}

/**
 * Task mall-round3-20261031 (lane SHOPS, R6): the placement-bias multiplier of area `a` for gear piece `itemId` under a level's
 * LootTables.gearPlace (1 without a bias / purpose entry). Applied only to areas gearAreaWeight already allows. Exported for tests.
 */
export function gearPlaceFactor(place: GearPlacement | undefined, a: Area, itemId: string): number {
  if (!place || !a.purpose) return 1;
  return (place.purposes[a.purpose] ?? 1) * (place.items?.[itemId]?.[a.purpose] ?? 1);
}

/**
 * Deterministic placement with the canonical rng (the levels registry calls this once per generated section). `profile`: the logical
 * level's loot profile (lane SHOPS, R6: its LootTables.gearPlace bias, if any; absent / no bias = the unbiased placement).
 */
export function placeSectionGear(layout: StationLayout, items: readonly GearAssignment[] | undefined, profile?: LootProfile): PickupPlacement[] {
  if (!items?.length) return [];
  return placeGear(layout, items, new Rng(hashString('gear-place', (layout.seed >>> 0) ^ 0x3c6ef372)), profile);
}

/**
 * Appends `items` to `layout.pickups` (count 1 each) in plausible spots; returns the placements (fewer only if the
 * layout has no reachable floor cell at all). Deterministic for (layout, items, rng seed, profile). `profile` (lane SHOPS, R6): its
 * placement bias (LootTables.gearPlace) weighs the area choice; without one the draws are exactly the unbiased ones. Task
 * reactor-playtest-round2-20261102 (lane GAS): `opts.areaOk` keeps the finds out of areas it rejects (every pool and fallback; the
 * Reactor's mask loot: never in the jammed gas zone). Absent = exactly the previous draws.
 */
export function placeGear(layout: StationLayout, items: readonly GearAssignment[], rng: Rng, profile?: LootProfile, opts?: {areaOk?(a: Area): boolean}): PickupPlacement[] {
  const place = profile?.tables.gearPlace;
  // Track 2 (lane GEN): a layout whose track extensions grew / translated its grid places its gear in the CORE frame (gen/trackExt
  // coreView: the station exactly as without them), so every choice — areas, cells, anchor-distance ties — is main's; the
  // placements are then translated back into the layout.
  const ext = layout.extensions;
  if (ext && items.length && hasExtensionGrowth(layout)) {
    const core = coreView(layout);
    const out = placeGearIn(core, items, rng, place, opts?.areaOk).map(p => ({...p, x: p.x + ext.shift.x, z: p.z + ext.shift.z}));
    layout.pickups.push(...out);
    return out;
  }
  return placeGearIn(layout, items, rng, place, opts?.areaOk);
}

function placeGearIn(layout: StationLayout, items: readonly GearAssignment[], rng: Rng, place?: GearPlacement, areaOk?: (a: Area) => boolean): PickupPlacement[] {
  const placed: PickupPlacement[] = [];
  if (!items.length) return placed;
  const levels = layout.levels?.length ? layout.levels : [{id: 0, role: 'main' as const, grid: layout.grid, baseY: 0}];
  const g0 = layout.grid, W = g0.w;
  const gridOf = (lv: number): Grid => levels[lv]?.grid ?? g0;
  type Box = {x0: number; z0: number; x1: number; z1: number};
  const office = (layout as {office?: {start?: {x: number; z: number; level: number}; elevator?: {cab?: Box; shaft?: Box; doorSide?: string; stops?: {levelId: number}[]}}}).office;
  const sp = (office?.start ?? layout.playerSpawn) as {x: number; z: number; level?: number};
  const spLevel = sp.level ?? 0;
  const [sx, sy] = g0.cellOf(sp.x, sp.z);
  let dist: Int32Array[];
  try { dist = levelDistance(levels, sx, sy, spLevel); } catch { dist = [g0.distanceField(sx, sy)]; }
  // reachability is known when the spawn cell seeded the search (else: any walkable cell, e.g. a spawn on a special cell)
  const reachKnown = dist.some(d => d && d.some(v => v >= 0));
  // The elevator shaft (+ 0.6 m) and the landing strip in front of its door (1.6 m) on every storey it serves: no gear there.
  const shaft = office?.elevator?.shaft ?? office?.elevator?.cab;
  const stopLevels = new Set(office?.elevator?.stops?.map(q => q.levelId) ?? []);
  const doorSide = office?.elevator?.doorSide ?? 'N';
  const inCab = (lv: number, x: number, z: number) => {
    if (!shaft || (stopLevels.size && !stopLevels.has(lv))) return false;
    const m = 0.6, fr = 1.6;
    return x > shaft.x0 - m - (doorSide === 'W' ? fr : 0) && x < shaft.x1 + m + (doorSide === 'E' ? fr : 0)
      && z > shaft.z0 - m - (doorSide === 'N' ? fr : 0) && z < shaft.z1 + m + (doorSide === 'S' ? fr : 0);
  };
  // Spawn distance: straight line on the Subway (unchanged), in 3D for the office (other storeys are metres above the start).
  const spY = office ? gridOf(spLevel).floorAt(sp.x, sp.z) : 0;
  const spawnDist = (lv: number, i: number, x: number, z: number) => (office ? Math.hypot(x - sp.x, z - sp.z, gridOf(lv).floorOf(i) - spY) : Math.hypot(x - sp.x, z - sp.z));
  const doorZone = levels.map(L => {
    const m = new Uint8Array(W * g0.h);
    for (const d of layout.doors) {
      if ((d.level ?? layout.areas[d.a]?.level ?? 0) !== L.id) continue;
      for (let y = d.y - 2; y < d.y + d.h + 2; y++) for (let x = d.x - 2; x < d.x + d.w + 2; x++) if (L.grid.inBounds(x, y)) m[L.grid.idx(x, y)] = 1;
    }
    return m;
  });
  const clear1 = (g: Grid, x: number, y: number) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!g.walkable(x + ox, y + oy) || g.rampIdx[g.idx(x + ox, y + oy)] >= 0) return false;
    return true;
  };
  // (Track 2, lane CONTENT: a service annex's own loose finds — behind rock, appended before the gear — never move a gear spot)
  const near = (lv: number, x: number, z: number, r: number) => layout.pickups.some(p => (p.level ?? 0) === lv && !isExtensionArea(layout.areas[p.area]) && Math.hypot(p.x - x, p.z - z) < r);
  const cellOk = (a: Area | null, lv: number, i: number, strict: boolean): boolean => {
    const g = gridOf(lv), dl = dist[lv];
    if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) return false;
    const x = i % W, y = (i / W) | 0;
    if (!g.walkable(x, y)) return false;
    if (a && g.area[i] !== a.id) return false;
    if (reachKnown && (!dl || dl[i] < 0)) return false;
    const [cx, cz] = g.center(x, y);
    if (inCab(lv, cx, cz)) return false;
    if (strict) {
      if (doorZone[lv]?.[i] || !clear1(g, x, y)) return false;
      if (spawnDist(lv, i, cx, cz) < GEAR_MIN_SPAWN_M) return false;
      if (near(lv, cx, cz, 1.2)) return false;
    }
    return true;
  };
  const cellsOf = (a: Area, strict: boolean): number[] => {
    const lv = a.level ?? 0, g = gridOf(lv), out: number[] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      if (!g.inBounds(x, y)) continue;
      const i = g.idx(x, y);
      if (cellOk(a, lv, i, strict)) out.push(i);
    }
    return out;
  };
  /** Up to 3 best cells beside an anchor prop (0.35-1.4 m from its footprint), else any clear cell. */
  const pickCell = (a: Area, cells: number[]): number => {
    const lv = a.level ?? 0, g = gridOf(lv);
    const anchors = layout.props.filter(p => p.area === a.id && (p.level ?? 0) === lv && ANCHOR.test(p.kind as string));
    if (anchors.length) {
      const scored: [number, number][] = [];
      for (const c of cells) {
        const [x, z] = g.center(c % W, (c / W) | 0);
        let best = Infinity;
        for (const p of anchors) {
          const dx = Math.max(0, Math.abs(x - p.x) - (p.hx ?? 0.3)), dz = Math.max(0, Math.abs(z - p.z) - (p.hz ?? 0.3));
          const d = Math.hypot(dx, dz);
          if (d >= 0.35 && d <= 1.4 && d < best) best = d;
        }
        if (best < Infinity) scored.push([c, best]);
      }
      if (scored.length) {
        scored.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
        return rng.pick(scored.slice(0, 3))[0];
      }
    }
    return rng.pick(cells);
  };
  const put = (lv: number, a: Area | null, i: number, it: GearAssignment): void => {
    const g = gridOf(lv);
    const [x, z] = g.center(i % W, (i / W) | 0);
    const p: PickupPlacement = {itemId: it.itemId, count: 1, x, y: g.floorOf(i), z, area: a?.id ?? g.area[i], ...(lv ? {level: lv} : {}), ...(it.filter !== undefined ? {filter: it.filter} : {})};
    layout.pickups.push(p);
    placed.push(p);
  };
  const pool = layout.areas.map(a => [a, gearAreaWeight(a)] as [Area, number]).filter(e => e[1] > 0 && (!areaOk || areaOk(e[0]))); // (lane GAS: + areaOk)
  const used = new Set<number>();
  for (const it of items) {
    let done = false;
    // (lane SHOPS, R6) the level's placement bias for this piece; none = the SAME pool (identical draws). Fallbacks stay unbiased.
    const choice = place ? pool.map(([a, w]) => [a, w * gearPlaceFactor(place, a, it.itemId)] as [Area, number]).filter(e => e[1] > 0) : pool;
    for (let t = 0; t < 16 && !done && choice.length; t++) {
      const fresh = choice.filter(([a]) => !used.has(a.id));
      const a = rng.weighted(fresh.length ? fresh : choice);
      const cells = cellsOf(a, true);
      if (!cells.length) continue;
      put(a.level ?? 0, a, pickCell(a, cells), it);
      used.add(a.id);
      done = true;
    }
    if (done) continue;
    // fallback 1: any non-excluded area, relaxed spacing; fallback 2: any reachable floor cell of the layout
    for (const [a] of pool) {
      const cells = cellsOf(a, false);
      if (cells.length) { put(a.level ?? 0, a, rng.pick(cells), it); done = true; break; }
    }
    if (done) continue;
    for (const L of levels) {
      const g = L.grid, cells: number[] = [];
      for (let i = 0; i < g.cells.length; i++) {
        const a = layout.areas[g.area[i]];
        if (cellOk(null, L.id, i, false) && (!a || (gearAreaWeight(a) > 0 && (!areaOk || areaOk(a))))) cells.push(i); // (lane GAS: + areaOk)
      }
      if (cells.length) { const i = rng.pick(cells); put(L.id, layout.areas[g.area[i]] ?? null, i, it); break; }
    }
  }
  return placed;
}

/** Cell size re-export for tests (gear spacing is in metres). */
export const GEAR_CELL = CELL;
