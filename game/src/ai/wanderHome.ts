// Task gameplay-feedback-20261111 (lane SPAWNS): the WANDER HOME of a zone-local enemy. Pure (no three.js).
//
// User feedback: "missing lingerie zombies in Mall lingerie stores and missing Strainers in Bunker wet areas". Measured on main
// (lane SPAWNS census, tests/mall-lingerie-placement.test.ts, tests/bunker-strainer-wet.test.ts):
//  - GENERATION is right: every mall that rolled its optional lingerie store (49 of seeds 1..80) holds its 3-5 store-local
//    variants INSIDE the store at spawn (look 'lingerie', context 'lingerie', ordinary zombies); every Bunker map whose seeded roster
//    includes the Strainer (68 of seeds 1..200 = 34 %, the 35 % rule) holds exactly one, in a damp area of storey 4. The other malls
//    / Bunkers lack them by their seeded chances (a legitimate absence);
//  - the runtime lost them: ZombieBrain's idle wander is an unbounded random walk (a target up to 6 m away, every ~10 s), so the
//    store-local variants walked out of their small store with nobody near — Game.updateZombies replica (tests/helpers/aiCpuSim.ts,
//    real actors, the player waiting at the start): 13 of 32 still inside after 120 s, 6 after 180 s, 5 after 300 s (8 malls). The
//    slow Strainer drifted less (6-7 of 8 in its damp rooms at 180-300 s).
// THE RULE: a zone-local enemy has a HOME (a set of layout areas) — the lingerie store's own areas for its store-local variants, the
// Bunker's damp areas (layout.bunker.damp) for the Strainer placed there. Every random walk target it picks (BrainWorld.randomNear:
// the idle wander, a search spot) is chosen as below, so it keeps to its store / habitat while nothing draws it out:
//  - standing INSIDE its home: a target inside its home (none found this time: it stays idle a moment);
//  - outside its home and UNAWARE of the player (a wander leg that ran out of time in a corridor between two damp rooms, or long
//    after a chase): a target inside its home when one lies within the walk radius — it drifts back in; else the ordinary target;
//  - outside and aware (it just chased / lost the player): the ordinary target.
// Nothing else changes: it still notices, chases, investigates a light and follows the player out (no leash, despawn or teleport).
// No spawn, position, family, look, roster or kill record changes (save data untouched): a runtime-only rule, the same on visited
// and new maps. Enemies without a home (every other spawn) use the unchanged world.

import type {BrainWorld} from './brain';
import {CELL} from '../gen/grid';
import type {StationLayout, ZombieSpawn} from '../gen/stationTypes';
import {lingerieStoreAreas, lingerieStores} from '../gen/mall/lingerieSpawns';

export type WanderHomeKind = 'lingerie-store' | 'strainer-damp';

export interface WanderHome {
  readonly kind: WanderHomeKind;
  /** layout.areas ids of the home (grid `area` values). */
  readonly areas: ReadonlySet<number>;
}

/** The grid surface the sampler reads (gen/grid.ts Grid). */
interface HomeGrid {
  readonly area: ArrayLike<number>;
  idx(x: number, y: number): number;
  inBounds(x: number, y: number): boolean;
  walkable(x: number, y: number): boolean;
  cellOf(wx: number, wz: number): [number, number];
  center(x: number, y: number): [number, number];
  cellFloor(x: number, y: number): number;
  circleClear(wx: number, wz: number, r: number): boolean;
}
/** The stacked-levels surface (gen/levels.ts Levels). */
export interface HomeLevels {
  readonly count: number;
  grid(level: number): HomeGrid;
  levelAt(wx: number, wz: number, y: number): number;
}

type HomeLayout = Pick<StationLayout, 'mall' | 'areas' | 'bunker'>;

