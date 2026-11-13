// Task studio-bb-production-20261112-234540-01 (lane ACTOR): BB's small ragdoll in the REAL physics world (cannon-es, the game's own
// statics). BB dies where it crawls — on a floor, on a WALL, under a CEILING, in the air — and takes the kill impulse every enemy
// gets on a body of about 9 kg. From each of those the corpse must fall, come to rest lying ON the floor, and never go through the
// floor, the wall it clung to or the slab over it. Run on the four real bodies, with the game's rifle and full-buckshot impulses.
//
// What the fixture is: a 3 m room under a second storey (so there IS a ceiling slab: a single-storey layout has no physics ceiling
// at all — which is why a shot from below must not launch the body) with a one-cell interior wall across it.

import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PhysicsSystem, killImpulseStrength} from '../src/physics/world';
import type {KillImpulse} from '../src/physics/ragdoll';
import {BB_ACTOR, BbActor, bbRagdollRig} from '../src/ai/bbActor';
import {BB_ASSET, bbRestPose, type BbPose, type BbVariantId} from '../src/ai/bb';
import {BB_JOINTS} from '../src/ai/bbClips';
import {CORPSE_TRAITS} from '../src/ai/corpseTrait';
import {BB_IDS, bbGltf, bbRoom, rigOfGltf, rng, spawnBb} from './helpers/bbBodies';

/** The room: 3 m to the slab under the upper storey, an interior wall across it at x = 12 .. 12.5 m. */
const CEIL = 3, WALL_X = 12, WALL_T = 0.5;
const RIFLE = killImpulseStrength('rifle', 1, 1), BUCKSHOT = killImpulseStrength('shotgun', 9, 9);
/** The actors' spawn seeds (their size — 7: the smallest, 0.94; 127773: the largest, 1.06 — and so every trajectory); BB_RAGDOLL_SEEDS=a,b,.. sweeps others. */
const SEEDS: readonly number[] = process.env.BB_RAGDOLL_SEEDS ? process.env.BB_RAGDOLL_SEEDS.split(',').map(Number) : [7, 127773];
const TRUNK = new Set(['Hips', 'Spine', 'Chest', 'Neck', 'Head']);

interface Case {
  name: string;
  pose: Partial<BbPose> & {x: number; y: number; z: number};
  /** The killing shot: its direction (the player's aim) and strength; null = no impulse (it just lets go). */
  shot: {dir: [number, number, number]; strength: number; head?: boolean} | null;
  /** The body must end within this far of where it died (m, along the floor). */
  travel: [number, number];
}
const on = (surface: BbPose['surface'], x: number, y: number, z: number, up: [number, number, number], fwd: [number, number, number], phase: BbPose['phase'] = 'idle', speed = 0): Case['pose'] =>
  ({x, y, z, ux: up[0], uy: up[1], uz: up[2], fx: fwd[0], fy: fwd[1], fz: fwd[2], surface, phase, speed});
