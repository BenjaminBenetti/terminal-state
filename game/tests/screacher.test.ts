// Task studio-screacher-production-20261110-221858-01: THE SCREACHER as a registered enemy — the family and its four model variants (one
// enemy type), the HEADLESS actor (no head hit volume live or dead, a ragdoll without a head part, the Scream clip), its cues, and the
// per-index kill memory. The brain is in screacher-brain.test.ts, real geometry in screacher-world.test.ts, the seeded roster in
// enemy-roster.test.ts, the real GLBs in screacher-asset.test.ts / screacher-contract.test.ts. This file uses a contract-shaped
// synthetic rig.
import {describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ZombieBrain} from '../src/ai/brain';
import {
  SCREACHER_ASSET, SCREACHER_CUES, SCREACHER_ECHO, SCREACHER_MAX_TOP_M, SCREACHER_SCALE, SCREACHER_STATS, SCREACHER_VARIANTS, SCREACHER_VOICE_Y, ScreacherBrain, screacherVariantOf,
} from '../src/ai/screacher';
import {SCREACHER_BONES, SCREACHER_CLIPS, ScreacherActor, headlessRagdollRig} from '../src/ai/screacherActor';
import {SCREACHER_VARIANT_IDS, ROSTER_VERSION, familyInRoster} from '../src/ai/enemyRoster';
import {ENEMY_ARCHETYPES, archetypeOf, createEnemyActor, enemyCues, type EnemyActor} from '../src/ai/creatureArchetypes';
import {ENEMY_FAMILY_IDS} from '../src/ai/spawnTables';
import {ENEMY_MODEL_FILES, enemyModelKeysFor} from '../src/ai/enemyModels';
import {MELEE_MASS, MELEE_PROTECTED} from '../src/combat/meleeImpact';
import {nearestEnemyHit} from '../src/combat/enemyRay';
import {HUMANOID_RIG} from '../src/physics/ragdoll';
import {PhysicsSystem, killImpulseStrength} from '../src/physics/world';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {LEVELS} from '../src/levels/registry';
import {createMemory, enemiesToSpawn, mergeKilled} from '../src/run/memory';
import type {Sfx} from '../src/audio/sfx';
import type {ZombieSpawn} from '../src/gen/stationTypes';

const rng = (seed = 1) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const spawnAt = (x: number, z: number, variant = 'sc01', yaw = 0): ZombieSpawn => ({x, z, yaw, type: 'shambler', area: 0, archetype: 'screacher', variant});
const src = (rel: string) => fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src', rel), 'utf8');