/** The home of spawn `s` of `layout`, or null (no home: the ordinary wander). `cache` shares one area set per zone. */
export function wanderHomeOf(layout: HomeLayout, s: Pick<ZombieSpawn, 'area' | 'look' | 'archetype' | 'horde'>, cache: Map<string, WanderHome> = new Map()): WanderHome | null {
  if (s.horde !== undefined || s.area === undefined) return null;
  if (s.look === 'lingerie') {
    for (const shop of lingerieStores(layout)) {
      const key = `lingerie:${shop.id}`;
      let h = cache.get(key);
      if (!h) cache.set(key, (h = {kind: 'lingerie-store', areas: lingerieStoreAreas(layout, shop)}));
      if (h.areas.has(s.area)) return h;
    }
    return null;
  }
  if ((s.archetype ?? 'zombie') === 'strainer' && layout.bunker?.damp.includes(s.area)) {
    let h = cache.get('damp');
    if (!h) cache.set('damp', (h = {kind: 'strainer-damp', areas: new Set(layout.bunker.damp)}));
    return h;
  }
  return null;
}

/** Every home of a built section: actor -> its spawn's home (only enemies that have one). `index` = actor -> layout spawn index. */
export function wanderHomesFor<A>(layout: HomeLayout & Pick<StationLayout, 'zombies'>, index: ReadonlyMap<A, number>): Map<A, WanderHome> {
  const out = new Map<A, WanderHome>(), cache = new Map<string, WanderHome>();
  for (const [actor, i] of index) {
    const s = layout.zombies[i];
    const h = s ? wanderHomeOf(layout, s, cache) : null;
    if (h) out.set(actor, h);
  }
  return out;
}

/** The home area under a point (world x / z, feet y) of `L`, or -1 off the grids. */
function areaAt(L: HomeLevels, x: number, z: number, y: number | undefined): {lv: number; area: number} {
  const lv = L.count > 1 && y !== undefined ? L.levelAt(x, z, y + 0.05) : 0, G = L.grid(lv), [cx, cy] = G.cellOf(x, z);
  return {lv, area: G.inBounds(cx, cy) ? G.area[G.idx(cx, cy)] : -1};
}

/**
 * Game.brainWorld's randomNear (the same square of half-size r, 14 tries of two draws, walkable + 0.36 m clear cell centre, on the
 * brain's own storey) restricted to cells of `home`:
 *  - a brain standing INSIDE its home: a target there, or null (it stays idle a moment);
 *  - outside and `calm` (unaware of the player): a target there when the tries find one within the radius, else `undefined`;
 *  - outside and not calm: `undefined`.
 * `undefined` = the caller's ordinary randomNear applies.
 */
export function homeRandomNear(L: HomeLevels, home: WanderHome, rand: () => number, x: number, z: number, r: number, y: number | undefined, calm: boolean):
  [number, number] | [number, number, number] | null | undefined {
  const here = areaAt(L, x, z, y), inside = home.areas.has(here.area);
  if (!inside && !calm) return undefined;
  const G = L.grid(here.lv), multi = L.count > 1;
  for (let i = 0; i < 14; i++) {
    const tx = x + (rand() * 2 - 1) * r, tz = z + (rand() * 2 - 1) * r;
    const [cx, cy] = G.cellOf(tx, tz);
    if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36) && home.areas.has(G.area[G.idx(cx, cy)])) {
      const c = G.center(cx, cy);
      return multi ? [c[0], c[1], G.cellFloor(cx, cy)] : c;
    }
  }
  return inside ? null : undefined;
}

/** The brain world of enemy brain `b` with a home: `w` with randomNear chosen by homeRandomNear (see the file comment). */
export function homeWorld(w: BrainWorld, home: WanderHome, L: HomeLevels, b: {readonly aware: boolean}): BrainWorld {
  return {...w, randomNear: (x, z, r, y) => { const p = homeRandomNear(L, home, w.rand, x, z, r, y, !b.aware); return p === undefined ? w.randomNear(x, z, r, y) : p; }};
}