const CASES: readonly Case[] = [
  {name: 'floor, settled, a rifle round from the front', pose: on('floor', 6, 0, 8, [0, 1, 0], [0, 0, 1]), shot: {dir: [0, -0.15, -1], strength: RIFLE}, travel: [0.3, 2.4]},
  {name: 'floor, scuttling, a full load of buckshot from behind and above', pose: on('floor', 6, 0, 6, [0, 1, 0], [0, 0, 1], 'crawl', 4.8), shot: {dir: [0.1, -0.35, 1], strength: BUCKSHOT}, travel: [1.5, 7]},
  {name: 'floor, a head shot', pose: on('floor', 5, 0, 8, [0, 1, 0], [1, 0, 0]), shot: {dir: [-1, -0.1, 0], strength: RIFLE, head: true}, travel: [0.3, 2.4]},
  {name: 'wall at 1.5 m, a rifle round INTO the wall', pose: on('wall', WALL_X, 1.5, 8, [-1, 0, 0], [0, 1, 0]), shot: {dir: [1, 0.05, 0], strength: RIFLE}, travel: [0, 1.2]},
  {name: 'wall at 1.5 m, buckshot INTO the wall', pose: on('wall', WALL_X, 1.5, 8, [-1, 0, 0], [0, 0, 1], 'crawl', 3.4), shot: {dir: [1, 0.1, 0.1], strength: BUCKSHOT}, travel: [0, 5]},
  {name: 'wall at 1.5 m, buckshot ALONG the wall', pose: on('wall', WALL_X, 1.5, 6, [-1, 0, 0], [0, -1, 0]), shot: {dir: [0.15, 0, 1], strength: BUCKSHOT}, travel: [1, 5.5]},
  {name: 'wall at 2.6 m (the far face), it just lets go', pose: on('wall', WALL_X + WALL_T, 2.6, 8, [1, 0, 0], [0, 1, 0]), shot: null, travel: [0, 1.2]},
  {name: 'ceiling at 3 m, a rifle round from below', pose: on('ceiling', 6, CEIL, 8, [0, -1, 0], [0, 0, 1]), shot: {dir: [0.3, 0.8, 0.5], strength: RIFLE}, travel: [0.5, 4.5]},
  {name: 'ceiling at 3 m, buckshot straight up', pose: on('ceiling', 7, CEIL, 9, [0, -1, 0], [1, 0, 0], 'crawl', 3.4), shot: {dir: [0.05, 1, 0.03], strength: BUCKSHOT}, travel: [0, 5.5]},
  {name: 'ceiling at 3 m, it just lets go', pose: on('ceiling', 5, CEIL, 5, [0, -1, 0], [0, 0, -1]), shot: null, travel: [0, 0.8]},
  {name: 'in the air mid-leap, a rifle round', pose: on('air', 6, 1.2, 8, [0, 1, 0], [0, 0, 1], 'pounce', 6), shot: {dir: [0, 0.1, -1], strength: RIFLE}, travel: [0, 2.5]},
  {name: 'in the air dropping from the ceiling, buckshot from straight below', pose: on('air', 6, 2.3, 8, [0, 1, 0], [0, 0, 1], 'fall', 0), shot: {dir: [0.03, 1, 0.02], strength: BUCKSHOT}, travel: [0, 1.2]},
  {name: 'floor 1.2 m from the wall, buckshot toward the wall', pose: on('floor', WALL_X - 1.2, 0, 8, [0, 1, 0], [1, 0, 0]), shot: {dir: [1, 0, 0.05], strength: BUCKSHOT}, travel: [0, 2.5]},
  {name: 'in the air 1 m from the wall, flying at it, buckshot from behind', pose: on('air', WALL_X - 1 - 6 * 0.4, 1.4, 8, [0, 1, 0], [1, 0, 0], 'pounce', 6), shot: {dir: [1, 0.1, 0], strength: BUCKSHOT}, travel: [0, 2.5]},
];

interface Result {
  settled: number; finite: boolean; failed: number;
  /** How far prepareRagdoll moved the root along the surface normal, and off it (m). */
  lift: number; liftOff: number;
  /** Over the whole fall: the lowest limb joint and the lowest trunk / head joint, the highest joint, the fastest joint (m/s). */
  minLimb: number; minTrunk: number; maxY: number; maxV: number;
  /** The deepest dip: which joint, when; and for how many frames any joint was more than 2 cm under the floor. */
  dip: string; dipT: number; dipFrames: number;
  /** The deepest any joint went into the interior wall, from the face on the side the body died on (m; <= 0: never in it). */
  wallDepth: number;
  /** At rest: the lowest and the highest joint, the hips, how far along the floor from where it died, which side of the wall. */
  low: number; top: number; hips: THREE.Vector3; travel: number; sameSide: boolean;
  /** The fastest any joint still moved in the last quarter second before it was frozen (m/s). */
  lastV: number;
}