// --- a contract-shaped synthetic headless rig: the shared 18 joints (Neck = the stump's base, Head = a technical joint at its top) ---
const JOINTS: readonly [string, string | null, [number, number, number]][] = [
  ['Root', null, [0, 0, 0]], ['Hips', 'Root', [0, 1.12, 0]], ['Spine', 'Hips', [0, 1.36, 0.01]], ['Chest', 'Spine', [0, 1.62, 0.02]],
  ['Neck', 'Chest', [0, 1.93, 0.02]], ['Head', 'Neck', [0, 2.0, 0.02]],
  ['L_UpperArm', 'Chest', [0.2, 1.84, 0.02]], ['L_Forearm', 'L_UpperArm', [0.25, 1.4, 0.03]], ['L_Hand', 'L_Forearm', [0.28, 0.98, 0.06]],
  ['R_UpperArm', 'Chest', [-0.2, 1.84, 0.02]], ['R_Forearm', 'R_UpperArm', [-0.25, 1.4, 0.03]], ['R_Hand', 'R_Forearm', [-0.28, 0.98, 0.06]],
  ['L_Thigh', 'Hips', [0.11, 1.08, 0]], ['L_Shin', 'L_Thigh', [0.11, 0.56, 0]], ['L_Foot', 'L_Shin', [0.11, 0.07, 0.03]],
  ['R_Thigh', 'Hips', [-0.11, 1.08, 0]], ['R_Shin', 'R_Thigh', [-0.11, 0.56, 0]], ['R_Foot', 'R_Shin', [-0.11, 0.07, 0.03]],
];
function syntheticScreacher(variant = 'sc01', extras: Record<string, unknown> = {}): GLTF {
  const scene = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  for (const [name, parent, world] of JOINTS) {
    const b = new THREE.Bone();
    b.name = name;
    const pw = parent ? JOINTS.find(j => j[0] === parent)![2] : [0, 0, 0];
    b.position.set(world[0] - pw[0], world[1] - pw[1], world[2] - pw[2]);
    (parent ? bones.get(parent)! : scene).add(b);
    bones.set(name, b);
  }
  const geo = new THREE.BoxGeometry(0.36, 2.0, 0.24).translate(0, 1.0, 0);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = 'ScreacherBody';
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(JOINTS.map(([j]) => bones.get(j)!)));
  scene.userData.enemyScreacher = {heightM: 2.0, variant, stump: {top: [0, 2.0, 0.02]}, ...extras};
  const dur: Record<string, number> = {Idle: 3.6, Walk: 1.3, Run: 0.72, Attack: SCREACHER_ASSET.attackDuration, Hit: 0.35, Death: 1.8, Scream: SCREACHER_ASSET.screamDuration};
  const animations = SCREACHER_CLIPS.map(c => new THREE.AnimationClip(c, dur[c], [
    new THREE.VectorKeyframeTrack('Hips.position', [0, dur[c]], [0, 1.12, 0, 0, c === 'Death' ? 0.3 : 1.12, 0]),
  ]));
  return {scene, scenes: [scene], animations, cameras: [], asset: {}, parser: null, userData: {}} as unknown as GLTF;
}
const zombieStandIn = (): EnemyActor => ({brain: new ZombieBrain('shambler', 0, 0, 0), stand: 'zombie'}) as unknown as EnemyActor;

