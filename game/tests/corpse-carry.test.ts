// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CORPSE): the corpse system (world/corpses.ts) on a generated Subway station with
// the REAL parked train runtime + ride + Player (helpers/fuelCartsHost.ts stationHost), the REAL train chipper (world/chipper.ts) as the
// sink, real enemy actors from the cooked GLBs (zombie-rigged / Blightbelly / Strainer / Siren, textures stripped) and Game.buildEnemyActor's
// contract (createEnemyActor) as the rebuild:
//  - eligibility (dead + layout identity + feedable trait: the rat-dog, a QA spawn, the living refused);
//  - pickup -> carry -> drop -> re-pickup with one body in one place through every move (hands / station lane / train cargo / chipper job);
//  - carrying: the input owner, item use refused / an item in use cancelled, the pour refused, the slow-down, the Slugger windup cancelled
//    by the lane-ownership path, the hands free again in the same call (no fire leak: Game's laneOwnedLast latch, pinned);
//  - first person: the carried body's skinned vertices in the lower-right of the view, none on the crosshair; the lying pose grounded for
//    every humanoid family (CPU skinning);
//  - the station lane round trip (rebuilt at its pose, its enemy never respawned); cargo v3 (save / load / v2), maxAboard and doorway
//    refusals; a journey (captured onto the car, released in the next station's car); the hands across save / load and Retry; strict save
//    validation (one body, one place; old saves load with no bodies); the real chipper's take (gone from here in the same call, saved once).
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';
import {trainToWorld} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {sectionId, type SectionKey} from '../src/levels/types';
import {ZombieActor} from '../src/ai/zombieActor';
import {createEnemyActor, type EnemyActor} from '../src/ai/creatureArchetypes';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {corpseFeedable} from '../src/ai/corpseTrait';
import {BODIES, bodyProblem, type BodyRecordJSON} from '../src/corpse/bodyRecord';
import {CORPSE_CARRY_PARTICIPANT, STATION_BODIES_LANE, carryProblem, stationBodiesProblem, type StationBodiesJSON} from '../src/corpse/bodyLanes';
import {poseLying, restingLift} from '../src/corpse/bodyPose';
import {DamageSystem, corpseVolumes} from '../src/damage/system';
import {woundsOf} from '../src/damage/wounds';
import {CORPSE, CORPSE_TEXT, CorpseSystem} from '../src/world/corpses';
import {CHIPPER_TEXT, ChipperSystem, type ChipperAudioLike, type ChipperHost} from '../src/world/chipper';
import {CHIPPER_ANCHORS} from '../src/world/chipperSpec';
import {chipperDirToLocal, chipperPlacement, chipperToLocal} from '../src/world/chipperPlace';
import {FuelPortSystem} from '../src/world/fuelPort';
import {cargoProblem, type TrainCargoJSON} from '../src/run/trainCargo';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {enemiesToSpawn, type SectionMemory} from '../src/run/memory';
import {WeaponController, WEAPONS} from '../src/weapons/weapons';
import {Inventory, type ItemStack} from '../src/items/inventory';
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
  for (const k of ['enemy_blightbelly', 'enemy_strainer', 'enemy_siren', 'enemy_screacher_sc01', 'enemy_screacher_sc03']) lazy[k] = await loadStripped(ENEMY_MODEL_FILES[k].url);
}, 120000);

const SUB = (): StationLayout => LEVELS.subway.generate('main', {levelSeed: 4242});
const OFF = (): StationLayout => LEVELS.office.generate('main', {levelSeed: 4242});
const KA: SectionKey = {level: 'subway', section: 'main', station: sid(1)};
const KB: SectionKey = {level: 'office', section: 'main', station: sid(2)};
const I = SPEC.interior;
const rng = (seed = 1) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

/** The run: section memories (killed + lanes) by section id, the section being played, an optional Retry snapshot. */
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

/** The real train runtime + ride + player, the corpse system, the real chipper (Game's install order), no world yet. */
function rig(first: StationLayout, key: SectionKey = KA) {
  const s = stationHost(first, {build: false});
  live.push(s.rt);
  const h = s.h as unknown as typeof s.h & Record<string, unknown> & {run: FakeRun; zombies: EnemyActor[]; layout: StationLayout};
  const enemyIndex = new Map<EnemyActor, number>(), forgot: object[] = [], released: object[] = [], cancels: string[] = [];
  const builds: {i: number; seed: number; rand: () => number; s: ZombieSpawn}[] = [];
  const gameRand = rng(99);
  Object.assign(h, {
    run: new FakeRun(key), seed: 4242, rand: gameRand, sectionLayoutHooks: [], sectionModelKeys: [], runParticipants: [], aimOffset: {pitch: 0},
    physics: {propsChanged: () => {}, forgetRagdoll: (t: object) => { forgot.push(t); return true; }}, damage: {releaseZombie: (z: object) => { released.push(z); return true; }},
    // Game.buildEnemyActor's contract: createEnemyActor over the loaded lazy models, the zombie look from the template
    buildEnemyActor: (sp: ZombieSpawn, i: number, seed: number, rand: () => number) => {
      builds.push({i, seed, rand, s: sp});
      return createEnemyActor(sp, lazy, rand, () => new ZombieActor(zombieGltf, sp, rand));
    },
  });
  const sys = new CorpseSystem(h as never, {enemyIndex: z => enemyIndex.get(z), forgetEnemy: z => { enemyIndex.delete(z); }, cancelUse: r => { cancels.push(r); }}).install();
  (h as Record<string, unknown>).corpses = sys;
  const ch = new ChipperSystem(h as unknown as ChipperHost, {audio: new SilentAudio(), model: () => null}).install();
  return {...s, h, sys, ch, enemyIndex, forgot, released, cancels, builds, gameRand};
}
type Rig = ReturnType<typeof rig>;

/** Game.prepareSection + buildSection: the layout hooks (prepare, build), the level fields, every section hook; the player in the car. */
function enter(c: Rig, L: StationLayout, key: SectionKey): void {
  c.h.run.current = key;
  for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L, key, c.h.run, 'prepare');
  for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L, key, c.h.run, 'build');
  build(c.h, L, !c.ride.riding);
}

/** Game.leaveSection: the section hooks' teardowns; the world's enemies go. */
function leave(c: Rig): void {
  for (const s of c.h.sectionHooks) s.teardown?.();
  for (const z of c.h.zombies.splice(0)) z.root.removeFromParent();
  c.enemyIndex.clear();
}

