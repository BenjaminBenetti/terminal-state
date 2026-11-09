// Task studio-market-rework-20261108-074144-01 (lane WARES; user: "Shops should have actually items they sell on display! If the player
// picks those items up, the shop keeper will attack them … The player must see a "steal" tooltip in red when looking at the item"): the
// stalls' OWNED WARES (market/wares/*) on a generated v1 market with the REAL TradeSystem (seeded stock in the station's lane memory),
// PickupManager and Inventory:
//  - surfaces: v1 derives them from each stall's own furniture (the counter tops first, the run joined across its seam, the exposed back
//    tiers), all empty-keyed holders (never loot / salvage), never under the lantern / toolbox; v2 `displays` are used as given;
//  - the plan: deterministic, inside its surfaces, no overlaps, within the free height, a change never moves the others; a shotgun fits
//    the v1 gun counter;
//  - displays = stock: every ware IS its stock stack (the same object), owned, resting on its surface, nothing floating / overlapping;
//    buying / selling follows (gone / the rest / joins a gap), nothing else moves;
//  - ownership: the plain Take never targets a ware; the in-game prompt is a RED "Steal"; at the stall's customer spot the Trade prompt
//    still shows when not looking at a ware;
//  - theft: the same stack (or the part that fits) moves into the inventory through takeStock, the stock record is written at once, the
//    settlement is provoked (kind 'theft', the stall); a full inventory changes nothing at all;
//  - no duplicate across rebuild / save / load; owned wares are never station memory, train cargo or station fuel.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {generateMarketLevel, MARKET_EMPTY_KEY} from '../src/gen/market/index';
import {levelsOf} from '../src/gen/levels';
import {PROP_DEFS} from '../src/gen/props';
import {MARKET_STALLS, type MarketStall, type MarketStallId} from '../src/gen/market/marketTypes';
import type {StationLayout} from '../src/gen/stationTypes';
import {PickupManager} from '../src/world/pickups';
import {PACK_SIZE, type SlotRef} from '../src/items/inventory';
import {itemDims, type ItemDims} from '../src/items/items';
import {holderTable, isLootHolderKind} from '../src/items/loot';
import {lootProfile} from '../src/items/lootTables';
import {MARKET_STOCK_LANE, type MarketStockJSON} from '../src/market/trade/stock';
import {buy, sell, type TradeCtx} from '../src/market/trade/transactions';
import type {MarketProvocation} from '../src/market/hostility';
import {WARES, stallSurfaces, vendorDisplayHosts} from '../src/market/wares/slots';
import {planStall, supported, type WarePlace} from '../src/market/wares/plan';
import {MarketWares, STEAL_RED, WARES_TEXT, wareLabel, type Ware} from '../src/market/wares/wares';
import {capturePickups} from '../src/run/worldMemory';
import {TrainCargoSystem} from '../src/world/trainCargo';
import {FuelStations} from '../src/world/fuelStations';
import {playerTrainPlacement, trainToWorld} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {FUEL} from '../src/fuel/fuel';
import {validateSaveFile} from '../src/save/validate';
import {installRestore, prepareRestore} from '../src/save/serialize';
import {census, giveTies, tradeHost, uniqueUids} from './helpers/marketTradeFixture';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {}; // (item stand-in label atlases clip their cells)

const SEEDS = [1, 42, 4242, 9001, 20261108];
const layouts = new Map<number, StationLayout>();
const layoutOf = (seed: number) => { let L = layouts.get(seed); if (!L) layouts.set(seed, (L = generateMarketLevel({levelSeed: seed}))); return L; };
// (task studio-market-rework-20261108-074144-01, lane LAYOUT: the default market is layout version 2 now — the v1-surface cases below
// generate layout version 1 explicitly, the rest run on the default)
const layouts1 = new Map<number, StationLayout>();
const layoutOf1 = (seed: number) => { let L = layouts1.get(seed); if (!L) layouts1.set(seed, (L = generateMarketLevel({levelSeed: seed, layoutVersion: 1}))); return L; };
const H = (i: number): SlotRef => ({bar: 'hotbar', index: i});
const P = (i: number): SlotRef => ({bar: 'pack', index: i});
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

