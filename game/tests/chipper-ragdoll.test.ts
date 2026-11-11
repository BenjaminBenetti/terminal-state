// Task studio-woodchipper-ragdoll-20261111-033048-01: the fed body goes LIMP in the train chipper's hopper (world/chipperRagdoll.ts
// ChipperFeed, driven by world/chipper.ts) — on a generated Subway layout with the REAL parked train runtime, the real chipper and REAL
// enemy actors from the cooked GLBs (zombie-rigged / Blightbelly / Screacher, textures stripped) handed over by a corpse fake that keeps
// the corpse system's contract (corpse/api.ts: the 'lying' pose at take, ragdollTarget = the actor):
//  - pure: the feed world's machine boxes leave the hopper's mouth column open and close its sides; the shared line / lunge depth;
//  - limp: its own ragdoll (crown first, the rest free), the legs flop down instead of the posed feed's raised legs, and are dragged in;
//  - controlled over a whole job: always finite, the free parts inside the car and under their speed caps, near the machine; taken parts
//    only ever added; every part taken from CHIPPER_FEED.allBy on and inside below the rim before the credit;
//  - unchanged: the same 20 s, credit, fuel, noises, sound and blood (frame for frame) as the posed feed; one disposal;
//  - riding / paused: the body hangs exactly as it is; a save mid-grind holds no physics and rebuilds a limp body from its progress;
//  - a failed feed (a non-finite body): the bones restored, the posed feed from there, the job still credited once;
//  - the other humanoid rigs (the obese Blightbelly, the headless Screacher) feed through the same way.
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player, STAND_EYE, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainToWorld, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PlayerTrainRuntime, installPlayerTrain} from '../src/world/playerTrain';
import {CHIPPER_ANCHORS} from '../src/world/chipperSpec';
import {chipperDirToLocal, chipperPlacement, chipperToLocal} from '../src/world/chipperPlace';
import {ChipperSystem, type ChipperAudioLike, type ChipperHost} from '../src/world/chipper';
import {CHIPPER_VIEW, feedDepth, feedLine, lungeCurve} from '../src/world/chipperView';
import {CHIPPER_FEED, chipperFeedBoxes} from '../src/world/chipperRagdoll';
import {CHIPPER, jobProgress} from '../src/fuel/chipperFuel';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {ZombieActor} from '../src/ai/zombieActor';
import {createEnemyActor, type EnemyActor} from '../src/ai/creatureArchetypes';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {poseLying} from '../src/corpse/bodyPose';
import type {BodyRecordJSON} from '../src/corpse/bodyRecord';
import type {BodySink, CorpseSystemApi, HeldBody} from '../src/corpse/api';
import type {RagdollTarget} from '../src/physics/ragdoll';
import type {WorldNoise} from '../src/ai/worldNoise';

installCanvasShim(false);