/** A dead layout enemy `index` lying (its Death clip played out) with its root at a train-local floor point. */
function deadEnemy(c: Rig, index: number, lx: number, lz: number, yaw = 0, o: {qa?: boolean; spawn?: Partial<ZombieSpawn>} = {}): EnemyActor {
  const p = c.h.trainPlacement!, w = trainToWorld(p, lx, SPEC.floorY, lz);
  if (o.spawn) Object.assign(c.h.layout.zombies[index], o.spawn); // (the layout's own spawn: the record reads its type / look / variant)
  const sp: ZombieSpawn = {...c.h.layout.zombies[index], x: w.x, z: w.z, yaw};
  const {actor: z} = createEnemyActor(sp, lazy, rng(index + 3), () => new ZombieActor(zombieGltf, sp, rng(index + 3)));
  z.brain.damage(999, w.x, w.z);
  for (let i = 0; i < 150; i++) { z.animate(1 / 60, 'Death', 0); z.syncTransform(); z.root.position.y = w.y; }
  z.brain.y = w.y;
  z.root.updateMatrixWorld(true);
  c.h.zombies.push(z);
  if (!o.qa) c.enemyIndex.set(z, index);
  c.h.scene.add(z.root);
  return z;
}

/** The player standing at a train-local floor point looking along world (dx, dz) (or at a point). */
function standIn(c: Rig, lx: number, lz: number, at?: THREE.Vector3): void {
  const p = c.h.trainPlacement!, w = trainToWorld(p, lx, SPEC.floorY, lz);
  c.h.player.spawn(w.x, w.z, 0, w.y);
  if (at) lookAt(c.h, at.x, at.y, at.z); else syncCamera(c.h);
}

/** Face along the car (local +X: open floor ahead in the aisle). */
function faceAlong(c: Rig): void {
  c.h.player.yaw = Math.atan2(-c.h.trainPlacement!.front, 0);
  c.h.player.pitch = 0;
  syncCamera(c.h);
}

const hipsOf = (z: {root: THREE.Object3D}) => z.root.getObjectByName('Hips')!.getWorldPosition(new THREE.Vector3());
/** The first lane prompt (Game.updateHud). */
const prompt = (c: Rig) => { for (const f of c.h.promptProviders) { const t = f(); if (t) return t; } return null; };

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

/** CPU-skinned world vertices of every visible skinned mesh under `root`. */
function skinned(root: THREE.Object3D, step = 3): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  root.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    const pos = m.geometry.attributes.position, n = pos.count;
    // (bind-space position, then the skin: SkinnedMesh.getVertexPosition would skin it already)
    for (let i = 0; i < n; i += step) { const v = new THREE.Vector3().fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); out.push(v.applyMatrix4(m.matrixWorld)); }
  });
  return out;
}

const rec = (id: string, extra: Partial<BodyRecordJSON> = {}): BodyRecordJSON => ({id, arch: 'zombie', seed: 4242, type: 'shambler', pose: 'lying', x: -2, y: SPEC.floorY, z: 0.1, q: [0, 0.38268, 0, 0.92388], scale: 1.01, ...extra});

// ---------------------------------------------------------------------------------------------------------------------------