/** A BB of look `v` posed as the case says, after a few frames of its clip (moving bodies advance as the brain moves them). */
function posed(gltf: GLTF, v: BbVariantId, pose: Case['pose'], seed: number): BbActor {
  const bb = new BbActor(gltf, spawnBb(pose.x, pose.z, v), rng(seed));
  const P = bb.brain.pose, dt = 1 / 60;
  Object.assign(P, bbRestPose(pose.x, pose.y, pose.z, 0), pose);
  for (let i = 0; i < 24; i++) {
    P.x += P.fx * P.speed * dt; P.y += P.fy * P.speed * dt; P.z += P.fz * P.speed * dt; P.phaseT += dt;
    bb.animate(dt, P.speed > 0 ? 'Run' : 'Idle', P.speed);
    bb.syncTransform();
    bb.updateVolumes();
  }
  return bb;
}
const impulseOf = (c: Case, at: THREE.Vector3): KillImpulse | null =>
  c.shot ? {dir: {x: c.shot.dir[0], y: c.shot.dir[1], z: c.shot.dir[2]}, point: {x: at.x, y: at.y, z: at.z}, strength: c.shot.strength, bone: c.shot.head ? 'head' : undefined} : null;

/** Kill a BB posed as `c` says and simulate its ragdoll until the physics freezes it; every joint of every frame is tracked. */
function run(gltf: GLTF, v: BbVariantId, c: Case, seed: number): Result {
  const ph = new PhysicsSystem(null);
  ph.build(bbRoom({storeyM: CEIL, wallX: WALL_X}));
  const bb = posed(gltf, v, c.pose, seed);
  const P = bb.brain.pose, dt = 1 / 60;
  const start = bb.root.position.clone(), up = new THREE.Vector3(P.ux, P.uy, P.uz);
  // which side of the interior wall the body is on (-1: x below it)
  const west = start.x + up.x * 0.2 < WALL_X + WALL_T / 2;
  bb.brain.damage(999, P.x, P.z + 3);
  expect(ph.ragdoll(bb, impulseOf(c, bb.bone('Chest')!.getWorldPosition(new THREE.Vector3()))), c.name).toBe(true);
  expect(bb.ragdolled).toBe(true);
  const moved = bb.root.position.clone().sub(start), lift = moved.dot(up);
  const R: Result = {settled: -1, finite: true, failed: 0, lift, liftOff: moved.addScaledVector(up, -lift).length(), minLimb: Infinity, minTrunk: Infinity, maxY: -Infinity, maxV: 0,
    dip: '', dipT: 0, dipFrames: 0, wallDepth: -Infinity, low: Infinity, top: -Infinity, hips: new THREE.Vector3(), travel: 0, sameSide: false, lastV: 0};
  // every joint of the body (the Root bone is the skeleton's fixed frame, not a body part: it stays where the body died)
  const p = new THREE.Vector3(), bones = BB_JOINTS.slice(1).map(([n]) => bb.bone(n)!), prev = bones.map(b => b.getWorldPosition(new THREE.Vector3()));
  const speeds: number[] = [];
  for (let t = dt; t < 9.5; t += dt) {
    ph.update(dt);
    bb.root.updateMatrixWorld(true);
    let under = false, fastest = 0;
    for (const [i, b] of bones.entries()) {
      b.getWorldPosition(p);
      if (!Number.isFinite(p.x + p.y + p.z)) R.finite = false;
      if (TRUNK.has(b.name)) R.minTrunk = Math.min(R.minTrunk, p.y);
      else if (p.y < R.minLimb) { R.minLimb = p.y; R.dip = b.name; R.dipT = t; }
      if (p.y < -0.02) under = true;
      R.maxY = Math.max(R.maxY, p.y);
      R.wallDepth = Math.max(R.wallDepth, west ? p.x - WALL_X : WALL_X + WALL_T - p.x);
      fastest = Math.max(fastest, p.distanceTo(prev[i]) / dt);
      prev[i].copy(p);
    }
    if (under) R.dipFrames++;
    R.maxV = Math.max(R.maxV, fastest);
    speeds.push(fastest);
    if (ph.stats().ragdollsActive === 0) { R.settled = t; break; }
  }
  R.lastV = Math.max(...speeds.slice(-16, -1));
  bb.root.updateMatrixWorld(true);
  for (const b of bones) { b.getWorldPosition(p); R.top = Math.max(R.top, p.y); R.low = Math.min(R.low, p.y); }
  bones[0].getWorldPosition(R.hips);
  R.travel = Math.hypot(R.hips.x - start.x, R.hips.z - start.z);
  R.sameSide = west ? R.hips.x < WALL_X : R.hips.x > WALL_X + WALL_T;
  R.failed = ph.stats().ragdollsFailed;
  // the corpse system's own volumes follow the fallen body (a bullet into it is stopped where it lies)
  const head = bb.corpseVolumes()[0];
  expect(head.part).toBe('head');
  expect(Math.abs(head.a.y - bb.bone('Head')!.getWorldPosition(p).y), `${c.name}: corpse head volume`).toBeLessThan(0.15);
  bb.dispose();
  return R;
}

