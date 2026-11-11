// Task gameplay-feedback-20261111 (lane SPAWNS). User: "Investigate missing lingerie zombies in Mall lingerie stores … Distinguish
// legitimate random absence from broken location eligibility."
//
// FINDINGS (measured on main, lane SPAWNS census; ai/wanderHome.ts has the numbers):
//  - the RULE (gen/mall/shops.ts MALL_PROGRAMS.lingerie, gen/mall/lingerieSpawns.ts, ai/spawnTables.ts LINGERIE_CONTEXT): the lingerie
//    boutique is an OPTIONAL seeded program (0..1 per mall, large lots only); a mall that has one gets ONE store-local run of
//    U{3..5} ordinary zombies wearing the fitted lingerie sets, mostly in its changing booths, inside that store only. A mall without
//    the store has none (a legitimate absence: 31 of seeds 1..80);
//  - generation is right: 49 of 49 stores held their 3-5 variants inside the store at spawn (look 'lingerie', context 'lingerie',
//    ordinary zombies; none outside a store, no lingerie stock without a store), and the lingerie library builds every one of them
//    (no outfit fallback);
//  - the runtime walked them out: the unbounded idle wander took most variants out of the store within ~3 minutes with nobody near
//    (Game.updateZombies replica, tests/helpers/aiCpuSim.ts). FIX: their wander home (ai/wanderHome.ts) — the store's own areas.
// PINNED HERE: the generation census (bounded); every variant's home is its store; the look is the lingerie set; with the homes every
// variant stays in its store while the player waits far away, without them (the pre-fix world, A/B) they leave.

import {beforeAll, describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {mulberry32} from '../src/core/rng';
import {aiCpuSim, loadEnemyModels} from './helpers/aiCpuSim';
import {LEVELS} from '../src/levels/registry';
import {ROSTER_VERSION} from '../src/ai/enemyRoster';
import {LINGERIE_ZONE_BUDGET, spawnContextOf, spawnProfile} from '../src/ai/spawnTables';
import {LINGERIE_SPAWN_STATS, lingerieStoreAreas, lingerieStores} from '../src/gen/mall/lingerieSpawns';
import {isLingerieStockKind} from '../src/world/mallLingerieDisplay';
import {homeRandomNear, wanderHomeOf, wanderHomesFor} from '../src/ai/wanderHome';
import {ZombieLookLibrary} from '../src/ai/outfits';
import {createLingerieLibrary} from '../src/ai/lingerie';
import {chooseSpawnLook, lingerieLookUsable} from '../src/ai/spawnLook';
import {Levels} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);

const P = spawnProfile('mall');
const SEEDS = Array.from({length: 24}, (_, k) => k + 1);
const gen = (seed: number): StationLayout => LEVELS.mall.generate('main', {levelSeed: seed, startWeapon: 'pistol', rosterVersion: ROSTER_VERSION});
const lingerieIdx = (L: StationLayout) => L.zombies.map((z, i) => (z.look === 'lingerie' ? i : -1)).filter(i => i >= 0);

