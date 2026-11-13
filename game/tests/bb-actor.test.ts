// Task studio-bb-production-20261112-234540-01 (lane ACTOR): the rendered BB (ai/bbActor.ts) on the four REAL bodies.
// What is held here:
//   * the EnemyActor contract (built by createEnemyActor in its own look, `placesRoot` / `nonGraphic`, exactly two spawn draws);
//   * PLACEMENT: the root is the brain's BbPose and nothing else — on a floor, a wall, a ceiling and in the air — and the body shown
//     is the clip's own pose (ai/bbClips.ts, the oracle) carried by it: every joint and every contact point, at any size;
//   * CLIPS: the phase -> clip table, the gear shift's dead band, the freeze of a crawl too slow to show, cross-fades without a snap;
//   * planted palms and knees stay where they were put down IN THE WORLD while the brain moves the pose (no sliding), at any pace
//     and frame rate, on every surface;
//   * the overlays, each once per counter: the cackle (the clip on a still body, a bob on a moving one, ended by a wind-up, held back
//     on a wall), the head twitch (deterministic per actor and counter; a lifted paw now and then), the look-at inside the neck's range;
//   * the hit volumes (ten; the skull sphere first; on the bones; x the size; inside the culling sphere, as every skinned vertex is);
//   * a body without the shared rig (bind pose, one trunk sphere), the ragdoll hand-over and dispose;
//   * END TO END: the real brain on a real generated level (tests/helpers/bbSim.ts) drives the four bodies.
// The ragdoll itself is tests/bb-ragdoll.test.ts, the non-graphic damage path tests/bb-nongraphic.test.ts, the clips tests/bb-clips.test.ts.
// BB_ACTOR_LOG=1 (with vitest --disableConsoleIntercept) prints what was measured.

import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type {AnimName} from '../src/ai/brain';
import {BB_ACTOR, BB_PHASE_CLIP, BbActor} from '../src/ai/bbActor';
import {BB_ASSET, BB_BODY, BB_CLIMB, BB_SCALE, BB_VARIANTS, BbBrain, bbRestPose, type BbPhase, type BbPose, type BbVariantId} from '../src/ai/bb';
import {BB_ANIMATED, BB_CLIP_NAMES, BB_CLIPS, BB_GAIT, BB_JOINTS, bbAngles, bbContacts, bbGaitDown, bbMirrorPoseAt, bbPoseAt, bbWorld,
  type BbClipName, type BbFrame, type BbRig, type BbSide, type Q, type V3} from '../src/ai/bbClips';
import {createEnemyActor, type EnemyActor} from '../src/ai/creatureArchetypes';
import {findMounts} from '../src/ai/bbSurface';
import {LEVELS} from '../src/levels/registry';
import {BB_IDS, bbGltf, rng, spawnBb, syntheticBb} from './helpers/bbBodies';
import {bbSim, bbStatic, standNear} from './helpers/bbSim';

const DT = 1 / 60, D2R = Math.PI / 180;
const SIDES: readonly BbSide[] = ['L', 'R'];
const PHASES: readonly BbPhase[] = ['idle', 'crawl', 'freeze', 'windup', 'pounce', 'fall', 'land', 'stagger', 'dead'];
/** Spawn seeds by the size they give: the smallest (0.94), about 1, the largest (1.06). */
const SMALL = 7, MID = 65536, BIG = 127773;
const LOG = !!process.env.BB_ACTOR_LOG;
const log = (...a: unknown[]): void => { if (LOG) console.log(...a); };

/**
 * The angle between two bones' rotations (rad). The bones are written from float32 tables, so their quaternions are unit only to
 * ~1e-7 — THREE's own angleTo then reads two identical ones as ~5e-4 rad apart; this one divides the lengths out. SAME: "the same".
 */
const rotAngle = (a: THREE.Quaternion, b: THREE.Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)) / Math.sqrt(a.lengthSq() * b.lengthSq())));
const SAME = 1e-6;
const rotOf = (f: BbFrame, n: string): THREE.Quaternion => new THREE.Quaternion(f.rot[n][0], f.rot[n][1], f.rot[n][2], f.rot[n][3]);
/** A clip time that falls exactly on table frame `i` (between two frames the actor's linear blend is a few millimetres off the solved pose). */
const onFrame = (clip: BbClipName, i: number): number => BB_CLIPS[clip].duration * i / BB_CLIPS[clip].frames;

const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angleDeg = (a: THREE.Vector3, b: THREE.Vector3): number => a.angleTo(b) / D2R;

/** A support frame: the pose point, the surface normal (the model's up) and the heading (the model's forward). */
interface Frame { name: string; surface: BbPose['surface']; at: V3; up: V3; fwd: V3 }
const TILT = unit([0.36, 0.8, -0.48]);
const FRAMES: readonly Frame[] = [
  {name: 'floor', surface: 'floor', at: [6, 0, 8], up: [0, 1, 0], fwd: [Math.sin(0.7), 0, Math.cos(0.7)]},
  {name: 'wall, heading up', surface: 'wall', at: [12, 1.5, 8], up: [-1, 0, 0], fwd: [0, 1, 0]},
  {name: 'wall, heading along and down', surface: 'wall', at: [4, 2.1, 3], up: [0, 0, 1], fwd: unit([1, -1, 0])},
  {name: 'ceiling', surface: 'ceiling', at: [6, 3, 8], up: [0, -1, 0], fwd: [-0.6, 0, 0.8]},
  {name: 'air, tumbling', surface: 'air', at: [5, 1.4, 5], up: TILT, fwd: unit(cross(TILT, [0, 0, 1]))},
];
const FLOOR = FRAMES[0], WALL = FRAMES[1], CEILING = FRAMES[3];
/** The frames with a surface under the body. */
const SURFACES = FRAMES.slice(0, 4);

/** Put an actor's pose on a frame (its counters as they are), with whatever else the case sets. */
function place(bb: BbActor, f: Frame, more: Partial<BbPose> = {}): BbPose {
  const P = bb.brain.pose, {cackleSeq, twitchSeq, windupSeq, pounceSeq, landSeq} = P;
  return Object.assign(P, bbRestPose(f.at[0], f.at[1], f.at[2], 0),
    {ux: f.up[0], uy: f.up[1], uz: f.up[2], fx: f.fwd[0], fy: f.fwd[1], fz: f.fwd[2], surface: f.surface, cackleSeq, twitchSeq, windupSeq, pounceSeq, landSeq}, more);
}
/** `n` frames of the actor on the pose as it stands (the game's order: animate, then the transform, then the volumes). */
function show(bb: BbActor, n = 1, dt = DT, anim: AnimName = 'Idle'): void {
  for (let i = 0; i < n; i++) { bb.animate(dt, anim, bb.brain.pose.speed); bb.syncTransform(); bb.updateVolumes(); }
}
/** `n` frames as the game runs them: the brain moves the pose along its heading at its pace, then the actor shows it. */
function run(bb: BbActor, n = 1, dt = DT): void {
  const P = bb.brain.pose;
  for (let i = 0; i < n; i++) {
    P.x += P.fx * P.speed * dt; P.y += P.fy * P.speed * dt; P.z += P.fz * P.speed * dt; P.phaseT += dt;
    show(bb, 1, dt);
  }
}

/** A root-space point (model metres) of a body of size `s` at pose `P`, in the world: X = up x forward, Y = up, Z = forward. */
function toWorld(P: BbPose, s: number, c: readonly number[]): THREE.Vector3 {
  const x = cross([P.ux, P.uy, P.uz], [P.fx, P.fy, P.fz]);
  return new THREE.Vector3(P.x + s * (x[0] * c[0] + P.ux * c[1] + P.fx * c[2]), P.y + s * (x[1] * c[0] + P.uy * c[1] + P.fy * c[2]), P.z + s * (x[2] * c[0] + P.uz * c[1] + P.fz * c[2]));
}
/** Height of a world point over the pose's support plane (m). */
const heightOf = (P: BbPose, p: {x: number; y: number; z: number}): number => (p.x - P.x) * P.ux + (p.y - P.y) * P.uy + (p.z - P.z) * P.uz;

/** The pose on the actor's bones as a clip frame (what bbAngles / bbContacts read). */
function frameOf(bb: BbActor): BbFrame {
  const rot: Record<string, Q> = {};
  for (const n of BB_ANIMATED) { const q = bb.bone(n)!.quaternion; rot[n] = [q.x, q.y, q.z, q.w]; }
  const h = bb.bone('Hips')!.position;
  return {hips: [h.x, h.y, h.z], rot};
}
const jointAt = (bb: BbActor, name: string): THREE.Vector3 => bb.bone(name)!.getWorldPosition(new THREE.Vector3());
/** World position of every driven joint. */
const jointsOf = (bb: BbActor): THREE.Vector3[] => { bb.root.updateMatrixWorld(true); return BB_ANIMATED.map(n => jointAt(bb, n)); };
const maxDist = (a: readonly THREE.Vector3[], b: readonly THREE.Vector3[]): number => a.reduce((m, p, i) => Math.max(m, p.distanceTo(b[i])), 0);
/** Where the face points (the Head joint's forward) in the world. */
const faceOf = (bb: BbActor): THREE.Vector3 => { bb.root.updateMatrixWorld(true); return new THREE.Vector3(0, 0, 1).transformDirection(bb.bone('Head')!.matrixWorld); };

