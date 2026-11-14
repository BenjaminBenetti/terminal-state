// Task studio-corpse-market-shop-20261114-031614-01: THE MARKET CORPSE BUYER — the pure sale record (market/corpseShop/shopState.ts), the
// runtime on a fake host with a hand-made den (market/corpseShop/corpseShop.ts: the chute sink, the swallow, the physical Rail Ties drop that
// becomes ONE world pickup, a load mid-sale, the hostile booth, the loot-spill seam, the look-at line), the buyer actor (the real cooked
// GLB: his post and facing, Idle / Greet / Work, dark while hostile, the bounded stare) and the save validation's one-body-one-place
// checks over the sale and the bought ids.

import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {CORPSE_BUYER_MODEL} from '../src/assets/corpseBuyer.generated';
import {CORPSE_SHOP_KIT} from '../src/assets/corpseShopKit.generated';
import type {HumanActor} from '../src/market/humanActor';
import {corpseCarriable} from '../src/ai/corpseTrait';
import type {BodyRecordJSON} from '../src/corpse/bodyRecord';
import type {BodySink, HeldBody} from '../src/corpse/api';
import {CORPSE_CARRY_PARTICIPANT, STATION_BODIES_LANE} from '../src/corpse/bodyLanes';
import {advanceSale, copyCorpseShop, CORPSE_SHOP, CORPSE_SHOP_LANE, CORPSE_SHOP_TEXT, corpseShopProblem, corpseShopRefusal, freshCorpseShop, salePhase, startSale,
  type CorpseShopJSON} from '../src/market/corpseShop/shopState';
import {CorpseShop, CORPSE_SHOP_RT, corpseBuyerModelKeys, type CorpseShopHost} from '../src/market/corpseShop/corpseShop';
import type {MarketDen, MarketLayout} from '../src/gen/market/marketTypes';
import type {PropPlacement} from '../src/gen/props';
import {sectionId, type SectionKey} from '../src/levels/types';
import type {ItemStack} from '../src/items/inventory';
import {RAIL_TIES_ID} from '../src/items/railTies';
import {checksumOf} from '../src/save/checksum';
import {validateSaveFile} from '../src/save/validate';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';

const rec = (id: string, extra: Partial<BodyRecordJSON> = {}): BodyRecordJSON =>
  ({id, arch: 'zombie', seed: 4242, type: 'shambler', pose: 'lying', x: 3, y: 0, z: 5, q: [0, 0, 0, 1], level: 0, scale: 1.01, ...extra});
const held = (id: string, extra: Partial<BodyRecordJSON> = {}): BodyRecordJSON => {
  const r = rec(id, {x: 0.26, y: -0.27, z: -0.2, q: [0, 0.38268, 0, 0.92388], ...extra});
  delete r.level;
  return r;
};