const DT = 1 / 60;
const C = chipperPlacement(SPEC)!;
const A = CHIPPER_ANCHORS;
/** Train-local: the hopper mouth's centre at the rim. */
const MOUTH = chipperToLocal(C, A.hopper.x, A.hopper.y, A.hopper.z);
const I = SPEC.interior;
const FRAMES = CHIPPER.grindMs / 1000 * 60;

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
async function loadStripped(rel: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(pub(rel));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

let zombieGltf: GLTF;
const lazy: Record<string, GLTF> = {};
beforeAll(async () => {
  zombieGltf = await loadStripped('assets/models/zombie-rigged.glb');
  for (const k of ['enemy_blightbelly', 'enemy_screacher_sc01']) lazy[k] = await loadStripped(ENEMY_MODEL_FILES[k].url);
}, 120000);

let layoutCache: StationLayout | null = null;
const layout = (): StationLayout => (layoutCache ??= LEVELS.subway.generate(LEVELS.subway.entry, {levelSeed: 4242}));

class Keys implements MoveInput {
  held = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
}

const rng = (seed = 1) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const bodyRecord = (i: number, arch: BodyRecordJSON['arch'] = 'zombie'): BodyRecordJSON => ({id: `subway:main#${i}`, arch, seed: 777, type: 'shambler', pose: 'lying', x: 12.5, y: 0.2, z: 4, q: [0, 0, 0, 1], level: 0});

type Kind = 'zombie' | 'blightbelly' | 'screacher';

/** A dead body's actor (the corpse system's build: mixer stopped, the 'lying' pose). */
function deadActor(kind: Kind, i: number): EnemyActor {
  const sp: ZombieSpawn = {x: 0, z: 0, yaw: 0, type: 'shambler', area: 0, ...(kind === 'zombie' ? {} : {archetype: kind}), ...(kind === 'screacher' ? {variant: 'sc01'} : {})};
  const {actor} = createEnemyActor(sp, lazy, rng(i + 3), () => new ZombieActor(zombieGltf, sp, rng(i + 3)));
  actor.beginRagdoll();
  poseLying(actor);
  actor.root.updateMatrixWorld(true);
  return actor;
}

/** The corpse system's side of the contract with REAL actors: a held body at rest in the 'lying' pose; ragdollTarget = its actor. */
class ActorCorpses implements CorpseSystemApi {
  readonly sinks: BodySink[] = [];
  heldBody: HeldBody | null = null;
  readonly disposed: THREE.Object3D[] = [];
  readonly actors = new Map<THREE.Object3D, EnemyActor>();
  built = 0;
  /** `limp` false: no ragdoll target (the posed feed). */
  constructor(readonly kind: Kind = 'zombie', readonly limp = true) {}
  held() { return this.heldBody; }
  addSink(s: BodySink) { this.sinks.push(s); }
  buildBody(_rec: BodyRecordJSON) { this.built++; return this.make(900 + this.built).root; }
  disposeBody(o: THREE.Object3D) { this.disposed.push(o); o.removeFromParent(); this.actors.delete(o); }
  ragdollTarget(o: THREE.Object3D): RagdollTarget | null { return this.limp ? this.actors.get(o) ?? null : null; }
  private make(i: number): EnemyActor { const a = deadActor(this.kind, i); this.actors.set(a.root, a); return a; }
  pickUp(i: number): HeldBody { const a = this.make(i); this.heldBody = {record: bodyRecord(i, this.kind), object: a.root}; return this.heldBody; }
  pressE(): 'fed' | 'refused' | 'none' {
    const h = this.heldBody;
    if (!h) return 'none';
    for (const s of this.sinks) {
      const o = s.offer(h);
      if (!o) continue;
      if (o.ok && s.take(h)) { this.heldBody = null; return 'fed'; }
      return 'refused';
    }
    return 'none';
  }
}

class CountingAudio implements ChipperAudioLike {
  readonly calls: string[] = [];
  start() { this.calls.push('start'); }
  feed() { this.calls.push('feed'); }
  grind(on: boolean) { this.calls.push(on ? 'grind-on' : 'grind-off'); }
  stop() { this.calls.push('stop'); }
  frame() { /* every frame */ }
  silence() { this.calls.push('silence'); }
}

const live: {rt: PlayerTrainRuntime; ch: ChipperSystem}[] = [];
afterEach(() => { for (const {rt, ch} of live.splice(0)) { ch.teardown(); if (rt.train) rt.teardown(); } });

function setup(o: {kind?: Kind; limp?: boolean; placement?: TrainPlacement} = {}) {
  const lay = layout();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(lay);
  const player = new Player();
  const corpses = new ActorCorpses(o.kind ?? 'zombie', o.limp ?? true);
  const toasts: string[] = [];
  const noises: WorldNoise[] = [];
  const host = {
    scene, camera, player, zombies: [] as never[], levels, layout: lay, propIndex: new PropIndex(levels, lay.props),
    trainPlacement: (o.placement ?? playerTrainPlacement(lay)) as TrainPlacement | null,
    sfx: null, hud: {toast: (t: string) => { toasts.push(t); }}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: () => {}},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    sectionModelKeys: [] as ((l: StationLayout) => readonly string[])[],
    state: 'playing', world: null, input: new Keys(), run: {current: {level: 'subway', section: 'main'}, campaign: null as {transit?: unknown} | null},
    playerTrain: new PlayerTrainRecord(), trainRide: {riding: false}, corpses, worldNoiseListeners: [(n: WorldNoise) => { noises.push(n); }],
    trainRuntime: undefined as unknown as PlayerTrainRuntime,
  };
  const rt = installPlayerTrain(host);
  host.trainRuntime = rt;
  const audio = new CountingAudio();
  const ch = new ChipperSystem(host as unknown as ChipperHost, {audio}).install();
  live.push({rt, ch});
  for (const s of host.sectionHooks) s.build?.(lay);
  return {host, rt, ch, corpses, audio, toasts, noises, p: rt.train!.placement};
}
type Setup = ReturnType<typeof setup>;

