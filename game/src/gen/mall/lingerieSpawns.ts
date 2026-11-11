// Task mall-lingerie-20261102-221554 (lane CONTEXT): the STORE-LOCAL spawns of the mall's optional lingerie store.
//
// User: "make store-local ordinary-zombie variants using these specific bodies dressed in the supplied lingerie designs … Spawn these
// variants inside this store, especially in the changing area." Only when the seeded mall HAS a lingerie store (lane STORE: program
// 'lingerie', purpose 'mall-lingerie', LARGE lots only, never guaranteed) this pass adds ONE run of the spawn profile's 'lingerie'
// zone context (ai/spawnTables.ts LINGERIE_CONTEXT, U{3..5} per store) inside that store and nowhere else:
//  - most of the run in the store's walk-in changing area (MallShop.changing: one rect per booth + the aisle), spread one per booth
//    first; floor(count / 3) on its own sales floor (3 -> 2 + 1, 4 -> 3 + 1, 5 -> 4 + 1); a part that does not fit moves to the
//    other group;
//  - only walkable FLOOR of the store's own sales floor (props block: gen/grid.ts walkable), reachable and >= 36 walking cells from
//    the start (the mall's validation rule), 5 m off the storey's landings, >= 4 m from the shopfront(s) (no point-blank entry):
//    in a BOOTH (a changing rect with <= 4 opening cells: its curtain gap) the centre of a 2 x 2 patch of its cells off the opening
//    row (lane STORE's booths are 2 cells wide x 3 deep: the back 2 x 2, on the booth's centre line); the AISLE hosts nobody while
//    there are booths (nobody waits in front of a booth door or blocks the way to the closed end); the sales floor: cells 3 x 3
//    clear, > 2 cells off the changing area and >= 2 m from its mouth (MallShop.changingEntry); everywhere a 0.5 m disc never splits
//    the storey (spawnTables sealsPassage) and 1.4 m from every enemy already on the storey;
//  - every spawn is an ordinary zombie (the context's own pool: zombie only, via the ONE assignEnemyArchetypes of the generator),
//    type 'shambler' (no coat roll: the look is the lingerie set), tagged ZombieSpawn.look 'lingerie' and the context 'lingerie';
//  - APPENDED after every other spawn of the level (ambient, hordes, annex 'service'): every existing spawn index — its family roll,
//    wardrobe look, kill memory — is unchanged; on its own rng fork (drawn from only when a store exists), so a mall WITHOUT a lingerie
//    store is byte-identical to one generated without this pass.
// The AI is the ordinary zombie's: no leash, despawn or teleport — after aggro a variant may follow the player out of the store.
// (Task gameplay-feedback-20261111, lane SPAWNS: while a variant stands inside the store its random walk targets — idle wander,
// search spots — stay in the store: its wander home, ai/wanderHome.ts; before, the unbounded idle wander walked most variants out
// of the store within ~3 minutes with nobody near.)

import type {Rng} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {levelDistance} from '../levelGen';
import {clearAround} from '../stationDress';
import type {StationLayout} from '../stationTypes';
import type {MallRect, MallShop} from './mallTypes';
import {markSpawnContext, reportSpawnCandidates, sealsPassage, type SpawnContextRule, type SpawnProfile} from '../../ai/spawnTables';

/** Lane STORE's contract: the lingerie store's program id and sales-floor purpose (gen/mall/shops.ts MALL_PROGRAMS.lingerie). */
export const LINGERIE_PROGRAM = 'lingerie';
export const LINGERIE_PURPOSE = 'mall-lingerie';
/** The spawn-context / look tag of the store-local variants (ZombieSpawn.look, SpawnContextId). */
export const LINGERIE_LOOK = 'lingerie' as const;
/** Lingerie stores per mall at most (lane STORE: MALL_PROGRAMS.lingerie.count max 1) = the zone context's runs per level. */
export const LINGERIE_STORES_MAX = 1;

/** The store-specific placement rules on top of the context's PlacementRules (LINGERIE_PLACEMENT). */
export const LINGERIE_SPAWN_RULES = {
  /** Sales-floor share of a run: floor(count / floorEvery); the rest in the changing area. */
  floorEvery: 3,
  /** Straight-line keep-off (m) of every spawn from the store's shopfront(s): no point-blank variant at the entrance. */
  entryKeepM: 4,
  /** Fair passage (m): a disc of this radius around a spawn never splits the storey's walkable floor (spawnTables sealsPassage). */
  passageRadiusM: 0.5,
  /** Sales-floor spawns stay more than this many cells (Chebyshev) off every changing-area cell: its mouth / booth fronts stay clear. */
  changingMarginCells: 2,
  /**
   * A changing rect with 1..this many OPENING cells (a walkable neighbour outside the rect: the curtain gap, <= 2 m) is a BOOTH: a
   * variant stands on the centre of a 2 x 2 patch of its cells off the opening row (lane STORE's booths are 2 cells wide x 3 deep:
   * its back 2 x 2). A rect with more (the aisle past the booths) hosts nobody while the store has booths (nobody waits in front of
   * a booth door or blocks the way to the closed end); without booths only cells off and not next to its openings.
   */
  boothOpeningCells: 4,
  /** Sales-floor spawns keep this straight-line distance (m) from the changing area's mouth (MallShop.changingEntry: the free turn). */
  changingEntryKeepM: 2,
} as const;