describe('BB ragdoll: the rig', () => {
  it('a small body: about 9 kg, its own radii, the shared joint names, the root part named pelvis, the shove shared by mass', async () => {
    for (const v of BB_IDS) {
      const rig = rigOfGltf(await bbGltf(v))!, R = bbRagdollRig(rig);
      const mass = R.parts.reduce((m, p) => m + p.mass, 0);
      expect(mass, v).toBeGreaterThan(0.9 * CORPSE_TRAITS.bb.massKg);
      expect(mass, v).toBeLessThan(1.1 * CORPSE_TRAITS.bb.massKg);
      expect(R.root).toBe('pelvis');
      expect(R.head).toBe('head');
      expect(R.parts.map(p => p.name)).toEqual(['pelvis', 'torso', 'head', 'upperArmL', 'forearmL', 'thighL', 'shinL', 'upperArmR', 'forearmR', 'thighR', 'shinR']);
      const names = new Set(BB_JOINTS.map(([n]) => n));
      for (const p of R.parts) {
        expect(names.has(p.bone) && names.has(p.child), p.name).toBe(true);
        if (p.parent) expect(R.joints[p.name], p.name).toBeDefined();
        expect(p.girth).toBe('none'); // (no adult girth clamp on these radii)
        // a small body's spheres: none thinner than a finger, none bigger than its skull or its measured trunk
        for (const s of p.spheres) { expect(s.r).toBeGreaterThan(0.015); expect(s.r).toBeLessThanOrEqual(Math.max(rig.head.radius, rig.hit.torso) + 1e-9); }
      }
      expect(R.parts.find(p => p.name === 'head')!.spheres[0].r).toBeCloseTo(rig.head.radius, 9);
      // no limb lighter than a 12th of the trunk part it hangs from (the solver cannot hold a feather under a falling trunk)
      const torso = R.parts.find(p => p.name === 'torso')!.mass;
      for (const p of R.parts) expect(p.mass, p.name).toBeGreaterThan(torso / 12);
      // the shot's shove is shared by every part by its mass (fractions sum to 1; the trunk first)
      expect(R.core.map(c => c[0]).slice(0, 2)).toEqual(['torso', 'pelvis']);
      expect(R.core.length).toBe(R.parts.length);
      expect(R.core.reduce((s, c) => s + c[1], 0)).toBeCloseTo(1, 9);
      for (const [n, k] of R.core) expect(k).toBeCloseTo(R.parts.find(p => p.name === n)!.mass / mass, 9);
    }
    // without a solved rig: the contract's default radii (never an adult's)
    const bare = bbRagdollRig(null);
    expect(bare.parts.length).toBe(11);
    for (const p of bare.parts) for (const s of p.spheres) expect(s.r).toBeLessThanOrEqual(BB_ASSET.headRadius);
  });
});

