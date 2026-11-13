// Task studio-refinement-batch-20261113-035659-01 (lane DROPS; user: "Carried bodies: set down/drop freely as physical ragdolls that fall
// naturally amid clutter, rather than requiring a clear area. Preserve body identity, contents and train/physical ownership through
// saves/travel; no deletion or duplication."): the corpse system's RAGDOLL DROP (world/corpses.ts) on a generated Subway station with the
// REAL PhysicsSystem (physics/world.ts: the station statics, the parked car's floor volume and shell boxes, the clutter props), the real
// parked train runtime + ride + Player (helpers/fuelCartsHost.ts), the real chipper, real enemy actors from the cooked GLBs:
//  - amid clutter (crates round the player, where the old posed drop refuses): it falls, comes to rest supported and grounded, no part
//    inside a crate, its ACTUAL pose recorded ('fallen');
//  - facing a wall (the car's side from inside, its shell from the platform): released pulled back, it never ends beyond the wall;
//  - ownership from the settled pelvis: in the parked car the train's, on the platform the station lane's;
//  - the station lane / Continue / a journey rebuild the SAME body (id, size) lying exactly as it fell; picked up again it carries as before;
//  - mid-fall: a save records it falling, the departure waits for it, a teardown stops it there and the rebuilt body falls on — one body,
//    one place, through every move; strict records (old 'lying' records unchanged).
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';
import type {PropPlacement} from '../src/gen/props';
import {playerTrainPlacement, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {sectionId, type SectionKey} from '../src/levels/types';
import {ZombieActor} from '../src/ai/zombieActor';
import {createEnemyActor, type EnemyActor} from '../src/ai/creatureArchetypes';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {corpseFeedable} from '../src/ai/corpseTrait';
import {BODIES, bodyProblem, type BodyRecordJSON} from '../src/corpse/bodyRecord';
import {CORPSE_CARRY_PARTICIPANT, STATION_BODIES_LANE, carryProblem, heldRecord, stationBodiesProblem, type StationBodiesJSON} from '../src/corpse/bodyLanes';
import {CORPSE_TEXT, CorpseSystem} from '../src/world/corpses';
import {ChipperSystem, type ChipperAudioLike, type ChipperHost} from '../src/world/chipper';
import {cargoProblem, type TrainCargoJSON} from '../src/run/trainCargo';
import {PhysicsSystem} from '../src/physics/world';
import type {SectionMemory} from '../src/run/memory';
import {checksumOf} from '../src/save/checksum';
import {validateSaveFile} from '../src/save/validate';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {build, lookAt, press, run, stationHost, syncCamera} from './helpers/fuelCartsHost';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';

installCanvasShim(false);

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
  for (const k of ['enemy_blightbelly']) lazy[k] = await loadStripped(ENEMY_MODEL_FILES[k].url);
}, 120000);

const SUB = (): StationLayout => LEVELS.subway.generate('main', {levelSeed: 4242});
const OFF = (): StationLayout => LEVELS.office.generate('main', {levelSeed: 4242});
const KA: SectionKey = {level: 'subway', section: 'main', station: sid(1)};
const KB: SectionKey = {level: 'office', section: 'main', station: sid(2)};
const I = SPEC.interior;
const MID = (I.x0 + I.x1) / 2 - 3; // (between the rear and middle doors: the chipper is in the front half)
const rng = (seed = 1) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

/** The run: section memories (killed + lanes) by section id, the section being played. */
class FakeRun {
  entry: {lanes: Record<string, unknown>; memories: Record<string, SectionMemory>} | null = null;
  readonly mems = new Map<string, SectionMemory>();
  constructor(public current: SectionKey) {}
  memory(key: SectionKey = this.current): SectionMemory {
    const id = sectionId(key);
    let m = this.mems.get(id);
    if (!m) this.mems.set(id, (m = {id, visits: 0, pickups: null, holders: {}, killed: [], cleared: false, lanes: {}}));
    return m;
  }
  laneStore<T = unknown>(lane: string, key: SectionKey = this.current): T | undefined { return this.mems.get(sectionId(key))?.lanes[lane] as T | undefined; }
  setLaneStore(lane: string, data: unknown, key: SectionKey = this.current): void {
    const m = this.memory(key);
    if (data === undefined) delete m.lanes[lane]; else m.lanes[lane] = data;
  }
  here(key: SectionKey): BodyRecordJSON[] { return (this.laneStore<StationBodiesJSON>(STATION_BODIES_LANE, key))?.here ?? []; }
}

class SilentAudio implements ChipperAudioLike { start() {} feed() {} grind() {} stop() {} frame() {} silence() {} }

