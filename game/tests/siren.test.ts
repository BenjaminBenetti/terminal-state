// Task track1-siren-blightbelly-20261031 (lane SIREN): the Siren family — stats derived from source, the DORMANT front end (no wander /
// groans / gunfire hearing / light lure), the three wake triggers with their protections (2 m proximity + sight line + storey; the
// lit flashlight: cone, range, lens-to-body rays, no through-wall / through-floor; direct damage), the one wake (rise -> chase, scream
// exactly once), claw swipes (one hit per swing, LOS, readable wind-up, cooldown, counterplay), hum cadence / lifecycle, the actor's
// clip mapping on a synthetic shared-skeleton rig (the real enemy-siren.glb is lane RIGS's; tests never need it), the game-side
// system (wake persistence across revisits, retry, model-missing skip, QA spawns not persisted) and the vein footprint (bounded,
// clipped to her storey's floor, never through a wall / down a storey; faded and disposed).

import {beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {CELL, FLOOR, Grid, PathFinder} from '../src/gen/grid';
import {levelsOf, singleLevel, type Levels} from '../src/gen/levels';
import {ZOMBIE_STATS, ZombieBrain, type BrainOutput, type BrainWorld} from '../src/ai/brain';
import {moveZombie, settleZombie} from '../src/ai/motor';
import {lureWorld} from '../src/ai/lightLure';
import {LightSources, type LightSource} from '../src/world/lightSources';
import {SIREN_CLAW, SIREN_STATS, SIREN_WAKE, SirenBrain, sirenBodyPoints, sirenLitBy, type SirenLightProbe} from '../src/ai/siren';
import {SIREN_CUES, SIREN_HUM_PACE, firstHumDelay} from '../src/ai/sirenCues';
import {SIREN_CLIPS, SIREN_MODEL_KEY, SirenActor, type SirenExtras} from '../src/ai/sirenActor';
import {SIREN_LANE, SirenSystem, sirenVeinSeed, type SirenHost} from '../src/ai/sirenSystem';
import {ENEMY_ARCHETYPES, createEnemyActor, enemyCues, type EnemyActor} from '../src/ai/creatureArchetypes';
import {RATDOG_STATS} from '../src/ai/creatureActor';
import {SIREN_VEINS, SirenVeinField, VEIN_DATA_KEY, veinCells, veinGeometry, visibleRadius} from '../src/world/sirenVeins';
import {RunState} from '../src/run/runState';
import {enemiesToSpawn, mergeKilled} from '../src/run/memory';
import {SPRINT_SPEED, WALK_SPEED} from '../src/player/player';
import type {Sfx} from '../src/audio/sfx';
import type {ZombieSpawn} from '../src/gen/station';
import type {HitVolume} from '../src/ai/zombieActor';
import {FIX, levelFixture} from './helpers/levelFixture';

const DT = 1 / 30;

// --- fixtures --------------------------------------------------------------------------------------------------------------
// hall: 60 x 20 m (floor 0, ceiling 4), a wall at x = 30..30.5 m from z = 0.5 to 14; open strip z 14..19.5 (as ai-light-lure.test.ts)
function hall(): Levels {
  const g = new Grid(120, 40);
  for (let y = 1; y < 39; y++) for (let x = 1; x < 119; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.floor[i] = 0; g.ceil[i] = 4; g.area[i] = 0; }
  for (let y = 1; y <= 27; y++) { const i = g.idx(60, y); g.cells[i] = 0; g.ceil[i] = 0; g.area[i] = -1; }
  return singleLevel(g);
}
const HL = hall();
const HPF = new PathFinder(HL);
const FL = levelsOf(levelFixture());
const FPF = new PathFinder(FL);

interface Pl { x: number; y: number; z: number; alive: boolean }
interface Sim { L: Levels; pf: PathFinder; sources: LightSources; player: Pl; paths: {noLinks?: boolean}[]; rays: number }
const sim = (L: Levels, pf: PathFinder, player: Partial<Pl>): Sim => ({L, pf, sources: new LightSources(), player: {x: 0, y: 0, z: 0, alive: true, ...player}, paths: [], rays: 0});
function worldOf(s: Sim): BrainWorld {
  const {L, pf, player: p} = s;
  const lw = lureWorld(L, s.sources);
  let r = 11;
  return {
    px: p.x, pz: p.z, py: p.y, playerAlive: p.alive,
    los: (ax, az, bx, bz, ay, by) => L.lineOfSight({x: ax, y: (ay ?? 0) + 1.5, z: az}, {x: bx, y: (by ?? 0) + 1.5, z: bz}),
    walkClear: (ax, az, bx, bz, rad, ay, by) => L.walkLineClear(ax, ay ?? 0, az, bx, bz, rad, by),
    findPath: (ax, az, bx, bz, o) => { s.paths.push({...o}); return pf.find(ax, az, bx, bz, 0.34, 26000, o); },
    randomNear: (x, z, _r, y) => { const sup = L.supportIn(x + 1.5, z, (y ?? 0) + 0.05); return sup ? [x + 1.5, z, sup.floor] : null; },
    rand: () => ((r = (r * 16807) % 2147483647) / 2147483647),
    ...lw,
    seePoint: (ax, ay, az, bx, by, bz) => { s.rays++; return lw.seePoint(ax, ay, az, bx, by, bz); },
  };
}
/** One frame of game.ts updateZombies for one enemy (brain, turn, motor). */
function frame(s: Sim, b: ZombieBrain): BrainOutput {
  const out = b.update(DT, worldOf(s));
  if (out.face !== null) {
    let d = out.face - b.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * DT;
    b.yaw += Math.max(-turn, Math.min(turn, d));
  }
  moveZombie(b, out, DT, s.L, null);
  settleZombie(b, s.L, null);
  return out;
}
function run(s: Sim, b: ZombieBrain, seconds: number, until?: (b: ZombieBrain) => boolean): {states: Set<string>; maxSpeed: number; t: number} {
  const states = new Set<string>();
  let maxSpeed = 0, t = 0;
  for (let f = 0; f < seconds / DT; f++) {
    const x0 = b.x, z0 = b.z;
    frame(s, b);
    t += DT;
    states.add(b.state);
    maxSpeed = Math.max(maxSpeed, Math.hypot(b.x - x0, b.z - z0) / DT);
    if (until?.(b)) break;
  }
  return {states, maxSpeed, t};
}
/** The light lane's flashlight source (player/flashlight.ts): emitter at the eye, unit beam dir, range 20 m x output. */
const torch = (s: Sim, eye: {x: number; y: number; z: number}, at: {x: number; y: number; z: number}, output = 1): LightSource => {
  const dx = at.x - eye.x, dy = at.y - eye.y, dz = at.z - eye.z, d = Math.hypot(dx, dy, dz);
  return s.sources.add({kind: 'flashlight', active: output > 0, ...eye, dir: {x: dx / d, y: dy / d, z: dz / d}, cosHalfAngle: Math.cos(0.58), spot: at, attractRange: 20 * output, intensity: output});
};
const torso = (b: SirenBrain) => sirenBodyPoints(b)[0];

// --- synthetic shared-skeleton rig (stands in for lane RIGS's enemy-siren.glb in tests only) -------------------------------------
const JOINTS: [string, string | null, [number, number, number]][] = [
  ['Root', null, [0, 0, 0]], ['Hips', 'Root', [0, 0.95, 0]], ['Spine', 'Hips', [0, 0.12, 0]], ['Chest', 'Spine', [0, 0.18, 0]],
  ['Neck', 'Chest', [0, 0.2, 0]], ['Head', 'Neck', [0, 0.1, 0]],
  ['L_UpperArm', 'Chest', [0.18, 0.12, 0]], ['L_Forearm', 'L_UpperArm', [0.28, 0, 0]], ['L_Hand', 'L_Forearm', [0.25, 0, 0]],
  ['R_UpperArm', 'Chest', [-0.18, 0.12, 0]], ['R_Forearm', 'R_UpperArm', [-0.28, 0, 0]], ['R_Hand', 'R_Forearm', [-0.25, 0, 0]],
  ['L_Thigh', 'Hips', [0.1, -0.05, 0]], ['L_Shin', 'L_Thigh', [0, -0.42, 0]], ['L_Foot', 'L_Shin', [0, -0.42, 0]],
  ['R_Thigh', 'Hips', [-0.1, -0.05, 0]], ['R_Shin', 'R_Thigh', [0, -0.42, 0]], ['R_Foot', 'R_Shin', [0, -0.42, 0]],
];
function syntheticSiren(clips: readonly string[] = SIREN_CLIPS): GLTF {
  const scene = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  for (const [n, parent, p] of JOINTS) {
    const b = new THREE.Bone(); b.name = n; b.position.set(...p); bones.set(n, b);
    if (parent) bones.get(parent)!.add(b); else scene.add(b);
  }
  const geo = new THREE.BoxGeometry(0.3, 1.6, 0.2);
  const n = geo.attributes.position.count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({color: 0xdddddd}));
  mesh.name = 'SirenBody';
  const list = JOINTS.map(([nm]) => bones.get(nm)!);
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  const dress = new THREE.SkinnedMesh(geo.clone(), new THREE.MeshStandardMaterial({color: 0x99aabb}));
  dress.name = 'GhostDress';
  scene.add(dress);
  dress.bind(mesh.skeleton);
  // Dormant: hips low (0.35 m) and the spine folded forward; Rise: hips 0.35 -> 0.95 over 1.2 s; the rest: a gentle hips bob
  const fwd = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.1).toArray();
  const id = [0, 0, 0, 1];
  const make = (name: string): THREE.AnimationClip => {
    if (name === 'Dormant') return new THREE.AnimationClip(name, 3, [new THREE.VectorKeyframeTrack('Hips.position', [0, 3], [0, 0.35, 0, 0, 0.37, 0]), new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 3], [...fwd, ...fwd])]);
    if (name === 'Rise') return new THREE.AnimationClip(name, 1.2, [new THREE.VectorKeyframeTrack('Hips.position', [0, 1.2], [0, 0.35, 0, 0, 0.95, 0]), new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 1.2], [...fwd, ...id])]);
    return new THREE.AnimationClip(name, name === 'Attack' ? 1.0 : 0.8, [new THREE.VectorKeyframeTrack('Hips.position', [0, 0.4, 0.8], [0, 0.95, 0, 0, 0.9, 0, 0, 0.95, 0]), new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 0.8], [...id, ...id])]);
  };
  scene.userData.enemySiren = {clips: {Rise: {duration: 1.2}, Run: {groundSpeed: 3.6}}};
  return {scene, scenes: [scene], animations: clips.map(make), cameras: [], asset: {}, parser: null, userData: {}} as unknown as GLTF;
}
const spawnAt = (x: number, z: number, yaw = 0, extra: Partial<ZombieSpawn> = {}): ZombieSpawn => ({x, z, yaw, type: 'coated', area: 0, archetype: 'siren', ...extra});
const seq = (k = 3) => () => ((k = (k * 16807) % 2147483647) / 2147483647);