describe('BB ragdoll: how it takes the killing shot (prepareRagdoll)', () => {
  let gltf: GLTF;
  beforeAll(async () => { gltf = await bbGltf('teddy'); }, 120_000);
  const shot = (dir: [number, number, number], strength: number): KillImpulse => ({dir: {x: dir[0], y: dir[1], z: dir[2]}, point: {x: 0, y: 0, z: 0}, strength});
  const massOf = (bb: BbActor): number => bb.ragdollRig.parts.reduce((m, p) => m + p.mass, 0) * bb.scale ** 3;
  const unit = (d: {x: number; y: number; z: number}): THREE.Vector3 => new THREE.Vector3(d.x, d.y, d.z).normalize();

  it('on the floor: a level rifle round is taken whole; a full load of buckshot throws the body no faster than the cap', () => {
    const bb = posed(gltf, 'teddy', on('floor', 6, 0, 8, [0, 1, 0], [0, 0, 1]), 3), cap = BB_ACTOR.ragdollMaxShoveMps * massOf(bb);
    const a = shot([0, 0, -2], RIFLE), frozen = JSON.stringify(a);
    const out = bb.prepareRagdoll(a)!;
    expect(out).not.toBe(a);
    expect(JSON.stringify(a)).toBe(frozen); // the caller's impulse (and its shared direction vector) is not touched
    expect(out.strength).toBeCloseTo(RIFLE, 9);
    expect(RIFLE).toBeLessThan(cap); // (a rifle round on this body: ~4-5 m/s, under the cap at every size)
    expect(unit(out.dir).z).toBeCloseTo(-1, 9);
    expect(out.point).toEqual(a.point);
    const b = bb.prepareRagdoll(shot([0, 0, -1], BUCKSHOT))!;
    expect(b.strength).toBeCloseTo(cap, 9);
    expect(b.strength / massOf(bb)).toBeCloseTo(BB_ACTOR.ragdollMaxShoveMps, 9);
    // fired down at it: the floor takes the downward part, the rest slides it along
    const c = bb.prepareRagdoll(shot([0, -1, -1], RIFLE))!;
    expect(c.dir.y).toBeCloseTo(0, 9);
    expect(c.strength).toBeCloseTo(RIFLE * Math.SQRT1_2, 6);
    expect(bb.prepareRagdoll(null)).toBeNull();
    const none = shot([0, 0, 1], 0);
    expect(bb.prepareRagdoll(none)).toBe(none);
    bb.dispose();
  });

  it('clinging to a wall or a ceiling: nothing of a shot fired INTO the surface; along it, the shot is taken', () => {
    const wall = posed(gltf, 'teddy', on('wall', WALL_X, 1.5, 8, [-1, 0, 0], [0, 1, 0]), 3);
    expect(wall.prepareRagdoll(shot([1, 0, 0], BUCKSHOT))).toBeNull(); // dead on: the wall takes all of it — the body just drops
    const glance = wall.prepareRagdoll(shot([1, 0, 1], RIFLE))!;
    expect(glance.dir.x).toBeCloseTo(0, 9); // only the part along the wall
    expect(glance.strength).toBeCloseTo(RIFLE * Math.SQRT1_2, 6);
    const off = wall.prepareRagdoll(shot([-1, 0, 0], RIFLE))!; // (from behind the wall's plane: away from it, whole)
    expect(unit(off.dir).x).toBeCloseTo(-1, 9);
    expect(off.strength).toBeCloseTo(RIFLE, 9);
    wall.dispose();
    const ceil = posed(gltf, 'teddy', on('ceiling', 6, CEIL, 8, [0, -1, 0], [0, 0, 1]), 3);
    const up = ceil.prepareRagdoll(shot([0.6, 0.8, 0], BUCKSHOT))!;
    expect(up.dir.y).toBeCloseTo(0, 9); // never driven up into the slab
    expect(unit(up.dir).x).toBeCloseTo(1, 9);
    expect(up.strength).toBeCloseTo(Math.min(BUCKSHOT * 0.6, BB_ACTOR.ragdollMaxShoveMps * massOf(ceil)), 6);
    expect(ceil.prepareRagdoll(shot([0, 1, 0], BUCKSHOT))).toBeNull();
    ceil.dispose();
  });

  it('in the air: never a launch — the vertical share stays within the shove band of the horizontal part', () => {
    const bb = posed(gltf, 'teddy', on('air', 6, 2, 8, [0, 1, 0], [0, 0, 1], 'fall', 0), 3);
    const before = bb.root.position.clone();
    const steep = bb.prepareRagdoll(shot([0.3, 0.9, 0.3], BUCKSHOT))!, d = unit(steep.dir);
    expect(d.y / Math.hypot(d.x, d.z)).toBeCloseTo(BB_ACTOR.ragdollShoveY[1], 6);
    expect(steep.strength).toBeLessThan(BUCKSHOT * 0.5);
    const down = unit(bb.prepareRagdoll(shot([0.3, -0.9, 0.3], RIFLE))!.dir);
    expect(down.y / Math.hypot(down.x, down.z)).toBeCloseTo(BB_ACTOR.ragdollShoveY[0], 6);
    // (the band is the one physics/ragdoll.ts applyShot clamps to: it has nothing left to change)
    expect(d.y).toBeLessThanOrEqual(0.15);
    expect(down.y).toBeGreaterThanOrEqual(-0.3);
    expect(bb.root.position.distanceTo(before)).toBe(0); // airborne: not moved
    bb.dispose();
  });
});

