// Task studio-corpse-market-shop-20261114-031614-01: the corpse buyer in a REAL version-4 Survivor Market — the generated den, the real
// level geometry (aim / occlusion), the real corpse system (a body arriving in the hands, the E hand-over to the chute sink), a real
// PickupManager (the ten Rail Ties as one loose item, captured by the station's memory like any dropped item) and the save's strict check.

import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';
import {sectionId, type SectionKey} from '../src/levels/types';
import {ZombieActor} from '../src/ai/zombieActor';
import {createEnemyActor, type EnemyActor} from '../src/ai/creatureArchetypes';
import {corpseCarriable} from '../src/ai/corpseTrait';
import type {BodyRecordJSON} from '../src/corpse/bodyRecord';
import {CORPSE_CARRY_PARTICIPANT} from '../src/corpse/bodyLanes';
import {CorpseSystem} from '../src/world/corpses';
import {CORPSE_SHOP, CORPSE_SHOP_LANE, CORPSE_SHOP_TEXT, corpseShopProblem, type CorpseShopJSON} from '../src/market/corpseShop/shopState';
import {CorpseShop, CORPSE_SHOP_RT, type CorpseShopHost} from '../src/market/corpseShop/corpseShop';
import {PickupManager} from '../src/world/pickups';
import {Inventory} from '../src/items/inventory';
import {RAIL_TIES_ID} from '../src/items/railTies';
import {capturePickups} from '../src/run/worldMemory';
import type {SectionMemory} from '../src/run/memory';
import {sid} from './helpers/saveFixture';
import {build, lookAt, press, run, stationHost} from './helpers/fuelCartsHost';
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
beforeAll(async () => { zombieGltf = await loadStripped('assets/models/zombie-rigged.glb'); }, 120000);

const SEED = 5150;
const MKT = (): StationLayout => LEVELS.market.generate('main', {levelSeed: SEED, layoutVersion: 4});
const KM: SectionKey = {level: 'market', section: 'main', station: sid(3)};
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
}

const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

/** A body from another station, arriving in the hands (the carry participant's record, as after a journey). */
const carried = (id: string, extra: Partial<BodyRecordJSON> = {}): BodyRecordJSON =>
  ({id, arch: 'zombie', seed: 4242, type: 'shambler', pose: 'lying', x: 0.26, y: -0.27, z: -0.2, q: [0, 0, 0, 1], scale: 1, ...extra});

function rig(L: StationLayout) {
  const s = stationHost(L, {build: false});
  live.push(s.rt);
  const h = s.h as unknown as typeof s.h & Record<string, unknown> & {run: FakeRun; zombies: EnemyActor[]; layout: StationLayout; pickups: PickupManager; inv: Inventory};
  const pickups = new PickupManager({});
  h.scene.add(pickups.group);
  Object.assign(h, {
    run: new FakeRun(KM), seed: SEED, rand: rng(99), sectionLayoutHooks: [], sectionModelKeys: [], runParticipants: [], aimOffset: {pitch: 0},
    physics: {propsChanged: () => {}, forgetRagdoll: () => true}, damage: {releaseZombie: () => true}, pickups, inv: new Inventory(),
    propModels: {get: () => undefined}, marketHostility: {hostile: false}, currentTarget: null,
    buildEnemyActor: (sp: ZombieSpawn, _i: number, _seed: number, rand: () => number) => createEnemyActor(sp, {}, rand, () => new ZombieActor(zombieGltf, sp, rand)),
  });
  const sys = new CorpseSystem(h as never, {enemyIndex: () => undefined, forgetEnemy: () => {}, cancelUse: () => {}}).install();
  (h as Record<string, unknown>).corpses = sys;
  const shop = new CorpseShop(h as unknown as CorpseShopHost).install();
  return {...s, h, sys, shop, pickups};
}
type Rig = ReturnType<typeof rig>;

function enter(c: Rig, L: StationLayout): void {
  c.h.run.current = KM;
  for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L, KM, c.h.run, 'prepare');
  for (const f of c.h.sectionLayoutHooks as ((l: StationLayout, k: SectionKey, r: unknown, p: string) => void)[]) f(L, KM, c.h.run, 'build');
  build(c.h, L, false); // (the level fields, then every section hook)
}

/** The player at the den's customer spot, looking at the chute's middle. */
function atChute(c: Rig, L: StationLayout): void {
  const den = L.market!.den!, ch = L.props[den.chute.prop];
  c.h.player.spawn(den.front.x, den.front.z, 0, den.front.y);
  lookAt(c.h, ch.x, den.chute.y + Math.min(0.5, ch.h / 2), ch.z);
}