/** A built v1 market: the trade test host + a real PickupManager / camera / Levels, a recording hostility, the wares installed after the trade. */
function market(seed = 4242) {
  const t = tradeHost();
  const L = layoutOf(seed);
  const pickups = new PickupManager({});
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
  const provoked: MarketProvocation[] = [];
  const hostility = {hostile: false, provoke(c: MarketProvocation) { provoked.push(c); this.hostile = true; }, canTrade() { return !this.hostile; }};
  Object.assign(t.host, {pickups, camera, levels: levelsOf(L), layout: L, trade: t.sys, marketHostility: hostility});
  const wares = new MarketWares(t.host as never).install();
  const build = () => { for (const s of t.host.sectionHooks) s.build?.(L as never); };
  const stall = (id: MarketStallId) => L.market!.stalls.find(s => s.id === id)!;
  const shown = (id: MarketStallId) => [...wares.wares.values()].filter(w => w.stall === id);
  /** The camera at `eye` (default: the stall's customer spot, 1.6 m up) looking at `at`; the player stands under it facing it. */
  const look = (id: MarketStallId, at: THREE.Vector3, eye?: THREE.Vector3) => {
    const s = stall(id), e = eye ?? new THREE.Vector3(s.front.x, s.front.y + 1.6, s.front.z);
    camera.position.copy(e);
    camera.lookAt(at);
    camera.updateMatrixWorld(true);
    Object.assign(t.host.player, {x: e.x, y: e.y - 1.6, z: e.z, yaw: Math.atan2(-(at.x - e.x), -(at.z - e.z))});
    t.frame();
  };
  const centre = (w: Ware) => new THREE.Box3().setFromObject(w.pickup.obj).getCenter(new THREE.Vector3());
  /** The stall's ware nearest its customer spot (on the counter), optionally of a kind the inventory does not hold yet. */
  const nearest = (id: MarketStallId, ok: (w: Ware) => boolean = () => true) => {
    const s = stall(id);
    return shown(id).filter(ok).sort((a, b) => Math.hypot(a.place.x - s.front.x, a.place.z - s.front.z) - Math.hypot(b.place.x - s.front.x, b.place.z - s.front.z))[0];
  };
  const record = () => t.h.run.laneStore<MarketStockJSON>(MARKET_STOCK_LANE);
  build();
  return {...t, L, pickups, camera, wares, provoked, hostility, build, stall, shown, look, centre, nearest, record};
}
type Market = ReturnType<typeof market>;

/** The world footprint corners of a surface. */
function corners(s: {x: number; z: number; yaw: number; w: number; d: number}): [number, number][] {
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [s.x + c * a * s.w / 2 + n * b * s.d / 2, s.z - n * a * s.w / 2 + c * b * s.d / 2]);
}

/** Fill every quick slot and pocket with full med kits (nothing else fits; gear slots stay empty). */
function fillPockets(m: Market): void {
  const inv = m.h.inv;
  for (let i = 0; i < inv.hotbar.length; i++) inv.set(H(i), inv.makeStack('medkit', 3));
  for (let i = 0; i < inv.pack.length; i++) inv.set(P(i), inv.makeStack('medkit', 3));
}

/** Every uid of the run's live items: the inventory, the stock, and the DISPLAYED wares' stacks (must all be stock stacks). */
function allUids(m: Market): number[] {
  return census(m.h.inv, m.sys.stock!).uids;
}