describe('corpses: records and validation', () => {
  it('body / carry / station / cargo v3 records are strictly shaped; v1 / v2 cargo load with no bodies; a duplicate id is refused', () => {
    const f = corpseFeedable;
    expect(bodyProblem(rec('st-01:main#3'), {world: false, feedable: f})).toBeNull();
    expect(bodyProblem(rec('st-01:main#3', {scale: 3}), {world: false, feedable: f})).toMatch(/size/);
    expect(bodyProblem(rec('st-01:main#3', {arch: 'ratdog'}), {world: false, feedable: f})).toMatch(/not a carriable/);
    expect(carryProblem({v: 1, held: null}, f)).toBeNull();
    expect(carryProblem({v: 1, held: rec('st-01:main#3', {x: 0, y: 0, z: 0, q: [0, 0, 0, 1]})}, f)).toBeNull();
    expect(carryProblem({v: 2, held: null}, f)).toMatch(/version/);
    expect(stationBodiesProblem({v: 1, here: [rec('st-01:main#3', {x: 120, level: 0})]}, f)).toBeNull();
    expect(stationBodiesProblem({v: 1, here: [rec('st-01:main#3', {x: 120})]}, f)).toMatch(/storey/);
    expect(stationBodiesProblem({v: 1, here: [rec('st-01:main#3', {level: 0}), rec('st-01:main#3', {level: 0})]}, f)).toMatch(/twice/);
    expect(cargoProblem({v: 3, items: [], props: [], bodies: [rec('st-01:main#3')]})).toBeNull();
    expect(cargoProblem({v: 3, items: [], props: []})).toMatch(/bodies/);
    expect(cargoProblem({v: 2, items: [], props: [], bodies: []})).toMatch(/unexpected train cargo field 'bodies'/);
    expect(cargoProblem({v: 3, items: [], props: [], bodies: Array.from({length: BODIES.maxAboard + 1}, (_, i) => rec(`st-01:main#${i}`))})).toMatch(/at most 64 bodies/);
    const t = new PlayerTrainRecord();
    t.cargo.load({v: 2, items: [], props: []});
    expect(t.cargo.bodies()).toEqual([]);
    t.cargo.load({v: 3, items: [], props: [], bodies: [rec('st-01:main#3')]});
    expect(t.cargo.bodies().map(r => r.id)).toEqual(['st-01:main#3']);
    expect((t.cargo.toJSON() as TrainCargoJSON).v).toBe(3);
  });

  it('save validation: the hands, the train, the chipper and every station hold each body once; old saves load with no bodies', () => {
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    hs.run.current = KA;
    hs.run.memory().visits = 1;
    let held: BodyRecordJSON | null = rec('st-01:main#7', {x: 0, y: 0, z: 0, q: [0, 0, 0, 1]});
    hs.participants.push({id: CORPSE_CARRY_PARTICIPANT, save: () => ({v: 1, held}), load: () => {}, reset: () => {}});
    hs.train.cargo.setBodies([rec('st-01:main#4'), rec('st-00:main#2')]);
    hs.train.chipper.state = {v: 1, ticks: 0, seq: 2, done: 0, last: 0, job: {uid: 1, body: rec('st-00:main#9', {x: 2.2, z: 0.9, q: [0, 0, 0, 1]}), ms: 1200}};
    hs.run.setLaneStore(STATION_BODIES_LANE, {v: 1, here: [rec('st-01:main#5', {x: 30, z: 8, level: 0})]}, KA);
    hs.takeEntry(); // (the Retry snapshot repeats the identities: its own world)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
    const base = hs.file('arrival', 1) as any;
    const good = validateSaveFile(structuredClone(base));
    expect(good.ok, good.ok ? '' : (good as {error: string}).error).toBe(true);
    expect(base.run.participants['player-train'].cargo.v).toBe(3);
    const refuse = (mut: (f: typeof base) => void, re: RegExp) => {
      const f = structuredClone(base);
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    const parts = (f: typeof base) => f.run.participants;
    refuse(f => { parts(f)[CORPSE_CARRY_PARTICIPANT].held.id = 'st-01:main#4'; }, /two places/); // held AND aboard
    refuse(f => { parts(f)['player-train'].cargo.bodies[0].id = 'st-01:main#5'; }, /two places/); // aboard AND in a station
    refuse(f => { parts(f)['player-train'].chipper.job.body.id = 'st-01:main#7'; }, /two places/); // in the hopper AND in the hands
    refuse(f => { f.run.memories['st-01:main'].lanes[STATION_BODIES_LANE].here.push(structuredClone(f.run.memories['st-01:main'].lanes[STATION_BODIES_LANE].here[0])); }, /twice/);
    refuse(f => { parts(f)[CORPSE_CARRY_PARTICIPANT].held.x = 900; }, /out of range/);
    refuse(f => { parts(f)['player-train'].cargo.bodies[0].arch = 'ratdog'; }, /not a carriable/);
    // an older save: no carry record, cargo v2, no station lane — valid; it loads with free hands and no bodies
    const old = structuredClone(base);
    delete old.run.participants[CORPSE_CARRY_PARTICIPANT];
    old.run.participants['player-train'].cargo = {v: 2, items: [], props: []};
    delete old.run.participants['player-train'].chipper;
    delete old.run.memories['st-01:main'].lanes[STATION_BODIES_LANE];
    delete old.run.entry; old.run.entry = null;
    old.checksum = checksumOf(old.run);
    const ok = validateSaveFile(old);
    expect(ok.ok, ok.ok ? '' : (ok as {error: string}).error).toBe(true);
    const sys = new CorpseSystem({camera: new THREE.PerspectiveCamera(), playerTrain: {cargo: {liveBodies: null}}, interactHandlers: [], promptProviders: [], inputOwners: [],
      modifierSources: [], frameHooks: [], sectionHooks: [], sectionLayoutHooks: [], sectionModelKeys: [], runParticipants: []} as never, {enemyIndex: () => undefined}).install();
    const part = sys.participant();
    part.load(undefined);
    expect(part.save()).toEqual({v: 1, held: null});
    held = null;
  });
});

describe('corpses: eligibility, pickup, carry, drop', () => {
  it('only a dead layout enemy of a feedable family can be picked up; the same actor goes into the hands, slower, hands busy', () => {
    const L = SUB(), c = rig(L);
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3; // between the rear and middle doors (the chipper is in the front half)
    const z = deadEnemy(c, 0, mid + 0.6, 0.2, Math.PI / 2);
    const qa = deadEnemy(c, 2, mid - 3.2, -0.3, 0, {qa: true});
    const rat = {brain: {alive: false, x: 0, z: 0}, archetype: 'ratdog'} as unknown as EnemyActor; // (eligibility reads the trait only)
    const alive = createEnemyActor({...L.zombies[4], x: 0, z: 0, yaw: 0}, lazy, rng(), () => new ZombieActor(zombieGltf, {...L.zombies[4], x: 0, z: 0, yaw: 0}, rng())).actor;
    c.enemyIndex.set(alive, 4);
    c.enemyIndex.set(rat, 5);
    expect(c.sys.eligible(z)).toBe(true);
    expect(c.sys.eligible(qa)).toBe(false); // no layout identity (a QA spawn)
    expect(c.sys.eligible(rat)).toBe(false); // not undead, not humanoid
    expect(alive.brain.alive).toBe(true);
    expect(c.sys.eligible(alive)).toBe(false); // living
    // aimed at the QA corpse / the rat: no prompt; at the zombie within reach: the prompt
    standIn(c, mid - 2.2, -0.3, hipsOf(qa));
    expect(prompt(c)).not.toBe(CORPSE_TEXT.pickup);
    standIn(c, mid - 1.0, 0.2, hipsOf(z));
    expect(prompt(c)).toBe(CORPSE_TEXT.pickup);
    const before = c.h.zombies.length;
    press(c.h, 'KeyE');
    const held = c.sys.held()!;
    expect(held.object).toBe(z.root); // the SAME actor
    expect(held.record).toMatchObject({id: `${sectionId(KA)}#0`, arch: 'zombie', seed: 4242, type: L.zombies[0].type, x: 0, y: 0, z: 0, q: [0, 0, 0, 1]});
    expect(held.record.scale).toBeCloseTo(z.scale, 4);
    expect(c.h.zombies.length).toBe(before - 1);
    expect(c.h.zombies.includes(z)).toBe(false);
    expect(c.enemyIndex.has(z)).toBe(false);
    expect(c.h.run.memory(KA).killed).toContain(0); // never respawned, whatever happens to the body
    expect(c.forgot).toContain(z);
    expect(c.released).toContain(z);
    expect(c.cancels).toContain('carry');
    expect(z.root.parent).toBe(c.sys.carry);
    expect(c.sys.carry.parent).toBe(c.h.camera);
    z.root.traverse(o => { if ((o as THREE.Mesh).isMesh) { expect(o.frustumCulled).toBe(false); expect((o as THREE.Mesh).castShadow).toBe(false); } });
    // hands busy: the input owner, item use refused, slower by mass (a sprint a heavy jog)
    expect(c.h.inputOwners.some(f => f())).toBe(true);
    expect(c.sys.refuseUse()).toBe(true);
    expect(c.h.toasts).toContain(CORPSE_TEXT.handsFull);
    const mods = c.h.modifierSources.map(f => f()).filter(m => m.speedMult !== undefined);
    expect(mods.length).toBe(1);
    expect(mods[0].speedMult).toBeCloseTo(Math.max(CORPSE.slowMin, Math.min(CORPSE.slowMax, 1 - 70 / CORPSE.massDiv)), 6);
    c.h.player.sprinting = true;
    expect((c.h.modifierSources.map(f => f()).find(m => m.speedMult !== undefined)!.speedMult!) * 5.8).toBeLessThan(3.4 * 1.3);
    c.h.player.sprinting = false;
    expect(prompt(c)).toBe(CORPSE_TEXT.drop);
    run(c.h, 0.5);
    expect(c.sys.holster).toBe(1);
    // FIRST PERSON: part of the body in the lower right of the view, nothing on the crosshair, nothing inside the near plane
    standIn(c, mid - 1.0, 0.2);
    c.h.player.yaw = Math.atan2(-c.h.trainPlacement!.front, 0); // along the car (local +X)
    c.h.player.pitch = 0;
    run(c.h, 0.05);
    const cam = c.h.camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld(true);
    const verts = skinned(z.root), eye = cam.getWorldPosition(new THREE.Vector3());
    const ndc = verts.map(v => v.clone().project(cam));
    const inView = ndc.filter(q => Math.abs(q.x) < 1 && Math.abs(q.y) < 1 && q.z > -1 && q.z < 1);
    expect(inView.length / verts.length).toBeGreaterThan(0.01);
    expect(inView.every(q => q.x > 0)).toBe(true); // the right side
    expect(inView.filter(q => Math.abs(q.x) < 0.2 && Math.abs(q.y) < 0.2).length).toBe(0); // the crosshair stays clear
    expect(Math.min(...verts.map(v => v.distanceTo(eye)))).toBeGreaterThan(0.08);
    // E: laid down in front (no sink offered here), in its lying pose, grounded, inside the car = the train's; the hands are free at once
    press(c.h, 'KeyE');
    expect(c.sys.held()).toBeNull();
    expect(c.h.inputOwners.some(f => f())).toBe(false); // (Game's laneOwnedLast latch keeps a still-held button from firing)
    expect(c.sys.lying.length).toBe(1);
    expect(z.root.parent).toBe(c.h.scene);
    const minY = Math.min(...skinned(z.root, 1).map(v => v.y));
    expect(Math.abs(minY - (c.h.trainPlacement!.floorY))).toBeLessThan(0.002); // never floating, never sunk
    z.root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) expect(o.frustumCulled).toBe(true); });
    expect(c.sys.trainBodies().map(r => r.id)).toEqual([held.record.id]);
    expect(census(c)).toEqual([held.record.id]);
    // and up again
    lookAt(c.h, hipsOf(z).x, hipsOf(z).y, hipsOf(z).z);
    expect(prompt(c)).toBe(CORPSE_TEXT.pickup);
    press(c.h, 'KeyE');
    expect(c.sys.held()?.record.id).toBe(held.record.id);
    expect(c.sys.lying.length).toBe(0);
    expect(census(c)).toEqual([held.record.id]);
  }, 120000);
});

