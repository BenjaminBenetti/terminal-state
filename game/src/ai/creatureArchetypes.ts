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
import {STRAINER_CUES, STRAINER_STATS, STRAINER_VOICE_Y} from './strainer'; // Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY)
import {StrainerActor} from './strainerActor'; // Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY)
import {BLIGHT_CUES, BLIGHTBELLY_STATS} from './blightbelly'; // Task track1-siren-blightbelly-20261031 (lane BLIGHT)
import {BlightbellyActor} from './blightbellyActor'; // Task track1-siren-blightbelly-20261031 (lane BLIGHT)
import {SIREN_STATS} from './siren'; // Task track1-siren-blightbelly-20261031 (lane SIREN)
import {SIREN_MODEL_KEY, SirenActor} from './sirenActor'; // Task track1-siren-blightbelly-20261031 (lane SIREN)
import {SIREN_CUES} from './sirenCues'; // Task track1-siren-blightbelly-20261031 (lane SIREN)
import {SCREACHER_CUES, SCREACHER_STATS, SCREACHER_VARIANTS, SCREACHER_VOICE_Y, screacherVariantOf} from './screacher'; // task studio-screacher-production-20261110-221858-01
import {ScreacherActor} from './screacherActor'; // task studio-screacher-production-20261110-221858-01
import {ENEMY_POOL, type EnemyArchetypeId} from './creatureSpawn';
import {CORPSE_TRAITS, type CorpseTrait} from './corpseTrait'; // task studio-corpse-chipper-fuel-20261110-235304-01: what each dead body is

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
  /** Task corpse-chipper (lane CORPSE): an authored clip by name (the humanoid actors; world/corpses.ts poses a body by its Death clip). */
  authoredClip?(name: string): THREE.AnimationClip | null;
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

/**
 * The zombie's cues — exactly the calls game.ts made before iteration 07. Task office-overhaul-20261030 (lane AUDIO): the
 * groans (alert + the idle / chase timer) are enemy VOCALS — audio/sfx.ts gates them by the navigable route from the player
 * (ai/vocalReach.ts) and caps simultaneous vocals; the alert flag marks the one that just saw the player. Swings, footfalls
 * (same storey) and death are unchanged.
 */
