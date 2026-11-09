// Task studio-market-bar-20261108-225231-01 (lane SHELVES; user: "Move owner wares to a shelf near them, not the counter immediately in
// front (accidental theft when trying to talk)."): the stalls' owned wares on the SHELVES NEAR THE VENDOR, never on the customer counter,
// and an intentional, reliable Trade-vs-Steal priority — on generated v1 / v2 markets and a synthetic v3 bar stall, with the REAL
// TradeSystem (seeded stock), PickupManager and Inventory:
//  - surfaces: never a customer counter top (v1's derived tops, v2's counter displays, a v3 bar counter of any kind / a hostless slot over
//    the counter), always a real supported surface of the stall's own fixture, nearest the trader first; v2 geometry untouched;
//  - displays = stock (same objects / uids), at most WARES.maxPerStall, what fits (capacity recorded);
//  - every displayed v2 ware is reachable on foot (the trader's way in / the side shelving) and stealable from there;
//  - priority: at the customer spot looking at the trader → Trade (E opens the trade, nothing stolen); a ware behind the trader's body
//    → Trade (the body occludes it), the same ware past the trader's shoulder → Steal; across the counter (the counter in front) →
//    not aimed, beside the counter's end → Steal; aiming straight at a ware → Steal (E = theft through takeStock + provoke).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {generateMarketLevel} from '../src/gen/market/index';
import {levelsOf} from '../src/gen/levels';
import {levelDistance} from '../src/gen/levelGen';
import type {PropPlacement} from '../src/gen/props';
import {CELL} from '../src/gen/grid';
import {MARKET_STALLS, type MarketStall, type MarketStallId} from '../src/gen/market/marketTypes';
import type {StationLayout} from '../src/gen/stationTypes';
import {PickupManager} from '../src/world/pickups';
import {WARES, allStallSurfaces, isCustomerCounter, stallSurfaces, talkCorridor, type WareSurface} from '../src/market/wares/slots';
import {MarketWares, WARES_TEXT, wareLabel, type Ware} from '../src/market/wares/wares';
import type {MarketProvocation} from '../src/market/hostility';
import {census, tradeHost, uniqueUids} from './helpers/marketTradeFixture';
import {installFakeDom} from './helpers/fakeDom';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {};

const SEEDS = [1, 42, 4242, 9001, 20261108];
const cache = new Map<string, StationLayout>();
const gen = (seed: number, v: 1 | 2) => { const k = `${v}:${seed}`; let L = cache.get(k); if (!L) cache.set(k, (L = generateMarketLevel({levelSeed: seed, layoutVersion: v}))); return L; };

/** A surface's world footprint corners. */
function corners(s: {x: number; z: number; yaw: number; w: number; d: number}): [number, number][] {
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [s.x + c * a * s.w / 2 + n * b * s.d / 2, s.z - n * a * s.w / 2 + c * b * s.d / 2]);
}
const inRect = (x: number, z: number, r: {x0: number; z0: number; x1: number; z1: number}, pad = 0) => x >= Math.min(r.x0, r.x1) - pad && x <= Math.max(r.x0, r.x1) + pad && z >= Math.min(r.z0, r.z1) - pad && z <= Math.max(r.z0, r.z1) + pad;

/** The rules a ware's surface keeps: not the customer counter, on a real fixture of the stall (inside its footprint, at a tier height). */
function checkShelf(L: StationLayout, s: MarketStall, q: WareSurface, tag: string): void {
  expect(isCustomerCounter(L, s, q), tag).toBe(false);
  expect(inRect(q.x, q.z, s.counter), `${tag} centre over the counter`).toBe(false);
  expect(q.hosts.length, tag).toBeGreaterThan(0);
  for (const i of q.hosts) {
    const p = L.props[i];
    expect(p.kind, tag).not.toBe('shopCounter');
    expect([p.area, p.level ?? 0], tag).toEqual([s.area, s.counter.level ?? 0]);
    expect(q.y, tag).toBeGreaterThan(p.y);
    expect(q.y, tag).toBeLessThanOrEqual(p.y + p.h + 0.01);
  }
  for (const [x, z] of corners(q)) expect(q.hosts.some(i => { const p = L.props[i]; return Math.abs(x - p.x) <= p.hx + 1e-3 && Math.abs(z - p.z) <= p.hz + 1e-3; }), `${tag} inside its fixture`).toBe(true);
}