describe('corpses: hands busy elsewhere', () => {
  it('the fuel pour refuses while carrying; a Slugger windup is cancelled by the lane-ownership path; Game latches the released button', () => {
    const toasts: string[] = [];
    const g = {trainRide: {riding: false}, playerTrain: {fuel: {tank: 0}}, inv: {count: () => 1, wornBag: () => null}, player: {climbing: false}, consumeView: {busy: false},
      gasMask: {transitioning: false}, gear: {readied: false}, corpses: {carrying: true}, hud: {toast: (t: string) => { toasts.push(t); }}, sfx: {denied: () => {}}, input: {clears: 0}};
    const port = new FuelPortSystem(g as never);
    expect(port.press()).toBe('busy');
    expect(toasts).toEqual(['Hands busy']);
    g.corpses.carrying = false;
    expect(port.press()).toBe('pouring');
    // Game.update: laneOwns -> the melee weapon is `lowered` and its button not `held`: a windup drops without a swing
    expect(WEAPONS.slugger?.melee).toBeTruthy();
    const w = new WeaponController(), inv = new Inventory();
    w.equip({uid: 1, itemId: 'slugger', count: 1} as ItemStack);
    const events: string[] = [];
    const step = (held: boolean, lowered: boolean) => { for (const e of w.update(1 / 60, {held, pressed: held && !w.winding, reload: false, lowered}, inv)) events.push(e.type); };
    for (let i = 0; i < 40; i++) step(false, false); // equipped
    for (let i = 0; i < 20; i++) step(true, false);
    expect(w.winding).toBe(true);
    step(false, true); // a body picked up mid-windup: the lane owns the buttons
    for (let i = 0; i < 60; i++) step(false, true);
    expect(w.winding).toBe(false);
    expect(events).not.toContain('swing');
    expect(events).not.toContain('contact');
    // the release latch (game.ts): a lane giving the mouse back with the left button held never fires it
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/if \(this\.laneOwnedLast && !laneOwns && inp\.mouse\[0\]\) this\.lmbLatch = true;/);
    expect(src).toMatch(/this\.corpses\?\.refuseUse\(\)/);
    expect(src).toMatch(/!this\.corpses\?\.carrying,/); // (no reload while carrying)
    expect(src).toMatch(/const carryHolster = this\.corpses\?\.holster \?\? 0;/);
  });
});

