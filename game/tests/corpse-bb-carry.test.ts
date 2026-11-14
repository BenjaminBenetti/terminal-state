// Task studio-corpse-market-shop-20261114-031614-01: BB's small dead body is CARRIABLE (ai/corpseTrait.ts corpseCarriable: every undead
// body) — picked up, carried over the shoulder on the shared rig, kept in a station's lane / the train, rebuilt as the same look — so it
// can be sold whole to the Market's corpse buyer; the train's chipper still refuses it (not an adult humanoid body) with its own line.
// The real corpse system + chipper in the parked train (the corpse-carry harness, trimmed), the real BB model (textures stripped).

import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
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
import {createEnemyActor, ENEMY_ARCHETYPES, type EnemyActor} from '../src/ai/creatureArchetypes';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {CORPSE_TRAITS, corpseCarriable, corpseFeedable} from '../src/ai/corpseTrait';
import type {BodyRecordJSON} from '../src/corpse/bodyRecord';
import {STATION_BODIES_LANE, carryProblem, stationBodiesProblem, type StationBodiesJSON} from '../src/corpse/bodyLanes';
import {CORPSE, CORPSE_TEXT, CorpseSystem} from '../src/world/corpses';
import {CHIPPER_TEXT, ChipperSystem, type ChipperAudioLike, type ChipperHost} from '../src/world/chipper';
import {CHIPPER_ANCHORS} from '../src/world/chipperSpec';
import {chipperDirToLocal, chipperPlacement, chipperToLocal} from '../src/world/chipperPlace';
import {cargoProblem} from '../src/run/trainCargo';
import type {SectionMemory} from '../src/run/memory';
import {sid} from './helpers/saveFixture';
import {build, lookAt, press, stationHost, syncCamera} from './helpers/fuelCartsHost';
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
  for (const k of ['enemy_bb_teddy', 'enemy_bb_lullaby']) lazy[k] = await loadStripped(ENEMY_MODEL_FILES[k].url);
}, 120000);

const SUB = (): StationLayout => LEVELS.subway.generate('main', {levelSeed: 4242});
const KA: SectionKey = {level: 'subway', section: 'main', station: sid(1)};
const I = SPEC.interior;
const rng = (seed = 1) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

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

function rig(first: StationLayout, key: SectionKey = KA) {
  const s = stationHost(first, {build: false});
  live.push(s.rt);
  const h = s.h as unknown as typeof s.h & Record<string, unknown> & {run: FakeRun; zombies: EnemyActor[]; layout: StationLayout};
  const enemyIndex = new Map<EnemyActor, number>();
  Object.assign(h, {
    run: new FakeRun(key), seed: 4242, rand: rng(99), sectionLayoutHooks: [], sectionModelKeys: [], runParticipants: [], aimOffset: {pitch: 0},
    physics: {propsChanged: () => {}, forgetRagdoll: () => true}, damage: {releaseZombie: () => true},
    buildEnemyActor: (sp: ZombieSpawn, _i: number, _seed: number, rand: () => number) => createEnemyActor(sp, lazy, rand, () => new ZombieActor(zombieGltf, sp, rand)),
  });
  const sys = new CorpseSystem(h as never, {enemyIndex: z => enemyIndex.get(z), forgetEnemy: z => { enemyIndex.delete(z); }, cancelUse: () => {}}).install();
  (h as Record<string, unknown>).corpses = sys;
  const ch = new ChipperSystem(h as unknown as ChipperHost, {audio: new SilentAudio(), model: () => null}).install();
  return {...s, h, sys, ch, enemyIndex};
}
type Rig = ReturnType<typeof rig>;

function enter(c: Rig, L: StationLayout, key: SectionKey): void {
  c.h.run.current = key;
  for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L, key, c.h.run, 'prepare');
  for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L, key, c.h.run, 'build');
  build(c.h, L, !c.ride.riding);
}

function leave(c: Rig): void {
  for (const s of c.h.sectionHooks) s.teardown?.();
  for (const z of c.h.zombies.splice(0)) z.root.removeFromParent();
  c.enemyIndex.clear();
}