describe('market wares: where they are displayed', () => {
  it('v1: every stall shows on the real open surfaces of its own empty-keyed furniture — counter tops first, joined across the run\'s seam', () => {
    const prof = lootProfile('market');
    for (const seed of SEEDS) {
      const L = layoutOf1(seed);
      expect(L.market!.v).toBe(1);
      const hosts = vendorDisplayHosts(L);
      for (const s of L.market!.stalls) {
        const ss = stallSurfaces(L, s);
        expect(ss.length, `${seed} ${s.id}`).toBeGreaterThan(0);
        expect(ss[0].hosts.every(i => L.props[i].kind === 'shopCounter'), `${seed} ${s.id}`).toBe(true);
        // the two 1.5 m counter modules' facing ends are one surface (wider than one module's 1.26 m top)
        const joined = ss.filter(q => q.hosts.length === 2);
        expect(joined.length, `${seed} ${s.id}`).toBe(1);
        expect(joined[0].w).toBeGreaterThan(PROP_DEFS.shopCounter.w - 0.24 + 0.05);
        for (const q of ss) {
          expect(q.w).toBeGreaterThanOrEqual(WARES.minW);
          for (const i of q.hosts) {
            const p = L.props[i];
            hosts.delete(i);
            expect([p.area, (p.level ?? 0), p.purpose]).toEqual([s.area, s.counter.level, MARKET_EMPTY_KEY]);
            expect(isLootHolderKind(p.kind), p.kind).toBe(true);
            if (!isLootHolderKind(p.kind)) continue;
            const t = holderTable(p.kind, p.purpose!, prof);
            expect(t.empty === 1 || t.lots[1] === 0 || !t.rows.length, `${seed} ${p.kind}`).toBe(true); // never rolls loot
            expect(q.y).toBeGreaterThan(p.y);
            expect(q.y).toBeLessThanOrEqual(p.y + p.h + 0.01);
          }
          // the surface lies inside its hosts' footprints (a real top / tier, nothing over the edge)
          for (const [x, z] of corners(q)) {
            expect(q.hosts.some(i => { const p = L.props[i]; return x >= p.x - p.hx - 1e-6 && x <= p.x + p.hx + 1e-6 && z >= p.z - p.hz - 1e-6 && z <= p.z + p.hz + 1e-6; }), `${seed} ${s.id}`).toBe(true);
          }
          // never under the on-top decor (lantern / toolbox) standing on one of its hosts
          for (const d of L.props.filter(p => p.host !== undefined && q.hosts.includes(p.host))) {
            const xs = corners(q).map(c => c[0]);
            const overlap = Math.min(Math.max(...xs), d.x + d.hx) - Math.max(Math.min(...xs), d.x - d.hx);
            expect(overlap, `${seed} ${s.id} ${d.kind}`).toBeLessThan(1e-6);
          }
        }
      }
      expect([...hosts]).toEqual([]); // (vendorDisplayHosts = exactly the surfaces' hosts)
    }
  });

  it('v2: a stall\'s own `displays` are used as given (an optional clear / host honoured; unusable ones dropped)', () => {
    const L = layoutOf(42), s0 = L.market!.stalls[0];
    const st: MarketStall = {...s0, displays: [
      {x: 1, z: 2, y: 0.9, level: 1, yaw: 0.5, w: 1.2, d: 0.4},
      {x: 3, z: 2, y: 1.1, level: 0, yaw: 0, w: 0.05, d: 0.4}, // too narrow
      Object.assign({x: 5, z: 6, y: 0.45, level: 0, yaw: Math.PI, w: 0.9, d: 0.3}, {clear: 0.3, host: 7}),
    ]};
    expect(stallSurfaces(L, st)).toEqual([
      {x: 1, y: 0.9, z: 2, yaw: 0.5, w: 1.2, d: 0.4, clear: WARES.clear, level: 1, hosts: []},
      {x: 5, y: 0.45, z: 6, yaw: Math.PI, w: 0.9, d: 0.3, clear: 0.3, level: 0, hosts: [7]},
    ]);
  });
});

