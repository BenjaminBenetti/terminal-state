// Playtest revision (studio-alpha-track2-playtest-revision-20261031-01): the user's two fresh runs found NO loot and NO enemies in
// the Beyond the Station annexes. Diagnosis (reference/tasks/track2-playtest-revision-20261031/DIAGNOSIS-BASELINE.md): every annex
// holder / enemy was generated, registered, reachable and targetable, but 94-98 % of annex holders rolled EMPTY (the picked-over /
// stash tables were cut a second time by the level-wide scarcity economy; the few stocked holders sat deepest) and the 3-5 enemies
// per annex sat in closed rooms an ordinary route rarely entered. These regressions run the PRODUCTION path of a fresh New Game
// (createRun -> LEVELS.generate -> ContainerManager.build -> fresh run memory) and pin the corrected behaviour.
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, openableModels} from './helpers/openablesFixture';
import {freshLayout} from './helpers/annexRoute';
import {ANNEX_CONTENT, SERVICE_EARSHOT_M} from '../src/gen/annexContent';
import {ANNEX_PICKED_KEY, ANNEX_SCRAPS_KEY, ANNEX_STASH_KEY, ANNEX_SUPPLY_KEY, econCat, lootProfile} from '../src/items/lootTables';
import {holderTable, rollHolderLots} from '../src/items/loot';
import {SERVICE_ZONE_BUDGET} from '../src/ai/spawnTables';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager} from '../src/world/containers';
import {Inventory} from '../src/items/inventory';
import {captureHolders, applyHolders} from '../src/run/worldMemory';
import {createMemory, enemiesToSpawn, mergeKilled} from '../src/run/memory';
import {CELL} from '../src/gen/grid';
import {isExtensionArea} from '../src/gen/trackExt/types';
import type {StationLayout} from '../src/gen/stationTypes';
import type {LevelId} from '../src/levels/types';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};
let models: Record<string, GLTF> = {};
beforeAll(async () => { models = await openableModels(); }, 120000);

/** Two fresh Subway runs (tunnel annex 1043; tunnel + bed-wall hatch 1002) + an Office and a Mall annex. */
const SAMPLE: readonly [LevelId, number][] = [['subway', 1043], ['subway', 1002], ['office', 222], ['mall', 846932]];
const cache = new Map<string, {layout: StationLayout; cm: ContainerManager}>();
function fresh(level: LevelId, seed: number) {
  const k = `${level}:${seed}`;
  let e = cache.get(k);
  if (!e) {
    const layout = freshLayout(level, seed);
    const cm = new ContainerManager(models, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), () => new Inventory());
    cm.build(layout, {}, lootProfile(level));
    cache.set(k, (e = {layout, cm}));
  }
  return e;
}

describe('annex loot tables roll exactly (no second scarcity cut)', () => {
  it('supply / scraps never empty, the picked-over table searched clean, the stash mostly stocked — on every level profile', () => {
    for (const level of ['subway', 'office', 'mall'] as LevelId[]) {
      const P = lootProfile(level);
      for (const kind of ['crate', 'shelf', 'cabinetTall', 'stockShelf'] as const) {
        expect(holderTable(kind, ANNEX_SUPPLY_KEY, P).exact).toBe(true);
        let supply = 0, scraps = 0, picked = 0, stash = 0;
        for (let i = 0; i < 60; i++) {
          const surf = [{x0: -0.5, x1: 0.5, z0: -0.2, z1: 0.2, y: 0.5}, {x0: -0.5, x1: 0.5, z0: -0.2, z1: 0.2, y: 1.1}] as never;
          if (rollHolderLots(7, i, kind, ANNEX_SUPPLY_KEY, surf, P).length) supply++;
          if (rollHolderLots(7, i, kind, ANNEX_SCRAPS_KEY, surf, P).length) scraps++;
          if (rollHolderLots(7, i, kind, ANNEX_PICKED_KEY, surf, P).length) picked++;
          if (rollHolderLots(7, i, kind, ANNEX_STASH_KEY, surf, P).length) stash++;
        }
        expect(supply, `${level} ${kind} supply`).toBeGreaterThanOrEqual(57); // packing may rarely drop a lot; never the roll
        expect(scraps, `${level} ${kind} scraps`).toBeGreaterThanOrEqual(57);
        expect(picked, `${level} ${kind} picked`).toBe(0);
        expect(stash, `${level} ${kind} stash`).toBeGreaterThanOrEqual(48);
      }
    }
  });
});