const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

/** Game's install order: the train runtime + ride + player, the REAL physics (stepped after the lane hooks, as Game.update), corpses, chipper. */
function rig(first: StationLayout, key: SectionKey = KA) {
  const s = stationHost(first, {build: false});
  live.push(s.rt);
  const h = s.h as unknown as typeof s.h & Record<string, unknown> & {run: FakeRun; zombies: EnemyActor[]; layout: StationLayout};
  const enemyIndex = new Map<EnemyActor, number>();
  const ph = new PhysicsSystem(null);
  const falls: number[] = [];
  ph.audio = {bodyFall: (_x: number, _y: number, _z: number, k: number) => { falls.push(k); }} as never;
  Object.assign(h, {
    run: new FakeRun(key), seed: 4242, sectionLayoutHooks: [], sectionModelKeys: [], runParticipants: [], aimOffset: {pitch: 0}, physics: ph,
    damage: {releaseZombie: () => true},
    buildEnemyActor: (sp: ZombieSpawn, _i: number, _seed: number, rand: () => number) => createEnemyActor(sp, lazy, rand, () => new ZombieActor(zombieGltf, sp, rand)),
  });
  const sys = new CorpseSystem(h as never, {enemyIndex: z => enemyIndex.get(z), forgetEnemy: z => { enemyIndex.delete(z); }}).install();
  (h as Record<string, unknown>).corpses = sys;
  const ch = new ChipperSystem(h as unknown as ChipperHost, {audio: new SilentAudio(), model: () => null}).install();
  h.frameHooks.push(dt => ph.update(dt)); // (Game.update: the lane frame hooks, then this.physics.update)
  return {...s, h, sys, ch, ph, enemyIndex, falls};
}
type Rig = ReturnType<typeof rig>;

/** Game.prepareSection + buildSection: the layout hooks, the physics world over the layout, the section hooks; the player in the car. */
function enter(c: Rig, L: StationLayout, key: SectionKey, extra: PropPlacement[] = []): void {
  c.h.run.current = key;
  L.props.push(...extra);
  for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L, key, c.h.run, 'prepare');
  for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L, key, c.h.run, 'build');
  c.ph.build(L); // (Game.buildSection: before the section hooks — the train adds its shell boxes and refreshes the chunks under it)
  build(c.h, L, !c.ride.riding);
}

function leave(c: Rig): void {
  for (const s of c.h.sectionHooks) s.teardown?.();
  for (const z of c.h.zombies.splice(0)) z.root.removeFromParent();
  c.enemyIndex.clear();
}

function deadEnemy(c: Rig, index: number, lx: number, lz: number, spawn: Partial<ZombieSpawn> = {}): EnemyActor {
  const p = c.h.trainPlacement!, w = trainToWorld(p, lx, SPEC.floorY, lz);
  Object.assign(c.h.layout.zombies[index], spawn);
  const sp: ZombieSpawn = {...c.h.layout.zombies[index], x: w.x, z: w.z, yaw: 0};
  const {actor: z} = createEnemyActor(sp, lazy, rng(index + 3), () => new ZombieActor(zombieGltf, sp, rng(index + 3)));
  z.brain.damage(999, w.x, w.z);
  for (let i = 0; i < 150; i++) { z.animate(1 / 60, 'Death', 0); z.syncTransform(); z.root.position.y = w.y; }
  z.brain.y = w.y;
  z.root.updateMatrixWorld(true);
  c.h.zombies.push(z);
  c.enemyIndex.set(z, index);
  c.h.scene.add(z.root);
  return z;
}

const hipsOf = (o: THREE.Object3D) => o.getObjectByName('Hips')!.getWorldPosition(new THREE.Vector3());

/** A world point at train-local x / z: in the car `up` m above its floor, else (`car` false) `up` m above the platform floor (world y 0). */
function at(c: Rig, lx: number, lz: number, up: number, car = true): THREE.Vector3 {
  const w = trainToWorld(c.h.trainPlacement!, lx, SPEC.floorY + up, lz);
  return new THREE.Vector3(w.x, car ? w.y : up, w.z);
}

/** Stand at a train-local x / z (in the car or on the platform) and look at a world point. */
function standAt(c: Rig, lx: number, lz: number, car: boolean, look: THREE.Vector3): void {
  const w = at(c, lx, lz, 0, car);
  c.h.player.spawn(w.x, w.z, 0, w.y);
  lookAt(c.h, look.x, look.y, look.z);
}