interface Contacts { palm: Record<BbSide, THREE.Vector3>; knee: Record<BbSide, THREE.Vector3>; toe: Record<BbSide, THREE.Vector3>; head: {c: THREE.Vector3; r: number} }
/** The body's contact points in the WORLD, read off the actor's own bones (palm skin centres, the underside of each knee, toe tips) and its skull. */
function contactsOf(bb: BbActor): Contacts {
  const rig = bb.rig!, s = bb.scale;
  bb.root.updateMatrixWorld(true);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(bb.root.matrixWorld);
  const at = (bone: string, local: readonly number[]): THREE.Vector3 => new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(bb.bone(bone)!.matrixWorld);
  const side = (f: (d: BbSide) => THREE.Vector3): Record<BbSide, THREE.Vector3> => ({L: f('L'), R: f('R')});
  return {
    palm: side(d => at(`${d}_Hand`, rig.palm[d])),
    knee: side(d => at(`${d}_Shin`, [0, 0, 0]).addScaledVector(up, -rig.kneeR[d] * s)),
    toe: side(d => at(`${d}_Foot`, rig.toe[d])),
    head: {c: at('Head', rig.head.centre), r: rig.head.radius * s},
  };
}

/**
 * The actor shows `clip` at time `t` (`mirrored`: left <-> right), placed by its pose: every joint and contact within `tol` m of the
 * clip's own solved pose. Returns the worst miss.
 */
function expectClipPose(bb: BbActor, clip: BbClipName, t: number, what: string, tol = 0.0005, mirrored = false): number {
  const rig = bb.rig!, P = bb.brain.pose, s = bb.scale, f = (mirrored ? bbMirrorPoseAt : bbPoseAt)(rig, clip, t), W = bbWorld(rig, f), C = bbContacts(rig, f), mine = contactsOf(bb);
  let worst = 0;
  const check = (p: THREE.Vector3, c: readonly number[], name: string): void => {
    const d = p.distanceTo(toWorld(P, s, c));
    worst = Math.max(worst, d);
    expect(d, `${what}: ${name}`).toBeLessThan(tol);
  };
  for (const n of BB_ANIMATED) check(jointAt(bb, n), W.pos[n], n);
  for (const d of SIDES) { check(mine.palm[d], C.palm[d], `palm ${d}`); check(mine.knee[d], C.knee[d], `knee ${d}`); check(mine.toe[d], C.toe[d], `toe ${d}`); }
  check(mine.head.c, C.head.c, 'skull');
  expect(mine.head.r).toBeCloseTo(C.head.r * s, 9);
  return worst;
}

/**
 * Which limbs a gait has planted at cycle phase `phi`, a table frame clear of both ends of the stance (the actor blends two table
 * frames: within one frame of a landing / lift-off the blend already holds some of the swing).
 */
function plantedAt(rig: BbRig, phi: number, fast: boolean): ReturnType<typeof bbGaitDown> {
  const m = 1 / BB_CLIPS[fast ? 'Scuttle' : 'Crawl'].frames, a = bbGaitDown(rig, phi - m, fast), b = bbGaitDown(rig, phi, fast), c = bbGaitDown(rig, phi + m, fast);
  const both = (k: 'palm' | 'knee'): Record<BbSide, boolean> => ({L: a[k].L && b[k].L && c[k].L, R: a[k].R && b[k].R && c[k].R});
  return {palm: both('palm'), knee: both('knee')};
}

/** `n` directions spread evenly over the sphere. */
const sphere = (n: number): V3[] => Array.from({length: n}, (_, i): V3 => { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963; return [r * Math.cos(a), y, r * Math.sin(a)]; });

const bodies = new Map<BbVariantId, GLTF>();
beforeAll(async () => { for (const v of BB_IDS) bodies.set(v, await bbGltf(v)); }, 120_000);