describe('Screacher: the family and its four variants (one enemy type)', () => {
  it('registered after the five older families; one archetype (the user\'s name, spelled "Screacher"); four approved bodies, the same stats', () => {
    // (it was appended last; task studio-bb-production-20261112-234540-01 appended BB after it — the Screacher is still the sixth family, after the same five)
    expect(ENEMY_FAMILY_IDS.slice(5)).toEqual(['screacher', 'bb']);
    expect(Object.keys(ENEMY_ARCHETYPES)).toEqual([...ENEMY_FAMILY_IDS]);
    const def = ENEMY_ARCHETYPES.screacher;
    expect(def).toMatchObject({id: 'screacher', label: 'Screacher', model: null, climbsLadders: false, voiceHeight: SCREACHER_VOICE_Y});
    expect(def.stats).toBe(SCREACHER_STATS); // ONE stats object for every variant
    expect(Object.keys(SCREACHER_VARIANTS)).toEqual([...SCREACHER_VARIANT_IDS]);
    expect(Object.values(SCREACHER_VARIANTS).map(v => v.name)).toEqual(['Hollow Commuter', 'Track Ganger', 'Lopsided Sleeper', 'Long-Stride Runner']);
    expect(def.variantModels).toEqual({sc01: 'enemy_screacher_sc01', sc02: 'enemy_screacher_sc02', sc03: 'enemy_screacher_sc03', sc04: 'enemy_screacher_sc04'});
    for (const [id, v] of Object.entries(SCREACHER_VARIANTS)) expect(ENEMY_MODEL_FILES[v.model].url).toBe(`assets/models/enemy-screacher-${id}.glb`);
    expect(screacherVariantOf({variant: 'sc03'})).toBe('sc03');
    expect(screacherVariantOf({})).toBe('sc01');
    expect(screacherVariantOf({variant: 'nope'})).toBe('sc01');
    // slightly taller than the 1.78 m zombie, well under the Strainer's 2.15; never above the ordinary 2.2 m doors
    expect(SCREACHER_ASSET.heightM).toBe(2.0);
    expect(SCREACHER_ASSET.heightM * SCREACHER_SCALE.max).toBeLessThanOrEqual(SCREACHER_MAX_TOP_M);
    expect(SCREACHER_MAX_TOP_M).toBeLessThan(2.2);
    // a gaunt body: a little easier to shove than a zombie; not a protected boss
    expect(MELEE_MASS.screacher).toBeLessThan(1);
    expect(MELEE_PROTECTED.has('screacher')).toBe(false);
  });

  it('600 hp in every one of the four bodies (user retune 2026-11-11: four times the first 150); the old 150 no longer kills it', () => {
    expect(SCREACHER_STATS.hp).toBe(600);
    expect(SCREACHER_STATS.hp).toBe(4 * 150);
    for (const id of SCREACHER_VARIANT_IDS) {
      const {actor, fallback} = createEnemyActor(spawnAt(1, 2, id), {[SCREACHER_VARIANTS[id].model]: syntheticScreacher(id)}, rng(3), zombieStandIn);
      expect(fallback, id).toBe(false);
      expect((actor as ScreacherActor).variant, id).toBe(id);
      expect(actor.brain.hp, id).toBe(600);
      expect(actor.brain.damage(150, 1, 2), id).toBe(false); // a quarter: it stays standing
      expect(actor.brain.hp, id).toBe(450);
      expect(actor.brain.damage(450, 1, 2), id).toBe(true);
    }
  });

  it('a layout loads exactly the variant models its Screachers wear (nothing for a level without one)', () => {
    expect(enemyModelKeysFor({zombies: [{archetype: 'zombie'}, {}]})).toEqual([]);
    expect(enemyModelKeysFor({zombies: [{archetype: 'screacher', variant: 'sc03'}, {archetype: 'zombie'}]})).toEqual(['enemy_screacher_sc03']);
    expect(enemyModelKeysFor({zombies: [{archetype: 'screacher', variant: 'sc02'}, {archetype: 'screacher', variant: 'sc04'}, {archetype: 'strainer'}]}))
      .toEqual(['enemy_screacher_sc02', 'enemy_screacher_sc04', 'enemy_strainer']);
  });

  it('createEnemyActor: the ScreacherActor in ITS variant\'s body; without that model the counted zombie stand-in (never another variant, never a box)', () => {
    const g2 = syntheticScreacher('sc02');
    const hit = createEnemyActor(spawnAt(1, 2, 'sc02'), {enemy_screacher_sc02: g2}, rng(2), zombieStandIn);
    expect(hit.fallback).toBe(false);
    expect(hit.actor).toBeInstanceOf(ScreacherActor);
    expect((hit.actor as ScreacherActor).variant).toBe('sc02');
    expect(archetypeOf(hit.actor)).toBe('screacher');
    expect(hit.actor.brain).toBeInstanceOf(ScreacherBrain);
    expect(hit.actor.brain.hp).toBe(SCREACHER_STATS.hp);
    expect(enemyCues(hit.actor)).toBe(SCREACHER_CUES);
    // the spawn's own variant is missing (another one is loaded): a counted stand-in
    const miss = createEnemyActor(spawnAt(1, 2, 'sc04'), {enemy_screacher_sc02: g2}, rng(2), zombieStandIn);
    expect(miss.fallback).toBe(true);
    expect((miss.actor as unknown as {stand: string}).stand).toBe('zombie');
  });

  it('the game treats its hit as a standing humanoid claw hit (attacker "screacher"), never a low creature bite', () => {
    expect(src('game.ts')).toMatch(/const claw = archetypeOf\(z\) === 'siren' \|\| archetypeOf\(z\) === 'blightbelly' \|\| archetypeOf\(z\) === 'strainer' \|\| archetypeOf\(z\) === 'screacher';/);
  });
});