// ===========================================================================================================================
describe('Siren family: stats from source, registry entry', () => {
  it('max health = 2 x the ordinary zombie (shambler) from ZOMBIE_STATS — not the coated variant, not a stale literal', () => {
    expect(SIREN_STATS.hp).toBe(2 * ZOMBIE_STATS.shambler.hp);
    expect(SIREN_STATS.hp).not.toBe(2 * ZOMBIE_STATS.coated.hp);
    // a coated spawn type never leaks into her (wardrobe / coated inheritance bypassed)
    const b = new SirenBrain(1, 1, 0);
    expect(b.type).toBe('shambler');
    expect(b.hp).toBe(SIREN_STATS.hp);
    expect(b.stats).toBe(SIREN_STATS);
  });
  it('chase speed: visibly faster than a shambler, near the rat/dog, between a walking and a sprinting player (counterplay)', () => {
    expect(SIREN_STATS.chaseSpeed).toBeGreaterThan(ZOMBIE_STATS.shambler.chaseSpeed * 1.5);
    expect(SIREN_STATS.chaseSpeed).toBeLessThanOrEqual(RATDOG_STATS.chaseSpeed);
    expect(SIREN_STATS.chaseSpeed).toBeGreaterThan(WALK_SPEED);
    expect(SIREN_STATS.chaseSpeed).toBeLessThan(SPRINT_SPEED);
    // readable wind-up + recovery: one swing per (duration + cooldown), like the shambler's 1.1 + 0.45
    expect(SIREN_STATS.attackImpact).toBeGreaterThanOrEqual(0.35);
    expect(SIREN_STATS.attackDuration + SIREN_STATS.attackCooldown!).toBeCloseTo(ZOMBIE_STATS.shambler.attackDuration + 0.45, 5);
  });
  it('ENEMY_ARCHETYPES.siren: her stats / model key, no ladders; enemyCues routes to the Siren adapter', () => {
    const def = ENEMY_ARCHETYPES.siren;
    expect(def.stats).toBe(SIREN_STATS);
    expect(def.model).toBe(SIREN_MODEL_KEY);
    expect(def.climbsLadders).toBe(false);
    expect(Object.keys(ENEMY_ARCHETYPES)).toEqual(['zombie', 'blightbelly', 'siren', 'ratdog']);
    const z = {archetype: 'siren', brain: new SirenBrain(0, 0, 0)} as unknown as EnemyActor;
    expect(enemyCues(z)).toBe(SIREN_CUES);
  });
});