describe('corpses: the station, the train, the journey', () => {
  it('a body put down on the platform is the station\'s (lane, rebuilt at its pose on every build, its enemy never respawned)', () => {
    const L = SUB(), c = rig(L);
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3;
    const z = deadEnemy(c, 2, mid + 0.6, 0.2);
    standIn(c, mid - 1.0, 0.2, hipsOf(z));
    press(c.h, 'KeyE');
    const id = c.sys.held()!.record.id;
    // out on the platform (local -Z beyond the wall), facing away from the car
    const p = c.h.trainPlacement!, out = trainToWorld(p, mid, 0, -(SPEC.width / 2 + 1.6));
    c.h.player.spawn(out.x, out.z, p.front === 1 ? 0 : Math.PI, 0);
    syncCamera(c.h);
    press(c.h, 'KeyE');
    expect(c.sys.held()).toBeNull();
    expect(c.sys.trainBodies()).toEqual([]);
    const lane = c.h.run.here(KA);
    expect(lane.map(r => r.id)).toEqual([id]);
    expect(lane[0].level).toBe(0);
    expect(lane[0].y).toBeGreaterThanOrEqual(-0.1); // its root on the platform floor (lifted by its look's few-cm grounding: restingLift)
    expect(lane[0].y).toBeLessThan(0.1);
    expect(Math.abs(Math.min(...skinned(c.sys.lying[0].actor.root, 1).map(v => v.y)))).toBeLessThan(0.002); // grounded
    expect(stationBodiesProblem(c.h.run.laneStore(STATION_BODIES_LANE, KA), () => true)).toBeNull();
    const at = new THREE.Vector3(lane[0].x, lane[0].y, lane[0].z);
    expect(census(c)).toEqual([id]);
    leave(c);
    expect(c.sys.lying).toEqual([]);
    expect(c.h.run.here(KA).map(r => r.id)).toEqual([id]);
    // REVISIT: the enemy stays dead (killed), the body lies where it was left — once
    expect(enemiesToSpawn(L.zombies.length, c.h.run.memory(KA))).not.toContain(2);
    const n0 = c.builds.length;
    enter(c, SUB(), KA);
    expect(c.sys.lying.length).toBe(1);
    expect(c.sys.lying[0].actor.root.position.distanceTo(at)).toBeLessThan(1e-4);
    expect(c.sys.lying[0].actor.scale).toBeCloseTo(lane[0].scale!, 5);
    const b = c.builds[n0];
    expect([b.i, b.seed, b.s.type]).toEqual([2, 4242, L.zombies[2].type]); // spawnEnemy's look inputs …
    expect(b.rand).not.toBe(c.gameRand); // … on the body's own stream, never the game's
    expect(census(c)).toEqual([id]);
  }, 120000);

  it('cargo v3: a body in the parked car saves / loads into the next car at its train-local pose; maxAboard and the doorway refuse', () => {
    const L = SUB(), c = rig(L);
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3;
    const z = deadEnemy(c, 0, mid + 0.6, 0.2);
    standIn(c, mid - 1.0, 0.2, hipsOf(z));
    press(c.h, 'KeyE');
    press(c.h, 'KeyE'); // down in the car
    const recs = c.sys.trainBodies();
    expect(recs.length).toBe(1);
    const saved = c.h.playerTrain.participant().save() as {cargo: TrainCargoJSON};
    expect(saved.cargo.v).toBe(3);
    expect(cargoProblem(saved.cargo)).toBeNull();
    expect(saved.cargo.bodies!.map(r => r.id)).toEqual([recs[0].id]);
    expect(recs[0].level).toBeUndefined();
    expect(c.sys.departBlock()).toBeNull();
    leave(c);
    expect(c.sys.pending.map(r => r.id)).toEqual([recs[0].id]); // a teardown without a ride: pending
    // Continue: a fresh game loads the record, then builds the station — the body lies in the car, at the same train-local pose, once
    const d = rig(SUB());
    d.h.playerTrain.participant().load(structuredClone(saved));
    enter(d, SUB(), KA);
    expect(d.sys.lying.length).toBe(1);
    const back = d.sys.trainBodies()[0];
    expect(Math.hypot(back.x - recs[0].x, back.y - recs[0].y, back.z - recs[0].z)).toBeLessThan(1e-4);
    expect(new THREE.Quaternion(...back.q).normalize().angleTo(new THREE.Quaternion(...recs[0].q).normalize())).toBeLessThan(1e-3);
    expect(census(d)).toEqual([recs[0].id]);
    // more than BODIES.maxAboard: the departure is refused, nothing cut
    d.h.playerTrain.cargo.load({v: 3, items: [], props: [], bodies: Array.from({length: BODIES.maxAboard}, (_, i) => rec(`st-00:main#${i}`, {x: -5 + (i % 10), z: 0.1 * (i % 5)}))});
    expect(d.sys.pending.length + d.sys.lying.length).toBe(BODIES.maxAboard);
    expect(d.sys.departBlock()).toBeNull();
    d.sys.pending.push(rec('st-00:main#99'));
    expect(d.sys.departBlock()).toBe(CORPSE_TEXT.overloaded(BODIES.maxAboard + 1));
    expect(d.sys.trainBodies().length).toBe(BODIES.maxAboard + 1);
    // a body lying across the doorway (its centre inside, its legs out on the platform): refused
    d.h.playerTrain.cargo.load({v: 3, items: [], props: [], bodies: []});
    leave(d);
    d.h.playerTrain.cargo.load({v: 3, items: [], props: [], bodies: [rec('st-00:main#1', {x: SPEC.doors[0].x, y: SPEC.floorY, z: -(I.halfWidth - 0.55), q: [0, 0, 0, 1]})]});
    enter(d, SUB(), KA);
    expect(d.sys.lying.length).toBe(1);
    expect(d.sys.departBlock()).toBe(CORPSE_TEXT.doorway);
  }, 180000);

  it('a journey: the car\'s bodies ride its view root (moving with it), stay through the teardown, lie in the next station\'s car', async () => {
    const L = SUB(), c = rig(L), {h, ride, rt} = c;
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3;
    const a = deadEnemy(c, 0, mid + 0.6, 0.2), b = deadEnemy(c, 2, mid - 2.0, -0.4, 1.2);
    standIn(c, mid - 1.0, 0.2, hipsOf(a));
    press(h, 'KeyE');
    press(h, 'KeyE');
    const ids = census(c);
    const local = c.sys.trainBodies();
    // the second one is carried: held through the journey
    standIn(c, mid - 3.2, -0.4, hipsOf(b));
    press(h, 'KeyE');
    const heldId = c.sys.held()!.record.id;
    standIn(c, mid - 3.2, -0.4);
    // the driving console stays usable with a body in the hands (its map starts the journey); every other E is the body's
    (rt as unknown as {consoleAimed: boolean}).consoleAimed = true;
    expect(prompt(c)).not.toBe(CORPSE_TEXT.drop);
    expect(h.interactHandlers[0]()).toBe(false); // (the carry handler goes first and lets the console's E through)
    (rt as unknown as {consoleAimed: boolean}).consoleAimed = false;
    expect(prompt(c)).toBe(CORPSE_TEXT.drop);
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    expect(c.sys.riding.map(x => x.rec.id)).toEqual(local.map(r => r.id));
    expect(c.sys.riding[0].actor.root.parent).toBe(rt.view!.root);
    expect(c.sys.held()?.record.id).toBe(heldId);
    leave(c); // the old world goes; the riding body and the hands stay
    expect(c.sys.riding.length).toBe(1);
    expect(c.sys.held()?.object.parent).toBe(c.sys.carry);
    run(h, 1);
    const B = OFF();
    enter(c, B, KB);
    expect(c.sys.riding.length).toBe(1);
    let arr: {status: string} | null = null;
    void ride.arrive().then(r => { arr = r; });
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    expect(arr).toMatchObject({status: 'stopped'});
    run(h, 0.1);
    expect(c.sys.riding).toEqual([]);
    expect(c.sys.lying.length).toBe(1);
    const now = c.sys.trainBodies();
    expect(now.map(r => r.id)).toEqual(local.map(r => r.id));
    expect(Math.hypot(now[0].x - local[0].x, now[0].y - local[0].y, now[0].z - local[0].z)).toBeLessThan(1e-3);
    expect(c.sys.held()?.record.id).toBe(heldId);
    expect(census(c).sort()).toEqual([...ids, heldId].sort());
  }, 240000);

  it('the hands across save / load and Retry: the entry state comes back (the enemy alive, no body where it was not at entry)', () => {
    const L = SUB(), c = rig(L);
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3;
    // the level entry (Game.levelEntrySnapshot): no body anywhere, enemy 0 alive
    const entry = {lanes: Object.fromEntries((c.h.runParticipants as {id: string; save(): unknown}[]).concat([c.h.playerTrain.participant()]).map(p => [p.id, structuredClone(p.save())])),
      memories: Object.fromEntries([...c.h.run.mems].map(([k, m]) => [k, structuredClone(m)]))};
    const z = deadEnemy(c, 0, mid + 0.6, 0.2);
    standIn(c, mid - 1.0, 0.2, hipsOf(z));
    press(c.h, 'KeyE');
    const id = c.sys.held()!.record.id;
    const carry = structuredClone(c.sys.participant().save()) as {held: BodyRecordJSON};
    expect(carry.held.id).toBe(id);
    // Load into a fresh game: the body in the hands after the build (rebuilt: same identity, look inputs and size)
    const d = rig(SUB());
    d.sys.participant().load(carry);
    enter(d, SUB(), KA);
    expect(d.sys.held()?.record).toEqual(carry.held);
    expect(d.sys.held()!.object.parent).toBe(d.sys.carry);
    // Retry in the first game after putting it down in the car: back to the entry
    press(c.h, 'KeyE');
    expect(census(c)).toEqual([id]);
    leave(c);
    c.h.run.mems.clear();
    for (const [k, m] of Object.entries(entry.memories)) c.h.run.mems.set(k, structuredClone(m));
    for (const p of [...(c.h.runParticipants as {id: string; load(d: unknown): void}[]), c.h.playerTrain.participant()]) p.load(structuredClone(entry.lanes[p.id]));
    enter(c, SUB(), KA);
    expect(c.sys.held()).toBeNull();
    expect(c.sys.lying).toEqual([]);
    expect(census(c)).toEqual([]);
    expect(enemiesToSpawn(L.zombies.length, c.h.run.memory(KA))).toContain(0); // alive again: it will be spawned
    // NewGame: none
    c.sys.participant().load(carry);
    expect(c.sys.held()).not.toBeNull();
    c.sys.participant().reset();
    expect(c.sys.held()).toBeNull();
  }, 180000);
});