describe.each(BB_IDS)('BB actor, look %s (the real body)', v => {
  const gltf = (): GLTF => bodies.get(v)!;
  const make = (seed = SMALL, f: Frame = FLOOR, more: Partial<BbPose> = {}): BbActor => {
    const bb = new BbActor(gltf(), spawnBb(f.at[0], f.at[2], v), rng(seed));
    place(bb, f, more);
    return bb;
  };

  it('is built by createEnemyActor in its own look: the contract flags, its own materials, exactly two draws', () => {
    const draw = rng(4242), drawn: number[] = [];
    const made = createEnemyActor(spawnBb(6, 8, v, 0.7), {[BB_VARIANTS[v].model]: gltf()}, () => { const x = draw(); drawn.push(x); return x; }, () => { throw new Error('a zombie stood in for a BB'); });
    expect(made.fallback).toBe(false);
    expect(made.actor).toBeInstanceOf(BbActor);
    const bb = made.actor as BbActor;
    expect(drawn.length).toBe(2);
    expect(bb.scale).toBeCloseTo(BB_SCALE.min + drawn[0] * (BB_SCALE.max - BB_SCALE.min), 12);
    expect(bb.groanT).toBeCloseTo(2 + drawn[1] * 5, 12);
    expect([bb.archetype, bb.variant, bb.root.name]).toEqual(['bb', v, `enemy-bb-${v}`]);
    expect([bb.placesRoot, bb.nonGraphic, bb.coated, bb.look, bb.ragdolled, bb.hitFlash, bb.deadT]).toEqual([true, true, false, null, false, 0, 0]);
    expect(bb.brain).toBeInstanceOf(BbBrain);
    expect([bb.brain.x, bb.brain.z, bb.brain.yaw]).toEqual([6, 8, 0.7]);
    expect(bb.extras).toBe(gltf().scene.userData.enemyBb);
    expect(bb.hasRig).toBe(true);
    expect(bb.rig!.heightM).toBeCloseTo(BB_ASSET.heightM, 2);
    expect(bb.clip).toBe('Idle');
    // on its spawn point facing its yaw, at its size
    expect(bb.root.position.toArray()).toEqual([6, 0, 8]);
    expect(bb.root.scale.toArray()).toEqual([bb.scale, bb.scale, bb.scale]);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(bb.root.quaternion).distanceTo(new THREE.Vector3(Math.sin(0.7), 0, Math.cos(0.7)))).toBeLessThan(1e-9);
    // one skinned body, tagged for the damage / wardrobe look-ups
    expect(bb.meshes.length).toBeGreaterThanOrEqual(1);
    for (const m of bb.meshes) {
      expect(m.isSkinnedMesh).toBe(true);
      expect(m.name).toBe('BBBody');
      expect(m.userData).toMatchObject({slot: 'body', wearable: null, archetype: 'bb'});
      expect(bb.slotOf(m)).toBe('body');
    }
    expect(bb.slotOf(new THREE.Object3D())).toBeNull();
    // its own materials and bones: the GLB template stays at rest, untouched
    const theirs: THREE.Material[] = [];
    gltf().scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) theirs.push(...(Array.isArray(m.material) ? m.material : [m.material])); });
    for (const m of bb.meshes) expect(theirs).not.toContain(m.material);
    show(bb, 5);
    expect(Math.abs(bb.bone('L_Thigh')!.quaternion.w)).toBeLessThan(0.999);
    for (const [n] of BB_JOINTS) expect(Math.abs(gltf().scene.getObjectByName(n)!.quaternion.w), n).toBeGreaterThan(0.99999);
    bb.dispose();
  });

  it.each(FRAMES)('placement: the root is the brain\'s pose and nothing else — $name', f => {
    for (const seed of [SMALL, BIG]) {
      const bb = make(seed, f, {phase: 'crawl', speed: 1.4});
      show(bb, 3);
      bb.root.updateMatrixWorld(true);
      const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
      bb.root.matrixWorld.extractBasis(X, Y, Z);
      expect(bb.root.position.toArray()).toEqual(f.at);
      const x = cross(f.up, f.fwd), s = bb.scale;
      expect(X.distanceTo(new THREE.Vector3(...x).multiplyScalar(s)), 'X = up x forward').toBeLessThan(1e-9);
      expect(Y.distanceTo(new THREE.Vector3(...f.up).multiplyScalar(s)), 'Y = up').toBeLessThan(1e-9);
      expect(Z.distanceTo(new THREE.Vector3(...f.fwd).multiplyScalar(s)), 'Z = forward').toBeLessThan(1e-9);
      expect(bb.root.matrixWorld.determinant()).toBeCloseTo(s ** 3, 9); // (never mirrored)
      bb.dispose();
    }
  });

  it('shows the clip\'s own pose carried by the brain\'s pose: every joint and contact, on every surface, small and large', () => {
    /** A phase held for `n` frames (past every cross-fade), and the clip time the body must then show. */
    interface Shot { phase: BbPhase; more?: Partial<BbPose>; anim?: AnimName; n?: number; clip: BbClipName; t: (bb: BbActor, frames: number) => number; tol?: number }
    const at = (clip: BbClipName, i: number, phase: BbPhase, more: Partial<BbPose> = {}): Shot => ({phase, more: {...more, phaseT: onFrame(clip, i)}, clip, t: () => onFrame(clip, i)});
    const shots: Shot[] = [
      // (the gaits run by distance, so between table frames: the actor's blend of two frames is up to ~1 cm off the solved pose at a swinging shin)
      {phase: 'crawl', more: {speed: 1.4}, clip: 'Crawl', t: bb => bb.gait.phase * BB_CLIPS.Crawl.duration, tol: 0.012},
      {phase: 'crawl', more: {speed: 4.8}, clip: 'Scuttle', t: bb => bb.gait.phase * BB_CLIPS.Scuttle.duration, tol: 0.012},
      {phase: 'freeze', clip: 'Poise', t: (_b, n) => n * DT},                      // 0.5 s: table frame 5
      at('Windup', 14, 'windup'),
      {phase: 'windup', more: {phaseT: 9}, clip: 'Windup', t: () => BB_CLIPS.Windup.duration}, // (held at its end)
      at('Pounce', 15, 'pounce', {speed: 7}),
      {phase: 'fall', more: {speed: 5}, n: 21, clip: 'Fall', t: (_b, n) => n * DT}, // 0.35 s: table frame 10
      at('Land', 21, 'land'),
      {phase: 'land', more: {phaseT: NaN}, clip: 'Land', t: () => 0},              // (a broken clock: its start, never a NaN pose)
      at('Hit', 8, 'stagger'),
      {phase: 'idle', anim: 'Death', clip: 'Death', t: (_b, n) => n * DT},        // 0.5 s: table frame 10
    ];
    let worst = 0, gait = 0;
    for (const f of FRAMES) for (const seed of [SMALL, BIG]) for (const sh of shots) {
      const bb = make(seed, f, {phase: sh.phase, ...sh.more}), n = sh.n ?? 30;
      show(bb, n, DT, sh.anim ?? 'Idle');
      expect(bb.clip).toBe(sh.clip);
      const miss = expectClipPose(bb, sh.clip, sh.t(bb, n), `${f.name}, ${sh.clip} x${bb.scale.toFixed(2)}`, sh.tol);
      if (sh.tol) gait = Math.max(gait, miss); else worst = Math.max(worst, miss);
      bb.dispose();
    }
    log(`${v}: actor pose vs the clip oracle, worst joint / contact miss ${(worst * 1000).toFixed(3)} mm on table frames, ${(gait * 1000).toFixed(2)} mm between them (the gaits)`);
  });

  it('planted palms and knees stay where they were put down IN THE WORLD: every surface, pace and frame rate', () => {
    const runs: [number, number, number][] = [[1.4, 1 / 60, SMALL], [4.8, 1 / 60, BIG], [0.8, 1 / 144, MID], [3.0, 1 / 30, SMALL], [BB_CLIMB.speed, 1 / 60, BIG], [BB_CLIMB.calmSpeed, 1 / 50, MID]];
    let worstSlide = 0, worstOff = 0;
    for (const f of SURFACES) for (const [speed, dt, seed] of runs) {
      const bb = make(seed, f, {phase: 'crawl', speed}), rig = bb.rig!, P = bb.brain.pose, what = `${f.name} at ${speed} m/s, ${Math.round(1 / dt)} Hz`;
      run(bb, Math.ceil(0.3 / dt), dt); // (through the cross-fade out of the idle)
      const start = bb.root.position.clone(), frames = Math.ceil(2 / dt);
      const anchor = new Map<string, THREE.Vector3>();
      let slide = 0, off = 0, stances = 0;
      for (let i = 0; i < frames; i++) {
        run(bb, 1, dt);
        const C = contactsOf(bb), planted = plantedAt(rig, bb.gait.phase, bb.gait.fast);
        for (const kind of ['palm', 'knee'] as const) for (const d of SIDES) {
          const key = kind + d, p = C[kind][d];
          if (!planted[kind][d]) { anchor.delete(key); continue; }
          const a = anchor.get(key);
          if (!a) { anchor.set(key, p.clone()); stances++; continue; }
          slide = Math.max(slide, p.distanceTo(a));
          off = Math.max(off, Math.abs(heightOf(P, p)));
        }
        // nothing of the body under the surface, the skull well clear of it
        for (const d of SIDES) for (const p of [C.palm[d], C.knee[d], C.toe[d]]) expect(heightOf(P, p), what).toBeGreaterThan(-0.004);
        expect(heightOf(P, C.head.c) - C.head.r, what).toBeGreaterThan(0.1);
      }
      // the body went where the brain's pose went, and the limbs kept stepping all the way
      expect(bb.root.position.distanceTo(start)).toBeCloseTo(speed * dt * frames, 6);
      expect(stances, what).toBeGreaterThan(8);
      expect(slide, `${what}: a planted limb slid`).toBeLessThan(0.006);
      expect(off, `${what}: a planted limb off the surface`).toBeLessThan(0.004);
      worstSlide = Math.max(worstSlide, slide); worstOff = Math.max(worstOff, off);
      bb.dispose();
    }
    log(`${v}: planted limbs in the world, worst drift over a stance ${(worstSlide * 1000).toFixed(2)} mm, worst height off the surface ${(worstOff * 1000).toFixed(2)} mm`);
  });

  it('the gear shifts with a dead band; a freeze holds the stride of the pair that led, and the crawl resumes from it', () => {
    const bb = make(MID, FLOOR, {phase: 'crawl', speed: 1}), rig = bb.rig!, P = bb.brain.pose, k = rig.sizeK * bb.scale;
    const at = (speed: number): BbClipName | null => { P.speed = speed; run(bb, 2); return bb.clip; };
    expect(at(BB_GAIT.shiftDownMps * k * 1.02)).toBe('Crawl');
    expect(at(BB_GAIT.shiftUpMps * k * 0.99)).toBe('Crawl');   // not yet
    expect(at(BB_GAIT.shiftUpMps * k * 1.01)).toBe('Scuttle');
    expect(bb.gait.fast).toBe(true);
    expect(at(BB_GAIT.shiftUpMps * k * 0.99)).toBe('Scuttle'); // inside the band: no flapping back
    expect(at(BB_GAIT.shiftDownMps * k * 1.01)).toBe('Scuttle');
    expect(at(BB_GAIT.shiftDownMps * k * 0.99)).toBe('Crawl');
    expect(at(BB_GAIT.shiftUpMps * k * 0.99)).toBe('Crawl');
    bb.dispose();
    // the freeze: stopped with pair A (left hand + right knee) or pair B planted ahead — mirror images, each solved for this body
    const frozen = (lo: number): {bb: BbActor; f: BbFrame} => {
      const a = make(MID, FLOOR, {phase: 'crawl', speed: 1.4});
      run(a, 20);
      for (let i = 0; i < 400 && !(a.gait.phase >= lo && a.gait.phase < lo + 0.1); i++) run(a, 1);
      a.brain.pose.phase = 'freeze'; a.brain.pose.speed = 0;
      run(a, 30);
      expect(a.clip).toBe('Poise');
      return {bb: a, f: frameOf(a)};
    };
    const A = frozen(0.05), B = frozen(0.55);
    expectClipPose(A.bb, 'Poise', 30 * DT, 'pair A led');
    expectClipPose(B.bb, 'Poise', 30 * DT, 'pair B led', 0.0005, true);
    const cA = bbContacts(rig, A.f), cB = bbContacts(rig, B.f);
    // pair A's hand is ahead in the one, pair B's in the other, by the same stride (to the solver's centimetre)
    const stride = cA.palm.L[2] - cA.palm.R[2];
    expect(stride).toBeGreaterThan(0.02 * rig.sizeK);
    expect(Math.abs(cB.palm.R[2] - cB.palm.L[2] - stride)).toBeLessThan(0.012);
    expect(Math.abs(cB.knee.L[2] - cB.knee.R[2] - (cA.knee.R[2] - cA.knee.L[2]))).toBeLessThan(0.012);
    // all four limbs ON the surface either way round (no real body is symmetric: the plain pose with its joint angles swapped left
    // for right left a palm or a knee up to 11 mm under it)
    for (const x of [A, B]) {
      const C = contactsOf(x.bb), Q2 = x.bb.brain.pose;
      for (const d of SIDES) {
        expect(Math.abs(heightOf(Q2, C.palm[d])), 'a frozen palm on the surface').toBeLessThan(0.003);
        expect(heightOf(Q2, C.knee[d]), 'a frozen knee not under the surface').toBeGreaterThan(-0.003);
        expect(heightOf(Q2, C.knee[d]), 'a frozen knee at the surface').toBeLessThan(0.02); // (the tense stance tips the pelvis: one knee rides up to 13 mm high)
      }
    }
    // out of the freeze the stride starts early in the stance of the pair that was planted ahead
    for (const [x, base] of [[A, 0], [B, 0.5]] as const) {
      const Q2 = x.bb.brain.pose;
      Q2.phase = 'crawl'; Q2.speed = 1.4;
      run(x.bb, 1);
      expect(x.bb.clip).toBe('Crawl');
      expect(x.bb.gait.phase).toBeCloseTo(base + 0.3 * rig.m.crawlDuty + DT * 1.4 / (rig.m.crawlM * x.bb.scale), 9);
      x.bb.dispose();
    }
  });

  it('a new clip is cross-faded into without a snap, a restarted one eased into, and the fade ends on the clip', () => {
    const bb = make(MID, FLOOR), rig = bb.rig!, P = bb.brain.pose, mid = onFrame('Windup', 12);
    show(bb, 30);
    const idle = jointsOf(bb);
    P.phase = 'windup'; P.phaseT = mid;
    show(bb);
    const first = jointsOf(bb);
    show(bb, 10);
    const end = jointsOf(bb), total = maxDist(idle, end);
    expect(total).toBeGreaterThan(0.03 * rig.sizeK);
    expect(maxDist(idle, first)).toBeLessThan(0.3 * total);
    expectClipPose(bb, 'Windup', mid, 'after the fade');
    // the same phase begins again (a second wind-up): eased into, not cut
    P.phaseT = 0;
    show(bb);
    const again = jointsOf(bb);
    show(bb, 8);
    const start = jointsOf(bb), back = maxDist(end, start);
    expect(back).toBeGreaterThan(0.02 * rig.sizeK);
    expect(maxDist(end, again)).toBeLessThan(0.45 * back);
    expectClipPose(bb, 'Windup', 0, 'restarted');
    // a flinch goes to the other side every other time (the Hit clip seen in a mirror, solved for this body)
    const peak = onFrame('Hit', 6);
    const flinch = (mirrored: boolean): BbFrame => {
      P.phase = 'stagger'; P.phaseT = peak;
      show(bb, 12);
      expectClipPose(bb, 'Hit', peak, mirrored ? 'a flinch to the other side' : 'a flinch', 0.0005, mirrored);
      const f = frameOf(bb);
      P.phase = 'idle';
      show(bb, 30);
      return f;
    };
    const one = flinch(false), two = flinch(true), three = flinch(false);
    for (const n of BB_ANIMATED) expect(rotAngle(rotOf(three, n), rotOf(one, n)), `${n}: the third as the first`).toBeLessThan(SAME);
    // (the arm thrown up is the right one, then the left)
    const c1 = bbContacts(rig, one), c2 = bbContacts(rig, two);
    expect(c1.palm.R[1]).toBeGreaterThan(c1.palm.L[1] + 0.02 * rig.sizeK);
    expect(c2.palm.L[1]).toBeGreaterThan(c2.palm.R[1] + 0.02 * rig.sizeK);
    bb.dispose();
  });

  it('the cackle: once per count; the Cackle clip on a still body, a bob over the gait on a moving one; a wind-up ends it; held back on a wall', () => {
    const frames = Math.round(BB_CLIPS.Cackle.duration / DT);
    for (const still of ['idle', 'freeze'] as const) {
      const bb = make(MID, FLOOR, {phase: still}), P = bb.brain.pose, rest = BB_PHASE_CLIP[still];
      show(bb, 40);
      expect(bb.clip).toBe(rest);
      const low = heightOf(P, contactsOf(bb).head.c);
      P.cackleSeq++;
      let n = 0, top = -Infinity, hands = -Infinity;
      for (let i = 0; i < frames + 30; i++) {
        show(bb);
        if (bb.clip !== 'Cackle') { expect(i, 'the clip runs its length').toBeGreaterThanOrEqual(frames - 1); continue; }
        expect(i).toBe(n++);
        const C = contactsOf(bb);
        top = Math.max(top, heightOf(P, C.head.c));
        hands = Math.max(hands, Math.min(heightOf(P, C.palm.L), heightOf(P, C.palm.R)));
        for (const d of SIDES) expect(Math.abs(heightOf(P, C.knee[d])), 'it stays on its knees').toBeLessThan(0.015);
      }
      expect(Math.abs(n - frames)).toBeLessThanOrEqual(1);
      expect(bb.clip).toBe(rest);
      // up on its haunches: the head well above where it was, both hands off the surface
      expect(top).toBeGreaterThan(low + 0.05);
      expect(hands).toBeGreaterThan(0.05);
      show(bb, 200);
      expect(bb.clip, 'not replayed').toBe(rest);
      P.cackleSeq++;
      show(bb);
      expect(bb.clip, 'the next count plays it again').toBe('Cackle');
      // a wind-up ends it for good
      show(bb, 10);
      P.phase = 'windup'; P.phaseT = 0;
      show(bb, 3);
      expect(bb.clip).toBe('Windup');
      P.phase = still;
      show(bb, 2);
      expect(bb.clip).toBe(rest);
      bb.dispose();
    }
    // moving: the gait goes on underneath (hips and legs untouched), chest and head bob for the clip's length, then nothing is left
    const a = make(MID, FLOOR, {phase: 'crawl', speed: 1.4}), b = make(MID, FLOOR, {phase: 'crawl', speed: 1.4});
    run(a, 30); run(b, 30);
    a.brain.pose.cackleSeq++;
    const LEGS = ['Hips', 'Spine', 'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'], q = (x: BbActor, n: string): THREE.Quaternion => x.bone(n)!.quaternion;
    let bob = 0, nod = 0, sunk = Infinity;
    for (let i = 0; i < frames + 12; i++) {
      run(a, 1); run(b, 1);
      expect(a.clip).toBe('Crawl');
      for (const n of LEGS) expect(rotAngle(q(a, n), q(b, n)), n).toBeLessThan(SAME);
      bob = Math.max(bob, rotAngle(q(a, 'Chest'), q(b, 'Chest')) / D2R);
      nod = Math.max(nod, angleDeg(faceOf(a), faceOf(b)));
      const C = contactsOf(a);
      for (const d of SIDES) sunk = Math.min(sunk, heightOf(a.brain.pose, C.palm[d]));
      expect(bbAngles(a.rig!, frameOf(a)).headExtension).toBeLessThanOrEqual(BB_ACTOR.look.upDeg + 0.5);
    }
    log(`${v}: moving cackle, chest bob ${bob.toFixed(1)} deg, face off the plain gait by up to ${nod.toFixed(1)} deg, lowest palm ${(sunk * 1000).toFixed(1)} mm`);
    expect(bob).toBeGreaterThan(BB_ACTOR.cackle.bobDeg * 0.8);
    expect(bob).toBeLessThan(BB_ACTOR.cackle.bobDeg * 1.05);
    expect(nod).toBeGreaterThan(4);
    expect(sunk, 'the bobbing chest presses a palm no more than a few millimetres into the surface').toBeGreaterThan(-0.008);
    for (const n of BB_ANIMATED) expect(rotAngle(q(a, n), q(b, n)), `${n} after`).toBeLessThan(SAME);
    a.dispose(); b.dispose();
    // on a wall the still cackle is only part of the way up: chest off the wall, never standing out of it
    const fl = make(MID, FLOOR), wl = make(MID, WALL);
    show(fl, 40); show(wl, 40);
    const settled = heightOf(wl.brain.pose, contactsOf(wl).head.c);
    fl.brain.pose.cackleSeq++; wl.brain.pose.cackleSeq++;
    let out = 0, outFloor = 0;
    for (let i = 0; i < frames - 2; i++) {
      show(fl); show(wl);
      expect(wl.clip).toBe('Cackle');
      const hw = heightOf(wl.brain.pose, contactsOf(wl).head.c), hf = heightOf(fl.brain.pose, contactsOf(fl).head.c);
      expect(hw).toBeLessThanOrEqual(hf + 1e-6);
      out = Math.max(out, hw - settled); outFloor = Math.max(outFloor, hf - settled);
    }
    log(`${v}: cackle, the head comes ${(outFloor * 100).toFixed(1)} cm up on a floor, ${(out * 100).toFixed(1)} cm off a wall`);
    expect(out).toBeGreaterThan(0.02);
    expect(out).toBeLessThan(0.75 * outFloor);
    fl.dispose(); wl.dispose();
  });

  it('the freeze\'s head twitch: once per count, a hash of the actor and the count, back to the stance; a paw comes up on every third', () => {
    const T = BB_ACTOR.twitch, hold = Math.round(0.14 / DT), all = Math.ceil(T.durationS / DT) + 2;
    const frozen = (seed = MID): BbActor => { const bb = make(seed, FLOOR, {phase: 'freeze'}); show(bb, 30); return bb; };
    /**
     * The twitch of count `seq` on a fresh frozen body beside an untwitched twin: at the hold, the face's turn off the stance and how
     * far each palm / knee moved off the twin's (m; palms: their height over it).
     */
    const twitch = (seq: number, seed = MID): {turn: number; quat: number[]; palms: number[]; knees: number[]; sizeK: number} => {
      const bb = frozen(seed), plain = frozen(seed), P = bb.brain.pose, rig = bb.rig!;
      P.twitchSeq = seq;
      let turn = 0, quat: number[] = [], palms: number[] = [], knees: number[] = [];
      for (let i = 1; i <= all; i++) {
        show(bb); show(plain);
        expect(bbAngles(rig, frameOf(bb)).headTurn, 'inside the neck\'s range').toBeLessThanOrEqual(BB_ACTOR.look.yawDeg + 0.5);
        expect(bb.clip).toBe('Poise');
        if (i === hold) {
          const C = contactsOf(bb), C0 = contactsOf(plain);
          turn = angleDeg(faceOf(bb), faceOf(plain));
          quat = bb.bone('Head')!.quaternion.toArray();
          palms = SIDES.map(d => heightOf(P, C.palm[d]) - heightOf(P, C0.palm[d]));
          knees = SIDES.map(d => C.knee[d].distanceTo(C0.knee[d]));
        }
      }
      // let go: the stance again, exactly — and it is not replayed while the count stays
      for (const n of BB_ANIMATED) expect(rotAngle(bb.bone(n)!.quaternion, plain.bone(n)!.quaternion), `${n} after the twitch`).toBeLessThan(SAME);
      show(bb, 60); show(plain, 60);
      for (const n of BB_ANIMATED) expect(rotAngle(bb.bone(n)!.quaternion, plain.bone(n)!.quaternion), `${n}: not replayed`).toBeLessThan(SAME);
      bb.dispose(); plain.dispose();
      return {turn, quat, palms, knees, sizeK: rig.sizeK};
    };
    const t1 = twitch(1), t1b = twitch(1), t2 = twitch(2), t3 = twitch(3), other = twitch(1, BIG);
    // a real snap of the head, the same every time for the same actor and count, different for another count / another actor
    for (const t of [t1, t2, t3, other]) { expect(t.turn).toBeGreaterThan(T.yawDeg[0] * 0.6); expect(t.turn).toBeLessThan(T.yawDeg[1] + T.rollDeg); }
    expect(t1b.quat).toEqual(t1.quat);
    expect(t2.quat).not.toEqual(t1.quat);
    expect(other.quat).not.toEqual(t1.quat);
    // counts 1 and 2: no limb moves; count 3: one hand comes up off the surface, the other and both knees stay where they are
    for (const t of [t1, t2]) for (const h of [...t.palms, ...t.knees]) expect(Math.abs(h)).toBeLessThan(1e-9);
    const up = Math.max(...t3.palms), down = Math.min(...t3.palms);
    log(`${v}: twitch turns the face ${t1.turn.toFixed(0)} / ${t2.turn.toFixed(0)} / ${t3.turn.toFixed(0)} deg; the lifted paw comes ${(up * 1000).toFixed(0)} mm up`);
    expect(up).toBeGreaterThan(0.01 * t3.sizeK);
    expect(Math.abs(down)).toBeLessThan(1e-9);
    for (const h of t3.knees) expect(h).toBeLessThan(1e-9);
    // while it crawls a twitch turns the head only (no paw over a gait)
    const a = make(MID, FLOOR, {phase: 'crawl', speed: 1.4}), b = make(MID, FLOOR, {phase: 'crawl', speed: 1.4});
    run(a, 30); run(b, 30);
    a.brain.pose.twitchSeq = 3;
    let turned = 0;
    for (let i = 0; i < all; i++) {
      run(a, 1); run(b, 1);
      turned = Math.max(turned, angleDeg(faceOf(a), faceOf(b)));
      for (const n of BB_ANIMATED) if (n !== 'Neck' && n !== 'Head') expect(rotAngle(a.bone(n)!.quaternion, b.bone(n)!.quaternion), n).toBeLessThan(SAME);
    }
    expect(turned).toBeGreaterThan(T.yawDeg[0] * 0.6);
    a.dispose(); b.dispose();
  });

  it('looks at pose.look with neck and head, inside the neck\'s audited range, on every surface; lets go when there is nothing to look at', () => {
    const L = BB_ACTOR.look, N = 40, dirs = sphere(22);
    // (the wind-up twice: its dip — chest between the elbows, the head at its lowest — and reared up at its end)
    const stances: [BbPhase, Partial<BbPose>][] = [['idle', {}], ['freeze', {}], ['crawl', {speed: 1.4}], ['windup', {phaseT: 0.16}], ['windup', {phaseT: 0.5}], ['pounce', {phaseT: 0.3, speed: 6}]];
    let worstTurn = 0, hi = -Infinity, lo = Infinity, gain = 0, n = 0, worse = 0, worst = 0, skull = Infinity;
    for (const f of [FLOOR, WALL, CEILING]) for (const [phase, more] of stances) for (const d of dirs) {
      // the looking body beside a twin with nothing to look at
      const bb = make(MID, f, {phase, ...more}), plain = make(MID, f, {phase, ...more}), P = bb.brain.pose, rig = bb.rig!;
      // 3 m from the body, all round it (over, under and behind as well)
      const t = toWorld(P, 1, [d[0] * 3, 0.3 + d[1] * 3, d[2] * 3]);
      P.look = {x: t.x, y: t.y, z: t.z};
      show(bb, N); show(plain, N);
      const A = bbAngles(rig, frameOf(bb)), want = t.clone().sub(jointAt(plain, 'Head'));
      worstTurn = Math.max(worstTurn, A.headTurn); hi = Math.max(hi, A.headExtension); lo = Math.min(lo, A.headExtension);
      expect(A.headTurn, `${f.name} ${phase}: head turn`).toBeLessThanOrEqual(L.yawDeg + 0.5);
      expect(A.headExtension, `${f.name} ${phase}: head extension`).toBeLessThanOrEqual(L.upDeg + 0.5);
      expect(A.headExtension, `${f.name} ${phase}: head flexion`).toBeGreaterThanOrEqual(-L.downDeg - 0.5);
      // it turns TOWARD what it looks at, as far as the neck goes (a target right behind and under it: no turn helps, some hurt a little)
      const err = angleDeg(faceOf(bb), want), err0 = angleDeg(faceOf(plain), want);
      gain += err0 - err; n++;
      if (err > err0 + 2) { worse++; worst = Math.max(worst, err - err0); }
      // only neck and head move, and wherever it looks its skull stays off the surface it is on
      for (const j of BB_ANIMATED) if (j !== 'Neck' && j !== 'Head') expect(rotAngle(bb.bone(j)!.quaternion, plain.bone(j)!.quaternion), j).toBeLessThan(SAME);
      const C = contactsOf(bb), under = heightOf(P, C.head.c) - C.head.r;
      skull = Math.min(skull, under);
      expect(under, `${f.name} ${phase}: the skull over the surface, looking ${d.map(x => x.toFixed(2)).join(' ')}`).toBeGreaterThan(0.01);
      // nothing to look at any more: back to the clip's own head
      P.look = null;
      show(bb, 80); show(plain, 80);
      for (const j of ['Neck', 'Head']) expect(rotAngle(bb.bone(j)!.quaternion, plain.bone(j)!.quaternion) / D2R, `${f.name} ${phase}: ${j} relaxed`).toBeLessThan(0.2);
      bb.dispose(); plain.dispose();
    }
    log(`${v}: look-at over ${n} targets: mean gain ${(gain / n).toFixed(1)} deg, ${worse} left worse off (by up to ${worst.toFixed(1)}); head turn <= ${worstTurn.toFixed(1)}, extension ${lo.toFixed(1)} .. ${hi.toFixed(1)}; skull >= ${(skull * 100).toFixed(1)} cm over the surface`);
    expect(gain / n).toBeGreaterThan(25);
    expect(worse).toBeLessThanOrEqual(0.02 * n);
    expect(worst).toBeLessThan(15);
  });

  it('the pose and the clips it is not looking in leave the head alone: a landing, a fall, a flinch, a death', () => {
    for (const [phase, more, anim] of [['land', {phaseT: 0.4}, 'Idle'], ['fall', {speed: 4}, 'Idle'], ['stagger', {phaseT: 0.2}, 'Hit'], ['idle', {}, 'Death']] as [BbPhase, Partial<BbPose>, AnimName][]) {
      const bb = make(MID, FLOOR, {phase, ...more}), plain = make(MID, FLOOR, {phase, ...more});
      const t = toWorld(bb.brain.pose, 1, [2, 1.5, 1]);
      bb.brain.pose.look = {x: t.x, y: t.y, z: t.z};
      show(bb, 40, DT, anim); show(plain, 40, DT, anim);
      for (const j of BB_ANIMATED) expect(rotAngle(bb.bone(j)!.quaternion, plain.bone(j)!.quaternion), `${phase}: ${j}`).toBeLessThan(SAME);
      bb.dispose(); plain.dispose();
    }
  });

  it('a target the neck can reach is faced: to either side in front of it, from just under its own eye line down', () => {
    // (on all fours the neck's 75 degrees of extension bring the face up to about the horizon of its own surface and no higher:
    // what is above that — a standing player's face, seen from the floor — it looks toward as far as it can)
    let worst = 0, top = 0;
    for (const f of [FLOOR, WALL, CEILING]) for (const [phase, more] of [['idle', {}], ['freeze', {}], ['crawl', {speed: 1.4}]] as [BbPhase, Partial<BbPose>][]) {
      for (const yaw of [-60, -25, 0, 40, 60]) for (const elev of [-28, -18, -9, 25]) {
        const bb = make(MID, f, {phase, ...more}), P = bb.brain.pose;
        show(bb, 20);
        // 4 m from its head, `yaw` to the side and `elev` over the surface's horizon
        const head = jointAt(bb, 'Head'), c = Math.cos(elev * D2R);
        const t = head.clone().add(toWorld(P, 1, [Math.sin(yaw * D2R) * c * 4, Math.sin(elev * D2R) * 4, Math.cos(yaw * D2R) * c * 4]).sub(new THREE.Vector3(P.x, P.y, P.z)));
        P.look = {x: t.x, y: t.y, z: t.z};
        show(bb, 60);
        const err = angleDeg(faceOf(bb), t.clone().sub(jointAt(bb, 'Head')));
        bb.dispose();
        if (elev > 0) { top = Math.max(top, elev - err); continue; }
        worst = Math.max(worst, err);
        expect(err, `${f.name} ${phase}: target ${yaw} deg aside, ${elev} deg up`).toBeLessThan(2);
      }
    }
    log(`${v}: a target in reach is faced within ${worst.toFixed(2)} deg; toward one 25 deg up, the face comes up to ${top.toFixed(1)} deg`);
    expect(top).toBeGreaterThan(-12);
    expect(top).toBeLessThan(12);
  });

  it('hit volumes: ten, the skull sphere first, on the bones, x the size, inside the culling sphere — alive only', () => {
    for (const f of FRAMES) for (const seed of [SMALL, BIG]) for (const [phase, more] of [['idle', {}], ['crawl', {speed: 4.8}], ['pounce', {phaseT: 0.35, speed: 7}], ['land', {phaseT: 0.6}], ['windup', {phaseT: 0.5}]] as [BbPhase, Partial<BbPose>][]) {
      const bb = make(seed, f, {phase, ...more}), rig = bb.rig!, s = bb.scale, P = bb.brain.pose;
      show(bb, 25);
      const V = bb.hitVolumes;
      expect(bb.updateVolumes()).toBe(bb.hitVolumes);
      expect(V.map(x => x.part)).toEqual(['head', 'torso', 'limb', 'limb', 'limb', 'limb', 'limb', 'limb', 'limb', 'limb']);
      const at = (p: {x: number; y: number; z: number}): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
      // the skull: one sphere on the Head joint
      const C = contactsOf(bb);
      expect(V[0].b).toBeNull();
      expect(at(V[0].a).distanceTo(C.head.c)).toBeLessThan(1e-9);
      expect(V[0].r).toBeCloseTo(rig.head.radius * s, 12);
      // the trunk: from the Hips toward the Neck, ending short of it (its round end covers the shoulders, not the back of the skull)
      const hips = jointAt(bb, 'Hips'), neck = jointAt(bb, 'Neck'), tb = at(V[1].b!);
      expect(at(V[1].a).distanceTo(hips)).toBeLessThan(1e-9);
      expect(V[1].r).toBeCloseTo(rig.hit.torso * s, 12);
      expect(tb.distanceTo(hips) + tb.distanceTo(neck)).toBeCloseTo(hips.distanceTo(neck), 9);
      expect(tb.distanceTo(neck)).toBeCloseTo(Math.min(0.7 * hips.distanceTo(neck), BB_ACTOR.torsoPullK * rig.hit.torso * s), 9);
      // the limbs: two capsules each, joint to joint (the forearm's to the palm)
      let i = 2;
      for (const d of SIDES) {
        const ends: [THREE.Vector3, THREE.Vector3, number][] = [
          [jointAt(bb, `${d}_UpperArm`), jointAt(bb, `${d}_Forearm`), rig.hit.arm], [jointAt(bb, `${d}_Forearm`), C.palm[d], rig.hit.arm],
          [jointAt(bb, `${d}_Thigh`), jointAt(bb, `${d}_Shin`), rig.hit.leg], [jointAt(bb, `${d}_Shin`), jointAt(bb, `${d}_Foot`), rig.hit.leg]];
        for (const [a, b, r] of ends) {
          expect(at(V[i].a).distanceTo(a)).toBeLessThan(1e-9);
          expect(at(V[i].b!).distanceTo(b)).toBeLessThan(1e-9);
          expect(V[i].r).toBeCloseTo(r * s, 12);
          i++;
        }
      }
      // every volume inside the sphere the body is culled by
      const K = BB_ACTOR.cull, centre = toWorld(P, s, K.centre);
      for (const x of V) for (const p of [x.a, x.b]) if (p) expect(at(p).distanceTo(centre) + x.r, `${f.name} ${phase}`).toBeLessThan(K.radius * s);
      bb.dispose();
    }
    // dead: no live volumes (the corpse system asks for its own), which are still its small ones
    const bb = make(BIG, WALL);
    show(bb, 5);
    bb.brain.damage(999, 0, 0);
    expect(bb.updateVolumes()).toEqual([]);
    expect(bb.hitVolumes).toEqual([]);
    const corpse = bb.corpseVolumes();
    expect(corpse.length).toBe(10);
    expect(corpse[0].part).toBe('head');
    expect(corpse[0].r).toBeCloseTo(bb.rig!.head.radius * bb.scale, 12);
    bb.dispose();
  });

  it('the culling sphere covers the skinned body in every clip, at every size and in the bind pose', () => {
    const K = BB_ACTOR.cull, p = new THREE.Vector3();
    /** The furthest skinned vertex from the sphere's centre, in root-space model metres. */
    const reach = (root: THREE.Object3D, scale: number): number => {
      root.updateMatrixWorld(true);
      const c = new THREE.Vector3(K.centre[0], K.centre[1], K.centre[2]).applyMatrix4(root.matrixWorld);
      let far = 0;
      root.traverse(o => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        const n = m.geometry.getAttribute('position').count;
        for (let i = 0; i < n; i += 5) far = Math.max(far, m.getVertexPosition(i, p).applyMatrix4(m.matrixWorld).distanceTo(c));
      });
      return far / scale;
    };
    let worst = 0, where = '';
    const shots: [BbPhase, Partial<BbPose>, AnimName][] = [['idle', {}, 'Idle'], ['freeze', {}, 'Idle'], ['crawl', {speed: 1.4}, 'Idle'], ['crawl', {speed: 4.8}, 'Idle'], ['fall', {speed: 4}, 'Idle'], ['idle', {}, 'Death']];
    for (const clip of ['Windup', 'Pounce', 'Land', 'Hit'] as const) for (const u of [0, 0.3, 0.6, 1]) {
      const phase = (Object.keys(BB_PHASE_CLIP) as BbPhase[]).find(k => BB_PHASE_CLIP[k] === clip)!;
      shots.push([phase, {phaseT: u * BB_CLIPS[clip].duration}, 'Idle']);
    }
    for (const [phase, more, anim] of shots) for (const frames of [25, 31, 38]) {
      const bb = make(frames === 31 ? BIG : SMALL, frames === 38 ? CEILING : FLOOR, {phase, ...more});
      show(bb, frames, DT, anim);
      const far = reach(bb.root, bb.scale);
      if (far > worst) { worst = far; where = `${bb.clip} after ${frames} frames`; }
      // the sphere the renderer culls by is that sphere (the skinned mesh sits on the root untransformed)
      for (const m of bb.meshes) {
        const s = m.boundingSphere!.clone().applyMatrix4(m.matrixWorld);
        expect(s.center.distanceTo(toWorld(bb.brain.pose, bb.scale, K.centre))).toBeLessThan(1e-9);
        expect(s.radius).toBeCloseTo(K.radius * bb.scale, 9);
      }
      bb.dispose();
    }
    // the Cackle clip (reared up) and the standing bind (what a body without the rig shows)
    const bb = make(BIG, FLOOR);
    show(bb, 20);
    bb.brain.pose.cackleSeq++;
    for (let i = 0; i < 70; i += 7) { show(bb, 7); const far = reach(bb.root, bb.scale); if (far > worst) { worst = far; where = `Cackle frame ${i}`; } }
    bb.dispose();
    const bind = reach(SkeletonUtils.clone(gltf().scene), 1);
    log(`${v}: furthest skinned vertex from the cull centre ${worst.toFixed(3)} m (${where}); the bind pose ${bind.toFixed(3)} m; the sphere ${K.radius} m`);
    expect(worst).toBeLessThan(K.radius - 0.03);
    expect(bind).toBeLessThan(K.radius - 0.03);
  });

  it('hands over to the ragdoll: bone velocities from the last two poses, then nothing here moves the body', () => {
    const bb = make(MID, FLOOR, {phase: 'fall', speed: 0}), P = bb.brain.pose, out = new THREE.Vector3();
    expect(bb.boneVelocity('Hips', out).length()).toBe(0); // (no history yet)
    show(bb, 30);
    // carried along by the pose at 3 m/s: the bones' velocities are the pose's (the falling clip's own motion is small beside it)
    P.speed = 3;
    run(bb, 3);
    const want = new THREE.Vector3(P.fx, P.fy, P.fz).multiplyScalar(3);
    for (const n of ['Hips', 'Chest', 'Head']) expect(bb.boneVelocity(n, out).distanceTo(want), n).toBeLessThan(0.6);
    expect(bb.boneVelocity('NoSuchBone', out).length()).toBe(0);
    for (const [n] of BB_JOINTS) expect(bb.bone(n), n).toBeInstanceOf(THREE.Bone);
    expect(bb.bone('NoSuchBone')).toBeUndefined();
    // the ragdoll takes over: the pose and the clips no longer write the root or the bones
    bb.beginRagdoll();
    expect(bb.ragdolled).toBe(true);
    const root = bb.root.position.clone(), quat = bb.root.quaternion.clone(), bones = BB_ANIMATED.map(n => bb.bone(n)!.quaternion.clone());
    place(bb, CEILING, {phase: 'crawl', speed: 4});
    run(bb, 20);
    expect(bb.root.position.equals(root)).toBe(true);
    expect(bb.root.quaternion.equals(quat)).toBe(true);
    BB_ANIMATED.forEach((n, i) => expect(bb.bone(n)!.quaternion.equals(bones[i]), n).toBe(true));
    // ... while the hit flash still fades, and the physics reports where the body went
    bb.hitFlash = 1;
    show(bb, 1);
    expect(bb.hitFlash).toBeCloseTo(1 - 6 * DT, 9);
    bb.ragdollMoved(3.5, -2);
    expect([bb.brain.x, bb.brain.z]).toEqual([3.5, -2]);
    // the settled corpse is culled by the sphere the physics gives it (never smaller than 0.6 m)
    for (const [r, want2] of [[0.2, 0.6], [1.3, 1.3]]) {
      bb.setCullSphere(new THREE.Vector3(3.5, 0.2, -2), r);
      for (const m of bb.meshes) {
        const s = m.boundingSphere!.clone().applyMatrix4(m.matrixWorld);
        expect(s.center.distanceTo(new THREE.Vector3(3.5, 0.2, -2))).toBeLessThan(1e-9);
        expect(s.radius).toBeCloseTo(want2, 9);
      }
    }
    bb.dispose();
  });
});