/** Stand in front of the hopper in the aisle, looking into its mouth. */
function standAtHopper(s: Setup, back = 0.95): void {
  const f = chipperDirToLocal(C, 0, 0, 1);
  const at = trainToWorld(s.p, MOUTH.x + f.x * back, SPEC.floorY, MOUTH.z + f.z * back), aim = trainToWorld(s.p, MOUTH.x, MOUTH.y, MOUTH.z);
  const P = s.host.player;
  P.spawn(at.x, at.z, 0, at.y);
  P.yaw = Math.atan2(-(aim.x - at.x), -(aim.z - at.z));
  P.pitch = Math.atan2(aim.y - (at.y + STAND_EYE), Math.hypot(aim.x - at.x, aim.z - at.z));
  s.host.camera.position.set(P.x, P.y + STAND_EYE, P.z);
  s.host.camera.rotation.set(P.pitch, P.yaw, 0);
  s.host.camera.updateMatrixWorld(true);
}

function feed(s: Setup, i = 1): HeldBody {
  const held = s.corpses.pickUp(i);
  standAtHopper(s);
  expect(s.corpses.pressE()).toBe('fed');
  return held;
}

function run(s: Setup, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) s.ch.update(DT);
}

/** A bone's train-local position (the chipper's group is train-local). */
function local(s: Setup, name: string): THREE.Vector3 {
  const o = s.ch.body!.obj.getObjectByName(name)!;
  s.ch.group.updateMatrixWorld(true);
  return s.ch.group.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
}

/** Every bone's local pose (flat numbers). */
function bonePose(obj: THREE.Object3D): number[] {
  const out: number[] = [];
  obj.traverse(o => { if ((o as THREE.Bone).isBone) out.push(o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w); });
  return out;
}

const partNamed = (s: Setup, name: string) => s.ch.feed!.parts.find(p => p.part.spec.name === name)!;

// ---------------------------------------------------------------------------------------------------------------------------

describe('chipper feed: the machine in the feed world (pure)', () => {
  it('the boxes leave the mouth column open above the hopper floor and close every side round it; the line and depth are the posed feed\'s', () => {
    const boxes = chipperFeedBoxes(), M = A.hopperMouth;
    const inside = (x: number, y: number, z: number) => boxes.some(b => !b.floor && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1);
    for (let i = 0; i <= 8; i++) for (let k = 0; k <= 8; k++) for (const y of [CHIPPER_FEED.hopperFloor + 0.01, 0.6, A.hopper.y - 0.01, A.hopper.y + 0.05]) {
      const x = A.hopper.x - M.x / 2 + 0.005 + (M.x - 0.01) * i / 8, z = A.hopper.z - M.z / 2 + 0.005 + (M.z - 0.01) * k / 8;
      expect(inside(x, y, z), `mouth ${x.toFixed(3)} ${y} ${z.toFixed(3)}`).toBe(false);
    }
    // the front lip / curtain (the aisle side), the back lip, the hopper's end wall, the housing beyond: solid just below the rim
    const y = A.hopper.y - 0.03;
    expect(inside(A.hopper.x, y, A.hopper.z + M.z / 2 + 0.015)).toBe(true);
    expect(inside(A.hopper.x, y, A.hopper.z - M.z / 2 - 0.015)).toBe(true);
    expect(inside(A.hopper.x - M.x / 2 - 0.02, y, 0)).toBe(true);
    expect(inside(A.hopper.x + M.x / 2 + 0.05, y, 0)).toBe(true);
    expect(inside(A.hopper.x, CHIPPER_FEED.hopperFloor - 0.02, 0)).toBe(true); // the hopper's floor (a free limb rests in it)
    expect(inside(A.hopper.x, A.hopper.y + 0.02, A.hopper.z + M.z / 2 + 0.015)).toBe(false); // nothing above the rim
    expect(boxes.filter(b => b.floor).length).toBe(1);
    // the depth is the posed feed's lunge staircase; the line is unit, nearly vertical, leaning over the hopper's end
    const B = CHIPPER_VIEW.body;
    for (const p of [0, 0.25, 0.5, 0.9, 1]) expect(feedDepth(p, 1.8)).toBeCloseTo(B.s0 + (1.8 + B.past - B.s0) * lungeCurve(p), 12);
    const aisle = chipperDirToLocal(C, 0, 0, 1), end = chipperDirToLocal(C, -1, 0, 0);
    const L = feedLine(aisle, B.tilt1, end, new THREE.Vector3());
    expect(L.length()).toBeCloseTo(1, 9);
    expect(L.y).toBeGreaterThan(0.9);
    expect(L.x * end.x + L.z * end.z).toBeCloseTo(Math.sin(B.endLean), 9);
  });
});