describe('corpses: the real chipper takes the body', () => {
  it('fed from the hands: gone from the corpse system in the same call, the chipper\'s job, saved exactly once; never touched again', () => {
    const L = SUB(), c = rig(L), {h} = c;
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3;
    const z = deadEnemy(c, 0, mid + 0.6, 0.2);
    standIn(c, mid - 1.0, 0.2, hipsOf(z));
    press(h, 'KeyE');
    const id = c.sys.held()!.record.id;
    // at the hopper, looking into its mouth (world/chipper.ts: eye in the car, within reach, crosshair on the machine)
    const C = chipperPlacement(SPEC)!, A = CHIPPER_ANCHORS.hopper, hop = chipperToLocal(C, A.x, A.y, A.z), f = chipperDirToLocal(C, 0, 0, 1);
    standIn(c, hop.x + f.x * 0.95, hop.z + f.z * 0.95);
    const aim = trainToWorld(h.trainPlacement!, hop.x, hop.y, hop.z);
    lookAt(h, aim.x, aim.y, aim.z);
    expect(prompt(c)).toBe(CHIPPER_TEXT.feed);
    press(h, 'KeyE');
    expect(c.sys.held()).toBeNull();
    expect(c.sys.lying).toEqual([]);
    expect(c.sys.trainBodies()).toEqual([]);
    const job = h.playerTrain.chipper.state.job!;
    expect(job.body.id).toBe(id);
    expect(job.body.scale).toBeCloseTo(z.scale, 4);
    expect(z.root.parent).toBe(c.ch.group); // the machine's visual now
    expect(census(c)).toEqual([id]);
    // the save: the job holds it, nowhere else
    const ids = [(c.sys.participant().save() as {held: BodyRecordJSON | null}).held?.id, ...(c.h.playerTrain.participant().save() as {cargo: TrainCargoJSON}).cargo.bodies!.map(r => r.id),
      (c.h.playerTrain.participant().save() as {chipper: {job: {body: BodyRecordJSON}}}).chipper.job.body.id].filter(Boolean);
    expect(ids).toEqual([id]);
    // the corpse system never touches it again: the machine poses it, grinds it and disposes it once
    run(h, 0.5);
    expect(z.root.parent).toBe(c.ch.group);
    expect(c.sys.qa().held).toBeNull();
    run(h, 21); // (20 active s of grinding, parked)
    expect(h.playerTrain.chipper.state.job).toBeNull();
    expect(h.playerTrain.chipper.state.done).toBe(1);
    expect(z.root.parent).toBeNull();
    expect(census(c)).toEqual([]);
  }, 180000);
});

const corpseVolumesOf = (z: EnemyActor) => corpseVolumes(z as never);

/** Does `root` draw the meshes of the loaded model `key` (a skinned clone shares its geometry)? */
function drawsModel(root: THREE.Object3D, key: string): boolean {
  const geos = new Set<THREE.BufferGeometry>();
  lazy[key].scene.traverse(o => { if ((o as THREE.Mesh).isMesh) geos.add((o as THREE.Mesh).geometry); });
  let hit = false;
  root.traverse(o => { if ((o as THREE.Mesh).isMesh && geos.has((o as THREE.Mesh).geometry)) hit = true; });
  return hit;
}