describe('Screacher: the headless actor', () => {
  it('the shared rig: all 18 joints (technical Neck / Head kept), every contract clip incl. Scream; its own narrow scale', () => {
    const a = new ScreacherActor(syntheticScreacher(), spawnAt(0, 0), rng(1));
    expect(a.hasRig).toBe(true);
    for (const b of ['Neck', 'Head', ...SCREACHER_BONES]) expect(a.bone(b), b).toBeDefined();
    expect(SCREACHER_BONES).not.toContain('Head'); // no hit volume reads it
    expect(SCREACHER_CLIPS).toEqual(['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Scream']);
    for (let s = 1; s < 40; s++) {
      const k = new ScreacherActor(syntheticScreacher(), spawnAt(0, 0), rng(s)).scale;
      expect(k).toBeGreaterThanOrEqual(SCREACHER_SCALE.min);
      expect(k).toBeLessThanOrEqual(SCREACHER_SCALE.max);
    }
    // a model without the Scream clip is not a complete rig
    const g = syntheticScreacher();
    g.animations = g.animations.filter(c => c.name !== 'Scream');
    expect(new ScreacherActor(g, spawnAt(0, 0), rng(1)).hasRig).toBe(false);
  });

  it('NO head hit volume: a torso capsule (Hips -> the stump\'s base) and limb capsules only — alive and as a corpse', () => {
    const a = new ScreacherActor(syntheticScreacher(), spawnAt(3, 4), rng(5));
    a.animate(1 / 30, 'Idle', 0);
    const vols = a.updateVolumes();
    expect(vols.map(v => v.part)).toEqual(['torso', 'limb', 'limb', 'limb', 'limb']);
    expect(vols.some(v => v.part === 'head')).toBe(false);
    const torso = vols[0];
    expect(torso.b).not.toBeNull();
    expect(torso.b!.y).toBeLessThanOrEqual(1.93 * a.scale + 1e-6); // ends at or under the stump's base (the Neck joint) ...
    expect(torso.b!.y + torso.r).toBeCloseTo(2.0 * a.scale, 2); // ... so that its round cap just reaches the stump's top, never the air above
    expect(a.corpseVolumes().some(v => v.part === 'head')).toBe(false);
    // dead: no live volumes at all
    a.brain.damage(1e6, 0, 0, 0);
    expect(a.updateVolumes()).toEqual([]);
    expect(a.corpseVolumes().map(v => v.part)).toEqual(['torso', 'limb', 'limb', 'limb', 'limb']);
  });

  it('a shot through the empty air where a head would be hits NOTHING; a chest shot is a body hit — never a head hit', () => {
    const a = new ScreacherActor(syntheticScreacher(), spawnAt(0, 0), rng(5));
    a.animate(1 / 30, 'Idle', 0);
    a.updateVolumes();
    const s = a.scale, shoot = (y: number) => nearestEnemyHit({x: 0, y, z: -6}, {x: 0, y: 0, z: 1}, 20, [a]);
    // where a zombie's head is (0.1-0.3 m above the stump top) and just over the stump
    for (const y of [2.0 * s + 0.3, 2.0 * s + 0.24, 2.0 * s + 0.2, 2.0 * s + 0.18]) expect(shoot(y), `y ${y}`).toBeNull();
    expect(shoot(1.5 * s)?.part).toBe('torso');
    expect(shoot(1.2 * s)?.part).toBe('torso');
    // every ray of a dense vertical sweep: only torso / limb, never head
    for (let y = 0.05; y < 2.6; y += 0.05) for (const x of [-0.3, -0.1, 0, 0.1, 0.3]) {
      const h = nearestEnemyHit({x, y, z: -6}, {x: 0, y: 0, z: 1}, 20, [a]);
      if (h) expect(h.part).not.toBe('head');
    }
  });

  it('the game\'s head branches can never fire for it: they key on the struck volume\'s part (source: unchanged head rule)', () => {
    const g = src('game.ts');
    expect(g).toMatch(/e\.head \|\|= bestPart === 'head';/);
    expect(g).toMatch(/const mult = bestPart === 'head' \? def\.headMult : bestPart === 'limb' \? def\.limbMult : 1;/);
  });

  it('ragdoll: the humanoid rig WITHOUT its head part / joint; the corpse falls and settles', () => {
    const rig = headlessRagdollRig();
    expect(rig.parts.some(p => p.name === 'head')).toBe(false);
    expect(rig.parts.length).toBe(HUMANOID_RIG.parts.length - 1);
    expect(Object.keys(rig.joints)).not.toContain('head');
    expect(rig.head).toBeUndefined();
    expect(HUMANOID_RIG.parts.some(p => p.name === 'head')).toBe(true); // the shared rig itself is untouched
    const g = new Grid(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) g.set(x, y, x < 2 || y < 2 || x >= 30 || y >= 30 ? SOLID : FLOOR);
    const ph = new PhysicsSystem(null);
    ph.build({grid: g, props: [], trench: {floorY: -1.15}} as never);
    const a = new ScreacherActor(syntheticScreacher(), spawnAt(8, 8, 'sc01', 0.3), rng(4));
    expect(a.ragdollRig.parts.some(p => p.name === 'head')).toBe(false);
    a.root.position.y = 0;
    for (let i = 0; i < 4; i++) { a.animate(1 / 30, 'Walk', 0.5); a.updateVolumes(); }
    expect(a.brain.damage(SCREACHER_STATS.hp, 8, 11)).toBe(true);
    // a "head" kill hint (impossible from a hit, but the API allows it) must not throw without a head part
    expect(ph.ragdoll(a, {dir: {x: 0, y: -0.1, z: -1}, point: {x: 8, y: 1.3, z: 8}, strength: killImpulseStrength('rifle', 1, 1), bone: 'head'})).toBe(true);
    expect(a.ragdolled).toBe(true);
    for (let t = 0; t < 4; t += 1 / 60) ph.update(1 / 60);
    a.root.updateMatrixWorld(true);
    const hips = a.bone('Hips')!.getWorldPosition(new THREE.Vector3());
    expect(Number.isFinite(hips.x + hips.y + hips.z)).toBe(true);
    expect(hips.y).toBeLessThan(0.8);
    expect(hips.y).toBeGreaterThan(-0.2);
  });

  it('the Scream clip plays while the brain screams, once per scream, and the body returns to its normal clips after', () => {
    const a = new ScreacherActor(syntheticScreacher(), spawnAt(0, 0), rng(1));
    const b = a.brain;
    const w = {px: 50, pz: 50, py: 0, playerAlive: true, los: () => true, walkClear: () => true, findPath: () => null, randomNear: () => null, rand: () => 0.5};
    a.animate(1 / 60, 'Idle', 0);
    expect(a.clip).toBe('Idle');
    b.echoT = 0.001;
    let out = b.update(1 / 60, w);
    expect(b.screaming).toBe(true);
    a.animate(1 / 60, out.anim, 0);
    expect(a.clip).toBe('Scream');
    for (let t = 0; t < SCREACHER_ECHO.holdS - 0.1; t += 1 / 60) { out = b.update(1 / 60, w); a.animate(1 / 60, out.anim, 0); expect(a.clip).toBe('Scream'); }
    for (let t = 0; t < 0.5; t += 1 / 60) { out = b.update(1 / 60, w); a.animate(1 / 60, out.anim, 0); }
    expect(b.screaming).toBe(false);
    expect(a.clip).toBe('Idle');
    // the next scream restarts the clip
    b.echoT = 0.001;
    out = b.update(1 / 60, w);
    a.animate(1 / 60, out.anim, 0);
    expect([b.screamSeq, a.clip]).toEqual([2, 'Scream']);
  });

  it('locomotion clips are time-scaled by the authored ground speeds (extras, else the contract\'s)', () => {
    const a = new ScreacherActor(syntheticScreacher(), spawnAt(0, 0), rng(1));
    expect([a.clipSpeed('Walk'), a.clipSpeed('Run')]).toEqual([SCREACHER_ASSET.walkGroundSpeed, SCREACHER_ASSET.runGroundSpeed]);
    const b = new ScreacherActor(syntheticScreacher('sc01', {clips: {Run: {groundSpeed: 3.5}}}), spawnAt(0, 0), rng(1));
    expect(b.clipSpeed('Run')).toBe(3.5);
  });
});