describe('corpse buyer: the sale record (pure)', () => {
  it('a sale takes the body as its only copy; completion consumes it, counts it and names it sold in ONE call, exactly once', () => {
    const c = freshCorpseShop();
    expect(corpseShopProblem(c, corpseCarriable)).toBeNull();
    const job = startSale(c, rec('st-01:main#4'));
    expect(job).toMatchObject({uid: 1, ms: 0});
    expect(c.seq).toBe(2);
    expect(corpseShopProblem(c, corpseCarriable)).toBeNull();
    expect(advanceSale(c, CORPSE_SHOP.saleMs - 1)).toBeNull();
    expect(c.job?.ms).toBe(CORPSE_SHOP.saleMs - 1);
    expect(corpseShopProblem(JSON.parse(JSON.stringify(c)), corpseCarriable)).toBeNull();
    const pay = advanceSale(c, 1);
    expect(pay).toEqual({uid: 1, id: 'st-01:main#4', ties: CORPSE_SHOP.price});
    expect(c).toEqual({v: 1, seq: 2, done: 1, last: 1, job: null, sold: ['st-01:main#4']});
    expect(advanceSale(c, 10000)).toBeNull(); // (nothing left to pay)
    expect(corpseShopProblem(c, corpseCarriable)).toBeNull();
    expect(CORPSE_SHOP.price).toBe(10); // (the approved flat price)
  });

  it('refusals: hostile -> closed, a running sale -> busy; never the same body twice', () => {
    const c = freshCorpseShop();
    expect(corpseShopRefusal(c, {hostile: false})).toBeNull();
    expect(corpseShopRefusal(c, {hostile: true})).toBe(CORPSE_SHOP_TEXT.closed);
    startSale(c, rec('st-01:main#4'));
    expect(corpseShopRefusal(c, {hostile: false})).toBe(CORPSE_SHOP_TEXT.busy);
    expect(() => startSale(c, rec('st-01:main#5'))).toThrow();
    advanceSale(c, CORPSE_SHOP.saleMs);
    expect(() => startSale(c, rec('st-01:main#4'))).toThrow(/already sold/);
  });

  it('the phases follow the clock; the sold list keeps the newest ids only (bounded)', () => {
    expect(salePhase(0)).toBe('swallow');
    expect(salePhase(CORPSE_SHOP.swallowMs)).toBe('count');
    expect(salePhase(CORPSE_SHOP.dropMs)).toBe('drop');
    const c = freshCorpseShop();
    for (let i = 0; i < CORPSE_SHOP.soldKeep + 6; i++) { startSale(c, rec(`st-01:main#${i}`)); advanceSale(c, CORPSE_SHOP.saleMs); }
    expect(c.done).toBe(CORPSE_SHOP.soldKeep + 6);
    expect(c.sold.length).toBe(CORPSE_SHOP.soldKeep);
    expect(c.sold[0]).toBe('st-01:main#6');
    expect(corpseShopProblem(c, corpseCarriable)).toBeNull();
    const k = copyCorpseShop(c);
    k.sold.push('x');
    expect(c.sold.length).toBe(CORPSE_SHOP.soldKeep); // (a deep copy)
  });

  it('strict: every undead body (BB too) is accepted, animals / unknown fields / broken counters are not', () => {
    const base = (): CorpseShopJSON => ({v: 1, seq: 3, done: 1, last: 1, job: {uid: 2, body: rec('st-02:main#9', {arch: 'bb', variant: 'teddy'}), ms: 1200}, sold: ['st-01:main#4']});
    expect(corpseShopProblem(base(), corpseCarriable)).toBeNull();
    const bad = (m: (o: CorpseShopJSON & Record<string, unknown>) => void) => { const o = base() as CorpseShopJSON & Record<string, unknown>; m(o); return corpseShopProblem(o, corpseCarriable); };
    expect(bad(o => { o.job!.body.arch = 'ratdog'; })).toMatch(/not a carriable/);
    expect(bad(o => { o.extra = 1; })).toMatch(/unexpected/);
    expect(bad(o => { o.v = 2 as 1; })).toMatch(/version/);
    expect(bad(o => { o.job!.ms = CORPSE_SHOP.saleMs; })).toMatch(/progress/);
    expect(bad(o => { o.job!.uid = 1; })).toMatch(/uid/);
    expect(bad(o => { o.done = 3; })).toMatch(/more bodies/);
    expect(bad(o => { o.sold.push('st-01:main#4'); })).toMatch(/twice|never more/);
    expect(bad(o => { o.sold = ['st-02:main#9']; })).toMatch(/again/);
    expect(bad(o => { o.sold = ['nope']; })).toMatch(/identity/);
    expect(bad(o => { delete (o.job!.body as Partial<BodyRecordJSON>).level; })).toMatch(/storey/);
    expect(bad(o => { o.job!.body.x = 2e6; })).toMatch(/out of range/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The runtime on a fake host: a den with its chute 1.6 m in front of the booth (the booth faces -Z), the buyer behind it

const KEY: SectionKey = {level: 'market', section: 'main', station: sid(3)};
const prop = (kind: string, x: number, z: number, rot: number, hx: number, hz: number, h: number): PropPlacement =>
  ({kind, x, z, y: 0, rot, area: 0, hx, hz, h, blocksSight: false, variant: 0} as unknown as PropPlacement);
const DEN: MarketDen = {
  area: 0, back: 1,
  door: {x0: 0, z0: 0, x1: 1, z1: 1, x: 0.5, z: 0.5, y: 0, level: 0},
  chute: {prop: 0, x: 3, z: 5, y: 0, level: 0, yaw: 0, rimY: 0.54},
  booth: {prop: 1, x: 3, z: 7, y: 0, level: 0, yaw: Math.PI, tray: {x: 3, z: 6.35, y: 0, level: 0}},
  buyer: {x: 3, z: 7.6, y: 0, level: 0, yaw: 0},
  front: {x: 2.2, z: 6.0, y: 0, level: 0},
};
const LAYOUT = (): {market: MarketLayout; props: PropPlacement[]} => ({
  market: {v: 4, stalls: [], spots: [], residents: 0, den: structuredClone(DEN)},
  props: [prop('corpseChute', 3, 5, 0, 0.475, 0.475, 1.15), prop('corpseBooth', 3, 7, Math.PI, 1.0, 0.225, 2.2)],
});

class FakeRun {
  readonly lanes = new Map<string, Record<string, unknown>>();
  constructor(public current: SectionKey) {}
  laneStore<T = unknown>(lane: string, key: SectionKey = this.current): T | undefined { return this.lanes.get(sectionId(key))?.[lane] as T | undefined; }
  setLaneStore(lane: string, data: unknown, key: SectionKey = this.current): void {
    const id = sectionId(key);
    const m = this.lanes.get(id) ?? {};
    this.lanes.set(id, m);
    if (data === undefined) delete m[lane]; else m[lane] = data;
  }
}

/** A lying body's bones (the head toward its root's -Z, like the authored deaths). */
function fakeBody(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'body';
  for (const [n, x, y, z] of [['Hips', 0, 0.15, 0], ['Head', 0, 0.15, -0.8], ['L_Foot', 0.1, 0.1, 0.9], ['R_Foot', -0.1, 0.1, 0.9], ['L_Hand', 0.3, 0.12, -0.2], ['R_Hand', -0.3, 0.12, -0.2]] as const) {
    const b = new THREE.Bone();
    b.name = n;
    b.position.set(x, y, z);
    root.add(b);
  }
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 1.8), new THREE.MeshBasicMaterial()));
  return root;
}

function shopHost(o: {run?: FakeRun; loot?: (b: BodyRecordJSON) => ItemStack[]; models?: Record<string, GLTF>} = {}) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
  scene.add(camera);
  const adds: {stack: ItemStack; x: number; y: number; z: number; jobAtAdd: boolean}[] = [], toasts: string[] = [], disposed: THREE.Object3D[] = [], sinks: BodySink[] = [];
  let uid = 1;
  let holding: HeldBody | null = null;
  const h = {
    scene, camera, player: {x: 3, y: 0, z: 3.6, alive: true}, state: 'playing',
    hud: {toast: (t: string) => { toasts.push(t); }},
    run: o.run ?? new FakeRun(KEY),
    layout: LAYOUT(),
    levels: null,
    pickups: {
      add: (stack: ItemStack, x: number, y: number, z: number) => { adds.push({stack, x, y, z, jobAtAdd: !!shop.record()?.job}); return {}; },
      meshFor: () => new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 1), new THREE.MeshBasicMaterial()),
    },
    inv: {makeStack: (itemId: string, count: number): ItemStack => ({uid: uid++, itemId, count})},
    propModels: {get: (k: string) => o.models?.[k]},
    corpses: {held: () => holding, addSink: (s: BodySink) => { sinks.push(s); }, buildBody: () => fakeBody(), disposeBody: (obj: THREE.Object3D) => { disposed.push(obj); obj.removeFromParent(); }},
    marketHostility: {hostile: false},
    currentTarget: null as unknown,
    frameHooks: [], sectionHooks: [], sectionModelKeys: [], promptProviders: [],
    corpseLoot: o.loot,
  };
  const shop = new CorpseShop(h as unknown as CorpseShopHost).install();
  const look = (x: number, y: number, z: number) => { camera.position.set(h.player.x, 1.6, h.player.z); camera.lookAt(x, y, z); camera.updateMatrixWorld(true); };
  const hold = (r: BodyRecordJSON) => { const obj = fakeBody(); camera.add(obj); holding = {record: r, object: obj}; return holding; };
  const frames = (s: number) => { for (let t = 0; t < s; t += 1 / 60) for (const f of h.frameHooks as ((dt: number) => void)[]) f(1 / 60); };
  return {h, shop, adds, toasts, disposed, sinks, look, hold, frames, release: () => { holding = null; }};
}