describe('corpses: the Screacher (headless, four bodies of one type)', () => {
  it('its variant is recorded at pickup, kept by a save, rebuilt as the SAME body; it lies grounded; no Head bone is needed', () => {
    const L = SUB(), c = rig(L);
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3;
    const z = deadEnemy(c, 2, mid + 0.6, 0.2, 0, {spawn: {archetype: 'screacher', variant: 'sc03'}});
    expect(z.archetype).toBe('screacher');
    expect(drawsModel(z.root, 'enemy_screacher_sc03')).toBe(true);
    expect(corpseVolumesOf(z).some(v => v.part === 'head')).toBe(false); // headless: no head volume to aim at
    standIn(c, mid - 1.0, 0.2, hipsOf(z));
    expect(prompt(c)).toBe(CORPSE_TEXT.pickup);
    press(c.h, 'KeyE');
    const held = c.sys.held()!;
    expect(held.record).toMatchObject({arch: 'screacher', variant: 'sc03'});
    // a save keeps it (strictly valid), a load rebuilds the sc03 body — never the default sc01
    const carry = structuredClone(c.sys.participant().save()) as {held: BodyRecordJSON};
    expect(carryProblem(carry, corpseFeedable)).toBeNull();
    expect(carry.held.variant).toBe('sc03');
    const d = rig(SUB());
    d.sys.participant().load(carry);
    enter(d, SUB(), KA);
    expect(d.sys.held()?.record.variant).toBe('sc03');
    expect(drawsModel(d.sys.held()!.object, 'enemy_screacher_sc03')).toBe(true);
    expect(drawsModel(d.sys.held()!.object, 'enemy_screacher_sc01')).toBe(false);
    expect(CorpseSystem.modelKeys([carry.held])).toEqual(['enemy_screacher_sc03']);
    // down on the platform: the station's record keeps the variant; the revisit rebuilds the sc03 body, grounded
    const p = c.h.trainPlacement!, out = trainToWorld(p, mid, 0, -(SPEC.width / 2 + 1.6));
    c.h.player.spawn(out.x, out.z, p.front === 1 ? 0 : Math.PI, 0);
    syncCamera(c.h);
    press(c.h, 'KeyE');
    expect(c.h.run.here(KA).map(r => [r.id, r.arch, r.variant])).toEqual([[held.record.id, 'screacher', 'sc03']]);
    expect(Math.abs(Math.min(...skinned(c.sys.lying[0].actor.root, 1).map(v => v.y)))).toBeLessThan(0.002);
    leave(c);
    const n0 = c.builds.length;
    enter(c, SUB(), KA);
    expect(c.builds[n0].s).toMatchObject({archetype: 'screacher', variant: 'sc03'});
    const back = c.sys.lying[0].actor;
    expect(back.archetype).toBe('screacher');
    expect(drawsModel(back.root, 'enemy_screacher_sc03')).toBe(true);
    expect(drawsModel(back.root, 'enemy_screacher_sc01')).toBe(false);
    expect(Math.abs(Math.min(...skinned(back.root, 1).map(v => v.y)))).toBeLessThan(0.002);
    expect(census(c)).toEqual([held.record.id]);
    // a body WITHOUT a Head bone at all (keyed look-ups fall back): picked up, carried, put down, fed — nothing needs a head
    const e = deadEnemy(c, 0, mid + 0.6, 0.2, 0, {spawn: {archetype: 'screacher', variant: 'sc01'}});
    const head = e.root.getObjectByName('Head');
    if (head) head.name = 'HeadGone';
    expect(e.root.getObjectByName('Head')).toBeUndefined();
    standIn(c, mid - 1.0, 0.2, hipsOf(e));
    press(c.h, 'KeyE');
    expect(c.sys.held()?.record).toMatchObject({arch: 'screacher', variant: 'sc01'});
    standIn(c, mid - 1.0, 0.2);
    faceAlong(c);
    press(c.h, 'KeyE'); // down in the car
    expect(c.sys.held()).toBeNull();
    const lyingE = c.sys.lying.find(b => b.actor === e)!;
    expect(lyingE.points.length).toBeGreaterThan(5);
    expect(Math.abs(Math.min(...skinned(e.root, 1).map(v => v.y)) - p.floorY)).toBeLessThan(0.002);
    expect(c.sys.departBlock()).toBeNull();
  }, 180000);
});