describe.each(BB_IDS)('BB %s ragdoll: deaths on the floor, a wall, the ceiling and in the air', v => {
  let gltf: GLTF;
  beforeAll(async () => { gltf = await bbGltf(v); }, 120_000);

  it.each(CASES.flatMap(c => SEEDS.map(seed => [c.name, seed, c] as const)))('%s (size seed %i)', (_n, seed, c) => {
    const R = run(gltf, v, c, seed);
    if (process.env.BB_RAGDOLL_LOG) console.log(`[bb-ragdoll] ${v} #${seed} | ${c.name}: frozen ${R.settled.toFixed(2)} s (last ${R.lastV.toFixed(3)} m/s), lift ${(R.lift * 100).toFixed(1)} cm, trunk >= ${R.minTrunk.toFixed(3)}, limbs >= ${R.minLimb.toFixed(3)} (${R.dip} @${R.dipT.toFixed(2)}, ${R.dipFrames} fr), top ${R.maxY.toFixed(3)}, wall ${R.wallDepth.toFixed(3)}, travel ${R.travel.toFixed(2)} m, max ${R.maxV.toFixed(1)} m/s, rest y ${R.low.toFixed(3)}..${R.top.toFixed(3)}, hips y ${R.hips.y.toFixed(2)}`);
    expect(R.finite).toBe(true);
    expect(R.failed).toBe(0);
    // --- the start: lifted just clear of the surface it clung to, along its normal only; in the air not at all
    expect(R.liftOff).toBeLessThan(1e-6);
    if (c.pose.surface === 'air') expect(R.lift).toBe(0);
    else { expect(R.lift).toBeGreaterThan(0); expect(R.lift).toBeLessThanOrEqual(BB_ACTOR.ragdollLiftM * 1.06 + 1e-9); }
    // --- never through the floor. The trunk and the head never dip under it. A hand or a foot can be pressed into it for a moment as
    // the body lands on it from a wall or a ceiling (the solver holds a light limb under a falling trunk only so well, as on every
    // ragdoll; measured over 616 deaths: at most 8.3 cm for at most 12 frames, deeper than 5 cm in 1 of 18) — nothing stays there
    expect(R.minTrunk, 'trunk / head under the floor').toBeGreaterThan(-0.02);
    expect(R.minLimb, `${R.dip} under the floor`).toBeGreaterThan(-0.12);
    expect(R.dipFrames, 'frames with a joint > 2 cm under the floor').toBeLessThanOrEqual(20);
    // --- never into the slab over it, never through the wall: at most a dent of a limb joint in the wall's face when the body is
    // thrown at it (measured: 10.5 cm at most; the wall is 0.5 m thick), and it ends on the side it died on
    expect(R.maxY, 'into the slab').toBeLessThan(CEIL);
    expect(R.wallDepth, 'into the wall').toBeLessThan(0.16);
    expect(R.sameSide).toBe(true);
    expect(R.maxV).toBeLessThan(14.5);
    // --- at rest: on the floor — flat, or slumped against the wall it slid down (no joint under the floor, none higher than a
    // sitting body's head) — where the shot could carry it
    expect(R.settled, 'frozen by the physics').toBeGreaterThan(0.5);
    expect(R.low).toBeGreaterThan(0);
    expect(R.top).toBeLessThan(0.5);
    expect(R.hips.y).toBeGreaterThan(0.03);
    expect(R.hips.y).toBeLessThan(0.35); // (flat: ~0.1; slumped against the wall it slid down: up to ~0.3)
    expect(R.travel).toBeGreaterThanOrEqual(c.travel[0]);
    expect(R.travel).toBeLessThanOrEqual(c.travel[1]);
    // and still by then: millimetres a frame at most
    expect(R.lastV).toBeLessThan(0.4);
  });
});