describe('market wares: the display plan', () => {
  const dims = (id: string): ItemDims => itemDims(id);
  const mixed = (n: number) => Array.from({length: n}, (_, i) => ({uid: 1000 + i, itemId: ['beans', 'water', 'ammo_9mm', 'medkit', 'chips', 'armor_vest', 'fuel_can', 'bandage', 'battery', 'backpack'][i % 10]}));
  /** Surface-local rectangles of a stall's placements must sit inside their surface, apart, within its free height. */
  const checkPlan = (places: WarePlace[], surfaces: ReturnType<typeof stallSurfaces>) => {
    for (const p of places) {
      const s = surfaces[p.surface];
      expect(p.lx - p.sx / 2).toBeGreaterThanOrEqual(-s.w / 2 - 1e-9);
      expect(p.lx + p.sx / 2).toBeLessThanOrEqual(s.w / 2 + 1e-9);
      expect(p.lz - p.sz / 2).toBeGreaterThanOrEqual(-s.d / 2 - 1e-9);
      expect(p.lz + p.sz / 2).toBeLessThanOrEqual(s.d / 2 + 1e-9);
      expect(p.sy).toBeLessThanOrEqual(s.clear);
      expect(near(p.y, s.y)).toBe(true);
      expect(supported(s, p.lx - p.sx / 2, p.sx), `${p.uid} over the seam`).toBe(true); // (on a board / top, or bridging two)
      for (const q of places) {
        if (q === p || q.surface !== p.surface) continue;
        const ox = Math.min(p.lx + p.sx / 2, q.lx + q.sx / 2) - Math.max(p.lx - p.sx / 2, q.lx - q.sx / 2);
        const oz = Math.min(p.lz + p.sz / 2, q.lz + q.sz / 2) - Math.max(p.lz - p.sz / 2, q.lz - q.sz / 2);
        expect(ox <= 1e-9 || oz <= 1e-9, `${p.uid} / ${q.uid} overlap`).toBe(true);
      }
    }
  };

  it('is deterministic, keeps every ware inside its surface, apart and under the free height, at most WARES.maxPerStall', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const L = layoutOf(seed);
      for (const s of L.market!.stalls) {
        const surfaces = stallSurfaces(L, s), stacks = mixed(30);
        const a = planStall(stacks, surfaces, dims), b = planStall(stacks, surfaces, dims);
        expect(JSON.stringify([...a.placed])).toBe(JSON.stringify([...b.placed]));
        expect(a.count).toBeLessThanOrEqual(WARES.maxPerStall);
        expect(a.count).toBeGreaterThan(0);
        checkPlan([...a.placed.values()], surfaces);
      }
    }
  });

  it('a change never moves the other wares: a released spot is reused by a new ware, the rest stay put', () => {
    const L = layoutOf(4242), s = L.market!.stalls.find(x => x.id === 'general')!, surfaces = stallSurfaces(L, s);
    const pk = planStall(mixed(8), surfaces, dims);
    const gone = [...pk.placed.keys()][2];
    const before = JSON.stringify([...pk.placed].filter(([u]) => u !== gone));
    pk.release(gone);
    const p = pk.place(5000, dims('beans'));
    expect(p).not.toBeNull();
    expect(JSON.stringify([...pk.placed].filter(([u]) => u !== 5000))).toBe(before);
    checkPlan([...pk.placed.values()], surfaces);
  });

  it('the v1 gun counter takes a 0.98 m shotgun (the joined top) beside the lantern and the toolbox, plus its ammo', () => {
    const shotgun: ItemDims = {w: 0.98, d: 0.229, h: 0.095, shape: 'flat'}; // world/pickups.ts meshFor's shotgun-user.glb on its side
    for (const seed of SEEDS) {
      const L = layoutOf1(seed), s = L.market!.stalls.find(x => x.id === 'gun')!, surfaces = stallSurfaces(L, s);
      const pk = planStall([{uid: 1, itemId: 'shotgun'}, {uid: 2, itemId: 'ammo_12ga'}, {uid: 3, itemId: 'ammo_12ga'}, {uid: 4, itemId: 'ammo_9mm'}],
        surfaces, id => (id === 'shotgun' ? shotgun : dims(id)));
      expect(pk.placed.has(1), `${seed}`).toBe(true);
      const g = pk.placed.get(1)!, top = surfaces[g.surface];
      expect([top.hosts.length, top.supports?.length], `${seed}`).toEqual([2, 2]);
      // too long for either module's free top: it bridges the seam, resting on both
      expect(top.supports!.some(([a, b]) => g.lx - g.sx / 2 >= a - 1e-9 && g.lx + g.sx / 2 <= b + 1e-9), `${seed}`).toBe(false);
      expect(supported(top, g.lx - g.sx / 2, g.sx)).toBe(true);
      expect(pk.count).toBe(4);
      checkPlan([...pk.placed.values()], surfaces);
    }
  });
});

