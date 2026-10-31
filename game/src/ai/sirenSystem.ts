// Task track1-siren-blightbelly-20261031 (lane SIREN): the game side of the Siren family — installed once on the Game (installSirens).
//
//  - LEVEL-SPECIFIC MODEL: `enemy_siren` is in lane BLIGHT's generic lazy enemy-model table (ai/enemyModels.ts: fetched through the
//    game's lazy model library only for a section whose layout places a Siren — Office now; a future level whose profile enables
//    her). The Subway (Siren weight 0) never fetches it; the library's trim keeps it while a section uses it.
//  - MISSING MODEL: a Siren spawn whose model is not loaded is SKIPPED (not built, never a zombie stand-in): `skip()` (the build
//    loop asks before spawnEnemy) counts it and warns once per section. Her layout index is not marked killed: she appears on a
//    later visit once the model is there. (createEnemyActor's zombie fallback for a model-less Siren is only reachable by direct
//    callers: tests / QA.)
//  - ADOPT (spawnEnemy): every Siren actor is tracked. A live section build (`layout.zombies[index] === spawn`) consults the run
//    memory: an index remembered AWAKE is restored awake (SirenBrain.restoreAwake: standing, ordinary awake hunter — idle / wander,
//    zombie sight + hearing, chase on sight — no hum, no scream, no veins, never dormant again); otherwise she starts DORMANT and
//    gets her ground-corruption patch (world/sirenVeins.ts). Positions are not remembered for any enemy: she stands at her
//    placement again. Dead Sirens stay dead through the generic killed indices (run/memory.ts).
//  - PERSISTENCE: the wake is written at once to the section's lane store 'siren' ({awake: layout indices}, JSON-safe; Retry
//    level restores the level-entry snapshot like every other section memory, NewGame starts a fresh run).
//  - FRAME: wake / death -> the patch fades out (SIREN_VEINS.fadeOutS) and is disposed; teardown disposes every patch and fades
//    any hum. Debug (QA) Siren spawns are tracked for veins but never persisted.

import type * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {Levels} from '../gen/levels';
import type {ZombieSpawn} from '../gen/station';
import type {Sfx} from '../audio/sfx';
import type {EnemyActor} from './creatureArchetypes';
import {SirenBrain} from './siren';
import {SIREN_MODEL_KEY} from './sirenActor';
import {stopSirenHum} from './sirenCues';
import {SirenVeinField} from '../world/sirenVeins';

/** Run-memory lane store key (per section). */
export const SIREN_LANE = 'siren';
export interface SirenStore { awake: number[] }

/** Deterministic 0..1 vein seed per (level seed, spawn index). */
export function sirenVeinSeed(levelSeed: number, index: number): number {
  let h = (Math.imul((levelSeed >>> 0) ^ 0x5f356495, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export interface SirenHost {
  scene: THREE.Object3D;
  levels: Pick<Levels, 'supportIn' | 'lineOfSight' | 'main'>;
  layout: {seed: number; zombies: readonly ZombieSpawn[]};
  /** Read through the host (NewGame replaces the run). */
  run: {laneStore<T = unknown>(lane: string): T | undefined; setLaneStore(lane: string, data: unknown): void};
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  warmRegistry: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  propModels: {get(key: string): GLTF | undefined};
  sfx: Sfx;
}

interface Tracked { actor: EnemyActor; brain: SirenBrain; index: number; persist: boolean; recorded: boolean }

export class SirenSystem {
  readonly veins = new SirenVeinField();
  private tracked: Tracked[] = [];
  /** Siren spawns skipped because her model was not loaded (this section / in total), and wakes written to the run memory. */
  skippedHere = 0;
  skippedTotal = 0;
  recordedWakes = 0;
  private warned = false;

  constructor(private readonly host: SirenHost) {}

  install(): this {
    const h = this.host;
    h.scene.add(this.veins.group);
    h.frameHooks.push(dt => this.frame(dt));
    h.sectionHooks.push({teardown: () => this.teardown()});
    h.warmRegistry.addPool('siren-veins', () => [this.veins.prototype]);
    return this;
  }

  /** The loaded Siren model (lazy library), if any. */
  model(): GLTF | undefined {
    return this.host.propModels.get(SIREN_MODEL_KEY);
  }

  /** True = do not build this spawn (a Siren without her model): counted, one console warning per section. */
  skip(spawn: {archetype?: string}): boolean {
    if (spawn.archetype !== 'siren' || this.model()) return false;
    this.skippedHere++;
    this.skippedTotal++;
    if (!this.warned) {
      this.warned = true;
      console.warn(`Track1 (SIREN): model '${SIREN_MODEL_KEY}' is not loaded — Siren spawns are skipped (never shown as an ordinary zombie)`);
    }
    return true;
  }

  /** Track a freshly spawned enemy (any archetype; only Sirens are kept). See the header for dormant / restored-awake. */
  adopt(actor: EnemyActor, spawn: ZombieSpawn, index: number): void {
    const b = actor.brain;
    if (!(b instanceof SirenBrain)) return;
    const persist = index >= 0 && this.host.layout.zombies[index] === spawn;
    if (persist && this.awakeIndices().includes(index)) b.restoreAwake();
    if (b.dormant) this.veins.add(actor, this.host.levels, b.x, b.y, b.z, sirenVeinSeed(this.host.layout.seed, index));
    this.tracked.push({actor, brain: b, index, persist, recorded: b.wakeReason === 'restored'});
  }

  /** Layout indices remembered awake in the current section. */
  awakeIndices(): number[] {
    return this.host.run.laneStore<SirenStore>(SIREN_LANE)?.awake ?? [];
  }

  /** Per frame (after the enemies updated): record wakes, fade veins of woken / dead Sirens. */
  frame(dt: number): void {
    for (const t of this.tracked) {
      const b = t.brain;
      if (!t.recorded && b.wakes > 0) {
        t.recorded = true;
        if (t.persist) this.record(t.index);
      }
      if ((!b.dormant || !b.alive) && this.veins.get(t.actor) && !this.veins.get(t.actor)!.fading) this.veins.release(t.actor);
    }
    this.veins.update(dt);
  }

  private record(index: number): void {
    const awake = this.awakeIndices();
    if (awake.includes(index)) return;
    this.host.run.setLaneStore(SIREN_LANE, {awake: [...awake, index].sort((a, b) => a - b)} satisfies SirenStore);
    this.recordedWakes++;
  }

  /** Section teardown: every patch now, hums faded, tracking reset. */
  teardown(): void {
    for (const t of this.tracked) stopSirenHum(this.host.sfx, t.actor);
    this.veins.clear();
    this.tracked = [];
    this.skippedHere = 0;
    this.warned = false;
  }

  /** Tracked Sirens (QA). */
  get list(): readonly {actor: EnemyActor; brain: SirenBrain; index: number; persist: boolean}[] {
    return this.tracked;
  }
}

export function installSirens(host: SirenHost): SirenSystem {
  return new SirenSystem(host).install();
}