/** A built market with the real trade + wares (+ an optional fake people list: the traders' live positions). */
function market(L: StationLayout) {
  const t = tradeHost();
  const pickups = new PickupManager({});
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
  const provoked: MarketProvocation[] = [];
  const hostility = {hostile: false, provoke(c: MarketProvocation) { provoked.push(c); this.hostile = true; }, canTrade() { return !this.hostile; }};
  const traders = new Map<MarketStallId, {x: number; y: number; z: number} | null>();
  const people = {traderAt: (id: MarketStallId) => (traders.has(id) ? traders.get(id)! : (() => { const s = L.market!.stalls.find(x => x.id === id); return s ? {x: s.trader.x, y: s.trader.y, z: s.trader.z} : null; })())};
  Object.assign(t.host, {pickups, camera, levels: levelsOf(L), layout: L, trade: t.sys, marketHostility: hostility, marketPeople: people});
  const wares = new MarketWares(t.host as never).install();
  const build = () => { for (const s of t.host.sectionHooks) s.build?.(L as never); };
  const stall = (id: MarketStallId) => L.market!.stalls.find(s => s.id === id)!;
  const shown = (id: MarketStallId) => [...wares.wares.values()].filter(w => w.stall === id);
  const look = (at: THREE.Vector3, eye: THREE.Vector3) => {
    camera.position.copy(eye);
    camera.lookAt(at);
    camera.updateMatrixWorld(true);
    Object.assign(t.host.player, {x: eye.x, y: eye.y - 1.6, z: eye.z, yaw: Math.atan2(-(at.x - eye.x), -(at.z - eye.z))});
    t.frame();
  };
  const centre = (w: Ware) => new THREE.Box3().setFromObject(w.pickup.obj).getCenter(new THREE.Vector3());
  /** A stand point in front of a ware's surface (0.7 m out, clear of the trader), the eye 1.6 m up. */
  const reachEye = (w: Ware) => {
    const s = stall(w.stall), q = stallSurfaces(L, s)[w.place.surface], f = new THREE.Vector3(Math.sin(q.yaw), 0, Math.cos(q.yaw));
    const side = new THREE.Vector3(Math.cos(q.yaw), 0, -Math.sin(q.yaw));
    const e = new THREE.Vector3(w.place.x, s.front.y + 1.6, w.place.z).addScaledVector(f, 0.7);
    const tp = people.traderAt(w.stall);
    if (tp && Math.hypot(e.x - tp.x, e.z - tp.z) < 0.75) e.addScaledVector(side, (side.dot(new THREE.Vector3(e.x - tp.x, 0, e.z - tp.z)) >= 0 ? 1 : -1) * 0.8);
    return e;
  };
  build();
  return {...t, L, pickups, camera, wares, provoked, hostility, traders, build, stall, shown, look, centre, reachEye};
}

