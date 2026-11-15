/** A fixed pool of ordinary street infected. Interior actors keep the normal permanent kill memory. */
import * as THREE from 'three';
import type {StationLayout, ZombieSpawn} from '../gen/stationTypes';
import type {EnemyActor} from '../ai/creatureArchetypes';
import {ZombieActor} from '../ai/zombieActor';
import {woundsOf} from '../damage/wounds';

export const SURFACE_POPULATION = Object.freeze({slots: 12, minSpawnM: 32, maxSpawnM: 90, sleepM: 100, corpseS: 18, periodS: 1.25});

export function exteriorSpawnAllowed(distance: number, visible: boolean, occupiedDistance = Infinity): boolean {
  return Number.isFinite(distance) && distance >= SURFACE_POPULATION.minSpawnM && distance <= SURFACE_POPULATION.maxSpawnM &&
    !visible && occupiedDistance >= 8;
}

interface Slot {actor: ZombieActor; active: boolean; deadS: number}
export interface SurfacePopulationHost {
  layout: StationLayout;
  player: {x: number; z: number};
  camera: THREE.PerspectiveCamera;
  zombies: EnemyActor[];
  state: string;
  spawnEnemy(spawn: ZombieSpawn, index: number): EnemyActor;
  physics: {forgetRagdoll(actor: EnemyActor): boolean};
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  warmRegistry: {addPool(name: string, roots: () => THREE.Object3D[]): void};
}

export class SurfacePopulation {
  private slots: Slot[] = [];
  private cursor = 0;
  private tickS = 0;
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();
  readonly counts = {spawned: 0, recycled: 0, slept: 0};

  constructor(private readonly host: SurfacePopulationHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.clear()});
    h.frameHooks.push(dt => this.frame(dt));
    h.warmRegistry.addPool('surface-street-pool', () => this.slots.map(s => s.actor.root));
    return this;
  }

  private build(layout: StationLayout): void {
    this.clear();
    const spawns = layout.surface?.exteriorSpawns;
    if (!spawns?.length) return;
    // Allocate every actor, wardrobe, skeleton and wound material behind the transition's graphics warm-up.
    // No layout identity: these bodies create neither permanent killed indices nor harvestable saved corpse/loot records.
    for (let i = 0; i < SURFACE_POPULATION.slots; i++) {
      const actor = this.host.spawnEnemy({...spawns[i % spawns.length], archetype: 'zombie'}, 10000 + i);
      if (!(actor instanceof ZombieActor)) throw new Error('Surface exterior pool requires the ordinary zombie actor');
      actor.brain.state = 'dead';
      actor.root.visible = false;
      this.slots.push({actor, active: false, deadS: 0});
    }
    this.tickS = 0;
  }

  private clear(): void {
    // Game owns disposal and removes all actors during the same section teardown.
    this.slots = [];
    this.cursor = 0;
    this.tickS = 0;
  }

  sleeping(actor: EnemyActor): boolean {
    return this.slots.some(s => s.actor === actor && !s.active);
  }

  private visible(x: number, y: number, z: number): boolean {
    // A body extends above/around its feet; use a sphere, not a point at ground height.
    return this.frustum.intersectsSphere(new THREE.Sphere(this.point.set(x, y + 1, z), 1.8));
  }

  private deactivate(slot: Slot): void {
    this.host.physics.forgetRagdoll(slot.actor);
    slot.active = false;
    slot.deadS = 0;
    slot.actor.brain.state = 'dead';
    slot.actor.root.visible = false;
  }

  frame(dt: number): void {
    const h = this.host, surface = h.layout?.surface;
    if (!surface || h.state !== 'playing' || !this.slots.length) return;
    h.camera.updateMatrixWorld();
    this.projection.multiplyMatrices(h.camera.projectionMatrix, h.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection, h.camera.coordinateSystem);
    for (const slot of this.slots) {
      if (!slot.active) continue;
      const b = slot.actor.brain, distance = Math.hypot(b.x - h.player.x, b.z - h.player.z);
      if (!b.alive) slot.deadS += dt;
      const outside = distance > SURFACE_POPULATION.sleepM;
      if ((outside || (!b.alive && slot.deadS >= SURFACE_POPULATION.corpseS && distance > 20)) && !this.visible(b.x, b.y, b.z)) {
        this.deactivate(slot);
        if (outside) this.counts.slept++; else this.counts.recycled++;
      }
    }
    this.tickS -= dt;
    if (this.tickS > 0) return;
    this.tickS = SURFACE_POPULATION.periodS;
    const slot = this.slots.find(s => !s.active);
    if (!slot) return;
    // At most one replacement per tick. The bounded candidate list is generated street cells, never interiors/checkpoint.
    for (let n = 0; n < surface.exteriorSpawns.length; n++) {
      const spawn = surface.exteriorSpawns[this.cursor++ % surface.exteriorSpawns.length];
      const distance = Math.hypot(spawn.x - h.player.x, spawn.z - h.player.z);
      let nearest = Infinity;
      for (const s of this.slots) if (s.active) nearest = Math.min(nearest, Math.hypot(s.actor.brain.x - spawn.x, s.actor.brain.z - spawn.z));
      if (!exteriorSpawnAllowed(distance, this.visible(spawn.x, spawn.y ?? 0, spawn.z), nearest)) continue;
      this.host.physics.forgetRagdoll(slot.actor);
      woundsOf(slot.actor)?.reset();
      slot.actor.resetExterior({...spawn, type: slot.actor.brain.type});
      slot.actor.root.visible = true;
      slot.active = true;
      slot.deadS = 0;
      this.counts.spawned++;
      break;
    }
  }

  report() {
    return {capacity: this.slots.length, active: this.slots.filter(s => s.active).length,
      living: this.slots.filter(s => s.active && s.actor.brain.alive).length,
      corpses: this.slots.filter(s => s.active && !s.actor.brain.alive).length, counts: {...this.counts}};
  }
}