describe('chipper feed: limp, drawn in', () => {
  it('the fed body is its own ragdoll: crown first, the rest free; the legs flop down (not the posed feed\'s) and are dragged in', () => {
    const s = setup();
    feed(s);
    const f = s.ch.feed!;
    expect(f).not.toBeNull();
    expect(s.ch.counts).toMatchObject({ragdolled: 1, posed: 0, feedFailed: 0});
    expect(s.ch.qa().body).toEqual({visual: true, bones: true, ragdoll: true});
    expect(f.parts.length).toBe(11); // the humanoid corpse rig, nothing new
    expect(partNamed(s, 'head').taken).toBe(true); // head first
    for (const n of ['pelvis', 'thighL', 'thighR', 'shinL', 'shinR']) expect(partNamed(s, n).taken, n).toBe(false);
    // along the body: crown -> soles
    expect(partNamed(s, 'head').chain).toBeLessThan(partNamed(s, 'torso').chain);
    expect(partNamed(s, 'torso').chain).toBeLessThan(partNamed(s, 'pelvis').chain);
    expect(partNamed(s, 'pelvis').chain).toBeLessThan(partNamed(s, 'thighL').chain);
    expect(partNamed(s, 'thighL').chain).toBeLessThan(partNamed(s, 'shinL').chain);
    // the posed feed would hold the soles up over the rim; limp, they fall
    const b = s.ch.body!;
    const feetY = () => (local(s, 'L_Foot').y + local(s, 'R_Foot').y) / 2;
    const start = feetY();
    run(s, 3);
    const p = jobProgress(s.host.playerTrain.chipper.state);
    expect(p).toBeCloseTo(0.15, 3);
    expect(feetY()).toBeLessThan(MOUTH.y + b.exposedTop(p) - 0.3);
    expect(feetY()).toBeLessThan(start - 0.3);
    expect(feetY()).toBeGreaterThan(SPEC.floorY - 0.01); // on the car floor at the lowest, never through it
    expect(f.stats.peakFree).toBeGreaterThan(0.5); // they really fell
    // the draw drags the free legs along (the pelvis is going in)
    run(s, 1);
    const t4 = [partNamed(s, 'thighL'), partNamed(s, 'thighR')].map(q => new THREE.Vector3(q.body.position.x, q.body.position.y, q.body.position.z));
    run(s, 8);
    const moved = [partNamed(s, 'thighL'), partNamed(s, 'thighR')].map((q, i) => t4[i].distanceTo(new THREE.Vector3(q.body.position.x, q.body.position.y, q.body.position.z)));
    for (const m of moved) expect(m).toBeGreaterThan(0.1);
    expect(f.taken).toBeGreaterThan(3);
  });

  it('controlled over the whole job: finite, inside the car, capped, near the machine; every part in, below the rim, before the credit', () => {
    const s = setup();
    const held = feed(s);
    const st = s.host.playerTrain.chipper.state, f = s.ch.feed!;
    let frames = 0, prevTaken = f.taken, checkedEnd = false, allChecked = false;
    while (st.job && frames < 2000) {
      s.ch.update(DT);
      frames++;
      if (!st.job) break;
      expect(s.ch.feed, `frame ${frames}`).toBe(f);
      const p = jobProgress(st);
      for (const fp of f.parts) {
        const q = fp.body.position, v = fp.body.velocity;
        expect(Number.isFinite(q.x + q.y + q.z), `${fp.part.spec.name} @${frames}`).toBe(true);
        expect(Math.hypot(q.x - MOUTH.x, q.y - MOUTH.y, q.z - MOUTH.z), `${fp.part.spec.name} near @${frames}`).toBeLessThan(2.5);
        if (fp.taken) continue;
        expect(q.x).toBeGreaterThanOrEqual(I.x0); expect(q.x).toBeLessThanOrEqual(I.x1);
        expect(Math.abs(q.z)).toBeLessThanOrEqual(I.halfWidth);
        expect(q.y).toBeGreaterThanOrEqual(SPEC.floorY - 1e-6); expect(q.y).toBeLessThanOrEqual(SPEC.ceilingY);
        expect(v.length(), `${fp.part.spec.name} speed @${frames}`).toBeLessThanOrEqual(CHIPPER_FEED.vFree + 1e-6);
      }
      expect(f.taken).toBeGreaterThanOrEqual(prevTaken); // never let go
      prevTaken = f.taken;
      if (p >= CHIPPER_FEED.allBy) { expect(f.taken, `p ${p}`).toBe(f.parts.length); allChecked = true; }
      if (frames === Math.round(FRAMES * 0.99)) {
        for (const fp of f.parts) expect(fp.body.position.y, `${fp.part.spec.name} in`).toBeLessThan(MOUTH.y + 0.05);
        checkedEnd = true;
      }
    }
    expect(allChecked && checkedEnd).toBe(true);
    // the record alone: 20 active seconds, credited once, the fuel, one disposal in that frame
    expect(frames).toBe(FRAMES);
    expect(st.done).toBe(1);
    expect(st.ticks).toBe(CHIPPER.bodyTicks);
    expect(s.ch.counts).toMatchObject({credited: 1, feedFailed: 0, ragdolled: 1});
    expect(s.corpses.disposed).toEqual([held.object]);
    expect(s.ch.body).toBeNull();
    expect(s.ch.feed).toBeNull();
    expect(f.failed).toBe(false);
    expect(f.world.bodies.length).toBe(0); // its world went with it
    run(s, 2);
    expect(s.ch.counts.credited).toBe(1);
    expect(s.corpses.disposed.length).toBe(1);
  });

  it('the blood, the noises, the sound and the 20 s are exactly the posed feed\'s, frame for frame', () => {
    const limp = setup({limp: true}), posed = setup({limp: false});
    feed(limp, 21);
    feed(posed, 22);
    expect(limp.ch.feed).not.toBeNull();
    expect(posed.ch.feed).toBeNull();
    expect(posed.ch.counts).toMatchObject({posed: 1, ragdolled: 0});
    for (let i = 0; i < FRAMES + 30; i++) {
      limp.ch.update(DT);
      posed.ch.update(DT);
      if (i % 30 === 0 || i >= FRAMES - 2) {
        expect(limp.ch.fx.counts, `frame ${i}`).toEqual(posed.ch.fx.counts);
        expect(limp.ch.fx.stats()).toEqual(posed.ch.fx.stats());
        expect(limp.host.playerTrain.chipper.state.job?.ms ?? -1).toBe(posed.host.playerTrain.chipper.state.job?.ms ?? -1);
      }
    }
    expect(limp.ch.fx.counts.drops).toBeGreaterThan(1000); // lots of blood
    expect(limp.noises.map(n => n.kind)).toEqual(posed.noises.map(n => n.kind));
    expect(limp.audio.calls).toEqual(posed.audio.calls);
    expect(limp.toasts).toEqual(posed.toasts);
    for (const s of [limp, posed]) {
      expect(s.host.playerTrain.chipper.state).toMatchObject({done: 1, ticks: CHIPPER.bodyTicks, job: null});
      expect(s.corpses.disposed.length).toBe(1);
    }
  });
});