/** Pick up the dead enemy (looking at it from 1 m along the aisle). */
function pickUp(c: Rig, z: EnemyActor): string {
  const hp = hipsOf(z.root), l = worldToTrain(c.h.trainPlacement!, hp.x, hp.y, hp.z);
  standAt(c, l.x - 1.0, l.z, true, hp);
  press(c.h, 'KeyE');
  const held = c.sys.held();
  expect(held, 'picked up').not.toBeNull();
  return held!.record.id;
}

/**
 * Pick a lying body up again: stand round it (1-1.4 m, 8 headings; on the platform or in the car) until a bone of it is under the
 * crosshair with nothing in the way (CorpseSystem.aimed: a crate it fell against may hide its pelvis from one side), then E.
 */
function pickUpLying(c: Rig, root: THREE.Object3D, car: boolean): void {
  const p = c.h.trainPlacement!;
  for (const name of ['Hips', 'Chest', 'Spine', 'Head']) {
    const t = root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()), l = worldToTrain(p, t.x, t.y, t.z);
    for (const r of [1.0, 1.4]) for (let k = 0; k < 8; k++) {
      const w = at(c, l.x + Math.cos(k * Math.PI / 4) * r, l.z + Math.sin(k * Math.PI / 4) * r, 0, car);
      c.h.player.spawn(w.x, w.z, 0, w.y);
      lookAt(c.h, t.x, t.y, t.z);
      const a = c.sys.aimed();
      if (a?.kind === 'body' && (a as {b: {actor: EnemyActor}}).b.actor.root === root) { press(c.h, 'KeyE'); return; }
    }
  }
  throw new Error('no clear aim at the lying body');
}

type LyingBody = {rec: BodyRecordJSON; actor: EnemyActor; falling?: boolean; centre: THREE.Vector3; vel?: THREE.Vector3};
const lyingOf = (c: Rig, id: string) => c.sys.lying.find(b => b.rec.id === id) as unknown as LyingBody | undefined;

/** E (the drop), then the frames until the body has come to rest (bounded). */
function dropAndSettle(c: Rig, id: string): LyingBody {
  press(c.h, 'KeyE');
  expect(c.sys.held(), 'the drop let it go').toBeNull();
  const b = lyingOf(c, id)!;
  expect(b).toBeTruthy();
  run(c.h, 12, () => !b.falling);
  expect(b.falling, 'came to rest').toBe(false);
  expect(b.rec.pose).toBe('fallen');
  expect(b.rec.falling).toBeUndefined();
  return b;
}

/** CPU-skinned world vertices of the visible skinned meshes under `root`. */
function skinned(root: THREE.Object3D, step = 3): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  root.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += step) { const v = new THREE.Vector3().fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); out.push(v.applyMatrix4(m.matrixWorld)); }
  });
  return out;
}

/** Every bone's world position by name. */
function boneWorld(root: THREE.Object3D): Map<string, THREE.Vector3> {
  root.updateMatrixWorld(true);
  const out = new Map<string, THREE.Vector3>();
  root.traverse(o => { if ((o as THREE.Bone).isBone) out.set(o.name, o.getWorldPosition(new THREE.Vector3())); });
  return out;
}
const maxBoneGap = (a: Map<string, THREE.Vector3>, b: Map<string, THREE.Vector3>) => Math.max(...[...a].map(([n, v]) => v.distanceTo(b.get(n)!)));

/** Every body identity exactly once: the hands, the train's records, every station's lane, the chipper's job. */
function census(c: Rig): string[] {
  const ids: string[] = [];
  const held = c.sys.held();
  if (held) ids.push(held.record.id);
  ids.push(...c.sys.trainBodies().map(r => r.id));
  for (const m of c.h.run.mems.values()) ids.push(...((m.lanes[STATION_BODIES_LANE] as StationBodiesJSON | undefined)?.here ?? []).map(r => r.id));
  const job = c.h.playerTrain.chipper.state.job;
  if (job) ids.push(job.body.id);
  ids.sort();
  expect(new Set(ids).size, `a body in two places: ${ids}`).toBe(ids.length);
  return ids;
}

/**
 * At rest on whatever is under it (the station statics: floors, the car floor's volume, crates): its lowest skinned point on the surface
 * under it (never floating), no point sunk in a floor (the landing's lift), the pelvis supported (not balanced folded on head and feet),
 * no bone inside a solid.
 */