export const ZOMBIE_CUES: EnemyCues = {
  alert: (sfx, z) => sfx.groan(z.brain.x, z.brain.y + 1.6, z.brain.z, coatedOf(z), true),
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

/** The rat/dog's cues (Sound Lab creature bank, iteration 07 Lane Q). Mouth height ~0.35 m. Lane AUDIO: growl / snarl are gated vocals. */
export const RATDOG_CUES: EnemyCues = {
  alert: (sfx, z) => sfx.creature('snarl', z.brain.x, z.brain.y + 0.35, z.brain.z, true),
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
  if (archetypeOf(z) === 'blightbelly') return BLIGHT_CUES; // Task track1-siren-blightbelly-20261031 (lane BLIGHT): deep groans, heavy gait
  if (archetypeOf(z) === 'siren') return SIREN_CUES; // Task track1-siren-blightbelly-20261031 (lane SIREN): dormant hum, one wake scream, no groans
  if (archetypeOf(z) === 'strainer') return STRAINER_CUES; // lane FAMILY: the zombie voice calls (deep groan from its taller mouth) + its own wet squelch set
  if (archetypeOf(z) === 'screacher') return SCREACHER_CUES; // the headless one: its own stump voice (echo scream, shriek, wheeze), zombie footfalls
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
  /** Task corpse-chipper: its dead body (ai/corpseTrait.ts CORPSE_TRAITS: undead / humanoid / mass) — eligibility is this trait. */
  corpse: CorpseTrait;
  /**
   * Task studio-screacher-production-20261110-221858-01: a family with SEVERAL approved bodies (one enemy type, the same stats): model
   * variant id (ZombieSpawn.variant) -> lazy model key. `model` is then null; a spawn loads exactly its own variant (ai/enemyModels.ts).
   */
  variantModels?: Readonly<Record<string, string>>;
}

export const ENEMY_ARCHETYPES: Record<EnemyArchetypeId, EnemyArchetypeDef> = {
  zombie: {id: 'zombie', corpse: CORPSE_TRAITS.zombie, label: 'Infected', model: null, stats: null, climbsLadders: true, dropsIntoTrackBed: true, voiceHeight: 1.6,
    source: 'zombie wardrobe registry (ai/outfits.ts); stats ZOMBIE_STATS by shambler / coated type'},
  // Task track1-siren-blightbelly-20261031 (lane SPAWN): key order zombie, blightbelly, siren, ratdog = ENEMY_FAMILY_IDS (= roll order);
  // lane FAMILY (round 4): + strainer, appended last.
  // Task track1-siren-blightbelly-20261031 (lane BLIGHT): the obese, pustule-covered zombie subtype that bursts once when killed
  // (ai/blightbelly.ts stats / burst, ai/blightbellyActor.ts, ai/blightBurst.ts); model lazily loaded per layout (ai/enemyModels.ts).
  blightbelly: {id: 'blightbelly', corpse: CORPSE_TRAITS.blightbelly, label: 'Blightbelly', model: 'enemy_blightbelly', stats: BLIGHTBELLY_STATS, climbsLadders: true, dropsIntoTrackBed: true, voiceHeight: 1.5,
    source: 'Meshy T2.5 text-to-3D (Track 1 Blightbelly attempt 2, refine) -> derivative enemy-blightbelly.glb (lane RIGB: shared 18-joint rig, pustule domes, heavy procedural clips)'},
  // Task track1-siren-blightbelly-20261031 (lane SIREN): dormant floor-hunched humming apparition, woken only by ~2 m proximity, the
  // lit flashlight on her or a hit; then one scream, Rise, fast Run + claw swipes (ai/siren.ts, sirenActor.ts, sirenSystem.ts).
  // No ladder links (no climb clip); voice height = her hunched mouth (standing 1.5). Model lazily loaded per layout (ai/enemyModels.ts).
  siren: {id: 'siren', corpse: CORPSE_TRAITS.siren, label: 'Siren', model: SIREN_MODEL_KEY, stats: SIREN_STATS, climbsLadders: false, dropsIntoTrackBed: true, voiceHeight: 0.5,
    source: 'user-supplied Pale Apparition body + Ghost Dress GLBs (appearance locked) -> derivative enemy-siren.glb (lane RIGS: unit fit, dress attachment, shared 18-joint rig + clips)'},
  ratdog: {id: 'ratdog', corpse: CORPSE_TRAITS.ratdog, label: 'Tunnel scavenger (rat/dog)', model: 'creature_ratdog', stats: RATDOG_STATS, climbsLadders: false, dropsIntoTrackBed: true, voiceHeight: 0.35,
    source: 'Field Notes core asset quadruped-02 concept -> Meshy T2.5 replacement -> derivative creature-ratdog-t25.glb (new rig + procedural clips)'},
  // Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): THE STRAINER, APPENDED LAST (= ENEMY_FAMILY_IDS: every older
  // pool's roll bands unchanged) — a tall, long-reach clawed ordinary-melee infected (ai/strainer.ts stats, ai/strainerActor.ts),
  // weight > 0 only in the service-annex pool (spawnTables STRAINER_CONTEXTS). No ladder links (it lurks in the annex); model lazily
  // loaded per layout (ai/enemyModels.ts).
  strainer: {id: 'strainer', corpse: CORPSE_TRAITS.strainer, label: 'Strainer', model: 'enemy_strainer', stats: STRAINER_STATS, climbsLadders: false, dropsIntoTrackBed: true, voiceHeight: STRAINER_VOICE_Y,
    source: 'user-picked Strainer concept (Beyond the Station) -> derivative enemy-strainer.glb (lane ASSET: shared 18-joint rig, clips Idle / Walk / Run / Attack / Hit / Death, extras enemyStrainer)'},
  // Task studio-screacher-production-20261110-221858-01: THE SCREACHER, APPENDED LAST (= ENEMY_FAMILY_IDS; weight 0 in every pool:
  // placed only by the per-level seeded roster, ai/enemyRoster.ts) — a headless, blind, sound-hunting infected that screams to
  // echolocate (ai/screacher.ts brain / stats, ai/screacherActor.ts). ONE enemy type with four approved bodies (variantModels: the
  // spawn's `variant` picks the GLB; the AI and stats are the same). No ladder links; models lazily loaded per layout.
  screacher: {id: 'screacher', corpse: CORPSE_TRAITS.screacher, label: 'Screacher', model: null, stats: SCREACHER_STATS, climbsLadders: false, dropsIntoTrackBed: true, voiceHeight: SCREACHER_VOICE_Y,
    variantModels: Object.fromEntries(Object.entries(SCREACHER_VARIANTS).map(([id, v]) => [id, v.model])),
    source: 'four user-approved headless concepts (SC01-SC04) -> Meshy T2.5 image-to-3D -> derivatives enemy-screacher-sc01..sc04.glb (shared 18-joint rig, clips Idle / Walk / Run / Attack / Hit / Death / Scream, extras enemyScreacher)'},
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
  // Task track1-siren-blightbelly-20261031 (lane BLIGHT): the Blightbelly when its (lazily loaded) model is there, else a zombie stands in
  if (spawn.archetype === 'blightbelly') {
    const g = models[ENEMY_ARCHETYPES.blightbelly.model!];
    if (g) return {actor: new BlightbellyActor(g, spawn, rand), fallback: false};
    return {actor: zombie(), fallback: true};
  }
  // Task track1-siren-blightbelly-20261031 (lane SIREN): the Siren (dormant) when her lazily loaded model is there. The game never asks
  // without it (ai/sirenSystem.ts skip(): the spawn is skipped, not a zombie); direct callers (tests / QA) get the counted fallback.
  if (spawn.archetype === 'siren') {
    const g = models[ENEMY_ARCHETYPES.siren.model!];
    if (g) return {actor: new SirenActor(g, spawn, rand), fallback: false};
    return {actor: zombie(), fallback: true};
  }
  // Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): the Strainer when its (lazily loaded) model is there, else the
  // Blightbelly's contract — a counted zombie stand-in (QA `fallback`; never a T-pose / slide)
  if (spawn.archetype === 'strainer') {
    const g = models[ENEMY_ARCHETYPES.strainer.model!];
    if (g) return {actor: new StrainerActor(g, spawn, rand), fallback: false};
    return {actor: zombie(), fallback: true};
  }
  // Task studio-screacher-production-20261110-221858-01: the Screacher in its spawn's approved body when that (lazily loaded) variant
  // model is there, else the Strainer's contract — a counted zombie stand-in (QA `fallback`; never a T-pose, a box or another variant)
  if (spawn.archetype === 'screacher') {
    const g = models[SCREACHER_VARIANTS[screacherVariantOf(spawn)].model];
    if (g) return {actor: new ScreacherActor(g, spawn, rand), fallback: false};
    return {actor: zombie(), fallback: true};
  }
  return {actor: zombie(), fallback: false};
}

export {CreatureActor};