describe('chipper feed: pause, save, failure, other bodies', () => {
  it('riding / paused: the body hangs exactly as it is; parked and playing again, the draw goes on', () => {
    const s = setup();
    feed(s);
    run(s, 2);
    const obj = s.ch.body!.obj, a = bonePose(obj), steps = s.ch.feed!.stats.steps;
    s.host.trainRide.riding = true;
    run(s, 3);
    expect(bonePose(obj)).toEqual(a);
    expect(s.ch.feed!.stats.steps).toBe(steps);
    s.host.trainRide.riding = false;
    s.host.state = 'paused';
    run(s, 1);
    expect(bonePose(obj)).toEqual(a);
    s.host.state = 'playing';
    run(s, 1);
    expect(bonePose(obj)).not.toEqual(a);
    expect(s.ch.feed!.stats.steps).toBeGreaterThan(steps);
    expect(s.host.playerTrain.chipper.state.job!.ms).toBe(3000);
  });

  it('a save mid-grind holds no physics; the load rebuilds a limp body from its progress; credited once', () => {
    const s = setup();
    feed(s, 9);
    run(s, 8);
    const saved = JSON.parse(JSON.stringify(s.host.playerTrain.participant().save()));
    expect(Object.keys(saved.chipper).sort()).toEqual(['done', 'job', 'last', 'seq', 'ticks', 'v']);
    expect(Object.keys(saved.chipper.job).sort()).toEqual(['body', 'ms', 'uid']);
    expect(saved.chipper.job.ms).toBe(8000);
    run(s, 4);
    s.host.playerTrain.participant().load(saved);
    const st = s.host.playerTrain.chipper.state;
    s.ch.update(DT);
    expect(s.corpses.disposed.length).toBe(1);
    expect(s.corpses.built).toBe(1);
    expect(s.ch.body!.uid).toBe(st.job!.uid);
    const f = s.ch.feed!;
    expect(f).not.toBeNull();
    expect(s.ch.counts.ragdolled).toBe(2);
    expect(f.taken).toBeGreaterThanOrEqual(2); // what was already in (head, chest) is in again
    expect(f.depth).toBeCloseTo(feedDepth(jobProgress(st), s.ch.body!.frame.len), 6);
    run(s, 11.9);
    expect(st.done).toBe(0);
    run(s, 0.2);
    expect(st.done).toBe(1);
    expect(st.ticks).toBe(CHIPPER.bodyTicks);
    expect(s.corpses.disposed.length).toBe(2);
    expect(s.ch.counts.credited).toBe(1);
  });

  it('a failed feed (a non-finite body): the bones restored, the posed feed from there, the job still credited once', () => {
    const s = setup();
    const held = feed(s);
    const obj = s.ch.body!.obj, start = bonePose(obj), st = s.host.playerTrain.chipper.state;
    run(s, 1);
    const head = partNamed(s, 'head');
    head.body.position.x = NaN;
    s.ch.update(DT);
    expect(s.ch.feed).toBeNull();
    expect(s.ch.counts).toMatchObject({feedFailed: 1, ragdolled: 1, posed: 1});
    // (the same rotations: a quaternion and its negation are one turn)
    const back = bonePose(obj);
    expect(back.length).toBe(start.length);
    for (let i = 0; i < back.length; i += 7) {
      for (let k = 0; k < 3; k++) expect(Math.abs(back[i + k] - start[i + k]), `bone ${i / 7} position`).toBeLessThan(1e-4);
      const dot = back[i + 3] * start[i + 3] + back[i + 4] * start[i + 4] + back[i + 5] * start[i + 5] + back[i + 6] * start[i + 6];
      expect(Math.abs(dot), `bone ${i / 7} turn`).toBeGreaterThan(1 - 1e-6);
    }
    // the posed feed moves the whole body with the progress
    const p0 = obj.position.clone();
    run(s, 2);
    expect(obj.position.distanceTo(p0)).toBeGreaterThan(0.01);
    let frames = 0;
    while (st.job && frames < 2000) { s.ch.update(DT); frames++; }
    expect(frames).toBe(FRAMES - 60 - 1 - 120);
    expect(st.done).toBe(1);
    expect(s.ch.counts.credited).toBe(1);
    expect(s.corpses.disposed).toEqual([held.object]);
  });

  it('the obese Blightbelly and the headless Screacher feed through the same way (their own ragdoll rigs)', () => {
    for (const kind of ['blightbelly', 'screacher'] as const) {
      const s = setup({kind});
      feed(s, kind === 'blightbelly' ? 31 : 32);
      const f = s.ch.feed!;
      expect(f, kind).not.toBeNull();
      expect(f.parts.length, kind).toBe(kind === 'screacher' ? 10 : 11);
      const st = s.host.playerTrain.chipper.state;
      let frames = 0, sawAll = false;
      while (st.job && frames < 2000) {
        s.ch.update(DT);
        frames++;
        if (!st.job) break;
        expect(s.ch.feed, `${kind} @${frames}`).toBe(f);
        if (jobProgress(st) >= CHIPPER_FEED.allBy) { expect(f.taken).toBe(f.parts.length); sawAll = true; }
      }
      expect(sawAll).toBe(true);
      expect(frames, kind).toBe(FRAMES);
      expect(st.done).toBe(1);
      expect(s.ch.counts).toMatchObject({ragdolled: 1, feedFailed: 0, credited: 1});
      s.ch.teardown(); s.rt.teardown(); live.pop();
    }
  });
});