function expectResting(c: Rig, root: THREE.Object3D, what: string): void {
  const q = c.ph.statics!;
  let low = Infinity, sunk = 0;
  for (const v of skinned(root, 2)) {
    low = Math.min(low, v.y - q.surfaceBelow(v.x, v.z, v.y + 0.15));
    const f = q.cellGround(v.x, v.z, v.y + 0.15); // (the band above it: the car's thin floor slab over the trench)
    if (f - v.y <= 0.15) sunk = Math.max(sunk, f - v.y); // (in the floor: the station's / the car's; a crate's side is no floor)
  }
  expect(low, `${what}: lowest point on what is under it (not floating)`).toBeLessThan(0.03);
  expect(sunk, `${what}: no point sunk in the floor (lifted out by its deepest; this samples vertices the lift skipped)`).toBeLessThan(0.03);
  const hp = hipsOf(root);
  expect(hp.y - q.surfaceBelow(hp.x, hp.z, hp.y), `${what}: pelvis supported`).toBeLessThan(0.4);
  for (const [n, v] of boneWorld(root)) if (n !== 'Root') expect(q.insideSolid(v.x, v.y, v.z), `${what}: ${n} inside a solid`).toBe(false);
}

/** A 'crate' prop standing at a world point (Game's clutter: a ragdoll static box, a collider, a hitscan box). */
function crate(x: number, z: number, floor: number, h = 0.432): PropPlacement {
  return {kind: 'crate', x, z, y: floor, rot: 0, area: 0, hx: 0.31, hz: 0.22, h, blocksSight: false, variant: 0, level: 0} as PropPlacement;
}

// ---------------------------------------------------------------------------------------------------------------------------

describe('corpse ragdoll drop: records', () => {
  const f = corpseFeedable;
  const bones = {Hips: [0, 0, 0, 1], Spine: [0.1, 0, 0, 0.99499]} as Record<string, [number, number, number, number]>;
  const rec = (extra: Partial<BodyRecordJSON> = {}): BodyRecordJSON => ({id: 'st-01:main#3', arch: 'zombie', seed: 4242, type: 'shambler', pose: 'lying', x: 2, y: 0, z: 1, q: [0, 0, 0, 1], level: 0, ...extra});

  it('a fallen pose carries its bones and pelvis (bounded, unit quaternions); a lying one has none; the hands never keep a pose', () => {
    expect(bodyProblem(rec(), {world: true, feedable: f})).toBeNull(); // (an old record loads unchanged)
    expect(bodyProblem(rec({pose: 'fallen', bones, hips: [0, 0.2, 0]}), {world: true, feedable: f})).toBeNull();
    expect(bodyProblem(rec({pose: 'fallen', bones, hips: [0, 0.2, 0], falling: [0.4, -1.2, 0]}), {world: true, feedable: f})).toBeNull();
    expect(bodyProblem(rec({pose: 'fallen'}), {world: true, feedable: f})).toMatch(/bones/);
    expect(bodyProblem(rec({pose: 'fallen', bones}), {world: true, feedable: f})).toMatch(/pelvis/);
    expect(bodyProblem(rec({pose: 'fallen', bones, hips: [0, BODIES.hipsLim + 1, 0]}), {world: true, feedable: f})).toMatch(/pelvis/);
    expect(bodyProblem(rec({pose: 'fallen', bones: {Hips: [0, 0, 0, 2]}, hips: [0, 0, 0]}), {world: true, feedable: f})).toMatch(/unit quaternion/);
    expect(bodyProblem(rec({pose: 'fallen', bones: {'no such': [0, 0, 0, 1]}, hips: [0, 0, 0]}), {world: true, feedable: f})).toMatch(/bone name/);
    expect(bodyProblem(rec({pose: 'fallen', bones: Object.fromEntries(Array.from({length: BODIES.bonesMax + 1}, (_, i) => [`B${i}`, [0, 0, 0, 1]])), hips: [0, 0, 0]}), {world: true, feedable: f})).toMatch(/bones/);
    expect(bodyProblem(rec({pose: 'fallen', bones, hips: [0, 0, 0], falling: true as never}), {world: true, feedable: f})).toMatch(/falling/);
    expect(bodyProblem(rec({pose: 'fallen', bones, hips: [0, 0, 0], falling: [0, -(BODIES.fallV + 1), 0]}), {world: true, feedable: f})).toMatch(/falling/);
    expect(bodyProblem(rec({pose: 'fallen', bones, hips: [0, 0, 0], falling: [0, 0] as never}), {world: true, feedable: f})).toMatch(/falling/);
    expect(bodyProblem(rec({bones}), {world: true, feedable: f})).toMatch(/no bones/);
    expect(bodyProblem(rec({pose: 'standing' as never}), {world: true, feedable: f})).toMatch(/known pose/);
    const held = heldRecord(rec({pose: 'fallen', bones, hips: [0, 0.2, 0], falling: [0.4, -1.2, 0]}));
    expect(held).toEqual({id: 'st-01:main#3', arch: 'zombie', seed: 4242, type: 'shambler', pose: 'lying', x: 0, y: 0, z: 0, q: [0, 0, 0, 1]});
    expect(carryProblem({v: 1, held}, f)).toBeNull();
    expect(stationBodiesProblem({v: 1, here: [rec({pose: 'fallen', bones, hips: [0, 0.2, 0]})]}, f)).toBeNull();
    const aboard = rec({pose: 'fallen', bones, hips: [0, 0.2, 0], falling: [0.4, -1.2, 0]});
    delete aboard.level;
    expect(cargoProblem({v: 3, items: [], props: [], bodies: [aboard]})).toBeNull();
  });

  it('strict save validation takes fallen bodies in a station and aboard (one body, one place still)', () => {
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    hs.run.current = KA;
    hs.run.memory().visits = 1;
    const aboard = rec({id: 'st-01:main#4', pose: 'fallen', bones, hips: [0, 0.18, 0.02], x: -2, y: SPEC.floorY, z: 0.1, falling: [0.3, -0.8, -0.1]});
    delete aboard.level;
    hs.train.cargo.setBodies([aboard]);
    hs.run.setLaneStore(STATION_BODIES_LANE, {v: 1, here: [rec({id: 'st-01:main#5', pose: 'fallen', bones, hips: [0, 0.2, 0], x: 30, z: 8})]}, KA);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
    const base = hs.file('arrival', 1) as any;
    const good = validateSaveFile(structuredClone(base));
    expect(good.ok, good.ok ? '' : (good as {error: string}).error).toBe(true);
    const bad = structuredClone(base);
    bad.run.participants['player-train'].cargo.bodies[0].id = 'st-01:main#5';
    bad.checksum = checksumOf(bad.run);
    expect(validateSaveFile(bad).ok).toBe(false);
    const bad2 = structuredClone(base);
    bad2.run.memories['st-01:main'].lanes[STATION_BODIES_LANE].here[0].bones.Hips = [0, 0, 0, 3];
    bad2.checksum = checksumOf(bad2.run);
    expect(validateSaveFile(bad2).ok).toBe(false);
  });
});