describe('BB actor: placement guards, fallbacks and bodies without the shared rig', () => {
  const lullaby = (): GLTF => bodies.get('lullaby')!;

  it('a pose basis that is not quite orthonormal is squared up; a degenerate one keeps the last orientation; a broken point keeps the last place', () => {
    const bb = new BbActor(lullaby(), spawnBb(6, 8), rng(MID)), P = bb.brain.pose;
    place(bb, WALL);
    show(bb, 2);
    const s = bb.scale, X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    const axes = (): void => { bb.root.updateMatrixWorld(true); bb.root.matrixWorld.extractBasis(X, Y, Z); X.divideScalar(s); Y.divideScalar(s); Z.divideScalar(s); };
    // lengths off, forward leaning into the normal: Y = the unit normal, Z = forward's part square to it
    Object.assign(P, {ux: -1.3, uy: 0, uz: 0, fx: -0.2, fy: 0.9, fz: 0.1});
    show(bb);
    axes();
    expect(Y.distanceTo(new THREE.Vector3(-1, 0, 0))).toBeLessThan(1e-9);
    expect(Z.distanceTo(new THREE.Vector3(0, 0.9, 0.1).normalize())).toBeLessThan(1e-9);
    expect(X.distanceTo(new THREE.Vector3().crossVectors(Y, Z))).toBeLessThan(1e-9);
    const kept = bb.root.quaternion.clone();
    // no up / no forward / forward along up: the place follows, the orientation stays
    for (const bad of [{ux: 0, uy: 0, uz: 0}, {fx: 0, fy: 0, fz: 0}, {fx: -1, fy: 0, fz: 0}, {ux: NaN}] as Partial<BbPose>[]) {
      place(bb, WALL, {x: 3, y: 1, z: 2, ...bad});
      show(bb);
      expect(bb.root.position.toArray()).toEqual([3, 1, 2]);
      expect(bb.root.quaternion.equals(kept)).toBe(true);
      expect(bb.root.matrixWorld.elements.every(Number.isFinite)).toBe(true);
    }
    // a point that is not a number: nothing moves
    place(bb, FLOOR, {x: NaN});
    show(bb);
    expect(bb.root.position.toArray()).toEqual([3, 1, 2]);
    expect(bb.root.quaternion.equals(kept)).toBe(true);
    for (const x of bb.hitVolumes) expect(Number.isFinite(x.a.x + x.a.y + x.a.z + x.r)).toBe(true);
    bb.dispose();
  });

  it('each phase shows its clip; a crawl too slow to show is the freeze; a death the pose has not caught up with still dies', () => {
    expect(Object.keys(BB_PHASE_CLIP).sort()).toEqual([...PHASES].sort());
    for (const c of Object.values(BB_PHASE_CLIP)) expect(BB_CLIP_NAMES).toContain(c);
    const cases: [BbPhase, number, BbClipName][] = [['idle', 0, 'Idle'], ['crawl', 1.4, 'Crawl'], ['crawl', 4.8, 'Scuttle'], ['crawl', BB_ACTOR.stillMps * 0.9, 'Poise'], ['crawl', 0, 'Poise'], ['crawl', NaN, 'Poise'],
      ['freeze', 0, 'Poise'], ['windup', 0, 'Windup'], ['pounce', 7, 'Pounce'], ['fall', 3, 'Fall'], ['land', 0, 'Land'], ['stagger', 0, 'Hit'], ['dead', 0, 'Death']];
    for (const v of BB_IDS) for (const [phase, speed, clip] of cases) {
      const bb = new BbActor(bodies.get(v)!, spawnBb(6, 8, v), rng(SMALL));
      place(bb, FLOOR, {phase, speed});
      show(bb, 3);
      expect(bb.clip, `${v}: ${phase} at ${speed} m/s`).toBe(clip);
      for (const n of BB_ANIMATED) expect(Number.isFinite(bb.bone(n)!.quaternion.lengthSq()), n).toBe(true);
      bb.dispose();
    }
    // the game's `anim` only ever says one thing the pose may not have caught up with: a death
    const a = new BbActor(lullaby(), spawnBb(6, 8), rng(SMALL));
    place(a, FLOOR, {phase: 'crawl', speed: 3});
    show(a, 2, DT, 'Run');
    expect(a.clip).toBe('Scuttle');
    show(a, 1, DT, 'Death');
    expect(a.clip).toBe('Death');
    const b = new BbActor(lullaby(), spawnBb(6, 8), rng(SMALL));
    show(b, 2);
    b.brain.damage(999, 0, 0);
    expect(b.brain.alive).toBe(false);
    show(b, 1, DT, 'Idle');
    expect(b.clip).toBe('Death');
    a.dispose(); b.dispose();
  });

  it('no model loaded: the counted zombie stand-in, never another look; an unknown look is the first one', () => {
    const stand = {archetype: 'zombie'} as unknown as EnemyActor;
    expect(createEnemyActor(spawnBb(1, 1, 'teddy'), {}, rng(1), () => stand)).toEqual({actor: stand, fallback: true});
    const other = createEnemyActor(spawnBb(1, 1, 'teddy'), {[BB_VARIANTS.binky.model]: bodies.get('binky')}, rng(1), () => stand);
    expect(other.actor).toBe(stand);
    expect(other.fallback).toBe(true);
    const odd = new BbActor(lullaby(), {...spawnBb(1, 1), variant: 'no-such-look'}, rng(1));
    expect(odd.variant).toBe(BB_IDS[0]);
    odd.dispose();
  });

  it('sizes stay inside the family\'s band over many spawns, and one BB\'s blink never lights another', () => {
    const scales = Array.from({length: 40}, (_, i) => { const bb = new BbActor(lullaby(), spawnBb(1, 1), rng(20000 * (i + 1) + 13)); const s = bb.scale; bb.dispose(); return s; });
    for (const s of scales) { expect(s).toBeGreaterThanOrEqual(BB_SCALE.min); expect(s).toBeLessThanOrEqual(BB_SCALE.max); }
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.08);
    const a = new BbActor(lullaby(), spawnBb(1, 1), rng(1)), b = new BbActor(lullaby(), spawnBb(2, 1), rng(2));
    const glow = (x: BbActor): number[] => (x.meshes[0].material as THREE.MeshStandardMaterial).emissive.toArray();
    a.hitFlash = 1;
    show(a); show(b);
    const f = 1 - 6 * DT;
    expect(glow(a)[0]).toBeCloseTo(f * BB_ACTOR.flash[0], 6);
    expect(glow(a)[0]).toBeCloseTo(glow(a)[1], 6); // (a neutral pale blink: no red)
    expect(glow(b)).toEqual([0, 0, 0]);
    show(a, 12);
    expect(a.hitFlash).toBe(0);
    expect(glow(a)).toEqual([0, 0, 0]);
    // dispose: its own materials go, the template's stay
    const mine = a.meshes.map(m => m.material as THREE.Material), gone = new Set<THREE.Material>();
    const theirs: THREE.Material[] = [];
    lullaby().scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) theirs.push(m.material as THREE.Material); });
    for (const m of [...mine, ...theirs]) m.addEventListener('dispose', () => gone.add(m));
    a.dispose();
    for (const m of mine) expect(gone.has(m)).toBe(true);
    for (const m of theirs) expect(gone.has(m)).toBe(false);
    b.dispose();
  });

  it('the runtime clips as THREE clips (QA / the corpse poser\'s Death look-up): built once, null for a name it has none of', () => {
    const bb = new BbActor(lullaby(), spawnBb(1, 1), rng(1));
    for (const name of BB_CLIP_NAMES) {
      const c = bb.authoredClip(name)!;
      expect(c).toBeInstanceOf(THREE.AnimationClip);
      expect([c.name, c.tracks.length]).toEqual([name, BB_ANIMATED.length + 1]);
      expect(c.duration).toBeCloseTo(BB_CLIPS[name].duration, 6);
      expect(bb.authoredClip(name)).toBe(c);
    }
    for (const name of ['Walk', 'Run', 'Attack', 'Scream', '', 'toString']) expect(bb.authoredClip(name), name).toBeNull();
    bb.dispose();
  });

  it('a body on the shared joints that is not a BB GLB still works (its own proportions, the contract\'s default radii)', () => {
    const bb = new BbActor(syntheticBb(), spawnBb(6, 8), rng(BIG));
    expect(bb.hasRig).toBe(true);
    place(bb, CEILING, {phase: 'crawl', speed: 1.4});
    run(bb, 40);
    expect(bb.clip).toBe('Crawl');
    const V = bb.hitVolumes, rig = bb.rig!;
    expect(V.length).toBe(10);
    expect(V[0].r).toBeCloseTo(BB_ASSET.headRadius * rig.sizeK * bb.scale, 9);
    expect(V[1].r).toBeCloseTo(BB_ASSET.hitRadii.torso * rig.sizeK * bb.scale, 9);
    const C = contactsOf(bb), down = bbGaitDown(rig, bb.gait.phase, false);
    for (const d of SIDES) {
      if (down.palm[d]) expect(Math.abs(heightOf(bb.brain.pose, C.palm[d]))).toBeLessThan(0.004);
      if (down.knee[d]) expect(Math.abs(heightOf(bb.brain.pose, C.knee[d]))).toBeLessThan(0.004);
    }
    expect(down.palm.L || down.palm.R).toBe(true);
    bb.dispose();
  });

  it('a GLB whose skeleton is not the shared rig at rest shows its bind pose: placed, one trunk sphere, no clips, still a ragdoll', () => {
    const odd = syntheticBb();
    odd.scene.getObjectByName('Spine')!.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    const gone = syntheticBb();
    gone.scene.getObjectByName('L_Hand')!.name = 'LeftHand';
    for (const [gltf, what] of [[odd, 'a rotated rest'], [gone, 'a missing joint']] as const) {
      const bb = new BbActor(gltf, spawnBb(6, 8), rng(BIG)), P = bb.brain.pose;
      expect(bb.hasRig, what).toBe(false);
      expect([bb.clip, bb.rig, bb.authoredClip('Crawl')]).toEqual([null, null, null]);
      const bind = BB_ANIMATED.map(n => bb.bone(n)?.quaternion.clone());
      place(bb, WALL, {phase: 'crawl', speed: 3});
      run(bb, 10);
      // placed by the pose as ever, its bones as the GLB had them
      expect(bb.root.position.distanceTo(new THREE.Vector3(P.x, P.y, P.z))).toBe(0);
      BB_ANIMATED.forEach((n, i) => { if (bind[i]) expect(bb.bone(n)!.quaternion.equals(bind[i]!), n).toBe(true); });
      // one sphere about the body centre
      const V = bb.hitVolumes, up = BB_BODY.centreUp * bb.scale;
      expect(V.length).toBe(1);
      expect([V[0].part, V[0].b]).toEqual(['torso', null]);
      expect(V[0].r).toBeCloseTo(BB_ASSET.hitRadii.torso * 1.6 * bb.scale, 12);
      expect(Math.hypot(V[0].a.x - (P.x + P.ux * up), V[0].a.y - (P.y + P.uy * up), V[0].a.z - (P.z + P.uz * up))).toBeLessThan(1e-12);
      // a ragdoll rig all the same (the contract's default sizes), and the shot is still taken as a small body takes it
      expect(bb.ragdollRig.parts.length).toBe(11);
      const at = bb.root.position.clone();
      const shove = bb.prepareRagdoll({dir: {x: 1, y: 0, z: 0}, point: {x: 0, y: 0, z: 0}, strength: 38});
      expect(bb.root.position.equals(at)).toBe(true);
      expect(shove).toBeNull(); // (fired straight into the wall it is on)
      bb.dispose();
    }
  });
});

