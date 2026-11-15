import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {ZombieBrain} from '../src/ai/brain';
import {ZombieActor} from '../src/ai/zombieActor';
import type {ZombieSpawn, StationLayout} from '../src/gen/stationTypes';
import {SurfacePopulation, SURFACE_POPULATION, exteriorSpawnAllowed, type SurfacePopulationHost} from '../src/world/surfacePopulation';

describe('Surface Run exterior population', () => {
  it('replacement policy refuses visible, close, remote and occupied spawns', () => {
    expect(exteriorSpawnAllowed(50, false, 9)).toBe(true);
    for (const d of [0, 15, 31.99, 90.01, Infinity, NaN]) expect(exteriorSpawnAllowed(d, false)).toBe(false);
    expect(exteriorSpawnAllowed(50, true)).toBe(false);
    expect(exteriorSpawnAllowed(50, false, 7.9)).toBe(false);
  });

  it('replenishes indefinitely with exactly twelve warmed actor objects, no allocation or simulation while paused', () => {
    const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 200);
    camera.position.set(120, 1.7, 120); camera.lookAt(120, 1.7, 0); camera.updateMatrixWorld();
    const spawns: ZombieSpawn[] = Array.from({length: 48}, (_, i) => {
      const angle = i / 48 * Math.PI * 2;
      return {x: 120 + Math.sin(angle) * 65, z: 120 + Math.cos(angle) * 65, y: 0, yaw: 0, type: 'shambler', area: 0};
    });
    const layout = {surface: {exteriorSpawns: spawns}} as StationLayout;
    const host: SurfacePopulationHost = {layout, player: {x: 120, z: 120}, camera, state: 'playing', zombies: [],
      physics: {forgetRagdoll: () => true}, frameHooks: [], sectionHooks: [], warmRegistry: {addPool: (_name, roots) => { warm = roots; }},
      spawnEnemy: s => {
        const actor = Object.create(ZombieActor.prototype) as ZombieActor;
        Object.assign(actor, {root: new THREE.Group(), brain: new ZombieBrain('shambler', s.x, s.z, s.yaw),
          resetExterior: (spawn: ZombieSpawn) => actor.brain.resetAt(spawn.x, 0, spawn.z, spawn.yaw)});
        host.zombies.push(actor); return actor;
      }};
    let warm: () => THREE.Object3D[] = () => [];
    const population = new SurfacePopulation(host).install();
    host.sectionHooks[0].build!(layout);
    const allocated = [...host.zombies];
    expect(warm()).toHaveLength(SURFACE_POPULATION.slots);
    for (let i = 0; i < 30; i++) population.frame(1.3);
    expect(population.report().living).toBe(12);
    for (let round = 0; round < 20; round++) {
      for (const z of host.zombies) if (z.brain.alive) z.brain.damage(1e9, 120, 120);
      population.frame(19);
      for (let i = 0; i < 20; i++) population.frame(1.3);
      expect(population.report().active).toBeLessThanOrEqual(12);
      expect(host.zombies).toEqual(allocated);
    }
    expect(population.report().counts.spawned).toBeGreaterThan(100);
    const before = population.report(); host.state = 'paused'; population.frame(1000);
    expect(population.report()).toEqual(before);
    host.sectionHooks[0].teardown!();
    expect(population.report().capacity).toBe(0);
    expect(warm()).toEqual([]);
  });

  it('a reused ordinary brain forgets alert, attack and health state without changing its stats', () => {
    const b = new ZombieBrain('coated', 3, 4, 0), stats = b.stats;
    b.damage(1e9, 2, 1); b.aware = true; b.attackSeq = 23; b.lureChecks = 18;
    b.resetAt(40, 0, 60, 1.5);
    expect(b.alive).toBe(true); expect(b.hp).toBe(stats.hp); expect(b.stats).toBe(stats);
    expect([b.x, b.y, b.z, b.yaw, b.attackSeq, b.lureChecks]).toEqual([40, 0, 60, 1.5, 0, 0]);
    expect(b.aware).toBe(false);
  });
});