describe('market wares: the displays ARE the stock', () => {
  it('build: every displayed ware is its stall\'s own stock stack (same object / uid), owned, on the pickups; nothing else is spawned', () => {
    const m = market();
    let total = 0;
    // (re-pinned by task studio-market-bar-20261108-225231-01, lane BAR: the default market is layout version 3 — its bartender is a
    // seventh stall whose beers are displayed on the backbar like every stall's stock, so the census runs over the layout's stalls)
    const ids = m.L.market!.stalls.map(s => s.id);
    expect(ids).toEqual([...MARKET_STALLS, 'bar']);
    for (const id of ids) {
      const list = m.sys.stock!.stalls[id], shown = m.shown(id);
      expect(shown.length, id).toBeGreaterThan(0);
      expect(shown.length).toBeLessThanOrEqual(Math.min(list.length, WARES.maxPerStall));
      for (const w of shown) {
        expect(list.includes(w.pickup.stack), id).toBe(true);
        expect([w.pickup.stack.uid, w.pickup.owner, m.pickups.list.includes(w.pickup)]).toEqual([w.uid, id, true]);
      }
      // shown in stock order: whatever is not shown did not fit (a later, smaller one may still show)
      expect(new Set(shown.map(w => w.uid)).size).toBe(shown.length);
      total += shown.length;
    }
    expect(m.pickups.list.length).toBe(total);
    // the roomy stalls show their whole stock
    for (const id of ['medical', 'general', 'scrap'] as const) expect(m.shown(id).length, id).toBe(Math.min(m.sys.stock!.stalls[id].length, WARES.maxPerStall));
    expect(uniqueUids(allUids(m))).toBe(true);
  });

  it('every ware rests on its surface: its bottom at the surface height, inside it, never overlapping another ware', () => {
    for (const seed of [4242, 42]) {
      const m = market(seed);
      const boxes = [...m.wares.wares.values()].map(w => ({w, b: new THREE.Box3().setFromObject(w.pickup.obj)}));
      for (const {w, b} of boxes) {
        const s = stallSurfaces(m.L, m.stall(w.stall))[w.place.surface];
        expect(near(b.min.y, s.y, 0.006), `${seed} ${w.pickup.stack.itemId} ${b.min.y} vs ${s.y}`).toBe(true);
        expect(b.max.y - s.y).toBeLessThanOrEqual(s.clear + 0.01);
        const cs = corners(s), xs = cs.map(c => c[0]), zs = cs.map(c => c[1]);
        expect(b.min.x).toBeGreaterThanOrEqual(Math.min(...xs) - 0.01);
        expect(b.max.x).toBeLessThanOrEqual(Math.max(...xs) + 0.01);
        expect(b.min.z).toBeGreaterThanOrEqual(Math.min(...zs) - 0.01);
        expect(b.max.z).toBeLessThanOrEqual(Math.max(...zs) + 0.01);
      }
      for (const a of boxes) for (const c of boxes) {
        if (a === c) continue;
        const i = a.b.clone().intersect(c.b);
        expect(i.isEmpty() || Math.min(i.max.x - i.min.x, i.max.y - i.min.y, i.max.z - i.min.z) < 0.004, `${seed} ${a.w.pickup.stack.itemId} / ${c.w.pickup.stack.itemId}`).toBe(true);
      }
    }
  });

  it('buy / sell (the trade\'s transactions): a bought stack leaves, a partly bought one shows the rest, a sold one joins a free gap — nothing else moves', () => {
    const m = market();
    giveTies(m.h.inv, 2000);
    const ctx: TradeCtx = {inv: m.h.inv, stock: m.sys.stock!, stall: 'general'};
    const list = m.sys.stock!.stalls.general;
    const pose = () => new Map([...m.wares.wares.values()].map(w => [w.uid, w.pickup.obj.position.toArray().join(',')]));
    // a whole lot
    const w0 = m.shown('general')[0], uid0 = w0.uid;
    const before = pose();
    expect(buy(ctx, list.indexOf(w0.pickup.stack)).ok).toBe(true);
    m.frame();
    expect(m.wares.wares.has(uid0)).toBe(false);
    expect(m.pickups.list.includes(w0.pickup)).toBe(false);
    for (const [uid, p] of pose()) expect(p, `${uid}`).toBe(before.get(uid));
    // part of a lot (count >= 2)
    const wp = m.shown('general').find(w => w.pickup.stack.count >= 2);
    if (wp) {
      const n = wp.pickup.stack.count;
      expect(buy(ctx, list.indexOf(wp.pickup.stack), 1).ok).toBe(true);
      m.frame();
      expect([m.wares.wares.get(wp.uid) === wp, wp.pickup.stack.count, list.includes(wp.pickup.stack)]).toEqual([true, n - 1, true]);
    }
    // a sale: a stack the stall does not hold joins its display as the SAME object
    const id = ['cola', 'juice', 'chocolate', 'chips', 'beans', 'noodles', 'water', 'bread'].find(i => !list.some(s => s.itemId === i) && m.h.inv.count(i) === 0)!;
    const mine = m.h.inv.makeStack(id, 1);
    m.h.inv.set(P(PACK_SIZE - 1), mine);
    const kept = pose();
    expect(sell(ctx, P(PACK_SIZE - 1)).ok).toBe(true);
    m.frame();
    const joined = m.wares.wares.get(mine.uid);
    expect(joined?.pickup.stack).toBe(mine);
    expect(joined?.pickup.owner).toBe('general');
    for (const [uid, p] of kept) expect(pose().get(uid), `${uid}`).toBe(p);
    expect(uniqueUids(allUids(m))).toBe(true);
  });
});