describe('corpse buyer in a real version-4 Market', () => {
  it('the den is there: the chute and booth props, the buyer behind the booth (the customer\'s spot and the tray in front of it)', () => {
    const L = MKT();
    expect(L.market?.v).toBe(4);
    const den = L.market!.den!, booth = L.props[den.booth.prop];
    expect(L.props[den.chute.prop].kind).toBe('corpseChute');
    expect(booth.kind).toBe('corpseBooth');
    // the booth's front (its prop's +Z): the customer and the tray on it, the buyer behind
    const fx = Math.sin(booth.rot), fz = Math.cos(booth.rot), side = (p: {x: number; z: number}) => (p.x - booth.x) * fx + (p.z - booth.z) * fz;
    expect(side(den.front)).toBeGreaterThan(0.5);
    expect(side(den.booth.tray)).toBeGreaterThan(0.2);
    expect(side(den.buyer)).toBeLessThan(-0.3);
  });

  it('a body carried in is sold with E at the chute: one Rail Ties pickup lands in front of the booth, remembered with the station', () => {
    const L = MKT(), c = rig(L), {h} = c;
    c.sys.participant().load({v: 1, held: carried('st-01:main#4')});
    enter(c, L);
    expect(c.sys.held()?.record.id).toBe('st-01:main#4');
    atChute(c, L);
    const line = () => { for (const f of h.promptProviders as (() => string | null)[]) { const t = f(); if (t) return t; } return null; };
    expect(line()).toBe(CORPSE_SHOP_TEXT.sell);
    press(h, 'KeyE');
    expect(c.sys.held()).toBeNull();
    const rec = h.run.laneStore<CorpseShopJSON>(CORPSE_SHOP_LANE, KM)!;
    expect(rec.job?.body.id).toBe('st-01:main#4');
    expect(corpseShopProblem(JSON.parse(JSON.stringify(rec)), corpseCarriable)).toBeNull();
    // the hands' saved record is empty now: the body is in exactly one place
    expect((c.sys.participant().save() as {held: unknown}).held).toBeNull();
    run(h, CORPSE_SHOP.saleMs / 1000 + 0.3);
    const ties = c.pickups.list.filter(p => p.stack.itemId === RAIL_TIES_ID);
    expect(ties.map(p => p.stack.count)).toEqual([10]);
    const den = L.market!.den!;
    expect(Math.hypot(ties[0].x - den.booth.tray.x, ties[0].z - den.booth.tray.z)).toBeLessThan(0.4);
    expect(h.run.laneStore<CorpseShopJSON>(CORPSE_SHOP_LANE, KM)).toMatchObject({done: 1, job: null, sold: ['st-01:main#4']});
    // the station's memory captures it like any dropped item (Game.saveSectionMemory)
    const mem = capturePickups(c.pickups.list, () => undefined).filter(r => r.stack.itemId === RAIL_TIES_ID);
    expect(mem.map(r => r.stack.count)).toEqual([10]);
    // the player can take it: the pickup is aimed at from the customer's spot (in sight, in reach)
    h.player.spawn(den.front.x, den.front.z, 0, den.front.y);
    lookAt(h, ties[0].x, ties[0].y + 0.05, ties[0].z);
    const eye = new THREE.Vector3(), dir = new THREE.Vector3();
    h.camera.getWorldPosition(eye);
    h.camera.getWorldDirection(dir);
    expect(c.pickups.target(eye, dir, h.levels as never)).toBe(ties[0]);
    expect(h.run.memory(KM).lanes[CORPSE_CARRY_PARTICIPANT]).toBeUndefined();
  }, 120000);

  it('over a seed sweep (both mirror states, the quarter-turned chute of the shallow rooms): sold from the customer\'s spot, the mouth inside the chute, every payout spot in sight', () => {
    const rots = new Set<number>(), sides = new Set<boolean>();
    for (const seed of [1, 2, 5, 8, 13, 42, 68, 78, 85, 777]) { // (68 / 85 east, 78 west: the shallow room's quarter-turned chute)
      const L = LEVELS.market.generate('main', {levelSeed: seed, layoutVersion: 4}), den = L.market!.den!, ch = L.props[den.chute.prop];
      const c = rig(L), {h} = c, at = `seed ${seed}`;
      enter(c, L);
      rots.add(Math.round((((ch.rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2)) % 4);
      sides.add(den.door.x > 25);
      // the dark mouth lies inside the chute's footprint
      const m = c.shop.throat()!;
      expect(Math.abs(m.x - ch.x), at).toBeLessThan(ch.hx);
      expect(Math.abs(m.z - ch.z), at).toBeLessThan(ch.hz);
      // from the customer's spot, looking at the chute: in reach, the sell line
      c.sys.participant().load({v: 1, held: carried(`st-01:main#${seed}`)});
      enter(c, L);
      atChute(c, L);
      expect(c.shop.aim(CORPSE_SHOP_RT.look), at).toMatchObject({what: 'chute'});
      expect(c.shop.aim(CORPSE_SHOP_RT.look).chuteDist, at).toBeLessThanOrEqual(CORPSE_SHOP_RT.reach);
      expect(c.shop.offer(c.sys.held()!), at).toEqual({ok: true, text: CORPSE_SHOP_TEXT.sell});
      // every payout spot: near the tray, nothing between the customer's eye and the bundle
      const eye = new THREE.Vector3(den.front.x, den.front.y + 1.62, den.front.z);
      for (let uid = 1; uid <= CORPSE_SHOP_RT.spots.length; uid++) {
        const p = c.shop.landing(uid);
        expect(Math.hypot(p.x - den.booth.tray.x, p.z - den.booth.tray.z), `${at} spot ${uid}`).toBeLessThan(0.35);
        const d = new THREE.Vector3(p.x, p.y + 0.06, p.z).sub(eye), len = d.length();
        d.normalize();
        const hit = (h.levels as unknown as {raycast(o: unknown, d: unknown, m: number, opts?: unknown): {kind: string; t: number}}).raycast(eye, d, len, {props: L.props});
        expect(hit.kind === 'none' || hit.t >= len - 0.05, `${at} spot ${uid} in sight (${hit.kind} at ${hit.t})`).toBe(true);
      }
      for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); }
    }
    expect(sides).toEqual(new Set([false, true]));
    expect(rots.size, `chute quarter turns seen: ${[...rots]}`).toBeGreaterThan(1);
  }, 120000);
});