/** A lingerie store's shop record (lane STORE: MallShop.changing rects of its walk-in changing area, changingEntry its mouth). */
export type LingerieShop = MallShop;

/** True for the mall's lingerie store (lane STORE's program / purpose). */
export function isLingerieStore(s: MallShop): boolean {
  return (s.program as string) === LINGERIE_PROGRAM || s.fit?.purpose === LINGERIE_PURPOSE;
}

/** The lingerie stores of a layout (0 or 1: the program is optional and capped at one per mall). */
export function lingerieStores(layout: Pick<StationLayout, 'mall'>): LingerieShop[] {
  return (layout.mall?.shops ?? []).filter(isLingerieStore) as LingerieShop[];
}

/**
 * The store's OWN areas (task gameplay-feedback-20261111, lane SPAWNS: its variants' wander home, ai/wanderHome.ts): its sales floor
 * + every area of its purpose on its storey (a changing area carved as its own room) — never its stock room or a public walkway
 * (the floor placeStore's `own` set may place on).
 */
export function lingerieStoreAreas(layout: Pick<StationLayout, 'areas'>, shop: LingerieShop): Set<number> {
  const own = new Set<number>([shop.area]);
  const purpose = shop.fit?.purpose ?? layout.areas[shop.area]?.purpose;
  if (purpose !== undefined) {
    for (const a of layout.areas) if (a.purpose === purpose && (a.level ?? 0) === shop.level && a.id !== shop.backroom && !a.publicSpace) own.add(a.id);
  }
  return own;
}

/** One store run (QA / tests). */
export interface LingerieStoreReport {
  shop: string;
  level: number;
  /** Drawn count (U{context count}) and its split (changing quota / sales-floor quota). */
  count: number;
  quota: {changing: number; floor: number};
  /** Placed spawns: total, in the changing area, on the sales floor. */
  placed: number;
  changing: number;
  floor: number;
  /** Eligible stand points: per changing rect (booths / aisle) and on the sales floor; booth rects recognised. */
  candidates: {changing: number[]; floor: number};
  booths: number;
  /** Index of the first spawn of this run in layout.zombies (-1 = none placed). */
  first: number;
}
/** The last generated layout's store runs (QA / tests). */
export const LINGERIE_SPAWN_STATS: {stores: LingerieStoreReport[]} = {stores: []};

/**
 * The store-local run(s): one per lingerie store, after every other spawn of the level (call it right before
 * assignEnemyArchetypes). `keep` = the storeys' keep points (world metres; the mall's run mouths / elevator landings). Reads the
 * profile's 'lingerie' context on every call (absent = no store-local spawns); draws from `rng` only when a store exists.
 */
export function placeLingerieSpawns(layout: StationLayout, rng: Rng, keep: readonly {level: number; x: number; z: number}[], profile: SpawnProfile): LingerieStoreReport[] {
  const ctx = profile.contexts.lingerie;
  const reports: LingerieStoreReport[] = [];
  LINGERIE_SPAWN_STATS.stores = reports;
  const stores = lingerieStores(layout);
  if (!ctx || ctx.count[1] <= 0 || !stores.length) return reports;
  // walking distance from the player start over the FINAL grids (Track 2's extensions may have re-framed them since the core
  // populations: their distance field indexes the old grid)
  const st = layout.mall?.start ?? {...layout.playerSpawn, level: 0};
  const [sx, sy] = layout.levels[st.level].grid.cellOf(st.x, st.z);
  const dist = levelDistance(layout.levels, sx, sy, st.level, layout.levelLinks);
  const first = layout.zombies.length;
  for (const shop of stores) reports.push(placeStore(layout, shop, rng.fork(`store:${shop.id}`), ctx, dist, keep));
  if (layout.zombies.length > first) markSpawnContext(layout, first, 'lingerie');
  return reports;
}

/**
 * Re-tags the store-local spawns after records before them were removed (gen/trackExt dropExtensions drops the annex 'service'
 * spawns: the context side table is per index). They are always the last spawns of the level.
 */
export function retagLingerieSpawns(layout: StationLayout): void {
  const first = layout.zombies.findIndex(z => z.look === LINGERIE_LOOK);
  if (first >= 0) markSpawnContext(layout, first, 'lingerie');
}