/** A dead BB (layout enemy `index`, look `variant`) lying in the car at a train-local floor point. */
function deadBb(c: Rig, index: number, lx: number, lz: number, variant: string): EnemyActor {
  const p = c.h.trainPlacement!, w = trainToWorld(p, lx, SPEC.floorY, lz);
  Object.assign(c.h.layout.zombies[index], {archetype: 'bb', variant});
  const sp: ZombieSpawn = {...c.h.layout.zombies[index], x: w.x, z: w.z, yaw: 0};
  const {actor: z, fallback} = createEnemyActor(sp, lazy, rng(index + 3), () => new ZombieActor(zombieGltf, sp, rng(index + 3)));
  expect(fallback).toBe(false);
  z.brain.damage(999, w.x, w.z);
  for (let i = 0; i < 150; i++) { z.animate(1 / 60, 'Death', 0); z.syncTransform(); z.root.position.y = w.y; }
  z.brain.y = w.y;
  z.root.updateMatrixWorld(true);
  c.h.zombies.push(z);
  c.enemyIndex.set(z, index);
  c.h.scene.add(z.root);
  return z;
}

function standIn(c: Rig, lx: number, lz: number, at?: THREE.Vector3): void {
  const p = c.h.trainPlacement!, w = trainToWorld(p, lx, SPEC.floorY, lz);
  c.h.player.spawn(w.x, w.z, 0, w.y);
  if (at) lookAt(c.h, at.x, at.y, at.z); else syncCamera(c.h);
}

const hipsOf = (z: {root: THREE.Object3D}) => z.root.getObjectByName('Hips')!.getWorldPosition(new THREE.Vector3());
const prompt = (c: Rig) => { for (const f of c.h.promptProviders) { const t = f(); if (t) return t; } return null; };

function drawsModel(root: THREE.Object3D, key: string): boolean {
  const geos = new Set<THREE.BufferGeometry>();
  lazy[key].scene.traverse(o => { if ((o as THREE.Mesh).isMesh) geos.add((o as THREE.Mesh).geometry); });
  let hit = false;
  root.traverse(o => { if ((o as THREE.Mesh).isMesh && geos.has((o as THREE.Mesh).geometry)) hit = true; });
  return hit;
}

function lowestSkinned(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  let lo = Infinity;
  root.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 2) { const v = new THREE.Vector3().fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); lo = Math.min(lo, v.applyMatrix4(m.matrixWorld).y); }
  });
  return lo;
}

describe('corpse traits: carrying is every undead body, the chipper only the humanoid ones', () => {
  it('BB is carriable (and sold), never feedable; animals and unknown ids are neither; every feedable archetype is carriable', () => {
    expect(corpseCarriable('bb')).toBe(true);
    expect(corpseFeedable('bb')).toBe(false);
    expect(corpseCarriable('ratdog')).toBe(false);
    for (const id of ['market-trader', 'player', 'human', '']) expect(corpseCarriable(id), id).toBe(false);
    for (const id of Object.keys(ENEMY_ARCHETYPES)) {
      expect(corpseCarriable(id), id).toBe(CORPSE_TRAITS[id as keyof typeof CORPSE_TRAITS].undead);
      if (corpseFeedable(id)) expect(corpseCarriable(id), id).toBe(true);
    }
  });
});