describe('Siren dormant: still, silent of groans, deaf to gunfire, blind to lures', () => {
  it('stays put for 20 s with the player 10 m away in plain sight (no wander, no path search, Idle output)', () => {
    const s = sim(HL, HPF, {x: 20, z: 15});
    const b = new SirenBrain(20, 5, 0);
    const tr = run(s, b, 20);
    expect([...tr.states]).toEqual(['dormant']);
    expect(tr.maxSpeed).toBe(0);
    expect(s.paths.length).toBe(0);
    expect(b.x).toBe(20); expect(b.z).toBe(5);
    expect(b.aware).toBe(false);
  });
  it('gunfire / knife noise at ANY radius is ignored while dormant (no ordinary hearing wake)', () => {
    const b = new SirenBrain(20, 5, 0);
    b.hear(22, 5, 1000, 0);
    expect(b.state).toBe('dormant');
    expect(b.aware).toBe(false);
  });
  it('a burning flare beside her never lures or wakes her (no LURABLE state, no investigate)', () => {
    const s = sim(HL, HPF, {x: 50, z: 30});
    s.sources.add({kind: 'flare', active: true, x: 21, y: 0.1, z: 5, dir: null, cosHalfAngle: 1, spot: {x: 21, y: 0.1, z: 5}, attractRange: 28, intensity: 1});
    const b = new SirenBrain(20, 5, 0);
    const tr = run(s, b, 6);
    expect([...tr.states]).toEqual(['dormant']);
    expect(b.lureStarts).toBe(0);
    expect(b.lightChecks).toBeGreaterThan(20); // checked ~10 Hz, but a flare is not a wake light
    expect(b.lightRays).toBe(0);
  });
});

describe('Siren wake trigger (a): ~2 m proximity with sight-line and storey protection', () => {
  it('2.2 m away: dormant; 1.8 m with a sight line: wakes (proximity) and rises', () => {
    const s = sim(HL, HPF, {x: 22.2, z: 5});
    const b = new SirenBrain(20, 5, 0);
    run(s, b, 1);
    expect(b.state).toBe('dormant');
    s.player.x = 21.8;
    run(s, b, DT * 2);
    expect(b.state).toBe('rise');
    expect(b.wakeReason).toBe('proximity');
  });
  it('1.6 m away through a wall: never wakes', () => {
    const s = sim(HL, HPF, {x: 31.0, z: 5});
    const b = new SirenBrain(29.4, 5, 0);
    run(s, b, 3);
    expect(b.state).toBe('dormant');
  });
  it('directly above her on the next storey (0.5 m plan distance, 4.75 m up): never wakes', () => {
    const s = sim(FL, FPF, {x: 23, y: FIX.upperY, z: 6.5});
    const b = new SirenBrain(23, 6, 0);
    b.y = 0;
    run(s, b, 3);
    expect(b.state).toBe('dormant');
  });
});

describe('Siren wake trigger (b): the active flashlight actually on her body', () => {
  const eye = {x: 28, y: 1.6, z: 5};
  it('lit inside the cone, in range, clear lens-to-body ray: wakes (flashlight)', () => {
    const s = sim(HL, HPF, {x: 28, z: 5});
    const b = new SirenBrain(20, 5, 0);
    const L = torch(s, eye, torso(b));
    run(s, b, 0.3);
    expect(b.state).toBe('rise');
    expect(b.wakeReason).toBe('flashlight');
    expect(b.wakeLight).toBe(L.id);
    expect(s.rays).toBeGreaterThan(0);
  });
  it('torch on but pointed away (off-cone), switched off, or too dim for the distance: dormant', () => {
    for (const setup of [
      (s: Sim) => torch(s, eye, {x: 40, y: 1.6, z: 5}),        // beam away from her
      (s: Sim, b: SirenBrain) => torch(s, eye, {x: torso(b).x, y: torso(b).y, z: torso(b).z + 7}), // swept past: every body point >= 38 deg off
      (s: Sim, b: SirenBrain) => torch(s, eye, torso(b), 0),    // off (inactive, range 0)
      (s: Sim, b: SirenBrain) => torch(s, eye, torso(b), 0.3),  // weak battery: 6 m range, she is 8 m away
    ]) {
      const s = sim(HL, HPF, {x: 28, z: 5});
      const b = new SirenBrain(20, 5, 0);
      setup(s, b);
      run(s, b, 1);
      expect(b.state).toBe('dormant');
    }
  });
  it('lit through a wall: dormant (the same geometry with a clear line wakes her)', () => {
    const blocked = sim(HL, HPF, {x: 34, z: 5});
    const b1 = new SirenBrain(29, 5, 0);
    torch(blocked, {x: 34, y: 1.6, z: 5}, torso(b1));
    run(blocked, b1, 1);
    expect(b1.state).toBe('dormant');
    expect(b1.lightRays).toBeGreaterThan(0); // in the cone and range: the ray is what said no
    const open = sim(HL, HPF, {x: 34, z: 17});
    const b2 = new SirenBrain(29, 17, 0);
    torch(open, {x: 34, y: 1.6, z: 17}, torso(b2));
    run(open, b2, 1);
    expect(b2.wakeReason).toBe('flashlight');
  });
  it('lit straight down from the storey above through the slab: dormant; lit across her own floor: wakes', () => {
    const above = sim(FL, FPF, {x: 23, y: FIX.upperY, z: 8.5});
    const b = new SirenBrain(23, 6, 0);
    b.y = 0;
    torch(above, {x: 23, y: FIX.upperY + 1.6, z: 7.5}, torso(b));
    run(above, b, 1);
    expect(b.state).toBe('dormant');
    const same = sim(FL, FPF, {x: 27, y: 0, z: 6});
    const b2 = new SirenBrain(23, 6, 0);
    b2.y = 0;
    torch(same, {x: 27, y: 1.6, z: 6}, torso(b2));
    run(same, b2, 1);
    expect(b2.wakeReason).toBe('flashlight');
  });
  it('sirenLitBy probes: per point range / cone / ray (QA); flares and the body glow are never wake lights', () => {
    const s = sim(HL, HPF, {});
    const b = new SirenBrain(20, 5, 0);
    torch(s, eye, torso(b));
    s.sources.add({kind: 'bodyGlow', active: true, x: 20.5, y: 1, z: 5, dir: null, cosHalfAngle: 1, spot: null, attractRange: 0, intensity: 1});
    const probes: SirenLightProbe[] = [];
    const lit = sirenLitBy(b, s.sources.list, lureWorld(HL, s.sources).seePoint, 1, undefined, probes);
    expect(lit?.kind).toBe('flashlight');
    expect(probes.length).toBe(SIREN_WAKE.flashlight.points.length); // only the torch is probed
    expect(probes.every(p => p.inRange)).toBe(true);
    expect(probes.some(p => p.inCone && p.clear)).toBe(true);
  });
});

