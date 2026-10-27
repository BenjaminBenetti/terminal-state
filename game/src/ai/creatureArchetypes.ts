// Iteration 07 (Lane Q): enemy archetype registry + the generic actor surface the game hosts.
//
// `EnemyActor` is what game.ts / hitscan / damage (wounds, chunks, corpses) / physics (ragdoll) /
// QA use from an enemy. The zombie (ai/zombieActor.ts, unchanged) satisfies it structurally; the
// rat/dog (ai/creatureActor.ts) implements it with quadruped data. Per-archetype audio goes through
// an `EnemyCues` adapter (zombie cues = the existing zombie calls; creature cues = the new Sound Lab
// creature clips). Spawn weights live in ai/creatureSpawn.ts (pure, level-generic).

import type * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {AnimName, ZombieBrain, ZombieStats} from './brain';
import type {HitVolume} from './zombieActor';
import type {MeshSlot, ZombieLook} from './wardrobe';
import type {RagdollTarget} from '../physics/ragdoll';
import type {WoundableActor} from '../damage/wounds';
import type {Sfx} from '../audio/sfx';
import type {ZombieSpawn} from '../gen/station';
import {CreatureActor, RATDOG_STATS} from './creatureActor';
import {ENEMY_POOL, type EnemyArchetypeId} from './creatureSpawn';

export {ENEMY_POOL, type EnemyArchetypeId};

/** The actor-facing surface shared by every enemy archetype (ZombieActor satisfies it as-is). */
export interface EnemyActor extends RagdollTarget, WoundableActor {
  readonly root: THREE.Object3D;
  readonly brain: ZombieBrain;
  readonly meshes: THREE.SkinnedMesh[];
  readonly scale: number;
  hitFlash: number;
  groanT: number;
  deadT: number;
  ragdolled: boolean;
  readonly look: ZombieLook | null;
  readonly hasRig: boolean;
  readonly hitVolumes: HitVolume[];
  updateVolumes(): HitVolume[];
  animate(dt: number, anim: AnimName, speed: number): void;
  syncTransform(): void;
  slotOf(mesh: THREE.Object3D): MeshSlot | null;
  dispose(): void;
  /** Non-zombie archetypes name themselves (absent = zombie). */
  readonly archetype?: EnemyArchetypeId;
  /** Corpse hit volumes for non-humanoid rigs (damage/system.ts uses humanoid bones otherwise). */
  corpseVolumes?(): HitVolume[];
}

export function archetypeOf(z: {archetype?: EnemyArchetypeId}): EnemyArchetypeId {
  return z.archetype ?? 'zombie';
}

/** Per-archetype positional audio (all clips are Sound Lab derivatives; missing ones stay silent). */
export interface EnemyCues {
  /** Became aware of the player. */
  alert(sfx: Sfx, z: EnemyActor): void;
  /** A new attack started. */
  attack(sfx: Sfx, z: EnemyActor): void;
  /** Per-frame: idle vocal timer (uses z.groanT), footsteps / climbing. `moved` = ground speed. */
  tick(sfx: Sfx, z: EnemyActor, dt: number, moved: number, dist: number, rand: () => number): void;
  /** Hit but not killed. */
  hurt(sfx: Sfx, z: EnemyActor): void;
  death(sfx: Sfx, z: EnemyActor): void;
}

const coatedOf = (z: EnemyActor) => z.brain.type === 'coated';