describe('corpses: handled bodies take hits like corpses', () => {
  it('a body lying in the station / the parked car is a corpse hit target (wounds while it is the actor that died; blood once rebuilt); never in the hands', () => {
    const L = SUB(), c = rig(L), dmg = new DamageSystem(null, null);
    enter(c, L, KA);
    Object.assign(c.h, {damage: dmg});
    const mid = (I.x0 + I.x1) / 2 - 3;
    const z = deadEnemy(c, 0, mid + 0.6, 0.2);
    dmg.installZombie(z); // (Game.spawnEnemy: its own wound materials)
    const w = woundsOf(z)!;
    expect(w).toBeTruthy();
    standIn(c, mid - 1.0, 0.2, hipsOf(z));
    press(c.h, 'KeyE');
    expect(c.sys.hitTargets()).toEqual([]); // carried: no target
    standIn(c, mid - 1.0, 0.2);
    faceAlong(c);
    press(c.h, 'KeyE'); // down in the parked car
    expect(c.sys.hitTargets()).toEqual([z]);
    expect(z.brain.alive).toBe(false);
    const shoot = (target: EnemyActor) => {
      lookAt(c.h, hipsOf(target).x, hipsOf(target).y, hipsOf(target).z);
      const cam = c.h.camera, o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
      const hit = dmg.corpseHit(c.sys.hitTargets() as never, {x: o.x, y: o.y, z: o.z}, {x: d.x, y: d.y, z: d.z}, 10);
      expect(hit?.z).toBe(target);
      dmg.beginShot();
      return dmg.hitZombie(hit!.z, o.clone().addScaledVector(d, hit!.t), d, hit!.part, {damage: 30, pellet: false, weapon: 'rifle'}, true);
    };
    const n0 = w.wounds.length;
    expect(shoot(z).object).toBe('corpse');
    expect(w.wounds.length).toBe(n0 + 1); // its own wound materials (installed when it spawned): a real wound, no new material
    expect(dmg.counts.corpse).toBe(1);
    // rebuilt from its record (Continue): still a target, blood and flesh bits, no wound controller (no new materials)
    leave(c);
    const d2 = rig(SUB()), dmg2 = new DamageSystem(null, null);
    d2.h.playerTrain.participant().load(structuredClone(c.h.playerTrain.participant().save()));
    enter(d2, SUB(), KA);
    Object.assign(d2.h, {damage: dmg2});
    const r = d2.sys.lying[0].actor;
    expect(d2.sys.hitTargets()).toEqual([r]);
    expect(woundsOf(r)).toBeUndefined();
    standIn(d2, mid - 1.0, 0.2);
    lookAt(d2.h, hipsOf(r).x, hipsOf(r).y, hipsOf(r).z);
    const cam = d2.h.camera, o = cam.getWorldPosition(new THREE.Vector3()), dir = cam.getWorldDirection(new THREE.Vector3());
    const hit = dmg2.corpseHit(d2.sys.hitTargets() as never, {x: o.x, y: o.y, z: o.z}, {x: dir.x, y: dir.y, z: dir.z}, 10);
    expect(hit?.z).toBe(r);
    expect(dmg2.hitZombie(hit!.z, o.clone().addScaledVector(dir, hit!.t), dir, hit!.part, {damage: 30, pellet: false, weapon: 'rifle'}, true).object).toBe('corpse');
    expect(woundsOf(r)).toBeUndefined();
    // Game wiring: shots and swings test the handled bodies after the world's corpses (the nearer wins)
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    expect(src.match(/this\.damage\.corpseHit\(this\.corpses\?\.hitTargets\(\) \?\? \[\]/g)?.length).toBe(2);
  }, 180000);
});

describe('corpses: poses, models', () => {
  it('the lying pose (each family\'s Death clip end) rests on the floor for the zombie, Blightbelly, Strainer, Siren and Screacher', () => {
    for (const [arch, variant] of [['zombie'], ['blightbelly'], ['strainer'], ['siren'], ['screacher', 'sc01'], ['screacher', 'sc03']]) {
      const sp: ZombieSpawn = {x: 0, z: 0, yaw: 0, type: 'shambler', area: 0, ...(arch !== 'zombie' ? {archetype: arch as never} : {}), ...(variant ? {variant} : {})};
      const {actor, fallback} = createEnemyActor(sp, lazy, rng(), () => new ZombieActor(zombieGltf, sp, rng()));
      expect(fallback, arch).toBe(false);
      actor.root.position.set(3, 1.5, -2);
      const stand = Math.max(...skinned(actor.root, 4).map(v => v.y)) - 1.5;
      actor.beginRagdoll();
      expect(poseLying(actor), arch).toBe('clip');
      const lift = restingLift(actor.root);
      expect(Math.abs(lift), `${arch}: the authored death ends within a few cm of the floor`).toBeLessThan(0.1);
      actor.root.position.y += lift * actor.scale; // (as the corpse system lays it down)
      const vs = skinned(actor.root, 1);
      const lo = Math.min(...vs.map(v => v.y)), hi = Math.max(...vs.map(v => v.y));
      expect(lo - 1.5, `${arch} lowest point`).toBeGreaterThan(-0.002);
      expect(lo - 1.5, `${arch} lowest point`).toBeLessThan(0.002);
      expect(hi - 1.5, `${arch} lying, not standing`).toBeLessThan(0.45 * stand);
    }
  }, 120000);

  it('every record\'s lazy models are section model keys (hands, train, station lane, the chipper\'s job, a Retry snapshot, a save)', () => {
    expect(CorpseSystem.modelKeys([rec('a:b#1', {arch: 'blightbelly'}), rec('a:b#2'), rec('a:b#3', {arch: 'strainer'})])).toEqual(['enemy_blightbelly', 'enemy_strainer']);
    expect(CorpseSystem.modelKeys([rec('a:b#1', {look: 'lingerie'})]).length).toBeGreaterThan(0);
    const L = SUB(), c = rig(L);
    c.h.playerTrain.cargo.load({v: 3, items: [], props: [], bodies: [rec('st-00:main#1', {arch: 'siren'})]});
    c.h.run.setLaneStore(STATION_BODIES_LANE, {v: 1, here: [rec('st-01:main#4', {arch: 'strainer', level: 0, x: 30})]}, KA);
    c.h.playerTrain.chipper.state = {v: 1, ticks: 0, seq: 2, done: 0, last: 0, job: {uid: 1, body: rec('st-00:main#5', {arch: 'blightbelly'}), ms: 0}};
    for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L, KA, c.h.run, 'prepare');
    const keys = (c.h.sectionModelKeys as ((l: StationLayout) => readonly string[])[]).flatMap(f => [...f(L)]);
    expect([...new Set(keys)].sort()).toEqual(['enemy_blightbelly', 'enemy_siren', 'enemy_strainer']);
    expect((c.h.sectionModelKeys as ((l: StationLayout) => readonly string[])[]).flatMap(f => [...f({...L, props: []})]).sort()).toEqual(['enemy_blightbelly', 'enemy_siren', 'enemy_strainer']); // (a spread copy keeps them)
    // a decoded save not installed yet (Game.decodeSave notes its run; the prepare of that run fetches the save's bodies too)
    const saveRun = new FakeRun(KA);
    c.sys.notePrepared(saveRun, {[CORPSE_CARRY_PARTICIPANT]: {v: 1, held: rec('st-00:main#8', {look: 'cosplay', x: 0, y: 0, z: 0, q: [0, 0, 0, 1]})}});
    const L2 = SUB();
    for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L2, KA, saveRun, 'prepare');
    const k2 = (c.h.sectionModelKeys as ((l: StationLayout) => readonly string[])[]).flatMap(f => [...f(L2)]);
    expect(k2).toEqual(expect.arrayContaining(CorpseSystem.modelKeys([rec('x:y#1', {look: 'cosplay'})])));
    // a Retry snapshot's bodies (the snapshot's train cargo / hands / station lane) are prepared too
    const snapRun = new FakeRun(KA);
    snapRun.entry = {lanes: {'player-train': {cargo: {v: 3, items: [], props: [], bodies: [rec('st-00:main#3', {arch: 'blightbelly'})]}}}, memories: {}};
    c.h.playerTrain.chipper.state = {v: 1, ticks: 0, seq: 1, done: 0, last: 0, job: null};
    c.h.playerTrain.cargo.load(undefined);
    const L3 = SUB();
    for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L3, KA, snapRun, 'prepare');
    expect((c.h.sectionModelKeys as ((l: StationLayout) => readonly string[])[]).flatMap(f => [...f(L3)])).toEqual(['enemy_blightbelly']);
  });
});