describe('Siren wake trigger (c) direct damage, and the ONE wake', () => {
  it('a hit wakes her without a stagger (hp drops); a killing hit in her sleep: dead, no wake, no scream', () => {
    const b = new SirenBrain(5, 5, 0);
    expect(b.damage(30, 9, 5, 0)).toBe(false);
    expect(b.state).toBe('rise');
    expect(b.wakeReason).toBe('damage');
    expect(b.hp).toBe(SIREN_STATS.hp - 30);
    expect(b.damage(25, 9, 5, 0)).toBe(false); // rising: no stagger either
    expect(b.state).toBe('rise');
    const k = new SirenBrain(5, 5, 0);
    expect(k.damage(SIREN_STATS.hp + 1, 9, 5, 0)).toBe(true);
    expect(k.state).toBe('dead');
    expect(k.wakes).toBe(0);
    expect(k.takeScream()).toBe(false);
    expect(k.damage(10, 9, 5, 0)).toBe(false); // dies once
  });
  it('rise -> chase at her chase speed toward the player (no ladder links); never dormant again, scream exactly once', () => {
    const s = sim(HL, HPF, {x: 21.8, z: 5});
    const b = new SirenBrain(20, 5, 0);
    run(s, b, 0.1);
    expect(b.state).toBe('rise');
    const rose = run(s, b, 3, x => x.state !== 'rise');
    expect(rose.t).toBeGreaterThan(SIREN_WAKE.riseS - 0.2); // ~0.1 s of the rise already ran above
    expect(rose.t).toBeLessThan(SIREN_WAKE.riseS + 0.05);
    expect(b.state).toBe('chase');
    s.player.x = 32; s.player.z = 17; // run off: she chases at her speed
    const chase = run(s, b, 1.5);
    expect(chase.maxSpeed).toBeGreaterThan(SIREN_STATS.chaseSpeed * 0.9);
    expect(chase.maxSpeed).toBeLessThan(SIREN_STATS.chaseSpeed * 1.1);
    expect(s.paths.every(o => o.noLinks === true)).toBe(true);
    // the scream: exactly once, whatever happens next
    expect(b.takeScream()).toBe(true);
    expect(b.takeScream()).toBe(false);
    expect(b.wake('proximity')).toBe(false);
    b.damage(5, 0, 0, 0);
    s.player.x = b.x + 1; s.player.z = b.z;
    run(s, b, 5);
    expect(b.takeScream()).toBe(false);
    expect(b.screams).toBe(1);
    expect(b.wakes).toBe(1);
    expect(b.state).not.toBe('dormant');
  });
  it('awake, she hears gunfire again (ordinary hunter): a woken Siren that lost the player chases a shot', () => {
    const b = new SirenBrain(5, 5, 0, SIREN_STATS, false);
    expect(b.state).toBe('idle');
    b.hear(15, 5, 30, 0);
    expect(b.state).toBe('chase');
  });
});

describe('Siren claws: wind-up, one hit per swing, LOS, cooldown, counterplay', () => {
  const fake = (o: {px: number; pz: number; los?: () => boolean}): BrainWorld & {px: number; pz: number} => {
    const w = {px: o.px, pz: o.pz, py: 0, playerAlive: true, los: o.los ?? (() => true), walkClear: () => true,
      findPath: (_ax: number, _az: number, bx: number, bz: number) => [[bx, bz]] as [number, number][], randomNear: () => null, rand: () => 0.5};
    return w as BrainWorld & {px: number; pz: number};
  };
  const step = (b: SirenBrain, w: BrainWorld, dt = 1 / 60) => {
    const out = b.update(dt, w);
    b.x += out.dirX * out.speed * dt; b.z += out.dirZ * out.speed * dt;
    if (out.face !== null) b.yaw = out.face;
    return out;
  };
  it('a player standing in reach takes exactly one hit per swing, swings spaced by duration + cooldown, lunging in the wind-up', () => {
    const b = new SirenBrain(0, 0, 0, SIREN_STATS, false);
    const w = fake({px: 0, pz: 1.0});
    const starts: number[] = [], hits: number[] = [];
    let seq = b.attackSeq, lunge = 0;
    for (let i = 0; i < 60 * 8; i++) {
      w.pz = b.z + 1.0; w.px = b.x; // keep the player 1 m in front (pinned against a wall, say)
      const out = step(b, w);
      if (b.attackSeq !== seq) { seq = b.attackSeq; starts.push(b.t); }
      if (out.attackHit) hits.push(b.t);
      if (b.state === 'attack' && out.speed >= SIREN_CLAW.lunge.speed - 1e-6) lunge++;
    }
    expect(starts.length).toBeGreaterThanOrEqual(4);
    // one hit per swing, landing at the impact time
    expect(hits.length).toBeGreaterThanOrEqual(starts.length - 1);
    expect(hits.length).toBeLessThanOrEqual(starts.length);
    hits.forEach((h, i) => expect(h - starts[i]).toBeCloseTo(SIREN_STATS.attackImpact, 1));
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(SIREN_STATS.attackDuration + SIREN_STATS.attackCooldown! - 0.05);
    expect(lunge).toBeGreaterThan(0); // the player stays 1 m (> lunge stop) ahead: she lunges through every wind-up
  });
  it('lunges through the wind-up when the player is at the edge of her reach; backing off at walking speed makes her miss', () => {
    const b = new SirenBrain(0, 0, 0, SIREN_STATS, false);
    const w = fake({px: 0, pz: SIREN_STATS.attackRange - 0.05});
    let lunged = 0, hit = false, started = false;
    for (let i = 0; i < 60 * 1.2; i++) {
      const out = step(b, w);
      if (b.state === 'attack') { started = true; w.pz += WALK_SPEED / 60; } // the player backs off at walking speed
      if (b.state === 'attack' && out.speed >= SIREN_CLAW.lunge.speed - 1e-6) lunged++;
      if (out.attackHit) hit = true;
    }
    expect(started).toBe(true);
    expect(lunged).toBeGreaterThan(5);
    expect(hit).toBe(false);
  });
  it('sight lost at the impact (a door / wall between): the swing whiffs', () => {
    const b = new SirenBrain(0, 0, 0, SIREN_STATS, false);
    let blocked = false;
    const w = fake({px: 0, pz: 0.9, los: () => !blocked});
    let hit = false, started = false;
    for (let i = 0; i < 60; i++) {
      const out = step(b, w);
      if (b.state === 'attack' && !started) { started = true; blocked = true; }
      if (out.attackHit) hit = true;
    }
    expect(started).toBe(true);
    expect(hit).toBe(false);
  });
  it('the shambler keeps its 0.45 s recovery (attackCooldown is optional, default unchanged)', () => {
    expect(ZOMBIE_STATS.shambler.attackCooldown).toBeUndefined();
    const z = new ZombieBrain('shambler', 0, 0, 0);
    const w = fake({px: 0, pz: 1});
    const starts: number[] = [];
    let seq = z.attackSeq;
    for (let i = 0; i < 60 * 5; i++) { z.update(1 / 60, w); if (z.attackSeq !== seq) { seq = z.attackSeq; starts.push(z.t); } }
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts[1] - starts[0]).toBeCloseTo(ZOMBIE_STATS.shambler.attackDuration + 0.45, 1);
  });
});