/** The corpse system's hand-over (world/corpses.ts toSink): the first sink that offers, its take(). */
function sell(s: ReturnType<typeof shopHost>, body: HeldBody): boolean {
  const offer = s.shop.offer(body);
  if (!offer?.ok) return false;
  const ok = s.shop.take(body);
  if (ok) s.release();
  return ok;
}

describe('corpse buyer: the den runtime (fake host)', () => {
  it('only a v4 layout with a den fetches the buyer; without one everything is inert', () => {
    expect(corpseBuyerModelKeys({market: {den: DEN}})).toEqual(['market_corpseBuyer']);
    expect(corpseBuyerModelKeys({market: {}})).toEqual([]);
    expect(corpseBuyerModelKeys({})).toEqual([]);
    const s = shopHost();
    for (const b of s.h.sectionHooks as {build(l: unknown): void}[]) b.build({market: {v: 3, stalls: [], spots: [], residents: 0}, props: []});
    expect(s.shop.den).toBeNull();
    s.look(3, 0.5, 5);
    expect(s.shop.offer(s.hold(held('st-01:main#4')))).toBeNull();
  });

  it('the chute\'s open throat gets a dark shaft mouth (placed like the model: turned with the prop); the body goes down through it', () => {
    const L = LAYOUT();
    L.props[0].rot = Math.PI / 2; // (the chute turned a quarter: its throat's +z offset now points +x)
    const s = shopHost();
    s.h.layout = L;
    for (const b of s.h.sectionHooks as {build(l: unknown): void}[]) b.build(L);
    const [x0, x1, z0, z1] = CORPSE_SHOP_KIT.chute.throat;
    const t = s.shop.throat()!;
    expect(t.x).toBeCloseTo(3 + (z0 + z1) / 2, 6);
    expect(t.z).toBeCloseTo(5 - (x0 + x1) / 2, 6);
    const mouth = s.h.scene.getObjectByName('corpse-chute-mouth') as THREE.Mesh;
    expect(mouth).toBeTruthy();
    const box = new THREE.Box3().setFromObject(mouth);
    expect(box.max.y - box.min.y).toBeLessThan(1e-6);
    expect(box.min.y).toBeGreaterThan(0); expect(box.min.y).toBeLessThan(0.01); // (just over the floor)
    // its long side (the throat's z) along world x after the quarter turn, grown over the throat on every side
    expect(box.max.x - box.min.x).toBeCloseTo(z1 - z0 + 2 * CORPSE_SHOP_RT.mouthGrow, 4);
    expect(box.max.z - box.min.z).toBeCloseTo(x1 - x0 + 2 * CORPSE_SHOP_RT.mouthGrow, 4);
    expect((mouth.material as THREE.MeshBasicMaterial).color.getHex()).toBeLessThan(0x101010);
    // the swallowed body ends over the throat's middle
    s.look(3, 0.5, 5);
    const body = s.hold(held('st-01:main#4'));
    expect(sell(s, body)).toBe(true);
    s.frames(CORPSE_SHOP.swallowMs * CORPSE_SHOP_RT.lift / 1000 + 0.05);
    const hips = body.object.getObjectByName('Hips')!.getWorldPosition(new THREE.Vector3());
    expect(Math.hypot(hips.x - t.x, hips.z - t.z)).toBeLessThan(0.35);
    // leaving the station: gone with the rest of the den's visuals
    s.shop.teardown();
    expect(s.h.scene.getObjectByName('corpse-chute-mouth')).toBeUndefined();
  });

  it('sold at the chute: the hands empty in the same call, the body down the shaft, ten Rail Ties land as ONE world pickup, once', () => {
    const s = shopHost();
    for (const b of s.h.sectionHooks as {build(l: unknown): void}[]) b.build(s.h.layout);
    s.frames(0.05);
    expect(s.sinks).toContain(s.shop.sink); // (registered with the corpse system)
    // looking elsewhere: not ours
    s.look(9, 0.5, 5);
    const body = s.hold(held('st-01:main#4'));
    expect(s.shop.offer(body)).toBeNull();
    // at the chute: the price on the prompt
    s.look(3, 0.5, 5);
    expect(s.shop.offer(body)).toEqual({ok: true, text: CORPSE_SHOP_TEXT.sell});
    expect(CORPSE_SHOP_TEXT.sell).toContain('10 Rail Ties');
    expect(sell(s, body)).toBe(true);
    const r = s.h.run.laneStore<CorpseShopJSON>(CORPSE_SHOP_LANE, KEY)!;
    expect(r.job?.body).toMatchObject({id: 'st-01:main#4', pose: 'lying', x: 3, z: 5, y: 0, level: 0});
    expect(corpseShopProblem(r, corpseCarriable)).toBeNull();
    expect(body.object.parent).toBe(s.h.scene); // (the buyer's visual now: out of the carry frame)
    // a second body while he deals with the first: refused, kept
    const second = s.hold(held('st-01:main#5'));
    expect(s.shop.offer(second)).toEqual({ok: false, text: CORPSE_SHOP_TEXT.busy});
    expect(s.shop.take(second)).toBe(false);
    // the swallow: head-down over the mouth, then below the floor; disposed once the swallow ends
    s.frames(CORPSE_SHOP.swallowMs * CORPSE_SHOP_RT.lift / 1000 + 0.05);
    const head = body.object.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3());
    const hips = body.object.getObjectByName('Hips')!.getWorldPosition(new THREE.Vector3());
    expect(head.y).toBeLessThan(hips.y); // head first
    expect(Math.hypot(hips.x - 3, hips.z - 5)).toBeLessThan(0.5); // over the mouth
    s.frames((CORPSE_SHOP.swallowMs * (1 - CORPSE_SHOP_RT.lift)) / 1000 - 0.1);
    const box = new THREE.Box3().setFromObject(body.object);
    expect(box.max.y).toBeLessThan(0.3); // nearly gone down the shaft
    s.frames(0.2);
    expect(s.disposed).toEqual([body.object]);
    expect(s.shop.qa().body).toBe(false);
    // the count, then the drop: a bundle visual falling, no pickup yet
    s.frames((CORPSE_SHOP.dropMs - CORPSE_SHOP.swallowMs) / 1000 + 0.1);
    expect(s.shop.qa().ties).toBe(true);
    expect(s.adds).toEqual([]);
    expect(s.h.run.laneStore<CorpseShopJSON>(CORPSE_SHOP_LANE, KEY)!.done).toBe(0);
    // it lands: the sale completes and the ties are ONE pickup on the floor in front of the booth, in the same step
    s.frames((CORPSE_SHOP.saleMs - CORPSE_SHOP.dropMs) / 1000);
    expect(s.adds.length).toBe(1);
    expect(s.adds[0].stack).toMatchObject({itemId: RAIL_TIES_ID, count: 10});
    expect(s.adds[0].jobAtAdd).toBe(false); // (the record was already settled when the pickup appeared)
    expect(Math.hypot(s.adds[0].x - DEN.booth.tray.x, s.adds[0].z - DEN.booth.tray.z)).toBeLessThan(0.35);
    expect(s.adds[0].y).toBe(0);
    expect(s.h.run.laneStore<CorpseShopJSON>(CORPSE_SHOP_LANE, KEY)).toEqual({v: 1, seq: 2, done: 1, last: 1, job: null, sold: ['st-01:main#4']});
    expect(s.toasts).toContain(CORPSE_SHOP_TEXT.sold);
    expect(s.shop.qa().ties).toBe(false);
    s.frames(5);
    expect(s.adds.length).toBe(1); // never twice
    // the next body lands on the next spot (bundles lie side by side, not stacked)
    s.look(3, 0.5, 5);
    expect(sell(s, s.hold(held('st-01:main#5')))).toBe(true);
    s.frames(CORPSE_SHOP.saleMs / 1000 + 0.2);
    expect(s.adds.length).toBe(2);
    expect(Math.hypot(s.adds[1].x - s.adds[0].x, s.adds[1].z - s.adds[0].z)).toBeGreaterThan(0.2);
  });

  it('every undead body sells (BB too, its look kept); a body that is not undead never does; a hostile settlement shuts the booth', () => {
    const s = shopHost();
    for (const b of s.h.sectionHooks as {build(l: unknown): void}[]) b.build(s.h.layout);
    s.look(3, 0.5, 5);
    expect(s.shop.offer(s.hold(held('st-01:main#7', {arch: 'ratdog' as never})))).toEqual({ok: false, text: CORPSE_SHOP_TEXT.notUndead});
    s.h.marketHostility.hostile = true;
    const bb = s.hold(held('st-01:main#8', {arch: 'bb', variant: 'binky', scale: 1}));
    expect(s.shop.offer(bb)).toEqual({ok: false, text: CORPSE_SHOP_TEXT.closed});
    expect(s.shop.take(bb)).toBe(false);
    s.h.marketHostility.hostile = false;
    expect(sell(s, bb)).toBe(true);
    expect(s.h.run.laneStore<CorpseShopJSON>(CORPSE_SHOP_LANE, KEY)!.job!.body).toMatchObject({arch: 'bb', variant: 'binky'});
    for (const arch of ['strainer', 'blightbelly', 'siren', 'screacher'] as const) expect(corpseCarriable(arch), arch).toBe(true);
  });

  it('loot a body still holds is spilled as pickups at the customer\'s spot BEFORE the body is consumed (the seam)', () => {
    const stacks: ItemStack[] = [{uid: 900, itemId: 'bandage', count: 1}, {uid: 901, itemId: 'scrap_metal', count: 2}];
    const s = shopHost({loot: () => stacks});
    for (const b of s.h.sectionHooks as {build(l: unknown): void}[]) b.build(s.h.layout);
    s.look(3, 0.5, 5);
    expect(sell(s, s.hold(held('st-01:main#4')))).toBe(true);
    expect(s.adds.map(a => a.stack)).toEqual(stacks);
    expect(s.adds.every(a => !a.jobAtAdd)).toBe(true); // (dropped before the sale took the body)
    expect(s.adds.every(a => Math.hypot(a.x - DEN.front.x, a.z - DEN.front.z) < 0.4)).toBe(true);
    expect(s.shop.qa().counts.spilled).toBe(2);
  });

  it('a save mid-sale resumes where it stood (the body rebuilt mid-swallow), pays exactly once; teardown keeps the record', () => {
    for (const at of [800, CORPSE_SHOP.dropMs + 200]) {
      const a = shopHost();
      for (const b of a.h.sectionHooks as {build(l: unknown): void}[]) b.build(a.h.layout);
      a.look(3, 0.5, 5);
      expect(sell(a, a.hold(held('st-01:main#4')))).toBe(true);
      a.frames(at / 1000);
      // leave the station (teardown: visuals go, the record stays), "save": the lane as JSON
      for (const t of a.h.sectionHooks as {teardown(): void}[]) t.teardown();
      const saved = JSON.parse(JSON.stringify(a.h.run.laneStore(CORPSE_SHOP_LANE, KEY))) as CorpseShopJSON;
      expect(saved.job?.ms).toBeGreaterThan(at - 50);
      expect(a.adds).toEqual([]);
      // "load" into a fresh game
      const run = new FakeRun(KEY);
      run.setLaneStore(CORPSE_SHOP_LANE, saved, KEY);
      const b = shopHost({run});
      for (const x of b.h.sectionHooks as {build(l: unknown): void}[]) x.build(b.h.layout);
      b.frames(0.1);
      expect(b.shop.qa().counts.rebuilt).toBe(at < CORPSE_SHOP.swallowMs ? 1 : 0);
      b.frames(CORPSE_SHOP.saleMs / 1000);
      expect(b.adds.length).toBe(1);
      expect(b.adds[0].stack).toMatchObject({itemId: RAIL_TIES_ID, count: 10});
      expect(run.laneStore<CorpseShopJSON>(CORPSE_SHOP_LANE, KEY)).toMatchObject({done: 1, job: null, sold: ['st-01:main#4']});
      // the abandoned session never pays
      a.frames(CORPSE_SHOP.saleMs / 1000);
      expect(a.adds).toEqual([]);
    }
  });

  it('the look-at line: what he buys and for how much; never over a loose item\'s Take or the carry\'s own prompt', () => {
    const s = shopHost();
    for (const b of s.h.sectionHooks as {build(l: unknown): void}[]) b.build(s.h.layout);
    const line = () => { for (const f of s.h.promptProviders as (() => string | null)[]) { const t = f(); if (t) return t; } return null; };
    s.look(3, 0.5, 5);
    expect(line()).toBe(CORPSE_SHOP_TEXT.hint);
    expect(CORPSE_SHOP_TEXT.hint).toMatch(/10 Rail Ties/);
    expect(CORPSE_SHOP_TEXT.hint).toMatch(/sells nothing/);
    s.look(3, 1.6, 7); // the booth
    expect(line()).toBe(CORPSE_SHOP_TEXT.hint);
    s.h.currentTarget = {};
    expect(line()).toBeNull();
    s.h.currentTarget = null;
    s.hold(held('st-01:main#4'));
    expect(line()).toBeNull();
    s.release();
    s.h.marketHostility.hostile = true;
    expect(line()).toBe(CORPSE_SHOP_TEXT.closed);
    s.look(9, 0.5, -5);
    expect(line()).toBeNull();
  });
});

