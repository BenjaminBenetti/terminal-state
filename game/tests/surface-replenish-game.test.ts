// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): the Game seams of SURFACE RUN's outdoor replenisher, exercised on
// the REAL Game methods (src/game.ts, called with a stand-in `this` — no renderer is constructed):
//  - Game.spawnEnemy(spawn, index, ownRand): the actor is built on the caller's OWN stream; Game.rand (the station stream every layout
//    spawn / pickup of the section draws from) is never drawn;
//  - Game.aliveEnemies: a replenished outdoor actor (Game.uncountedEnemies) is never counted (the section clear, the HUD, the end screen);
//  - Game.saveSectionMemory: a replenished actor has no layout index, so its kill never enters the kill memory; interior (layout) kills
//    do, permanently: a re-entered district spawns none of them again (run/memory.ts enemiesToSpawn) and nothing of the outdoor ones;
//  - the district memory's encoded size stays the same however long the replenisher runs (nothing of it is saved).
import {beforeAll, describe, expect, it} from 'vitest';
import {createRun} from '../src/run/runState';
import {enemiesToSpawn} from '../src/run/memory';
import {encodeMemory} from '../src/save/serialize';
import {canonicalJson} from '../src/save/checksum';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';
import type {SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import {surfaceKeyOf} from '../src/gen/surface/surfaceRun';
import {OutdoorReplenisher, REPLENISH, outdoorFamilyPool, outdoorRulesOf, standableOn, viewerOf, type ReplenishHost} from '../src/world/surface/replenish';
import {mulberry32} from '../src/core/rng';

type GameProto = Record<string, (...a: unknown[]) => unknown>;
let G: GameProto;
beforeAll(async () => {
  const {Game} = await import('../src/game');
  G = Game.prototype as unknown as GameProto;
}, 120000);

interface FakeActor { brain: {x: number; y: number; z: number; alive: boolean}; root: {position: {y: number}} }
const actor = (x = 0, z = 0): FakeActor => ({brain: {x, y: 0, z, alive: true}, root: {position: {y: 0}}});

describe('Surface Run: Game seams of the outdoor replenisher', () => {
  it('spawnEnemy builds on the caller\'s own stream and never draws Game.rand', () => {
    const passed: unknown[] = [];
    const station = () => { throw new Error('Game.rand drawn'); };
    const self = {
      currentSeed: 77, rand: station, enemyFallbacks: 0, zombies: [] as FakeActor[], screacherBrains: [],
      buildEnemyActor(_s: ZombieSpawn, _i: number, _seed: number, rand: () => number) { passed.push(rand); rand(); return {actor: actor(), fallback: false}; },
      damage: {installZombie() {}}, blight: {adopt() {}}, sirens: {adopt() {}}, irradiation: {adopt() {}},
      levels: {grid: () => ({floorAt: () => 0})}, scene: {add() {}}, atmosphere: {markShadows() {}},
    };
    const own = mulberry32(5);
    const z = G.spawnEnemy.call(self, {x: 1, z: 2, yaw: 0, type: 'shambler', area: 0, level: 0, y: 0} as ZombieSpawn, REPLENISH.indexBase, own) as FakeActor;
    expect(passed[0]).toBe(own);
    expect(self.zombies).toEqual([z]);
    // without the stream the station's own (the layout spawns: unchanged)
    expect(() => G.spawnEnemy.call(self, {x: 1, z: 2, yaw: 0, type: 'shambler', area: 0, level: 0, y: 0} as ZombieSpawn, 3)).toThrow('Game.rand drawn');
  });

  it('aliveEnemies never counts a replenished outdoor actor', () => {
    const a = actor(), b = actor(), c = actor(), d = actor();
    d.brain.alive = false;
    const uncounted = new WeakSet<object>([b]);
    expect(G.aliveEnemies.call({zombies: [a, b, c, d], uncountedEnemies: uncounted})).toBe(2);
    expect(G.aliveEnemies.call({zombies: [b], uncountedEnemies: uncounted})).toBe(0); // only outdoor ones alive: the section is clear
  });

  it('kills: interior kills are permanent in the kill memory; outdoor kills never enter it; the saved memory does not grow', () => {
    const layout = LEVELS.subway.generate('surface', {levelSeed: 7}) as StationLayout;
    const s = layout.surface as SurfaceInfo, L = levelsOf(layout);
    const key = surfaceKeyOf({level: 'subway', section: 'main'});
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 5, skyways: 6, reactor: 7}, start: key, levels: LEVELS});
    run.current = key;
    // the interior enemies of the layout (lane ROOMS places them; the skeleton has none: three stand-ins with layout indices 0..2)
    const interior = [actor(), actor(), actor()];
    const enemyIndex = new Map<object, number>(interior.map((z, i) => [z, i]));
    const zombies: FakeActor[] = [...interior];
    const self = {run, zombies, enemyIndex, pickups: {list: []}, trainCargo: null, layoutPickup: new Map(), containers: null};
    // the outdoor replenisher feeding the same zombie list (as Game.spawnEnemy does), never enemyIndex
    const player = {x: s.portal.pose.x, z: s.portal.pose.z, yaw: s.portal.pose.yaw};
    const outdoor = new Set(s.outdoor.areas);
    const host: ReplenishHost<FakeActor> = {
      spawn: sp => { const z = actor(sp.x, sp.z); zombies.push(z); return z; },
      remove: z => { zombies.splice(zombies.indexOf(z), 1); },
      viewer: () => viewerOf({x: player.x, y: 1.6, z: player.z}, player.yaw, 0, 75, 16 / 9),
      lineOfSight: (a, b) => L.lineOfSight(a, b),
      standable: (x, z, r) => standableOn(L.main, (a, b, c, d) => L.circleClear(a, b, c, d), outdoor, x, z, r),
      truck: () => null,
      active: () => true,
    };
    const rep = new OutdoorReplenisher<FakeActor>(host, outdoorRulesOf(s), {seed: s.seed, visit: 1, pool: outdoorFamilyPool('subway'), coatedChance: 0.4});
    rep.seed();
    interior[1].brain.alive = false; // an interior kill
    G.saveSectionMemory.call(self);
    const mem = run.memory(key);
    expect(mem.killed).toEqual([1]);
    const size0 = canonicalJson(encodeMemory(mem)).length;
    const r = mulberry32(8);
    let outdoorKills = 0;
    for (let k = 0; k < 20 * 600; k++) { // 20 simulated minutes
      player.yaw += 0.01;
      rep.tick(0.1);
      if (k % 10 === 0) for (const z of zombies) if (!enemyIndex.has(z) && z.brain.alive && r() < 0.05) { z.brain.alive = false; outdoorKills++; }
      if (k % 3000 === 0) G.saveSectionMemory.call(self); // autosaves along the way
    }
    G.saveSectionMemory.call(self);
    expect(outdoorKills).toBeGreaterThan(REPLENISH.cap * 3);
    expect(mem.killed).toEqual([1]); // outdoor kills never enter the kill memory
    expect(canonicalJson(encodeMemory(mem)).length).toBe(size0); // the save does not grow
    expect(zombies.length).toBeLessThanOrEqual(interior.length + REPLENISH.cap + REPLENISH.corpseHard);
    // re-entering the district: the interior kill stays dead (never respawned); nothing of the outdoor population is remembered
    expect(enemiesToSpawn(3, mem)).toEqual([0, 2]);
  }, 120000);
});