describe('mall lingerie store: generation census (seeds 1..24)', () => {
  const layouts = new Map<number, StationLayout>();
  const stats = new Map<number, typeof LINGERIE_SPAWN_STATS.stores>();
  beforeAll(() => { for (const s of SEEDS) { layouts.set(s, gen(s)); stats.set(s, [...LINGERIE_SPAWN_STATS.stores]); } }, 300000);

  it('a mall with its optional lingerie store holds its variants INSIDE the store; a mall without one has none (seeded absence)', () => {
    let withStore = 0, variants = 0;
    for (const seed of SEEDS) {
      const L = layouts.get(seed)!, stores = lingerieStores(L), idx = lingerieIdx(L);
      expect(stores.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      if (!stores.length) {
        expect(idx, `seed ${seed}: no store, no variants`).toEqual([]);
        expect(L.props.some(p => isLingerieStockKind(p.kind)), `seed ${seed}: no store, no lingerie stock`).toBe(false);
        continue;
      }
      withStore++;
      const own = lingerieStoreAreas(L, stores[0]), run = stats.get(seed)!;
      expect(run.length).toBe(1);
      expect(run[0].count).toBeGreaterThanOrEqual(LINGERIE_ZONE_BUDGET[0]);
      expect(run[0].count).toBeLessThanOrEqual(LINGERIE_ZONE_BUDGET[1]);
      expect(idx.length, `seed ${seed}: the store's variants`).toBe(run[0].placed);
      expect(idx.length, `seed ${seed}: the store's variants`).toBeGreaterThanOrEqual(1);
      for (const i of idx) {
        const z = L.zombies[i];
        expect(own.has(z.area), `seed ${seed} #${i}: inside the store`).toBe(true);
        expect(L.areas[z.area].level ?? 0).toBe(stores[0].level);
        expect(z.archetype ?? 'zombie').toBe('zombie');
        expect(z.horde).toBeUndefined();
        expect(spawnContextOf(L, P, i)).toBe('lingerie');
      }
      variants += idx.length;
    }
    // the store is a seeded program, never guaranteed: some malls have it, some not (seeds 1..80 on main: 49 with, 31 without)
    expect(withStore).toBeGreaterThan(SEEDS.length * 0.3);
    expect(withStore).toBeLessThan(SEEDS.length);
    expect(variants / withStore).toBeGreaterThanOrEqual(3);
  });

  it('every variant has its store as its wander home; every other spawn has none', () => {
    for (const seed of SEEDS) {
      const L = layouts.get(seed)!, stores = lingerieStores(L);
      const index = new Map(L.zombies.map((_, i) => [i, i] as const));
      const homes = wanderHomesFor(L, index);
      L.zombies.forEach((z, i) => {
        const h = homes.get(i) ?? null;
        if (z.look === 'lingerie') {
          expect(h?.kind, `seed ${seed} #${i}`).toBe('lingerie-store');
          expect([...h!.areas].sort()).toEqual([...lingerieStoreAreas(L, stores[0])].sort());
        } else expect(h, `seed ${seed} #${i}: ${z.archetype ?? 'zombie'} without a home`).toBeNull();
      });
      // one shared area set per store
      const sets = new Set([...homes.values()].map(h => h.areas));
      expect(sets.size).toBeLessThanOrEqual(1);
    }
  });

  it('homeRandomNear: inside the store every target is a store cell; outside and aware the ordinary pick applies', () => {
    const L = layouts.get(SEEDS.find(s => lingerieIdx(layouts.get(s)!).length)!)!;
    const lv = new Levels(L.levels, L.levelLinks, L.rails), i = lingerieIdx(L)[0], z = L.zombies[i], home = wanderHomeOf(L, z)!;
    const rand = mulberry32(0x11e);
    for (let k = 0; k < 200; k++) {
      const p = homeRandomNear(lv, home, rand, z.x, z.z, 6, z.y, k % 2 === 0);
      expect(p).not.toBeUndefined();
      if (!p) continue;
      const G = lv.grid(z.level ?? 0), [cx, cy] = G.cellOf(p[0], p[1]);
      expect(home.areas.has(G.area[G.idx(cx, cy)])).toBe(true);
    }
    // a point far outside the store (the player's start, storey 0): aware -> undefined (ordinary); calm but out of reach -> undefined
    const s = L.playerSpawn;
    expect(homeRandomNear(lv, home, rand, s.x, s.z, 6, 0, false)).toBeUndefined();
    expect(homeRandomNear(lv, home, rand, s.x, s.z, 6, 0, true)).toBeUndefined();
  });
});

describe('mall lingerie store: the variants wear their sets and stay in the store (real actors, Game.updateZombies replica)', () => {
  let models: Record<string, GLTF>;
  beforeAll(async () => { models = await loadEnemyModels(); }, 300000);

  it('every store variant is built with a lingerie set (top + bottom), never the ordinary fallback', () => {
    const looks = new ZombieLookLibrary(models), lib = createLingerieLibrary(models);
    let n = 0;
    for (const seed of SEEDS.slice(0, 12)) {
      const L = gen(seed);
      for (const i of lingerieIdx(L)) {
        const pick = chooseSpawnLook(L.seed >>> 0, i, L.zombies[i], looks, lib);
        expect(pick.library, `seed ${seed} #${i}`).toBe('lingerie');
        expect(lingerieLookUsable(pick.look, lib)).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('with the player waiting at the start (no shots, no flashlight): every variant stays inside its store; without the homes they walk out', () => {
    const SECS = 120, FPS = 60, DT = 1 / FPS, EVERY = 10;
    let outsideWithout = 0, snaps = 0;
    for (const seed of [2, 4]) {
      const L = gen(seed), idx = lingerieIdx(L), home = wanderHomeOf(L, L.zombies[idx[0]])!;
      expect(idx.length).toBeGreaterThan(0);
      for (const homes of [true, false]) {
        const sim = aiCpuSim(L, {actors: models, clock: 'virtual', dt: DT, wanderHomes: homes});
        const inside = (i: number) => { const b = sim.brains[i], G = sim.L.grid(sim.L.levelAt(b.x, b.z, b.y + 0.05)), [cx, cy] = G.cellOf(b.x, b.z); return home.areas.has(G.area[G.idx(cx, cy)]); };
        let moved = 0;
        for (let f = 1; f <= SECS * FPS; f++) {
          sim.step();
          if (f % (EVERY * FPS) !== 0) continue;
          for (const i of idx) {
            if (homes) { expect(inside(i), `seed ${seed} #${i} at ${f / FPS} s`).toBe(true); snaps++; }
            else if (!inside(i)) outsideWithout++;
          }
        }
        if (homes) for (const i of idx) if (Math.hypot(sim.brains[i].x - L.zombies[i].x, sim.brains[i].z - L.zombies[i].z) > 1) moved++;
        if (homes) expect(moved, `seed ${seed}: they still wander inside the store`).toBeGreaterThan(0);
      }
    }
    expect(snaps).toBeGreaterThan(0);
    expect(outsideWithout, 'the pre-fix world: variants left the store').toBeGreaterThan(0);
  }, 300000);
});