/** The zombie's cues — exactly the calls game.ts made before iteration 07. */
export const ZOMBIE_CUES: EnemyCues = {
  alert: (sfx, z) => sfx.groan(z.brain.x, z.brain.y + 1.6, z.brain.z, coatedOf(z)),
  attack: (sfx, z) => sfx.zombieAttack(z.brain.x, z.brain.y + 1.5, z.brain.z),
  tick(sfx, z, dt, moved, dist, rand) {
    const b = z.brain;
    if (!b.alive) return;
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = (b.aware ? 2.5 : 6) + rand() * 6; if (dist < 22) sfx.groan(b.x, b.y + 1.6, b.z, coatedOf(z)); }
    if (b.climbing) sfx.zombieClimb(z, b.x, b.y, b.z, dt); // Lane S: rung clanks on a ladder
    else sfx.zombieGait(z, b.x, b.z, moved, dt, coatedOf(z), b.y);
  },
  hurt: () => {},
  death: (sfx, z) => sfx.zombieDeath(z.brain.x, z.brain.y + 1.4, z.brain.z),
};

/** The rat/dog's cues (Sound Lab creature bank, iteration 07 Lane Q). Mouth height ~0.35 m. */
export const RATDOG_CUES: EnemyCues = {
  alert: (sfx, z) => sfx.creature('snarl', z.brain.x, z.brain.y + 0.35, z.brain.z),
  attack: (sfx, z) => sfx.creature('bite', z.brain.x, z.brain.y + 0.32, z.brain.z),
  tick(sfx, z, dt, moved, dist, rand) {
    const b = z.brain;
    if (!b.alive) return;
    z.groanT -= dt;
    if (z.groanT <= 0) {
      z.groanT = (b.aware ? 3 : 7) + rand() * 6;
      if (dist < 20) sfx.creature(b.aware && rand() < 0.4 ? 'snarl' : 'growl', b.x, b.y + 0.35, b.z);
    }
    sfx.creatureGait(z, b.x, b.z, moved, dt, b.y);
  },
  hurt: (sfx, z) => sfx.creature('yelp', z.brain.x, z.brain.y + 0.35, z.brain.z),
  death: (sfx, z) => sfx.creature('death', z.brain.x, z.brain.y + 0.3, z.brain.z),
};

export function enemyCues(z: EnemyActor): EnemyCues {
  return archetypeOf(z) === 'ratdog' ? RATDOG_CUES : ZOMBIE_CUES;
}

/** Archetype registry (data only; level-generic). */
export interface EnemyArchetypeDef {
  id: EnemyArchetypeId;
  label: string;
  /** Model key in assets/manifest.ts (zombies use the wardrobe registry instead). */
  model: string | null;
  stats: ZombieStats | null;
  climbsLadders: boolean;
  dropsIntoTrackBed: boolean;
  /** Feet-to-voice height for positional audio (m). */
  voiceHeight: number;
  source: string;
}

export const ENEMY_ARCHETYPES: Record<EnemyArchetypeId, EnemyArchetypeDef> = {
  zombie: {id: 'zombie', label: 'Infected', model: null, stats: null, climbsLadders: true, dropsIntoTrackBed: true, voiceHeight: 1.6,
    source: 'zombie wardrobe registry (ai/outfits.ts); stats ZOMBIE_STATS by shambler / coated type'},
  ratdog: {id: 'ratdog', label: 'Tunnel scavenger (rat/dog)', model: 'creature_ratdog', stats: RATDOG_STATS, climbsLadders: false, dropsIntoTrackBed: true, voiceHeight: 0.35,
    source: 'Field Notes core asset quadruped-02 -> derivative creature-ratdog.glb (new rig + procedural clips)'},
};

/**
 * Build the actor for a spawn: the rat/dog when the spawn's archetype says so AND its model is
 * loaded (else a zombie stands in — reported by QA as `fallback`), otherwise the zombie builder.
 */
export function createEnemyActor(spawn: ZombieSpawn, models: Record<string, GLTF | undefined>, rand: () => number, zombie: () => EnemyActor): {actor: EnemyActor; fallback: boolean} {
  if (spawn.archetype === 'ratdog') {
    const g = models[ENEMY_ARCHETYPES.ratdog.model!];
    if (g) return {actor: new CreatureActor(g, spawn, rand), fallback: false};
    return {actor: zombie(), fallback: true};
  }
  return {actor: zombie(), fallback: false};
}

export {CreatureActor};