describe('corpses: BB\'s small body (carried, kept, rebuilt; refused by the chipper)', () => {
  it('picked up with its look, carried at the shoulder anchor, saved as carriable (never as a chipper job)', () => {
    const L = SUB(), c = rig(L);
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3;
    const z = deadBb(c, 1, mid + 0.6, 0.2, 'teddy');
    expect(drawsModel(z.root, 'enemy_bb_teddy')).toBe(true);
    standIn(c, mid - 0.6, 0.2, hipsOf(z));
    expect(prompt(c)).toBe(CORPSE_TEXT.pickup);
    press(c.h, 'KeyE');
    const held = c.sys.held()!;
    expect(held).not.toBeNull();
    expect(held.record).toMatchObject({arch: 'bb', variant: 'teddy', pose: 'lying'});
    expect(drawsModel(held.object, 'enemy_bb_teddy')).toBe(true);
    // the pelvis at the shoulder anchor (in the carry frame: the camera's, half its pitch undone)
    c.sys.carry.updateMatrixWorld(true);
    const hips = c.sys.carry.worldToLocal(hipsOf({root: held.object}));
    expect(hips.distanceTo(new THREE.Vector3(CORPSE.anchor.x, CORPSE.anchor.y, CORPSE.anchor.z))).toBeLessThan(0.05);
    // saved held: valid as a carriable body, never as a chipper job
    const carry = structuredClone(c.sys.participant().save());
    expect(carryProblem(carry, corpseCarriable)).toBeNull();
    expect(carryProblem(carry, corpseFeedable)).toMatch(/not a carriable undead body/);
  }, 120000);

  it('the chipper refuses it with its own line (the body stays in the hands, no job)', () => {
    const L = SUB(), c = rig(L), {h} = c;
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3;
    const z = deadBb(c, 1, mid + 0.6, 0.2, 'lullaby');
    standIn(c, mid - 0.6, 0.2, hipsOf(z));
    press(h, 'KeyE');
    const id = c.sys.held()!.record.id;
    const C = chipperPlacement(SPEC)!, A = CHIPPER_ANCHORS.hopper, hop = chipperToLocal(C, A.x, A.y, A.z), f = chipperDirToLocal(C, 0, 0, 1);
    standIn(c, hop.x + f.x * 0.95, hop.z + f.z * 0.95);
    const aim = trainToWorld(h.trainPlacement!, hop.x, hop.y, hop.z);
    lookAt(h, aim.x, aim.y, aim.z);
    expect(prompt(c)).toBe(CHIPPER_TEXT.notAdult);
    press(h, 'KeyE');
    expect(c.sys.held()?.record.id).toBe(id);
    expect(h.playerTrain.chipper.state.job).toBeNull();
  }, 120000);

  it('put down in the train: the cargo keeps it (valid), a rebuild gives the same look, grounded', () => {
    const L = SUB(), c = rig(L), {h} = c;
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3;
    const z = deadBb(c, 1, mid + 0.6, 0.2, 'teddy');
    standIn(c, mid - 0.6, 0.2, hipsOf(z));
    press(h, 'KeyE');
    const id = c.sys.held()!.record.id;
    // face along the aisle (open floor) and put it down
    h.player.yaw = Math.atan2(-h.trainPlacement!.front, 0);
    h.player.pitch = 0;
    syncCamera(h);
    press(h, 'KeyE');
    expect(c.sys.held()).toBeNull();
    const aboard = c.sys.trainBodies();
    expect(aboard.map(r => [r.id, r.arch, r.variant])).toEqual([[id, 'bb', 'teddy']]);
    const cargo = structuredClone(h.playerTrain.participant().save() as {cargo: unknown}).cargo;
    expect(cargoProblem(cargo)).toBeNull();
    expect(CorpseSystem.modelKeys(aboard)).toEqual(['enemy_bb_teddy']);
    // its rebuild (Game.buildEnemyActor): the same look, lying on the car floor (never floating, never sunk)
    const obj = c.sys.buildBody({...aboard[0], x: 0, y: 0, z: 0, q: [0, 0, 0, 1], level: 0, pose: 'lying', bones: undefined, hips: undefined} as BodyRecordJSON)!;
    expect(obj).not.toBeNull();
    expect(drawsModel(obj, 'enemy_bb_teddy')).toBe(true);
    c.sys.disposeBody(obj);
    // a station lane holding it validates as carriable (and only so)
    const lane = {v: 1, here: [{...aboard[0], x: 1, y: 0, z: 1, level: 0}]};
    expect(stationBodiesProblem(lane, corpseCarriable)).toBeNull();
    expect(stationBodiesProblem(lane, corpseFeedable)).toMatch(/not a carriable undead body/);
    leave(c);
  }, 120000);

  it('dropped on the platform: the station lane keeps it and the revisit rebuilds the same look on the floor', () => {
    const L = SUB(), c = rig(L), {h} = c;
    enter(c, L, KA);
    const mid = (I.x0 + I.x1) / 2 - 3;
    const z = deadBb(c, 1, mid + 0.6, 0.2, 'teddy');
    standIn(c, mid - 0.6, 0.2, hipsOf(z));
    press(h, 'KeyE');
    const id = c.sys.held()!.record.id;
    const p = h.trainPlacement!, out = trainToWorld(p, mid, 0, -(SPEC.width / 2 + 1.6));
    h.player.spawn(out.x, out.z, p.front === 1 ? 0 : Math.PI, 0);
    syncCamera(h);
    press(h, 'KeyE');
    expect(h.run.here(KA).map(r => [r.id, r.arch, r.variant])).toEqual([[id, 'bb', 'teddy']]);
    expect(stationBodiesProblem(h.run.laneStore(STATION_BODIES_LANE, KA), corpseCarriable)).toBeNull();
    const floor = h.run.here(KA)[0].y;
    leave(c);
    enter(c, SUB(), KA);
    expect(c.sys.lying.map(b => b.rec.id)).toEqual([id]);
    const root = c.sys.lying[0].actor.root;
    expect(drawsModel(root, 'enemy_bb_teddy')).toBe(true);
    expect(Math.abs(lowestSkinned(root) - floor)).toBeLessThan(0.03);
  }, 120000);
});