describe('market wares on the shelves: where they stand', () => {
  it('v1 / v2: never on a customer counter top — real supported surfaces of the stall\'s own fixtures, nearest the trader first', () => {
    for (const v of [1, 2] as const) for (const seed of SEEDS) {
      const L = gen(seed, v);
      for (const s of L.market!.stalls) {
        const tag = `v${v} ${seed} ${s.id}`;
        const all = allStallSurfaces(L, s), ss = stallSurfaces(L, s);
        // the layout offers its counter tops; a stall with shelving never uses them (one without: only the far ends, the test below)
        expect(all.some(q => q.hosts.some(i => L.props[i].kind === 'shopCounter')), tag).toBe(true);
        const shelves = all.filter(q => !isCustomerCounter(L, s, q));
        if (shelves.length) {
          expect(ss.length, tag).toBe(shelves.length);
          for (const q of ss) { checkShelf(L, s, q, tag); expect(all).toContainEqual(q); expect(q.end).toBeUndefined(); }
        } else expect(ss.every(q => q.end === true), `${tag}: counter ends only`).toBe(true);
        const k = ss.map(q => Math.hypot(q.x - s.trader.x, q.z - s.trader.z, q.y - (s.trader.y + 1.2)));
        for (let i = 1; i < k.length; i++) expect(k[i], tag).toBeGreaterThanOrEqual(k[i - 1] - 1e-9);
        if (v === 2) expect(ss.length, `${tag}: shelving behind / beside the trader`).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('v1\'s first market: stalls with shelving keep the shelves-only rule; the gun / fuel / scrap stalls (no shelving) use ONLY their counter run\'s far ends — never the stretch in front of the trader / customer spot', () => {
    for (const seed of SEEDS) {
      const L = gen(seed, 1);
      const stall = (id: MarketStallId) => L.market!.stalls.find(s => s.id === id)!;
      for (const id of ['medical', 'general', 'gear'] as const) {
        const ss = stallSurfaces(L, stall(id));
        expect(ss.length, `${seed} ${id}`).toBeGreaterThanOrEqual(3);
        for (const q of ss) { expect(q.end).toBeUndefined(); checkShelf(L, stall(id), q, `${seed} ${id}`); }
      }
      for (const id of ['gun', 'fuel', 'scrap'] as const) {
        const s = stall(id), ss = stallSurfaces(L, s), tag = `${seed} ${id}`;
        expect(ss.length, tag).toBeGreaterThanOrEqual(2); // (both ends of the run)
        const counters = allStallSurfaces(L, s).filter(q => isCustomerCounter(L, s, q));
        for (const q of ss) {
          expect(q.end, tag).toBe(true);
          expect(q.w, tag).toBeGreaterThanOrEqual(WARES.minW);
          // a piece of a real counter top (same height / depth / yaw), lying wholly inside it
          const host = counters.find(c => Math.abs(c.y - q.y) < 1e-9 && Math.abs(c.d - q.d) < 1e-9 && c.hosts.join() === q.hosts.join())!;
          expect(host, tag).toBeDefined();
          const lx = (q.x - host.x) * Math.cos(host.yaw) - (q.z - host.z) * Math.sin(host.yaw);
          expect(lx - q.w / 2, tag).toBeGreaterThanOrEqual(-host.w / 2 - 1e-6);
          expect(lx + q.w / 2, tag).toBeLessThanOrEqual(host.w / 2 + 1e-6);
          // never within WARES.talk (along the counter) of the trader's post or the customer spot
          const cor = talkCorridor(s, q)!;
          expect(cor[0], tag).toBeLessThan(cor[1]);
          expect(q.w / 2 <= cor[0] + 1e-6 || -q.w / 2 >= cor[1] - 1e-6, `${tag}: outside the talk corridor`).toBe(true);
          for (const p of [s.trader, s.front]) {
            const along = (p.x - q.x) * Math.cos(q.yaw) - (p.z - q.z) * Math.sin(q.yaw);
            expect(Math.abs(along) - q.w / 2, `${tag}: away from ${p === s.trader ? 'the trader' : 'the customer'}`).toBeGreaterThanOrEqual(WARES.talk - 1e-6);
          }
        }
        // one end each side of the trader
        const sides = new Set(ss.map(q => Math.sign((q.x - s.trader.x) * Math.cos(q.yaw) - (q.z - s.trader.z) * Math.sin(q.yaw))));
        expect(sides.size, tag).toBe(2);
      }
    }
  });

  it('v1 gun / fuel / scrap: their wares stand ONLY on the far counter ends (stock objects); at the customer spot looking at the trader it is Trade; beside the end, Steal', () => {
    for (const seed of [42, 4242]) {
      const L = gen(seed, 1), m = market(L);
      for (const id of ['gun', 'fuel', 'scrap'] as const) {
        const s = m.stall(id), ss = stallSurfaces(L, s), shown = m.shown(id), tag = `${seed} ${id}`;
        expect(shown.length, tag).toBeGreaterThan(0);
        for (const w of shown) {
          const q = ss[w.place.surface];
          expect(q.end, tag).toBe(true);
          expect(m.sys.stock!.stalls[id].includes(w.pickup.stack)).toBe(true);
          // its box wholly outside the talk corridor (along the counter, from the trader's / customer's axis)
          const b = new THREE.Box3().setFromObject(w.pickup.obj), c = Math.cos(q.yaw), n = Math.sin(q.yaw);
          const along = (x: number, z: number) => (x - s.trader.x) * c - (z - s.trader.z) * n;
          const xs = [along(b.min.x, b.min.z), along(b.max.x, b.min.z), along(b.min.x, b.max.z), along(b.max.x, b.max.z)];
          expect(Math.min(...xs.map(Math.abs)), `${tag} ${w.pickup.stack.itemId}`).toBeGreaterThanOrEqual(WARES.talk - 0.02);
          expect(Math.abs(b.min.y - q.y)).toBeLessThan(0.006);
        }
        // at the customer spot: looking at the trader (face / chest / belt) is Trade; E opens the trade, nothing is stolen
        const eye = new THREE.Vector3(s.front.x, s.front.y + 1.6, s.front.z);
        for (const h of [1.0, 1.3, 1.55, 1.7]) {
          for (const dx of [-0.2, 0, 0.2]) {
            m.look(new THREE.Vector3(s.trader.x + dx, s.trader.y + h, s.trader.z), eye);
            expect(m.wares.aimed, `${tag} trader @${h} ${dx}`).toBeNull();
            expect(m.prompt(), tag).toMatch(/^<b>\[E\]<\/b> Trade — /);
          }
        }
        const c0 = census(m.h.inv, m.sys.stock!), p0 = m.provoked.length, t0 = m.wares.counts.thefts;
        const dom = installFakeDom();
        try { expect(m.press()).toBe(true); expect(m.sys.open?.id).toBe(id); m.sys.close('user'); } finally { dom.uninstall(); }
        expect([m.provoked.length, m.wares.counts.thefts]).toEqual([p0, t0]);
        expect(census(m.h.inv, m.sys.stock!)).toEqual(c0);
        // beside the end (the customer side, level with that end of the run): aimed straight at a ware there, Steal; E = theft
        const w = shown.find(x => m.h.inv.count(x.pickup.stack.itemId) === 0) ?? shown[0];
        const q = ss[w.place.surface], f = new THREE.Vector3(Math.sin(q.yaw), 0, Math.cos(q.yaw));
        const beside = new THREE.Vector3(w.place.x, s.front.y + 1.6, w.place.z).addScaledVector(f, q.d / 2 + 0.55);
        m.look(m.centre(w), beside);
        expect(m.wares.aimed, `${tag} beside the end`).toBe(w);
        expect(m.prompt()).toBe(WARES_TEXT.steal(wareLabel(w.pickup.stack)));
        expect(m.press()).toBe(true);
        expect([m.wares.counts.thefts, m.wares.lastTheft?.stall], tag).toEqual([t0 + 1, id]);
        expect(m.provoked.at(-1)).toEqual({kind: 'theft', stall: id});
        m.hostility.hostile = false;
      }
    }
  });

  it('synthetic v3 (a bar stall): the bar counter — any kind on the counter footprint, or a hostless slot over it — is out; the backbar shelves are in', () => {
    const L = generateMarketLevel({levelSeed: 42, layoutVersion: 2}); // (a fresh copy: mutated below)
    L.market!.v = 3;
    const s = L.market!.stalls.find(x => x.id === 'general')!;
    const c = s.counter, cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2, lv = c.level ?? 0, base = c.y;
    // the bar counter: a long solid prop of another kind over the counter footprint (the BAR lane picks its own kind)
    const bar: PropPlacement = {kind: 'workbench' as PropPlacement['kind'], x: cx, z: cz, y: base, rot: 0, area: s.area, hx: (c.x1 - c.x0) / 2, hz: (c.z1 - c.z0) / 2, h: 1.08, blocksSight: false, variant: 0, ...(lv ? {level: lv} : {})};
    L.props.push(bar);
    const barIdx = L.props.length - 1;
    // the backbar: the stall's own back-wall shelving (displays of v2's record that are not counters)
    const back = s.displays!.filter(d => L.props[d.host!].kind !== 'shopCounter');
    s.displays = [
      {x: cx, z: cz, y: base + 1.08, level: lv, yaw: 0, w: 2.4, d: 0.5, host: barIdx, clear: 0.5}, // the bar top (hosted)
      {x: cx + 0.3, z: cz, y: base + 1.08, level: lv, yaw: 0, w: 1.0, d: 0.4}, // a hostless slot over the bar
      ...back,
    ];
    const ss = stallSurfaces(L, s);
    expect(ss.length).toBe(back.length);
    for (const q of ss) checkShelf(L, s, q, 'v3 backbar');
    expect(ss.some(q => q.hosts.includes(barIdx))).toBe(false);
    // built: every bottle / ware on the backbar, stock objects, none on the bar top
    const m = market(L);
    const shown = m.shown('general');
    expect(shown.length).toBeGreaterThan(0);
    for (const w of shown) {
      const q = ss[w.place.surface];
      expect(isCustomerCounter(L, s, q)).toBe(false);
      expect(inRect(w.place.x, w.place.z, c)).toBe(false);
      expect(m.sys.stock!.stalls.general.includes(w.pickup.stack)).toBe(true);
    }
  });
});

describe('market wares on the shelves: the displays are still the stock', () => {
  it('v2: every ware IS its stall\'s stock stack (same object / uid), owned, on a shelf; at most WARES.maxPerStall; capacity: the stock that fits', () => {
    for (const seed of [42, 4242]) {
      const m = market(gen(seed, 2));
      const cap: string[] = [];
      for (const id of MARKET_STALLS) {
        const list = m.sys.stock!.stalls[id], shown = m.shown(id), s = m.stall(id), ss = stallSurfaces(m.L, s);
        expect(shown.length, `${seed} ${id}`).toBeGreaterThan(0);
        expect(shown.length).toBeLessThanOrEqual(Math.min(list.length, WARES.maxPerStall));
        for (const w of shown) {
          expect(list.includes(w.pickup.stack)).toBe(true);
          expect([w.pickup.stack.uid, w.pickup.owner]).toEqual([w.uid, id]);
          checkShelf(m.L, s, ss[w.place.surface], `${seed} ${id}`);
          // resting on its shelf (bottom on the board), never over the counter
          const b = new THREE.Box3().setFromObject(w.pickup.obj);
          expect(Math.abs(b.min.y - ss[w.place.surface].y), `${seed} ${id} ${w.pickup.stack.itemId}`).toBeLessThan(0.006);
          expect(inRect(b.getCenter(new THREE.Vector3()).x, b.getCenter(new THREE.Vector3()).z, s.counter)).toBe(false);
        }
        cap.push(`${id} ${shown.length}/${Math.min(list.length, WARES.maxPerStall)}`);
      }
      expect(uniqueUids(census(m.h.inv, m.sys.stock!).uids)).toBe(true);
      // (capacity, recorded: v2's shelves show the whole of the first 18 stacks for most stalls)
      expect(cap.length).toBe(MARKET_STALLS.length);
    }
  });
});

describe('market wares on the shelves: reachable and stealable', () => {
  it('v2: every displayed ware has a stand point reachable on foot from the customer spot (the trader\'s way in / the side shelves) within reach, in sight', () => {
    for (const seed of [42, 9001]) {
      const L = gen(seed, 2), m = market(L);
      for (const id of MARKET_STALLS) {
        const s = m.stall(id), lv = s.front.level, g = L.levels[lv].grid;
        const [fx, fy] = g.cellOf(s.front.x, s.front.z);
        const dist = levelDistance(L.levels, fx, fy, lv, [])[lv];
        for (const w of m.shown(id)) {
          const c = m.centre(w);
          let ok = false;
          for (let x = c.x - 2; x <= c.x + 2 && !ok; x += 0.1) for (let z = c.z - 2; z <= c.z + 2 && !ok; z += 0.1) {
            const [cx, cy] = g.cellOf(x, z);
            if (!g.inBounds(cx, cy) || dist[g.idx(cx, cy)] < 0 || !g.circleClear(x, z, 0.29)) continue;
            const eye = new THREE.Vector3(x, s.front.y + 1.6, z);
            if (eye.distanceTo(c) > WARES.reach - 0.1) continue;
            if (!levelsOf(L).lineOfSight(eye, c, {slack: 0.15})) continue;
            ok = true;
          }
          expect(ok, `${seed} ${id} ${w.pickup.stack.itemId} @ ${c.toArray().map(v => v.toFixed(2))}`).toBe(true);
        }
      }
    }
  });

  it('aimed straight at a shelved ware from in front of it: a red Steal; E = theft (the same stack, takeStock, provoke)', () => {
    const m = market(gen(4242, 2));
    for (const id of ['general', 'medical'] as const) {
      const w = m.shown(id).find(x => m.h.inv.count(x.pickup.stack.itemId) === 0)!;
      m.look(m.centre(w), m.reachEye(w));
      expect(m.wares.aimed, id).toBe(w);
      expect(m.prompt()).toBe(WARES_TEXT.steal(wareLabel(w.pickup.stack)));
      const st = w.pickup.stack, uid = w.uid;
      expect(m.press()).toBe(true);
      expect(m.h.inv.allStacks(true).includes(st)).toBe(true);
      expect(m.sys.stock!.stalls[id].some(x => x.uid === uid)).toBe(false);
      expect(m.provoked.at(-1)).toEqual({kind: 'theft', stall: id});
      m.hostility.hostile = false;
    }
  });
});

describe('market wares on the shelves: Trade vs Steal', () => {
  /** A v2 stall's back-wall (top-tier) ware and an eye at its customer spot (0.3 m toward the counter: still the Trade spot). */
  function backCase(m: ReturnType<typeof market>, id: MarketStallId) {
    const s = m.stall(id), f = new THREE.Vector3(s.trader.x - s.front.x, 0, s.trader.z - s.front.z).normalize();
    const eye = new THREE.Vector3(s.front.x, s.front.y + 1.6, s.front.z).addScaledVector(f, 0.3);
    const back = m.shown(id).filter(w => {
      const c = m.centre(w);
      return (c.x - s.trader.x) * f.x + (c.z - s.trader.z) * f.z > 0.3 && eye.distanceTo(c) < WARES.reach - 0.15; // (behind the trader, in reach)
    }).sort((a, b) => Math.abs((m.centre(a).x - s.trader.x) * f.z - (m.centre(a).z - s.trader.z) * f.x) - Math.abs((m.centre(b).x - s.trader.x) * f.z - (m.centre(b).z - s.trader.z) * f.x));
    return {s, f, eye, w: back[0]};
  }
  /** The point where the eye -> ware line crosses the trader's depth (the trader stepped onto that line). */
  const onLine = (eye: THREE.Vector3, c: THREE.Vector3, s: MarketStall, f: THREE.Vector3) => {
    const d = new THREE.Vector3().subVectors(c, eye), u = ((s.trader.x - eye.x) * f.x + (s.trader.z - eye.z) * f.z) / (d.x * f.x + d.z * f.z);
    return {x: eye.x + d.x * u, y: s.trader.y, z: eye.z + d.z * u};
  };

  it('at the customer spot looking at the trader: Trade (E opens the trade view, nothing stolen, no one provoked)', () => {
    const m = market(gen(42, 2));
    for (const id of MARKET_STALLS) {
      const s = m.stall(id);
      for (const h of [1.0, 1.45, 1.7]) {
        m.look(new THREE.Vector3(s.trader.x, s.trader.y + h, s.trader.z), new THREE.Vector3(s.front.x, s.front.y + 1.6, s.front.z));
        expect(m.wares.aimed, `${id} @${h}`).toBeNull();
        expect(m.prompt(), id).toMatch(/^<b>\[E\]<\/b> Trade — /);
      }
      const c0 = census(m.h.inv, m.sys.stock!);
      const dom = installFakeDom(); // (the trade view's panel)
      try {
        expect(m.press()).toBe(true);
        expect(m.sys.open?.id).toBe(id);
        m.sys.close('user');
      } finally { dom.uninstall(); }
      expect([m.provoked.length, m.wares.counts.thefts]).toEqual([0, 0]);
      expect(census(m.h.inv, m.sys.stock!)).toEqual(c0);
    }
  });

  it('a ware right behind the trader: the body occludes it (Trade); the same ware past the trader\'s shoulder: Steal', () => {
    let cases = 0, trades = 0;
    for (const seed of [42, 4242, 9001]) {
      const m = market(gen(seed, 2));
      for (const id of MARKET_STALLS) {
        const {s, f, eye, w} = backCase(m, id);
        if (!w) continue;
        const c = m.centre(w);
        // the trader steps onto the line of sight: the look meets the body first
        m.traders.set(id, onLine(eye, c, s, f));
        m.look(c, eye);
        expect(m.wares.aimed, `${seed} ${id} behind the body`).toBeNull();
        expect(m.wares.lastBlock, `${seed} ${id}`).toBe('trader');
        // never a Steal: the trade's prompt where the view faces the counter (the trade's own rule), else nothing
        const pr = m.prompt();
        if (pr === null) expect(m.wares.aimed).toBeNull(); else { expect(pr, `${seed} ${id}`).toMatch(/^<b>\[E\]<\/b> Trade — /); trades++; }
        // the trader a shoulder's width aside (0.45 m off the line): the ware is in plain view past the shoulder
        const p = onLine(eye, c, s, f), side = new THREE.Vector3(-f.z, 0, f.x);
        m.traders.set(id, {x: p.x + side.x * 0.45, y: p.y, z: p.z + side.z * 0.45});
        m.look(c, eye);
        expect(m.wares.aimed, `${seed} ${id} past the shoulder`).toBe(w);
        expect(m.prompt()).toContain('>Steal<');
        // the trader gone (fled / dead): nothing occludes
        m.traders.set(id, null);
        m.look(c, eye);
        expect(m.wares.aimed).toBe(w);
        m.traders.delete(id);
        cases++;
      }
    }
    expect(cases).toBeGreaterThanOrEqual(6);
    expect(trades).toBeGreaterThanOrEqual(4);
  });

  it('a ware at the end of the counter run: across the counter (its body in front) not aimed; from beside the counter\'s end, Steal', () => {
    const L = generateMarketLevel({levelSeed: 4242, layoutVersion: 2}); // (a fresh copy: mutated below)
    const s = L.market!.stalls.find(x => x.id === 'general')!;
    const c = s.counter, f = Math.sign(s.trader.z - s.front.z); // (the counter runs along x; f: toward the trader)
    // a low shelf at the trader's end of the run, just past it, behind the counter's front line (the gap side: the trader's way in)
    const a = L.areas[s.area], gapRight = (a.x + a.w) * CELL - c.x1 > c.x0 - a.x * CELL;
    const ex = gapRight ? c.x1 + 0.3 : c.x0 - 0.3, ez = (c.z0 + c.z1) / 2 + f * 0.2;
    const host = L.props.find(p => p.kind === 'outdoorsPlankShelving' && p.area === s.area)!;
    s.displays = [{x: ex, z: ez, y: s.counter.y + 0.55, level: s.counter.level ?? 0, yaw: 0, w: 0.4, d: 0.3, host: L.props.indexOf(host), clear: 0.4}];
    // (a synthetic slot at the counter's end: its host index only names the stall's own fixture kind; the geometry is the test's)
    const m = market(L);
    // from beside the counter's end (the customer side, level with the end): nothing in front of the nearest ware — Steal
    const beside = new THREE.Vector3(ex, s.front.y + 1.6, (f > 0 ? c.z0 : c.z1) - f * 0.6);
    const w = m.shown('general').sort((p, q) => m.centre(p).distanceTo(beside) - m.centre(q).distanceTo(beside))[0];
    expect(w).toBeDefined();
    const wc = m.centre(w);
    // from the customer spot's far side: the line passes through the counter's body first
    const across = new THREE.Vector3(ex + (gapRight ? -2 : 2), s.front.y + 1.15, s.front.z);
    m.look(wc, across);
    expect(m.wares.aimed).toBeNull();
    expect(m.wares.lastBlock).toBe('counter');
    m.look(wc, beside);
    expect(m.wares.aimed).toBe(w);
    expect(m.prompt()).toContain('>Steal<');
  });
});