describe('fresh New Game annexes: findable finite loot, encounterable enemies (production path)', () => {
  it('supply holders by depth band (entry first), stocked holders registered, ordinary non-ammo finds at the core density', () => {
    for (const [level, seed] of SAMPLE) {
      const {layout, cm} = fresh(level, seed);
      for (const a of layout.extensions!.annexes) {
        const ids = new Set(a.areas);
        const hs = cm.all.filter(h => ids.has(h.prop.area));
        const supply = hs.filter(h => h.prop.purpose === ANNEX_SUPPLY_KEY);
        const want = Math.max(ANNEX_CONTENT.loot.supply[0], Math.min(ANNEX_CONTENT.loot.supply[1], Math.round(a.areaM2 / ANNEX_CONTENT.loot.m2PerSupply)));
        expect(supply.length, `${level} ${seed} annex ${a.id} supply`).toBe(Math.min(want, supply.length + hs.filter(h => h.prop.purpose === ANNEX_PICKED_KEY || h.prop.purpose === ANNEX_SCRAPS_KEY).length));
        for (const h of supply) expect(h.state.lots.length, `supply ${h.kind} rolled`).toBeGreaterThan(0);
        // the entry third (door-hop depth) holds its share when it has holders
        const depths = a.areas.map(id => layout.areas[id].depth), dMin = Math.min(...depths), dMax = Math.max(...depths);
        const entry = (h: (typeof hs)[number]) => layout.areas[h.prop.area].depth - dMin < (dMax - dMin) / 3;
        if (hs.some(h => entry(h) && h.prop.purpose !== ANNEX_STASH_KEY)) expect(supply.filter(entry).length, `${level} ${seed} annex ${a.id} entry supply`).toBeGreaterThanOrEqual(2);
        const per = new Map<number, number>();
        for (const h of supply) per.set(h.prop.area, (per.get(h.prop.area) ?? 0) + 1);
        expect(Math.max(...per.values())).toBeLessThanOrEqual(ANNEX_CONTENT.loot.perArea);
        // non-ammo finds of the annex (holders + floor): ~the core station's density (~15-25 per ~1840 m2 annex)
        const nonAmmo = hs.reduce((n, h) => n + h.state.lots.filter(l => econCat(l.itemId) !== 'ammo').length, 0);
        expect(nonAmmo, `${level} ${seed} annex ${a.id} non-ammo finds`).toBeGreaterThanOrEqual(10);
        expect(nonAmmo).toBeLessThanOrEqual(45);
        expect(hs.every(h => h.prop.purpose !== ANNEX_PICKED_KEY || h.state.lots.length === 0)).toBe(true);
      }
    }
  });

  it('service enemies: the per-annex budget, spread over entry / middle / deep, out of station earshot where possible, at the annex floor', () => {
    for (const [level, seed] of SAMPLE) {
      const {layout} = fresh(level, seed);
      const coreCells: [number, number][] = [];
      for (const L of layout.levels?.length ? layout.levels : [{grid: layout.grid}]) {
        const g = L.grid;
        for (let y = 0; y < g.h; y += 2) for (let x = 0; x < g.w; x += 2) { const ar = g.area[g.idx(x, y)]; if (ar >= 0 && !isExtensionArea(layout.areas[ar]) && g.walkable(x, y)) coreCells.push([(x + 0.5) * CELL, (y + 0.5) * CELL]); }
      }
      for (const a of layout.extensions!.annexes) {
        const ids = new Set(a.areas);
        const z = layout.zombies.filter(s => ids.has(s.area));
        expect(z.length, `${level} ${seed} annex ${a.id} service enemies`).toBeGreaterThanOrEqual(SERVICE_ZONE_BUDGET[0]);
        expect(z.length).toBeLessThanOrEqual(SERVICE_ZONE_BUDGET[1]);
        for (const s of z) expect(s.y, 'spawn at the annex floor').toBeCloseTo(a.floorY, 2);
        const depths = a.areas.map(id => layout.areas[id].depth), dMin = Math.min(...depths), dMax = Math.max(...depths);
        const band = (s: (typeof z)[number]) => Math.min(2, Math.floor((3 * (layout.areas[s.area].depth - dMin)) / (dMax - dMin + 1e-9)));
        expect(new Set(z.map(band)).size, `${level} ${seed} annex ${a.id} depth bands`).toBeGreaterThanOrEqual(2);
        for (const s of z) expect(Math.hypot(s.x - a.exit.x, s.z - a.exit.z), 'entry keep-off').toBeGreaterThanOrEqual(6 - 1e-6);
        const loud = z.filter(s => coreCells.some(([x, zz]) => Math.hypot(x - s.x, zz - s.z) < SERVICE_EARSHOT_M - 1.5)).length;
        expect(loud, `${level} ${seed} annex ${a.id} within station earshot`).toBeLessThanOrEqual(Math.ceil(z.length / 2));
      }
    }
  });

  it('taken annex loot stays taken on a revisit, a killed annex enemy stays dead (finite run memory; no refill)', () => {
    const {layout, cm} = fresh('subway', 1043);
    const inv = new Inventory();
    const cm2 = new ContainerManager(models, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), () => inv);
    cm2.build(layout, {}, lootProfile('subway'));
    const ids = new Set(layout.extensions!.annexes[0].areas);
    const h = cm2.all.find(q => ids.has(q.prop.area) && q.prop.purpose === ANNEX_SUPPLY_KEY && q.state.lots.length)!;
    expect(h).toBeDefined();
    const n0 = h.state.lots.length, lot = h.state.lots[0];
    if (h.open || !h.state.open) cm2.interact({container: h, t: 1, lot: null, part: h.open ? 0 : undefined} as never);
    for (let t = 0; t < 1.5; t += 1 / 30) cm2.update(1 / 30, t);
    cm2.interact({container: h, t: 1, lot, part: lot.part} as never);
    expect(inv.count(lot.itemId)).toBeGreaterThan(0);
    expect(h.state.lots.length).toBe(n0 - 1);
    const recs = captureHolders(cm2);
    // the revisit: the same section regenerated and rebuilt, the run memory applied (Game.buildSection order)
    const again = freshLayout('subway', 1043);
    const cm3 = new ContainerManager(models, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), () => new Inventory());
    cm3.build(again, {}, lootProfile('subway'));
    applyHolders(cm3, recs);
    const back = cm3.all.find(q => q.prop.x === h.prop.x && q.prop.z === h.prop.z && q.kind === h.kind)!;
    expect(back.state.lots.length).toBe(n0 - 1);
    expect(back.state.lots.some(l => l.id === lot.id)).toBe(false);
    void cm;
    const mem = createMemory({level: 'subway', section: 'main'});
    const z = layout.zombies.findIndex(s => ids.has(s.area));
    mem.killed = mergeKilled(mem.killed, [z]);
    expect(enemiesToSpawn(layout.zombies.length, mem)).not.toContain(z);
    void THREE;
  });
});