describe('market wares: ownership and the red Steal', () => {
  it('looking at a ware: the plain Take never targets it, the in-game prompt is a RED "Steal <item>", the ware is highlighted', () => {
    const m = market();
    const w = m.nearest('medical');
    m.look('medical', m.centre(w));
    expect(m.wares.aimed).toBe(w);
    const p = m.prompt();
    expect(p).toBe(WARES_TEXT.steal(wareLabel(w.pickup.stack)));
    expect(p).toContain(`<span class="steal" style="color:${STEAL_RED};font-weight:700">Steal</span>`);
    expect(p).toMatch(/^<b>\[E\]<\/b> <span[^>]*>Steal<\/span> /);
    expect(m.pickups.hover).toBe(w.pickup);
    const eye = m.camera.getWorldPosition(new THREE.Vector3()), dir = m.camera.getWorldDirection(new THREE.Vector3());
    expect(m.pickups.target(eye, dir, levelsOf(m.L))).toBeNull(); // (the plain [E] Take sees no owned pickup)
  });

  it('at the stall\'s customer spot looking at the trader (over the wares): the Trade prompt, not Steal', () => {
    const m = market();
    const s = m.stall('general');
    m.look('general', new THREE.Vector3(s.trader.x, 1.6, s.trader.z));
    expect(m.wares.aimed).toBeNull();
    expect(m.prompt()).toMatch(/^<b>\[E\]<\/b> Trade — /);
  });

  it('a ware knocked off its spot is still owned (Steal, never Take) and re-sits on its spot on the next build', () => {
    const m = market();
    const w = m.nearest('general'), uid = w.uid, home = w.pickup.obj.position.clone();
    w.pickup.obj.position.set(home.x, 0, home.z + 0.75); // knocked onto the floor in front of the counter
    w.pickup.x = home.x; w.pickup.y = 0; w.pickup.z = home.z + 0.75;
    w.pickup.obj.updateMatrix();
    m.look('general', m.centre(w));
    expect(m.wares.aimed?.uid).toBe(uid);
    expect(m.prompt()).toContain('>Steal<');
    m.teardown();
    m.build();
    const again = m.wares.wares.get(uid)!;
    expect(again.pickup.obj.position.distanceTo(home)).toBeLessThan(1e-6);
    expect(m.wares.qa().stalls.general!.every(x => x.home)).toBe(true);
  });
});