describe('corpse ragdoll drop: amid clutter, at walls, ownership', () => {
  it('amid crates on the platform (where the posed drop refuses) it falls and rests supported, grounded, in no crate — the station\'s', () => {
    const L = SUB(), c = rig(L);
    const p0 = playerTrainPlacement(L)!;
    // the player on the platform facing away from the car; crates in front, left and right (one stacked on the front one), one beyond
    const pl = -(SPEC.width / 2 + 1.6), dir = Math.sign(pl), atL = (lx: number, lz: number) => trainToWorld(p0, lx, 0, lz);
    const floor = 0;
    const box = [[MID, pl + dir * 0.75], [MID - 0.75, pl + dir * 0.35], [MID + 0.75, pl + dir * 0.35], [MID + 0.05, pl + dir * 1.3]].map(([lx, lz]) => { const w = atL(lx, lz); return crate(w.x, w.z, floor); });
    const top = atL(MID, pl + dir * 0.75);
    box.push(crate(top.x, top.z, floor + 0.432)); // (stacked on the front crate)
    enter(c, L, KA, box);
    const z = deadEnemy(c, 2, MID + 0.6, 0.2);
    const id = pickUp(c, z);
    standAt(c, MID, pl, false, at(c, MID, pl + dir * 3, 1.0, false));
    c.h.player.pitch = 0;
    syncCamera(c.h);
    // the posed drop needs open, level floor: refused here
    expect((c.sys as unknown as {dropSpot(b: unknown): unknown}).dropSpot((c.sys as unknown as {hand: unknown}).hand)).toBe(CORPSE_TEXT.noRoom);
    const toasts = c.h.toasts.length;
    const b = dropAndSettle(c, id);
    expect(c.h.toasts.slice(toasts)).toEqual([]); // (no refusal)
    expect(c.sys.counts.ragdolls).toBe(1);
    expect(c.falls.length).toBeGreaterThan(0); // (the ragdoll's landing cue)
    expectResting(c, z.root, 'amid clutter');
    // it fell amid the clutter: some of it on / against a crate, and within reach of where it was let go
    const hp = hipsOf(z.root);
    expect(Math.hypot(hp.x - c.h.player.x, hp.z - c.h.player.z)).toBeLessThan(2.2);
    const toBox = (v: THREE.Vector3, q: PropPlacement) => Math.hypot(Math.max(0, Math.abs(v.x - q.x) - q.hx), Math.max(0, v.y - (q.y! + q.h), q.y! - v.y), Math.max(0, Math.abs(v.z - q.z) - q.hz));
    expect(Math.min(...skinned(z.root, 4).map(v => Math.min(...box.map(q => toBox(v, q))))), 'touching a crate').toBeLessThan(0.05);
    // the station's: its lane holds the fallen pose (world + storey), strictly shaped; nothing aboard
    expect(c.sys.trainBodies()).toEqual([]);
    const lane = c.h.run.here(KA);
    expect(lane.map(r => r.id)).toEqual([id]);
    expect(lane[0]).toMatchObject({pose: 'fallen', level: 0});
    expect(lane[0].falling).toBeUndefined();
    expect(Object.keys(lane[0].bones!).length).toBe(17);
    expect(stationBodiesProblem(c.h.run.laneStore(STATION_BODIES_LANE, KA), corpseFeedable)).toBeNull();
    expect(Math.hypot(lane[0].x - hp.x, lane[0].z - hp.z)).toBeLessThan(1e-3); // (its root under the pelvis)
    expect(b.centre.distanceTo(hp)).toBeLessThan(1e-6);
    expect(census(c)).toEqual([id]);
    // revisit: the same body, lying exactly as it fell, once
    const before = boneWorld(z.root);
    leave(c);
    expect(c.h.run.here(KA).map(r => r.id)).toEqual([id]);
    const L2 = SUB();
    enter(c, L2, KA, box.map(q => ({...q})));
    expect(c.sys.lying.length).toBe(1);
    const back = c.sys.lying[0] as unknown as LyingBody;
    expect(back.rec.id).toBe(id);
    expect(back.actor).not.toBe(z); // (rebuilt from its record)
    expect(back.actor.scale).toBeCloseTo(z.scale, 5);
    expect(maxBoneGap(before, boneWorld(back.actor.root))).toBeLessThan(2e-3);
    expect(back.falling).toBeFalsy();
    expect(census(c)).toEqual([id]);
    // picked up again: it carries as before (the hands' record has no pose)
    pickUpLying(c, back.actor.root, false);
    const held = c.sys.held();
    expect(held?.record).toEqual(heldRecord(lane[0]));
    expect(held?.record.pose).toBe('lying');
    expect(held?.object.parent).toBe(c.sys.carry);
    expect(c.sys.lying).toEqual([]);
    expect(c.h.run.here(KA)).toEqual([]);
    expect(census(c)).toEqual([id]);
  }, 180000);

  it('in the parked car facing its side wall: pulled back, it rests inside the car — the train\'s; from the platform facing the shell: outside', () => {
    const L = SUB(), c = rig(L);
    enter(c, L, KA);
    const p = c.h.trainPlacement!;
    const z = deadEnemy(c, 0, MID + 0.6, 0.2);
    const id = pickUp(c, z);
    // 0.45 m from the -Z side wall, looking straight at it (chest height)
    const lz = -(I.halfWidth - 0.45);
    standAt(c, MID - 1.5, lz, true, at(c, MID - 1.5, -(I.halfWidth + 0.3), 1.2));
    const b = dropAndSettle(c, id);
    // never through the wall: every skinned point inside the car's shell (soft skin may touch a few cm into the lining: the ragdoll's
    // spheres are slimmer than the skin; the shell's outer face is ~0.19 m past the lining), none under its floor
    for (const v of skinned(z.root, 2)) {
      const l = worldToTrain(p, v.x, v.y, v.z);
      expect(Math.abs(l.z)).toBeLessThan(I.halfWidth + 0.08);
      expect(l.y).toBeGreaterThan(SPEC.floorY - 0.03);
    }
    expectResting(c, z.root, 'at the car wall');
    expect(c.sys.ownsBody(b as never)).toBe(true);
    const recs = c.sys.trainBodies();
    expect(recs.map(r => r.id)).toEqual([id]);
    expect(recs[0]).toMatchObject({pose: 'fallen'});
    expect(recs[0].level).toBeUndefined();
    expect(c.h.run.here(KA)).toEqual([]);
    expect(c.sys.departBlock()).toBeNull();
    expect(census(c)).toEqual([id]);
    // up again and out on the platform, 0.5 m from the car's outer shell, facing it: it stays on the platform side
    pickUpLying(c, z.root, true);
    expect(c.sys.held()?.record.id).toBe(id);
    const outZ = -(SPEC.width / 2 + 0.5);
    standAt(c, MID - 1.5, outZ, false, at(c, MID - 1.5, 0, 1.2, false));
    dropAndSettle(c, id);
    for (const v of skinned(z.root, 2)) expect(worldToTrain(p, v.x, v.y, v.z).z).toBeLessThan(-(I.halfWidth + 0.02));
    expect(c.sys.trainBodies()).toEqual([]);
    expect(c.h.run.here(KA).map(r => r.id)).toEqual([id]);
    expect(census(c)).toEqual([id]);
  }, 180000);
});