describe('corpse buyer: the actor (the real cooked buyer through the unchanged HumanWardrobe)', () => {
  let gltf: GLTF;
  beforeAll(async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(fileURLToPath(new URL('../public/' + CORPSE_BUYER_MODEL.url, import.meta.url)));
    for (const t of doc.getRoot().listTextures()) t.dispose(); // (node has no image decoder)
    const bin = await io.writeBinary(doc);
    gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
  }, 120_000);

  /** World yaw (atan2(x, z) of +Z) of a bone or the root: the model faces +Z. */
  const facing = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); const f = new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld); return Math.atan2(f.x, f.z); };
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  it('stands behind the booth facing the customer, idles, greets a sale, works the count, goes dark while hostile', () => {
    const s = shopHost({models: {[CORPSE_BUYER_MODEL.key]: gltf}});
    for (const b of s.h.sectionHooks as {build(l: unknown): void}[]) b.build(s.h.layout);
    s.frames(0.1);
    const a = (s.shop as unknown as {buyer: HumanActor}).buyer;
    expect(s.shop.qa()).toMatchObject({buyer: true, buyerVisible: true, buyerClip: 'Idle'});
    expect(a.root.parent).toBe(s.h.scene);
    expect([a.root.position.x, a.root.position.y, a.root.position.z]).toEqual([DEN.buyer.x, DEN.buyer.y, DEN.buyer.z]);
    // the contract's yaw 0 faces -Z: across the booth (z 7) toward the chute (z 5)
    expect(Math.abs(wrap(facing(a.root) - Math.PI))).toBeLessThan(1e-6);
    // a sale: the greeting, then the count's Work loop once the body is down
    s.look(3, 0.5, 5);
    expect(sell(s, s.hold(held('st-01:main#4')))).toBe(true);
    expect(a.current).toBe('Greet');
    s.frames(CORPSE_SHOP.swallowMs / 1000 + 0.1);
    expect(a.loop).toBe('Work');
    s.frames((CORPSE_SHOP.saleMs - CORPSE_SHOP.swallowMs) / 1000 + 2);
    expect(s.shop.qa()).toMatchObject({buyerClip: 'Idle', record: {done: 1, job: null}});
    // the settlement turns hostile: the booth goes dark (he is never a fighter), back at his post after
    s.h.marketHostility.hostile = true;
    s.frames(0.1);
    expect(s.shop.qa().buyerVisible).toBe(false);
    s.h.marketHostility.hostile = false;
    s.frames(0.1);
    expect(s.shop.qa().buyerVisible).toBe(true);
    // teardown (leaving the station) removes him from the scene
    s.shop.teardown();
    expect(a.root.parent).toBeNull();
    expect(s.shop.qa().buyer).toBe(false);
  });

  it('the stare: his head turns toward the player, bounded, and never accumulates over a long wait', () => {
    const s = shopHost({models: {[CORPSE_BUYER_MODEL.key]: gltf}});
    for (const b of s.h.sectionHooks as {build(l: unknown): void}[]) b.build(s.h.layout);
    s.frames(0.1);
    const a = (s.shop as unknown as {buyer: HumanActor}).buyer, head = a.bone('Head')!;
    const turn = () => wrap(facing(head) - facing(a.root));
    /**
     * The head's turn with the player standing at (x, z): min / max / mean over the last whole Idle cycle (the clip sways the head
     * itself; a whole cycle's mean is phase-free), after the smoothing has settled.
     */
    const cycle = Math.round(a.duration('Idle') * 60);
    expect(cycle).toBeGreaterThan(30);
    const sample = (x: number, z: number, secs: number) => {
      s.h.player.x = x; s.h.player.z = z;
      const v: number[] = [];
      for (let t = 0; t < secs; t += 1 / 60) { for (const f of s.h.frameHooks as ((dt: number) => void)[]) f(1 / 60); v.push(turn()); }
      const tail = v.slice(-cycle);
      return {min: Math.min(...tail), max: Math.max(...tail), mean: tail.reduce((p, q) => p + q, 0) / tail.length};
    };
    const S = 3 + 2 * cycle / 60;
    const ahead = sample(3, 5, S);
    // the player off to his side (+X, about 60 degrees off his facing): the head follows, by a bounded turn
    const side = sample(3 + 2.4, 7.6 - 1.4, S);
    const want = Math.sign(wrap(Math.atan2(2.4, -1.4) - facing(a.root)));
    expect((side.mean - ahead.mean) * want).toBeGreaterThan(0.5);
    expect(Math.abs(side.mean - ahead.mean)).toBeLessThanOrEqual(CORPSE_SHOP_RT.stare + 0.05);
    // directly behind him (out of a neck's reach): still capped
    const behind = sample(3, 7.6 + 2, S);
    expect(Math.abs(behind.mean - ahead.mean)).toBeLessThanOrEqual(CORPSE_SHOP_RT.stare + 0.05);
    // a long wait at the side: the same band, never a growing spin
    const later = sample(3 + 2.4, 7.6 - 1.4, 4 * S);
    expect(Math.abs(later.mean - side.mean)).toBeLessThan(0.1);
    expect(later.max - later.min).toBeLessThan(side.max - side.min + 0.1);
    // out of range: he settles back to the clip's own head
    const away = sample(3, 7.6 - 20, S);
    expect(Math.abs(away.mean - ahead.mean)).toBeLessThan(0.1);
  });
});