describe('market wares: theft', () => {
  it('[E] on a ware: the SAME stack moves into the inventory through takeStock, recorded at once; the stall is provoked; the ware is gone', () => {
    const m = market();
    const w = m.nearest('general', x => m.h.inv.count(x.pickup.stack.itemId) === 0), st = w.pickup.stack, uid = w.uid;
    const c0 = census(m.h.inv, m.sys.stock!);
    m.look('general', m.centre(w));
    expect(m.press()).toBe(true);
    expect(m.h.inv.allStacks(true).includes(st)).toBe(true); // the very stack (uid, condition)
    expect(m.sys.stock!.stalls.general.some(s => s.uid === uid)).toBe(false);
    expect(m.record()!.stalls.general.some(s => s.uid === uid)).toBe(false); // the stock record is written at once
    expect(m.provoked).toEqual([{kind: 'theft', stall: 'general'}]);
    expect([m.wares.wares.has(uid), m.pickups.list.includes(w.pickup)]).toEqual([false, false]);
    expect(m.toasts.at(-1)).toBe(WARES_TEXT.stolen(wareLabel(st)));
    expect(m.wares.counts.thefts).toBe(1);
    // nothing created or lost: the run's items are the same set
    expect(census(m.h.inv, m.sys.stock!)).toEqual(c0);
  });

  it('only part fits: that part is stolen (a fresh uid), the rest stays on display as the same stack', () => {
    const m = market();
    const lot = m.h.inv.makeStack('ammo_9mm', 40);
    m.sys.stock!.stalls.medical.push(lot); // (a sold lot on the medical shelves)
    m.sys.stock!.version++;
    m.frame();
    const w = m.wares.wares.get(lot.uid)!;
    expect(w).toBeDefined();
    fillPockets(m);
    m.h.inv.set(P(0), m.h.inv.makeStack('ammo_9mm', 115)); // room for 5 more rounds only
    m.look('medical', m.centre(w), m.centre(w).add(new THREE.Vector3(0, 0.45, 0.45)));
    expect(m.wares.aimed).toBe(w);
    expect(m.press()).toBe(true);
    expect([lot.count, m.wares.wares.get(lot.uid) === w, m.sys.stock!.stalls.medical.includes(lot)]).toEqual([35, true, true]);
    expect(m.h.inv.count('ammo_9mm')).toBe(120);
    expect(m.wares.lastTheft).toMatchObject({stall: 'medical', itemId: 'ammo_9mm', count: 5});
    expect(m.provoked).toEqual([{kind: 'theft', stall: 'medical'}]);
    expect(uniqueUids(allUids(m))).toBe(true);
  });

  it('a full inventory: no theft, no loss — the inventory, the stock, its record and the display are unchanged; no one is provoked', () => {
    const m = market();
    fillPockets(m);
    const w = m.nearest('general', x => x.pickup.stack.itemId !== 'flare'); // (a flare would take the empty grenade slot)
    m.look('general', m.centre(w));
    const snap = () => JSON.stringify({inv: m.h.inv.toJSON(), stock: m.sys.stock!.toJSON(), rec: m.record(), shown: m.wares.qa().stalls});
    const before = snap();
    expect(m.press()).toBe(true);
    expect(snap()).toBe(before);
    expect([m.provoked.length, m.wares.counts.thefts, m.wares.counts.refused, m.wares.wares.get(w.uid) === w]).toEqual([0, 0, 1, true]);
    expect(m.toasts.at(-1)).toBe(WARES_TEXT.noRoom);
  });

  it('never twice: rebuild / save -> load show exactly the stock again (the stolen stack once, in the inventory)', () => {
    const m = market();
    const w = m.nearest('general', x => m.h.inv.count(x.pickup.stack.itemId) === 0), uid = w.uid;
    m.look('general', m.centre(w));
    expect(m.press()).toBe(true);
    m.teardown();
    m.build();
    expect(m.wares.wares.has(uid)).toBe(false);
    for (const x of m.wares.wares.values()) expect(m.sys.stock!.stalls[x.stall].includes(x.pickup.stack)).toBe(true);
    expect(uniqueUids(allUids(m))).toBe(true);
    // save -> load (a fresh game) -> build
    const v = validateSaveFile(m.h.file('arrival'));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const u = market();
    u.teardown();
    installRestore(prepareRestore(v.value.run, u.h.makeRun), u.h.target());
    u.build();
    expect(u.h.inv.allStacks(true).filter(s => s.uid === uid).length).toBe(1);
    expect(u.wares.wares.has(uid)).toBe(false);
    for (const x of u.wares.wares.values()) expect(u.sys.stock!.stalls[x.stall].includes(x.pickup.stack)).toBe(true);
    expect(u.wares.wares.size).toBe(m.wares.wares.size);
    expect(uniqueUids(allUids(u))).toBe(true);
  });
});