describe('Screacher: cues (audio only; nothing feeds the AI)', () => {
  it('one scream cue per pulse at the stump; a shriek on turning frenzied; a wheeze while idle and near; hurt / death; zombie footfalls', () => {
    const calls: string[] = [];
    const sfx = {
      screacherScream: (_k: object, _x: number, y: number) => calls.push(`scream@${y.toFixed(2)}`),
      screacherVoice: (kind: string) => calls.push(kind),
      zombieGait: () => calls.push('gait'),
    } as unknown as Sfx;
    const a = new ScreacherActor(syntheticScreacher(), spawnAt(0, 0), rng(1));
    const b = a.brain, cues = enemyCues(a), rand = () => 0.5;
    b.echoT = 1e6;
    cues.tick(sfx, a, 1 / 60, 0, 5, rand);
    expect(calls.filter(c => c.startsWith('scream'))).toEqual([]);
    // an echo pulse
    b.screamSeq++;
    cues.tick(sfx, a, 1 / 60, 0, 5, rand);
    cues.tick(sfx, a, 1 / 60, 0, 5, rand);
    expect(calls.filter(c => c.startsWith('scream'))).toEqual([`scream@${(SCREACHER_VOICE_Y * a.scale).toFixed(2)}`]);
    // frenzy
    b.shriekSeq++;
    cues.tick(sfx, a, 1 / 60, 0, 5, rand);
    expect(calls.filter(c => c === 'shriek').length).toBe(1);
    // the idle wheeze: paced by the cue (seconds apart), only near
    calls.length = 0;
    for (let t = 0; t < 20; t += 1 / 60) cues.tick(sfx, a, 1 / 60, 0, 5, rand);
    const near = calls.filter(c => c === 'wheeze').length;
    expect(near).toBeGreaterThanOrEqual(2);
    expect(near).toBeLessThanOrEqual(7);
    calls.length = 0;
    for (let t = 0; t < 20; t += 1 / 60) cues.tick(sfx, a, 1 / 60, 0, 40, rand);
    expect(calls.filter(c => c === 'wheeze').length).toBe(0); // far away: silent
    expect(calls.includes('gait')).toBe(true); // ordinary footfalls, reused
    calls.length = 0;
    cues.hurt(sfx, a); cues.attack(sfx, a); cues.death(sfx, a); cues.alert(sfx, a);
    expect(calls).toEqual(['hurt', 'hurt', 'death']);
    // the cue adapter never touches the brain's senses
    expect([b.heard, b.counted, b.belief]).toEqual([0, 0, null]);
  });
});