describe('corpse buyer: save validation (one body, one place)', () => {
  it('the sale\'s body and the bought ids are each in no other place; a valid record saves and loads', () => {
    const MK: SectionKey = {level: 'subway', section: 'main', station: sid(1)};
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    hs.run.current = MK;
    hs.run.memory().visits = 1;
    const heldBody: BodyRecordJSON | null = held('st-01:main#7');
    hs.participants.push({id: CORPSE_CARRY_PARTICIPANT, save: () => ({v: 1, held: heldBody}), load: () => {}, reset: () => {}});
    hs.run.setLaneStore(STATION_BODIES_LANE, {v: 1, here: [rec('st-01:main#5', {x: 30, z: 8, level: 0})]}, MK);
    hs.run.setLaneStore(CORPSE_SHOP_LANE, {v: 1, seq: 4, done: 2, last: 2, job: {uid: 3, body: rec('st-00:main#9', {arch: 'bb', variant: 'teddy'}), ms: 900}, sold: ['st-00:main#2', 'st-00:main#3']}, MK);
    hs.takeEntry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
    const base = hs.file('arrival', 1) as any;
    const good = validateSaveFile(structuredClone(base));
    expect(good.ok, good.ok ? '' : (good as {error: string}).error).toBe(true);
    const refuse = (mut: (f: typeof base) => void, re: RegExp) => {
      const f = structuredClone(base);
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    const lane = (f: typeof base) => f.run.memories['st-01:main'].lanes[CORPSE_SHOP_LANE];
    refuse(f => { f.run.participants[CORPSE_CARRY_PARTICIPANT].held.id = 'st-00:main#9'; }, /two places/); // being sold AND in the hands
    refuse(f => { f.run.participants[CORPSE_CARRY_PARTICIPANT].held.id = 'st-00:main#2'; }, /two places/); // sold AND in the hands
    refuse(f => { f.run.memories['st-01:main'].lanes[STATION_BODIES_LANE].here[0].id = 'st-00:main#3'; }, /two places/); // sold AND lying in a station
    refuse(f => { lane(f).job.body.arch = 'ratdog'; }, /not a carriable/);
    refuse(f => { lane(f).sold.push('st-00:main#2'); lane(f).done = 3; }, /twice/);
    refuse(f => { lane(f).job.ms = -1; }, /progress/);
  });
});