describe('corpse ragdoll drop: saves, travel, mid-fall', () => {
  it('Continue: a fallen body aboard saves into cargo v3 and rebuilds in the next game\'s car exactly as it fell, once', () => {
    const L = SUB(), c = rig(L);
    enter(c, L, KA);
    const z = deadEnemy(c, 0, MID + 0.6, 0.2);
    const id = pickUp(c, z);
    standAt(c, MID - 1.0, 0.1, true, at(c, MID + 2, 0.1, 0.4));
    dropAndSettle(c, id);
    const local = (root: THREE.Object3D) => new Map([...boneWorld(root)].map(([n, v]) => { const l = worldToTrain(c.h.trainPlacement!, v.x, v.y, v.z); return [n, new THREE.Vector3(l.x, l.y, l.z)]; }));
    const before = local(z.root);
    const saved = structuredClone(c.h.playerTrain.participant().save()) as {cargo: TrainCargoJSON};
    expect(cargoProblem(saved.cargo)).toBeNull();
    expect(saved.cargo.bodies!.map(r => [r.id, r.pose])).toEqual([[id, 'fallen']]);
    leave(c);
    expect(c.sys.pending.map(r => r.id)).toEqual([id]);
    const d = rig(SUB());
    d.h.playerTrain.participant().load(structuredClone(saved));
    enter(d, SUB(), KA);
    expect(d.sys.lying.length).toBe(1);
    const back = d.sys.lying[0] as unknown as LyingBody;
    const after = new Map([...boneWorld(back.actor.root)].map(([n, v]) => { const l = worldToTrain(d.h.trainPlacement!, v.x, v.y, v.z); return [n, new THREE.Vector3(l.x, l.y, l.z)]; }));
    expect(maxBoneGap(before, after)).toBeLessThan(2e-3);
    expect(back.falling).toBeFalsy();
    expect(d.sys.counts.resumed).toBe(0);
    expect(census(d)).toEqual([id]);
  }, 180000);

  it('a journey: a fallen body in the car rides its view root and lies in the next station\'s car in the same pose; one body', async () => {
    const L = SUB(), c = rig(L), {h, ride, rt} = c;
    enter(c, L, KA);
    const z = deadEnemy(c, 0, MID + 0.6, 0.2);
    const id = pickUp(c, z);
    standAt(c, MID - 1.0, 0.1, true, at(c, MID + 2, 0.1, 0.4));
    dropAndSettle(c, id);
    const rec0 = c.sys.trainBodies()[0];
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    expect(c.sys.riding.map(x => x.rec.id)).toEqual([id]);
    expect(c.sys.riding[0].actor.root.parent).toBe(rt.view!.root);
    leave(c);
    run(h, 1);
    enter(c, OFF(), KB);
    let arr: {status: string} | null = null;
    void ride.arrive().then(r => { arr = r; });
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    expect(arr).toMatchObject({status: 'stopped'});
    run(h, 0.1);
    expect(c.sys.riding).toEqual([]);
    expect(c.sys.lying.length).toBe(1);
    const now = c.sys.trainBodies()[0];
    expect(now.id).toBe(id);
    expect(Math.hypot(now.x - rec0.x, now.y - rec0.y, now.z - rec0.z)).toBeLessThan(1e-3);
    expect(new THREE.Quaternion(...now.q).angleTo(new THREE.Quaternion(...rec0.q))).toBeLessThan(1e-3);
    expect(now.bones).toEqual(rec0.bones);
    expect(now.hips).toEqual(rec0.hips);
    expect(census(c)).toEqual([id]);
  }, 240000);

  it('mid-fall: a save records it falling, the departure waits, a teardown stops it there; rebuilt it falls on and rests — once', () => {
    const L = SUB(), c = rig(L);
    enter(c, L, KA);
    const z = deadEnemy(c, 0, MID + 0.6, 0.2);
    const id = pickUp(c, z);
    const p = c.h.trainPlacement!;
    standAt(c, MID - 1.0, 0.1, true, at(c, MID + 2, 0.1, 0.4));
    press(c.h, 'KeyE');
    run(c.h, 0.1);
    const b = lyingOf(c, id)!;
    expect(b.falling).toBe(true);
    // a save now: its pose this instant, marked falling with its pelvis velocity (the car's frame), strictly valid; the departure waits
    const mid = c.sys.trainBodies();
    expect(mid.map(r => [r.id, r.pose])).toEqual([[id, 'fallen']]);
    const carV = (q: TrainPlacement, at0: THREE.Vector3, v: THREE.Vector3) => {
      const a = worldToTrain(q, at0.x, at0.y, at0.z), e = worldToTrain(q, at0.x + v.x, at0.y + v.y, at0.z + v.z);
      return [e.x - a.x, e.y - a.y, e.z - a.z];
    };
    const v0 = carV(p, b.centre, b.vel!);
    expect(Math.hypot(...v0)).toBeGreaterThan(0.3); // (still on its way down)
    mid[0].falling!.forEach((x, k) => expect(x).toBeCloseTo(v0[k], 3));
    expect(cargoProblem({v: 3, items: [], props: [], bodies: mid})).toBeNull();
    expect(c.sys.departBlock()).toBe(CORPSE_TEXT.settling);
    expect(census(c)).toEqual([id]);
    // the world goes while it falls (Retry / Load / leaving): stopped where it is, a pending train record, falling as fast
    leave(c);
    expect(c.sys.lying).toEqual([]);
    expect(c.sys.pending.map(r => r.id)).toEqual([id]);
    const pend = c.sys.pending[0];
    pend.falling!.forEach((x, k) => expect(x).toBeCloseTo(v0[k], 3));
    // (the save held the pose on screen, the physics' interpolated one; the stop freezes it at its latest step: within one step's fall)
    expect(Math.hypot(pend.x - mid[0].x, pend.y - mid[0].y, pend.z - mid[0].z)).toBeLessThan(0.05);
    expect(c.sys.counts.stopped).toBe(1);
    expect(c.ph.stats().ragdollsActive).toBe(0); // (its ragdoll left the physics)
    // rebuilt (the next build of a world with the car): it falls on from that pose at that velocity and comes to rest in the car
    enter(c, SUB(), KA);
    const r = c.sys.lying[0] as unknown as LyingBody;
    expect(r.rec.id).toBe(id);
    expect(r.falling).toBe(true);
    expect(c.sys.counts.resumed).toBe(1);
    carV(c.h.trainPlacement!, r.centre, r.vel!).forEach((x, k) => expect(x).toBeCloseTo(v0[k], 3));
    run(c.h, 12, () => !r.falling);
    expect(r.falling).toBe(false);
    expect(r.rec.falling).toBeUndefined();
    expectResting(c, r.actor.root, 'resumed');
    expect(c.sys.trainBodies().map(x => [x.id, x.falling])).toEqual([[id, undefined]]);
    expect(c.sys.departBlock()).toBeNull();
    expect(census(c)).toEqual([id]);
  }, 180000);

  it('the hands, the platform and Retry with ragdoll drops: the Blightbelly falls and rests too; Retry restores the entry, nothing doubled', () => {
    const L = SUB(), c = rig(L);
    enter(c, L, KA);
    const entry = {lanes: Object.fromEntries((c.h.runParticipants as {id: string; save(): unknown}[]).concat([c.h.playerTrain.participant()]).map(p => [p.id, structuredClone(p.save())])),
      memories: Object.fromEntries([...c.h.run.mems].map(([k, m]) => [k, structuredClone(m)]))};
    const z = deadEnemy(c, 2, MID + 0.6, 0.2, {archetype: 'blightbelly'});
    expect(z.archetype).toBe('blightbelly');
    const id = pickUp(c, z);
    const pl = -(SPEC.width / 2 + 1.6);
    standAt(c, MID, pl, false, at(c, MID, pl * 2, 0.8, false));
    dropAndSettle(c, id);
    expectResting(c, z.root, 'blightbelly');
    expect(c.h.run.here(KA).map(r => [r.id, r.arch, r.pose])).toEqual([[id, 'blightbelly', 'fallen']]);
    expect(census(c)).toEqual([id]);
    // Retry: everything back to the level entry (no body anywhere, the enemy alive again)
    leave(c);
    c.h.run.mems.clear();
    for (const [k, m] of Object.entries(entry.memories)) c.h.run.mems.set(k, structuredClone(m));
    for (const q of [...(c.h.runParticipants as {id: string; load(d: unknown): void}[]), c.h.playerTrain.participant()]) q.load(structuredClone(entry.lanes[q.id]));
    enter(c, SUB(), KA);
    expect(c.sys.lying).toEqual([]);
    expect(c.sys.held()).toBeNull();
    expect(census(c)).toEqual([]);
    expect((c.sys.participant().save() as {held: unknown}).held).toBeNull();
    expect((c.h.runParticipants as {id: string}[]).some(q => q.id === CORPSE_CARRY_PARTICIPANT)).toBe(true);
  }, 180000);
});