describe('Siren audio adapter: hum cadence / lifecycle, one scream, no groans', () => {
  const fakeSfx = (humLen = 6) => {
    const log = {hum: [] as number[], stop: 0, scream: 0, gait: 0, attack: 0, death: 0, groan: 0, t: 0};
    const sfx = {
      sirenHum: () => { log.hum.push(log.t); return humLen; }, sirenHumStop: () => { log.stop++; }, sirenScream: () => { log.scream++; return true; },
      zombieGait: () => { log.gait++; }, zombieAttack: () => { log.attack++; }, zombieDeath: () => { log.death++; }, groan: () => { log.groan++; }, creature: () => { log.groan++; },
    } as unknown as Sfx;
    return {sfx, log};
  };
  const tickFor = (sfx: Sfx, log: {t: number}, z: EnemyActor, seconds: number, dist: number) => {
    for (let i = 0; i < seconds / DT; i++) { log.t += DT; SIREN_CUES.tick(sfx, z, DT, 0, dist, () => 0.5); }
  };
  it('dormant: phrases from her position at phrase + gap spacing; none beyond maxDist; gated requests retry at a bounded rate', () => {
    const {sfx, log} = fakeSfx(6);
    const z = {archetype: 'siren', brain: new SirenBrain(0, 0, 0), groanT: firstHumDelay(0.5)} as unknown as EnemyActor;
    tickFor(sfx, log, z, 60, 10);
    const gap = 6 + SIREN_HUM_PACE.gap[0];
    expect(log.hum.length).toBeGreaterThanOrEqual(5);
    expect(log.hum.length).toBeLessThanOrEqual(Math.ceil(60 / gap));
    for (let i = 1; i < log.hum.length; i++) expect(log.hum[i] - log.hum[i - 1]).toBeGreaterThanOrEqual(gap - DT);
    expect(log.groan).toBe(0);
    const far = fakeSfx(6);
    tickFor(far.sfx, far.log, {...z, groanT: 0} as EnemyActor, 30, SIREN_HUM_PACE.maxDist + 1);
    expect(far.log.hum.length).toBe(0);
    const gated = fakeSfx(0); // the vocal gate / cap said no every time
    tickFor(gated.sfx, gated.log, {...z, groanT: 0} as EnemyActor, 30, 5);
    expect(gated.log.hum.length).toBeLessThanOrEqual(Math.ceil(30 / SIREN_HUM_PACE.retryS) + 1);
  });
  it('wake: one scream, the hum stops for good; awake: footfalls, no vocals; death fades the hum', () => {
    const {sfx, log} = fakeSfx(6);
    const b = new SirenBrain(0, 0, 0);
    const z = {archetype: 'siren', brain: b, groanT: 0} as unknown as EnemyActor;
    tickFor(sfx, log, z, 10, 5);
    const hums = log.hum.length;
    expect(hums).toBeGreaterThan(0);
    b.wake('proximity');
    tickFor(sfx, log, z, 10, 5);
    expect(log.scream).toBe(1);
    b.state = 'chase';
    for (let i = 0; i < 300; i++) { SIREN_CUES.tick(sfx, z, DT, 3, 5, () => 0.5); SIREN_CUES.alert(sfx, z); }
    expect(log.scream).toBe(1);
    expect(log.hum.length).toBe(hums);
    expect(log.gait).toBeGreaterThan(0);
    SIREN_CUES.death(sfx, z);
    expect(log.stop).toBe(1);
    expect(log.death).toBe(1);
  });
});