/** Straight-line distance (m) from a point to a rect (0 inside). */
const rectDist = (r: MallRect, x: number, z: number): number =>
  Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** A candidate stand point: world position and the grid cell it lies in (its area / floor height). */
interface Cand { i: number; x: number; z: number }

function placeStore(layout: StationLayout, shop: LingerieShop, r: Rng, ctx: SpawnContextRule, dist: Int32Array[], keep: readonly {level: number; x: number; z: number}[]): LingerieStoreReport {
  const R = LINGERIE_SPAWN_RULES, pl = ctx.placement;
  const lv = shop.level, g = layout.levels[lv].grid, d = dist[lv];
  const rects = (shop.changing ?? []).slice(0, 30); // (one membership bit per rect)
  const sales = layout.areas[shop.area];
  // --- the store's own floor: its sales floor (+ an area of the store's purpose its changing rects cover: a changing area carved as
  // its own room); never its stock room, a public walkway or another unit
  const own = new Set<number>([shop.area]);
  let bx0 = sales.x, by0 = sales.y, bx1 = sales.x + sales.w - 1, by1 = sales.y + sales.h - 1;
  const rectCells = rects.map(q => {
    const [x0, y0] = g.cellOf(q.x0, q.z0), [x1, y1] = g.cellOf(q.x1, q.z1);
    return {x0, y0, x1, y1, has: (x: number, y: number) => { const [cx, cz] = g.center(x, y); return cx >= q.x0 && cx <= q.x1 && cz >= q.z0 && cz <= q.z1; }};
  });
  for (const q of rectCells) {
    bx0 = Math.min(bx0, q.x0); by0 = Math.min(by0, q.y0); bx1 = Math.max(bx1, q.x1); by1 = Math.max(by1, q.y1);
    for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) {
      if (!g.inBounds(x, y) || !q.has(x, y)) continue;
      const a = layout.areas[g.area[g.idx(x, y)]];
      if (a && a.id !== shop.backroom && !a.publicSpace && (a.level ?? 0) === lv && a.purpose === shop.fit?.purpose) own.add(a.id);
    }
  }
  bx0 = Math.max(1, bx0); by0 = Math.max(1, by0); bx1 = Math.min(g.w - 2, bx1); by1 = Math.min(g.h - 2, by1);
  // --- changing-area membership (a bit per rect: walkable cells of the store) and its OPENING cells (a walkable 4-neighbour outside
  // one of the cell's rects: a booth's curtain-gap row, the aisle cells facing it, the area's mouth)
  const mask = new Map<number, number>();
  rectCells.forEach((q, k) => {
    for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) {
      if (!g.inBounds(x, y) || !q.has(x, y) || !g.walkable(x, y) || !own.has(g.area[g.idx(x, y)])) continue;
      const i = g.idx(x, y);
      mask.set(i, (mask.get(i) ?? 0) | (1 << k));
    }
  });
  const opening = new Set<number>(), openCount = rects.map(() => 0);
  for (const [i, m] of mask) {
    const x = i % g.w, y = (i - x) / g.w;
    if (!N4.some(([ox, oy]) => g.walkable(x + ox, y + oy) && (m & ~(mask.get(g.idx(x + ox, y + oy)) ?? 0)) !== 0)) continue;
    opening.add(i);
    for (let k = 0; k < rects.length; k++) if (m & (1 << k)) openCount[k]++;
  }
  // a rect with at most boothOpeningCells opening cells is a BOOTH (a dead end behind its curtain gap); a wider one is the AISLE
  const booth = openCount.map(n => n > 0 && n <= R.boothOpeningCells);
  const hasBooths = booth.some(Boolean);
  const nextToOpening = (i: number): boolean => { const x = i % g.w, y = (i - x) / g.w; return N4.some(([ox, oy]) => opening.has(g.idx(x + ox, y + oy))); };
  const nearChanging = (x: number, y: number): boolean => {
    const c = R.changingMarginCells;
    for (let oy = -c; oy <= c; oy++) for (let ox = -c; ox <= c; ox++) if (mask.has(g.idx(x + ox, y + oy))) return true;
    return false;
  };
  const fronts = shop.frontages?.length ? shop.frontages : [shop.frontage];
  const cellOk = (x: number, y: number): boolean => {
    if (!g.inBounds(x, y)) return false;
    const i = g.idx(x, y);
    return g.cells[i] === FLOOR && g.walkable(x, y) && g.rampIdx[i] < 0 && own.has(g.area[i]) && d[i] >= pl.startCells;
  };
  const pointOk = (px: number, pz: number): boolean =>
    !keep.some(k => k.level === lv && Math.hypot(k.x - px, k.z - pz) < (pl.landingKeepM ?? 0)) && !fronts.some(f => rectDist(f, px, pz) < R.entryKeepM);
  const cand = (px: number, pz: number): Cand => { const [ax, ay] = g.cellOf(px, pz); return {i: g.idx(ax, ay), x: px, z: pz}; };
  // --- candidates. Booth k: the centre of every 2 x 2 patch of its own cells off its opening row (a booth is 2 cells wide: the
  // variant stands on its centre line, clear of both panels). The aisle (only when the store has no booth): cells 3 x 3 clear, off
  // and not next to an opening. The sales floor: cells 3 x 3 clear, > changingMarginCells off the changing area, off its mouth.
  const changing: Cand[][] = rects.map(() => []), floor: Cand[] = [];
  const inRect = (i: number, k: number) => ((mask.get(i) ?? 0) & (1 << k)) !== 0;
  rectCells.forEach((q, k) => {
    if (booth[k]) {
      for (let y = q.y0; y < q.y1; y++) for (let x = q.x0; x < q.x1; x++) {
        const patch = [g.idx(x, y), g.idx(x + 1, y), g.idx(x, y + 1), g.idx(x + 1, y + 1)];
        if (!patch.every(i => inRect(i, k) && !opening.has(i)) || ![[0, 0], [1, 0], [0, 1], [1, 1]].every(([ox, oy]) => cellOk(x + ox, y + oy))) continue;
        const px = (x + 1) * CELL, pz = (y + 1) * CELL;
        if (pointOk(px, pz)) changing[k].push(cand(px, pz));
      }
    } else if (!hasBooths) {
      for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) {
        const i = g.idx(x, y);
        if (!inRect(i, k) || (mask.get(i)! & -mask.get(i)!) !== 1 << k || opening.has(i) || nextToOpening(i) || !cellOk(x, y) || !clearAround(g, x, y, pl.clearCells)) continue;
        const [px, pz] = g.center(x, y);
        if (pointOk(px, pz)) changing[k].push({i, x: px, z: pz});
      }
    }
  });
  const mouth = shop.changingEntry;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    if (mask.has(g.idx(x, y)) || !cellOk(x, y) || !clearAround(g, x, y, pl.clearCells) || nearChanging(x, y)) continue;
    const [px, pz] = g.center(x, y);
    if (mouth && Math.hypot(mouth.x - px, mouth.z - pz) < R.changingEntryKeepM) continue;
    if (pointOk(px, pz)) floor.push({i: g.idx(x, y), x: px, z: pz});
  }
  const byArea = new Map<number, Cand[]>();
  for (const c of [...changing.flat(), ...floor]) { const a = g.area[c.i]; const l = byArea.get(a); if (l) l.push(c); else byArea.set(a, [c]); }
  reportSpawnCandidates(layout, 'lingerie', byArea);
  // --- the run: count, then the changing area (round-robin over its rects in a seeded order: one per booth first), then the sales
  // floor (+ what the changing area could not take), then the changing area again (what the floor could not take)
  const count = r.int(ctx.count[0], ctx.count[1]);
  const quota = {floor: Math.floor(count / R.floorEvery), changing: 0};
  quota.changing = count - quota.floor;
  const first = layout.zombies.length;
  const order = r.shuffle(changing.map((_, k) => k).filter(k => changing[k].length > 0));
  const tryPlace = (cells: readonly Cand[]): boolean => {
    for (let t = 0; t < pl.tries; t++) {
      const c = r.pick(cells);
      if (layout.zombies.some(z => (z.level ?? 0) === lv && Math.hypot(z.x - c.x, z.z - c.z) < pl.spacingM)) continue;
      if (sealsPassage(g, c.x, c.z, R.passageRadiusM)) continue;
      layout.zombies.push({x: c.x, z: c.z, yaw: r.range(-Math.PI, Math.PI), type: 'shambler', area: g.area[c.i], ...(lv ? {level: lv, y: g.floorOf(c.i)} : {}), look: LINGERIE_LOOK});
      return true;
    }
    return false;
  };
  const fillChanging = (n: number): number => {
    let placed = 0, progress = true;
    while (placed < n && progress) {
      progress = false;
      for (const k of order) {
        if (placed >= n) break;
        if (tryPlace(changing[k])) { placed++; progress = true; }
      }
    }
    return placed;
  };
  const fillFloor = (n: number): number => {
    let placed = 0;
    while (placed < n && floor.length && tryPlace(floor)) placed++;
    return placed;
  };
  let inChanging = fillChanging(quota.changing);
  const onFloor = fillFloor(quota.floor + quota.changing - inChanging);
  inChanging += fillChanging(count - inChanging - onFloor);
  const placed = layout.zombies.length - first;
  return {shop: shop.id, level: lv, count, quota, placed, changing: inChanging, floor: onFloor,
    candidates: {changing: changing.map(c => c.length), floor: floor.length}, booths: booth.filter(Boolean).length, first: placed ? first : -1};
}