describe('market wares: never station memory, train cargo or station fuel', () => {
  it('the section memory never records an owned ware (an ordinary dropped item still is)', () => {
    const m = market();
    expect(capturePickups(m.pickups.list, () => undefined)).toEqual([]);
    m.pickups.add(m.h.inv.makeStack('water', 1), 0, 0, 0);
    expect(capturePickups(m.pickups.list, () => undefined).map(r => r.stack.itemId)).toEqual(['water']);
  });

  it('an owned ware knocked into the parked train is never the train\'s: not owned, captured, saved, counted or kept pending', () => {
    const m = market();
    const placement = playerTrainPlacement(m.L)!;
    expect(placement).not.toBeNull();
    const root = new THREE.Group();
    const host = {
      scene: new THREE.Scene(), camera: m.camera, state: 'playing', player: m.host.player, inv: m.h.inv, pickups: m.pickups, gear: null,
      trainRuntime: {spec: SPEC, view: {root}, train: {placement}, carLocal: () => null, carDir: () => null},
      trainRide: {riding: false, phase: 'parked', moving: false, local: {x: 0, y: 0, z: 0, yaw: 0}}, playerTrain: {cargo: {live: null}},
      hud: m.host.hud, sfx: {}, frameHooks: [], interactHandlers: [], promptProviders: [], sectionHooks: [],
    };
    const cargo = new TrainCargoSystem(host as never);
    const a = trainToWorld(placement, (SPEC.interior.x0 + SPEC.interior.x1) / 2, SPEC.floorY, 0);
    const ware = m.nearest('gun');
    ware.pickup.obj.position.set(a.x, a.y, a.z); // knocked into the car
    const mine = m.pickups.add(m.h.inv.makeStack('water', 1), a.x + 0.5, a.y, a.z);
    expect([cargo.ownsPickup(ware.pickup), cargo.ownsPickup(mine)]).toEqual([false, true]);
    expect(cargo.aboardCount()).toBe(1);
    expect(cargo.cargo().map(r => r.stack.uid)).toEqual([mine.stack.uid]);
    (cargo as unknown as {onTeardown(): void}).onTeardown();
    expect(cargo.pending.map(r => r.stack.uid)).toEqual([mine.stack.uid]);
    expect(m.pickups.list.includes(ware.pickup)).toBe(true);
    cargo.pending = [];
    m.pickups.add(mine.stack, a.x + 0.5, a.y, a.z);
    expect(cargo.capture()).toBe(1);
    expect(cargo.riding.map(r => r.stack.uid)).toEqual([mine.stack.uid]);
    expect(m.pickups.list.includes(ware.pickup)).toBe(true);
  });

  it('the fuel stall\'s displayed cans are its stock for sale, never the station\'s fuel', () => {
    const m = market();
    const free = m.pickups.add(m.h.inv.makeStack(FUEL.canItem, 1), 0, 0, 0);
    const owned = m.pickups.add(m.h.inv.makeStack(FUEL.canItem, 2), 1, 0, 0);
    owned.owner = 'fuel';
    const fs = new FuelStations({pickups: {list: [free, owned]}, gear: null} as never);
    expect(fs.liveUnits()).toBe(FUEL.canUnits);
  });
});