describe('Siren actor (synthetic shared-skeleton rig; the real GLB is lane RIGS\'s)', () => {
  it('rigged with the six contract clips; Dormant = floor-hunched, rise -> standing (Rise held), Run while chasing; six humanoid volumes', () => {
    const a = new SirenActor(syntheticSiren(), spawnAt(4, 5), seq());
    expect(a.hasRig).toBe(true);
    expect(a.brain.state).toBe('dormant');
    expect(a.brain.riseS).toBeCloseTo(1.2, 5);
    expect(a.scale).toBe(1);
    a.root.position.y = 0;
    for (let i = 0; i < 5; i++) a.animate(DT, 'Idle', 0);
    expect(a.clip).toBe('Dormant');
    const lowHead = a.updateVolumes().find(v => v.part === 'head')!.a.y;
    expect(lowHead).toBeLessThan(1.0);
    expect(a.hitVolumes.length).toBe(6);
    a.brain.wake('qa');
    for (let i = 0; i < 45; i++) a.animate(DT, 'Idle', 0);
    expect(a.clip).toBe('Rise');
    a.brain.state = 'idle';
    for (let i = 0; i < 20; i++) a.animate(DT, 'Idle', 0);
    expect(a.clip).toBe('Stand');
    const head = a.updateVolumes().find(v => v.part === 'head')!.a.y;
    expect(head).toBeGreaterThan(1.3);
    a.brain.state = 'chase';
    a.animate(DT, 'Run', 4.2);
    expect(a.clip).toBe('Run');
    a.animate(DT, 'Walk', 0.7);
    expect(a.clip).toBe('Run'); // no Walk clip: Run slowed
    // the dress is a cloth wearable, the body flesh (wound classes); both are her meshes
    expect(a.meshes.map(m => a.slotOf(m))).toEqual(['body', 'upper']);
    a.brain.damage(999, 0, 0);
    expect(a.updateVolumes().length).toBe(0);
    a.dispose();
  });
  it('appearance untouched: geometry / colours / emissive as supplied; the hit flash adds on top and returns to the supplied emissive', () => {
    const g = syntheticSiren();
    const src = g.scene.getObjectByName('SirenBody') as THREE.SkinnedMesh;
    (src.material as THREE.MeshStandardMaterial).emissive.setRGB(0.05, 0.02, 0.01);
    const a = new SirenActor(g, spawnAt(0, 0), seq());
    const body = a.root.getObjectByName('SirenBody') as THREE.SkinnedMesh;
    const mat = body.material as THREE.MeshStandardMaterial;
    expect(body.geometry).toBe(src.geometry);
    expect(mat.color.getHex()).toBe((src.material as THREE.MeshStandardMaterial).color.getHex());
    expect(mat.emissive.toArray()).toEqual((src.material as THREE.MeshStandardMaterial).emissive.toArray());
    expect(body.material).not.toBe(src.material);
    a.hitFlash = 1;
    a.animate(DT, 'Idle', 0);
    expect(mat.emissive.r).toBeGreaterThan(0.05 + 0.2);
    for (let i = 0; i < 30; i++) a.animate(DT, 'Idle', 0);
    expect(a.hitFlash).toBe(0);
    expect(mat.emissive.r).toBeCloseTo(0.05, 9);
    expect(mat.emissive.g).toBeCloseTo(0.02, 9);
    expect(mat.emissive.b).toBeCloseTo(0.01, 9);
    a.dispose();
  });
  it('createEnemyActor: a Siren when her model is in the models record; without it the counted fallback (game skips instead)', () => {
    const zombie = () => ({archetype: undefined, brain: new ZombieBrain('shambler', 0, 0, 0)} as unknown as EnemyActor);
    const withModel = createEnemyActor(spawnAt(1, 1), {[SIREN_MODEL_KEY]: syntheticSiren()}, seq(), zombie);
    expect(withModel.fallback).toBe(false);
    expect(withModel.actor).toBeInstanceOf(SirenActor);
    expect(withModel.actor.archetype).toBe('siren');
    const without = createEnemyActor(spawnAt(1, 1), {}, seq(), zombie);
    expect(without.fallback).toBe(true);
    withModel.actor.dispose();
  });
  it('draws exactly three rolls from the game rand (as a zombie actor does) so later draws stay aligned', () => {
    let n = 0;
    const a = new SirenActor(syntheticSiren(), spawnAt(0, 0), () => { n++; return 0.5; });
    expect(n).toBe(3);
    a.dispose();
  });
});

describe('Siren actor on lane RIGS\'s enemy-siren.glb (the real asset; textures stripped: node has no image decoder)', () => {
  let real: GLTF;
  beforeAll(async () => {
    const io = new NodeIO();
    const doc = await io.read(fileURLToPath(new URL('../public/assets/models/enemy-siren.glb', import.meta.url)));
    for (const t of doc.getRoot().listTextures()) t.dispose();
    const bin = await io.writeBinary(doc);
    real = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
  });
  /** Distance from p to the surface of a hit volume (negative inside). */
  const toVolume = (p: {x: number; y: number; z: number}, v: HitVolume) => {
    if (!v.b) return Math.hypot(p.x - v.a.x, p.y - v.a.y, p.z - v.a.z) - v.r;
    const ab = [v.b.x - v.a.x, v.b.y - v.a.y, v.b.z - v.a.z], ap = [p.x - v.a.x, p.y - v.a.y, p.z - v.a.z];
    const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / Math.max(1e-9, ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
    return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) - v.r;
  };
  it('contract: the six clips, shared bones, extras; SIREN_STATS / SIREN_WAKE timing = the clips; hit radii from hitRadii', () => {
    const ex = real.scene.userData.enemySiren as SirenExtras & {clips: Record<string, {duration: number; impactTime?: number; groundSpeed?: number}>; hitRadii: Record<string, number>};
    expect(real.animations.map(a => a.name).sort()).toEqual([...SIREN_CLIPS].sort());
    expect(SIREN_STATS.attackDuration).toBeCloseTo(ex.clips.Attack.duration, 6);
    expect(SIREN_STATS.attackImpact).toBeCloseTo(ex.clips.Attack.impactTime!, 6);
    expect(SIREN_WAKE.riseS).toBeCloseTo(ex.clips.Rise.duration, 6);
    expect(ex.clips.Run.groundSpeed).toBeCloseTo(SIREN_STATS.chaseSpeed, 1); // Run plays at ~1x at full chase
    const a = new SirenActor(real, spawnAt(4, 5), seq());
    expect(a.hasRig).toBe(true);
    expect(a.brain.riseS).toBeCloseTo(ex.clips.Rise.duration, 6);
    expect(a.hit).toEqual({head: ex.hitRadii.head, torso: ex.hitRadii.torso, arm: ex.hitRadii.arm, leg: ex.hitRadii.leg});
    expect(a.meshes.map(m => [m.name, a.slotOf(m)])).toEqual([['SirenBody', 'body'], ['SirenDress', 'upper']]);
    a.dispose();
  });
  it('dormant: low, and every flashlight sample point lies on her dormant body volumes; risen: RIGS\'s forward-leaning run-ready stance', () => {
    for (const yaw of [0, 0.7, -2.2]) {
      const a = new SirenActor(real, spawnAt(4, 5, yaw), seq());
      a.root.position.y = 0;
      for (let i = 0; i < 10; i++) a.animate(DT, 'Idle', 0);
      expect(a.clip).toBe('Dormant');
      const vols = a.updateVolumes();
      const head = vols.find(v => v.part === 'head')!.a;
      expect(head.y).toBeLessThan(0.8);
      for (const p of sirenBodyPoints(a.brain)) expect(Math.min(...vols.map(v => toVolume(p, v))), `yaw ${yaw} point ${JSON.stringify(p)}`).toBeLessThan(0.1);
      a.brain.wake('qa');
      for (let i = 0; i < 40; i++) a.animate(DT, 'Idle', 0);
      a.brain.state = 'idle';
      for (let i = 0; i < 15; i++) a.animate(DT, 'Idle', 0);
      expect(a.clip).toBe('Stand');
      // Rise ends leaning forward, ready to run (hips ~0.72 m, head joint ~1.34 m; the Run clip leans the same way)
      expect(a.updateVolumes().find(v => v.part === 'head')!.a.y).toBeGreaterThan(1.3);
      a.dispose();
    }
  });
});