describe('BB actor: END TO END — the real brain on a real level drives the four bodies', () => {
  it('subway: hunting (floor, leaps, landings) and perching (walls, ceilings): placed by the pose every frame, the clip its phase asks for, sane volumes, no sliding', () => {
    const layout = LEVELS.subway.generate('main', {levelSeed: 1201}), {L, cw} = bbStatic(layout);
    // an ordinary spawn point with a wall to climb near it and a place for the player 7 m away (as tests/bb-brain.test.ts picks its scenes)
    let scene: {at: {x: number; z: number; y: number; yaw: number; level?: number}; player: {x: number; z: number; y: number}} | null = null;
    for (const s of layout.zombies) {
      const y = s.y ?? L.grid(s.level ?? 0).floorAt(s.x, s.z);
      if (!findMounts(cw, s.x, y, s.z, BB_CLIMB.mountReachM).length) continue;
      const p = standNear(layout, s.x, s.z, y, 7);
      if (!p) continue;
      scene = {at: {x: s.x, z: s.z, y, yaw: Math.atan2(p.x - s.x, p.z - s.z), level: s.level}, player: {x: p.x, z: p.z, y}};
      break;
    }
    expect(scene).not.toBeNull();
    const S = scene!;
    const T = {frames: 0, phases: new Set<BbPhase>(), surfaces: new Set<string>(), clips: new Set<string>(), skullMin: Infinity, skullWhere: '', skullSolid: 0, skullDeep: 0, solidWhere: [] as string[],
      straight: [] as number[], other: [] as number[], limbLow: Infinity, limbWhere: '', travelled: 0, paced: 0};
    /** What went wrong, where (the first few). */
    const bad: string[] = [];
    const fail = (what: string, why: string): void => { if (bad.length < 12) bad.push(`${what}: ${why}`); };
    const drive = (seconds: number, player: {x: number; z: number; y: number}): void => {
      const sim = bbSim(layout, {at: S.at, player});
      const actors = BB_IDS.map((v, i) => new BbActor(bodies.get(v)!, spawnBb(S.at.x, S.at.z, v, S.at.yaw), rng([SMALL, MID, BIG, 20013][i])));
      const prev = actors.map(() => ({clip: null as BbClipName | null, since: 0, C: null as Contacts | null, down: null as ReturnType<typeof bbGaitDown> | null}));
      const K = BB_ACTOR.cull, up = new THREE.Vector3(), fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
      const was = {at: new THREE.Vector3(sim.b.pose.x, sim.b.pose.y, sim.b.pose.z), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, 1)};
      sim.run(seconds, DT, (_t, out) => {
        const P = sim.b.pose;
        T.frames++; T.phases.add(P.phase); T.surfaces.add(P.surface);
        up.set(P.ux, P.uy, P.uz); fwd.set(P.fx, P.fy, P.fz);
        // did the brain move the pose straight along its heading at the pace it reports? (through a turn, a corner or a mount it
        // travels less than speed x dt: the limbs keep stepping through it)
        const moved = tmp.set(P.x, P.y, P.z).sub(was.at), along = moved.dot(fwd), aside = Math.sqrt(Math.max(0, moved.lengthSq() - along * along));
        const straight = Math.max(was.up.angleTo(up), was.fwd.angleTo(fwd)) < 0.002 && Math.abs(along - P.speed * DT) < 0.001 && aside < 0.001;
        if (P.phase === 'crawl') { T.travelled += along; T.paced += P.speed * DT; }
        was.at.set(P.x, P.y, P.z); was.up.copy(up); was.fwd.copy(fwd);
        actors.forEach((bb, i) => {
          // the game's frame: the brain has written its pose; animate, place, volumes
          Object.assign(bb.brain.pose, P, {look: P.look ? {...P.look} : null});
          bb.animate(DT, out.anim, P.speed);
          bb.syncTransform();
          const V = bb.updateVolumes(), Q2 = bb.brain.pose, clip = bb.clip!, what = `${bb.variant} t=${sim.t.toFixed(2)} ${P.surface}/${P.phase}/${clip}`;
          // placed by the pose
          if (bb.root.position.x !== P.x || bb.root.position.y !== P.y || bb.root.position.z !== P.z) fail(what, 'the root is not at the pose point');
          if (tmp.set(0, 1, 0).applyQuaternion(bb.root.quaternion).distanceTo(up) > 1e-6 || tmp.set(0, 0, 1).applyQuaternion(bb.root.quaternion).distanceTo(fwd) > 1e-6) fail(what, 'the root is not turned as the pose');
          // the clip its phase asks for
          T.clips.add(clip);
          const still = P.phase === 'idle' || P.phase === 'freeze' || (P.phase === 'crawl' && !(P.speed > BB_ACTOR.stillMps));
          const ok = still ? clip === 'Cackle' || clip === (P.phase === 'idle' ? 'Idle' : 'Poise') : P.phase === 'crawl' ? clip === 'Crawl' || clip === 'Scuttle' : clip === BB_PHASE_CLIP[P.phase];
          if (!ok) fail(what, 'not the clip of its phase');
          // the volumes: ten, finite, inside the culling sphere
          if (V.length !== 10) fail(what, `${V.length} volumes`);
          const centre = toWorld(Q2, bb.scale, K.centre);
          for (const x of V) for (const p of [x.a, x.b]) if (p && !(Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z) + x.r < K.radius * bb.scale)) fail(what, `a ${x.part} volume outside the culling sphere`);
          // the skull against the surface it is on, and against the level's real geometry
          const C = contactsOf(bb), rig = bb.rig!;
          if (P.surface !== 'air') {
            const h = heightOf(Q2, C.head.c) - C.head.r;
            if (h < T.skullMin) { T.skullMin = h; T.skullWhere = what; }
            for (const d of SIDES) for (const p of [C.palm[d], C.knee[d]]) { const l = heightOf(Q2, p); if (l < T.limbLow) { T.limbLow = l; T.limbWhere = what; } }
          }
          const band = cw.band(C.head.c.x, C.head.c.y, C.head.c.z);
          if (!band) { T.skullSolid++; if (T.solidWhere.length < 4 && i === 0) T.solidWhere.push(`${what} doing ${JSON.stringify(sim.b.doing)}`); }
          else T.skullDeep = Math.max(T.skullDeep, band.floor + C.head.r - C.head.c.y, C.head.c.y + C.head.r - band.ceil);
          // planted limbs between two frames of the same gait
          const m = prev[i], gait = clip === 'Crawl' || clip === 'Scuttle', down = gait ? plantedAt(rig, bb.gait.phase, bb.gait.fast) : null;
          m.since = m.clip === clip ? m.since + 1 : 0;
          // (8 frames into a clip: past its cross-fade)
          if (down && m.down && m.C && m.since >= 8) {
            for (const kind of ['palm', 'knee'] as const) for (const d of SIDES) if (down[kind][d] && m.down[kind][d]) (straight ? T.straight : T.other).push(C[kind][d].distanceTo(m.C[kind][d]));
          }
          m.clip = clip; m.C = C; m.down = down;
        });
      });
      const A = sim.audit;
      log(`e2e ${seconds} s: ${JSON.stringify({wall: A.wall, ceiling: A.ceiling, air: A.air, windups: A.windups, leaps: A.leaps, hits: A.hits, mounts: sim.b.tally.mounts})}`);
      for (const bb of actors) bb.dispose();
    };
    drive(40, S.player);                                              // the hunt: cackle, approach, wind-up, leap, landing, cooldown
    drive(70, {x: S.at.x + 500, z: S.at.z + 500, y: S.at.y});         // nobody about: it perches on walls and ceilings
    const pct = (a: number[], q: number): number => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
    log(`e2e: ${T.frames} frames; phases ${[...T.phases].join(' ')}; surfaces ${[...T.surfaces].join(' ')}; clips ${[...T.clips].join(' ')}`);
    log(`e2e: skull over its surface >= ${(T.skullMin * 100).toFixed(1)} cm (${T.skullWhere}); lowest palm / knee ${(T.limbLow * 1000).toFixed(1)} mm (${T.limbWhere})`);
    log(`e2e: against the level's geometry, the skull centre is inside something solid on ${T.skullSolid} of ${T.frames * BB_IDS.length} actor-frames, the skull sphere up to ${(T.skullDeep * 100).toFixed(1)} cm into a floor / ceiling; first: ${T.solidWhere.join(' | ')}`);
    log(`e2e: crawling, the pose travelled ${T.travelled.toFixed(1)} m along its heading for ${T.paced.toFixed(1)} m of speed x dt`);
    log(`e2e: planted-limb slide per frame — pose straight at its pace: n=${T.straight.length} median ${(pct(T.straight, 0.5) * 1000).toFixed(2)} mm, p95 ${(pct(T.straight, 0.95) * 1000).toFixed(2)}, max ${(pct(T.straight, 1) * 1000).toFixed(2)}; turning / off its pace: n=${T.other.length} median ${(pct(T.other, 0.5) * 1000).toFixed(2)}, p95 ${(pct(T.other, 0.95) * 1000).toFixed(2)}, max ${(pct(T.other, 1) * 1000).toFixed(2)}`);
    expect(bad).toEqual([]);
    for (const p of ['idle', 'crawl', 'freeze', 'windup', 'pounce', 'land'] as const) expect(T.phases.has(p), p).toBe(true);
    for (const s of ['floor', 'wall', 'ceiling', 'air']) expect(T.surfaces.has(s), s).toBe(true);
    for (const c of ['Idle', 'Crawl', 'Scuttle', 'Poise', 'Cackle', 'Windup', 'Pounce', 'Land']) expect(T.clips.has(c), c).toBe(true);
    // the skull never in the surface the body is on, whatever it looks at; a palm or a knee under it only through a cross-fade (<= 0.1 s)
    expect(T.skullMin).toBeGreaterThan(0.01);
    expect(T.limbLow).toBeGreaterThan(-0.03);
    // where the brain moves the pose straight at its reported pace, a planted limb stays put in the world
    expect(T.straight.length).toBeGreaterThan(400);
    expect(pct(T.straight, 0.95)).toBeLessThan(0.0005);
    expect(pct(T.straight, 1)).toBeLessThan(0.004);
  }, 240_000);
});