describe('Screacher: persistence (the per-index kill memory; nothing else is saved)', () => {
  it('a level that holds Screachers regenerates them at the same indices in the same bodies; a killed one stays dead', () => {
    let seed = 1;
    while (!familyInRoster('screacher', 'subway', seed)) seed++;
    const gen = () => LEVELS.subway.generate('main', {levelSeed: seed, rosterVersion: ROSTER_VERSION});
    const A = gen(), B = gen();
    const idx = A.zombies.flatMap((z, i) => (z.archetype === 'screacher' ? [i] : []));
    expect(idx.length).toBeGreaterThanOrEqual(1);
    expect(B.zombies.flatMap((z, i) => (z.archetype === 'screacher' ? [i] : []))).toEqual(idx);
    expect(idx.map(i => B.zombies[i].variant)).toEqual(idx.map(i => A.zombies[i].variant));
    const mem = createMemory({level: 'subway', section: 'main'});
    mem.killed = mergeKilled(mem.killed, [idx[0]]);
    const restored = JSON.parse(JSON.stringify(mem));
    expect(enemiesToSpawn(B.zombies.length, restored)).not.toContain(idx[0]);
    for (const i of idx.slice(1)) expect(enemiesToSpawn(B.zombies.length, restored)).toContain(i);
    const v = A.zombies[idx[0]].variant!;
    const {actor, fallback} = createEnemyActor(B.zombies[idx[0]], {[SCREACHER_VARIANTS[v as 'sc01'].model]: syntheticScreacher(v)}, rng(2), zombieStandIn);
    expect([fallback, (actor as ScreacherActor).variant]).toEqual([false, v]);
    // a rebuilt Screacher starts fresh: no belief, calm, its first scream at its deterministic per-spawn offset
    const again = createEnemyActor(B.zombies[idx[0]], {[SCREACHER_VARIANTS[v as 'sc01'].model]: syntheticScreacher(v)}, rng(9), zombieStandIn).actor.brain as ScreacherBrain;
    expect([again.belief, again.heat, again.echoT]).toEqual([null, 0, (actor.brain as ScreacherBrain).echoT]);
  });
});