describe('Siren system: persistence across revisits, retry, model-missing skip, veins lifecycle', () => {
  const host = (model: GLTF | undefined, zombies: ZombieSpawn[], run = new RunState({seeds: {subway: 1, office: 2}, start: {level: 'office', section: 'main'}})) => {
    const stops: object[] = [];
    const pools = new Map<string, () => readonly THREE.Object3D[]>();
    const h: SirenHost & {stops: object[]; pools: typeof pools} = {
      scene: new THREE.Group(), levels: HL, layout: {seed: 77, zombies}, run,
      frameHooks: [], sectionHooks: [], warmRegistry: {addPool: (n, r) => { pools.set(n, r); }},
      propModels: {get: k => (k === SIREN_MODEL_KEY ? model : undefined)},
      sfx: {sirenHumStop: (id: object) => { stops.push(id); }} as unknown as Sfx, stops, pools,
    };
    return h;
  };
  it('a woken Siren is remembered awake for the section: the revisit restores her awake (no hum / scream / veins); dead stays dead', () => {
    const g = syntheticSiren();
    const spawns = [spawnAt(20, 5), spawnAt(40, 5)];
    const h = host(g, spawns);
    const sys = new SirenSystem(h).install();
    expect(h.frameHooks.length).toBe(1);
    expect(h.sectionHooks.length).toBe(1);
    expect(h.pools.get('siren-veins')?.()).toEqual([sys.veins.prototype]);
    const a0 = new SirenActor(g, spawns[0], seq()), a1 = new SirenActor(g, spawns[1], seq());
    a0.brain.y = a1.brain.y = 0;
    sys.adopt(a0 as unknown as EnemyActor, spawns[0], 0);
    sys.adopt(a1 as unknown as EnemyActor, spawns[1], 1);
    expect(sys.veins.count).toBe(2);
    a0.brain.wake('proximity');
    h.frameHooks[0](DT);
    expect(h.run.laneStore(SIREN_LANE)).toEqual({awake: [0]});
    expect(sys.veins.get(a0)!.fading).toBe(true);
    for (let t = 0; t < SIREN_VEINS.fadeOutS + 0.5; t += 0.1) h.frameHooks[0](0.1);
    expect(sys.veins.get(a0)).toBeUndefined();
    expect(sys.veins.count).toBe(1);
    // leave the section
    h.sectionHooks[0].teardown!();
    expect(sys.veins.count).toBe(0);
    expect(h.stops).toEqual([a0, a1]);
    // revisit: spawn 0 restored awake, spawn 1 dormant again with its patch
    const b0 = new SirenActor(g, spawns[0], seq()), b1 = new SirenActor(g, spawns[1], seq());
    b0.brain.y = b1.brain.y = 0;
    sys.adopt(b0 as unknown as EnemyActor, spawns[0], 0);
    sys.adopt(b1 as unknown as EnemyActor, spawns[1], 1);
    expect(b0.brain.state).toBe('idle');
    expect(b0.brain.wakeReason).toBe('restored');
    expect(b0.brain.takeScream()).toBe(false);
    expect(b0.brain.wake('proximity')).toBe(false);
    expect(sys.veins.get(b0)).toBeUndefined();
    expect(b1.brain.dormant).toBe(true);
    expect(sys.veins.get(b1)).toBeDefined();
    h.frameHooks[0](DT);
    expect(h.run.laneStore(SIREN_LANE)).toEqual({awake: [0]}); // the restore is not a new wake
    // a kill is permanent through the generic killed indices
    expect(enemiesToSpawn(2, {killed: mergeKilled([], [1])} as never)).toEqual([0]);
    [a0, a1, b0, b1].forEach(a => a.dispose());
  });
  it('Retry level restores the level-entry snapshot: Sirens woken after entry are dormant again', () => {
    const g = syntheticSiren();
    const spawns = [spawnAt(20, 5)];
    const run = new RunState({seeds: {subway: 1, office: 2}, start: {level: 'office', section: 'main'}});
    const h = host(g, spawns, run);
    const sys = new SirenSystem(h).install();
    run.memory();
    const entry = run.levelMemories('office');
    const a = new SirenActor(g, spawns[0], seq());
    a.brain.y = 0;
    sys.adopt(a as unknown as EnemyActor, spawns[0], 0);
    a.brain.wake('flashlight');
    h.frameHooks[0](DT);
    expect(sys.awakeIndices()).toEqual([0]);
    run.restoreLevelMemories('office', entry);
    expect(sys.awakeIndices()).toEqual([]);
    a.dispose();
  });
  it('QA / debug spawns (not the layout\'s own spawn object) are never persisted', () => {
    const g = syntheticSiren();
    const spawns = [spawnAt(20, 5)];
    const h = host(g, spawns);
    const sys = new SirenSystem(h).install();
    const a = new SirenActor(g, {...spawns[0]}, seq());
    a.brain.y = 0;
    sys.adopt(a as unknown as EnemyActor, {...spawns[0]}, 0);
    a.brain.wake('qa');
    h.frameHooks[0](DT);
    expect(h.run.laneStore(SIREN_LANE)).toBeUndefined();
    a.dispose();
  });
  it('model missing at runtime: Siren spawns are skipped (counted, one warning per section), other families untouched', () => {
    const h = host(undefined, [spawnAt(20, 5), spawnAt(21, 5)]);
    const sys = new SirenSystem(h).install();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(sys.skip({archetype: 'siren'})).toBe(true);
    expect(sys.skip({archetype: 'siren'})).toBe(true);
    expect(sys.skip({archetype: 'zombie'})).toBe(false);
    expect(sys.skip({})).toBe(false);
    expect(sys.skippedHere).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    h.sectionHooks[0].teardown!();
    expect(sys.skippedHere).toBe(0);
    expect(sys.skippedTotal).toBe(2);
    sys.skip({archetype: 'siren'});
    expect(warn).toHaveBeenCalledTimes(2); // once per section
    warn.mockRestore();
    expect(new SirenSystem(host(syntheticSiren(), [])).install().skip({archetype: 'siren'})).toBe(false);
  });
  it('vein seeds are deterministic per (level seed, index) and differ between Sirens', () => {
    expect(sirenVeinSeed(77, 3)).toBe(sirenVeinSeed(77, 3));
    expect(sirenVeinSeed(77, 3)).not.toBe(sirenVeinSeed(77, 4));
    for (let i = 0; i < 50; i++) { const s = sirenVeinSeed(i * 7919, i); expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThan(1); }
  });
});

describe('Siren ground corruption: bounded footprint clipped to her storey floor; faded and disposed', () => {
  /** Distance from (x, z) to the nearest point of cell (cx, cy). */
  const near = (cx: number, cy: number, x: number, z: number) => Math.hypot(Math.max(cx * CELL, Math.min(x, (cx + 1) * CELL)) - x, Math.max(cy * CELL, Math.min(z, (cy + 1) * CELL)) - z);
  it('open floor: a bounded disc of her floor cells (<= maxCells, every cell the visible edge reaches and no other), flat at her floor + lift', () => {
    const fp = veinCells(HL, 20.1, 0, 10.2)!;
    expect(fp.level).toBe(0);
    expect(fp.floor).toBe(0);
    expect(fp.cells.length).toBeGreaterThan(60);
    expect(fp.cells.length).toBeLessThan(SIREN_VEINS.maxCells); // the cap is a guard, never reached on open floor
    const R = visibleRadius();
    expect(R).toBeCloseTo(SIREN_VEINS.radius * (1 + SIREN_VEINS.edgeNoise / 2), 9);
    expect(R).toBeLessThanOrEqual(SIREN_VEINS.maxRadius);
    expect(SIREN_VEINS.maxRadius).toBeLessThanOrEqual(2.5);
    expect(fp.cells.every(([cx, cy]) => near(cx, cy, 20.1, 10.2) <= R)).toBe(true);
    // complete: every open-floor cell the edge can reach is in (the organic border is never cut by a missing cell)
    const keep = new Set(fp.cells.map(([cx, cy]) => `${cx},${cy}`));
    for (let cy = 10; cy < 32; cy++) for (let cx = 30; cx < 52; cx++) if (near(cx, cy, 20.1, 10.2) <= R) expect(keep.has(`${cx},${cy}`), `${cx},${cy}`).toBe(true);
    const geo = veinGeometry(fp);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(SIREN_VEINS.lift, 6);
    expect(geo.index!.count).toBe(fp.cells.length * 6);
    expect(geo.attributes.normal.getY(0)).toBe(1);
    geo.dispose();
  });
  it('beside a wall: no cell on the far side (no through-wall bleed)', () => {
    const fp = veinCells(HL, 29.4, 0, 5)!;
    expect(fp.cells.length).toBeGreaterThan(10);
    expect(fp.cells.every(([cx]) => cx < 60)).toBe(true); // wall cells x = 60; the far side is x >= 61
  });
  it('stacked storeys: under the deck the patch stays on her floor (no deck cells); on the deck it never drops into the track bed / aperture', () => {
    const below = veinCells(FL, 23, 0, 6)!;
    expect(below.level).toBe(0);
    for (const [cx, cy] of below.cells) {
      const s = FL.supportIn((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.05)!;
      expect(s.level).toBe(0);
      expect(s.floor).toBe(0);
    }
    const deck = veinCells(FL, 23, FIX.upperY, 10.2)!; // the deck edge next to the light-well aperture (x 22..24, z 11..13)
    expect(deck.level).toBe(1);
    for (const [cx, cy] of deck.cells) {
      const s = FL.supportIn((cx + 0.5) * CELL, (cy + 0.5) * CELL, FIX.upperY + 0.05)!;
      expect(s.level).toBe(1);
      expect(Math.abs(s.floor - FIX.upperY)).toBeLessThanOrEqual(SIREN_VEINS.flatTol);
    }
    expect(deck.cells.some(([cx, cy]) => cx >= FIX.aperture.x0 && cx <= FIX.aperture.x1 && cy >= FIX.aperture.y0 && cy <= FIX.aperture.y1)).toBe(false);
  });
  it('the field: one mesh per patch on one shared material, per-patch data (centre / radius / seed / fade), capped, faded, cleared', () => {
    const f = new SirenVeinField();
    expect(f.prototype.visible).toBe(false);
    expect(f.prototype.material).toBe(f.material);
    const ids = Array.from({length: SIREN_VEINS.maxPatches + 2}, () => ({}));
    const made = ids.map((id, i) => f.add(id, HL, 10 + i * 5, 0, 17, 0.25));
    expect(made.filter(Boolean).length).toBe(SIREN_VEINS.maxPatches);
    expect(f.stats.rejected).toBe(2);
    const p = made[0]!;
    expect(p.mesh.material).toBe(f.material);
    const data = p.mesh.userData[VEIN_DATA_KEY] as Float32Array;
    expect([...data.slice(0, 3)]).toEqual([10, 17, SIREN_VEINS.radius].map(v => Math.fround(v)));
    expect(data[4]).toBe(1);
    expect(f.group.children.length).toBe(1 + SIREN_VEINS.maxPatches); // prototype + patches
    f.release(ids[0]);
    f.update(SIREN_VEINS.fadeOutS / 2);
    expect(data[4]).toBeCloseTo(0.5, 5);
    f.update(SIREN_VEINS.fadeOutS);
    expect(f.get(ids[0])).toBeUndefined();
    expect(f.stats.disposed).toBe(1);
    f.release(ids[1], true);
    expect(f.get(ids[1])).toBeUndefined();
    f.clear();
    expect(f.count).toBe(0);
    expect(f.group.children).toEqual([f.prototype]);
    // no floor under her (outside the grid): no patch
    expect(f.add({}, HL, -10, 0, -10, 0.5)).toBeNull();
    f.dispose();
  });
});
