// Task studio-market-bar-20261108-225231-01 (lane PEOPLE): THE BAR'S PATRONS AND BARTENDER (market/marketPeople.ts with
// market/people/{drinkClips,bottle,seats}.ts), driven in Node on real generated markets — layout v3's bar deck (its 'drink' posts each
// name their counter stool / table chair; its 'bar' stall) — with the real cast and the real cola-can model as the bottle (the fallback
// while the beer has no model). User: "NPCs drinking" / "bartender selling beers".
//  - patrons at 'drink' spots play a runtime drinking loop (raise, sip, lower; two variants, staggered) with a bottle in the right hand
//    that reaches the lips; seated on the post's stool / chair at its seat height (a post without a seat — synthetic, on a v2 layout —
//    stands); they linger; the bar's regulars return;
//  - the bartender works the counter (the Work loop) and turns to talk to a customer;
//  - hostile: the bottles are put away; the bar's people take part (the robbed bartender fights);
//  - no 'drink' spot (layouts v1 / v2): no bottle, no drinking loop — the calm market as before.
import {beforeAll, describe, expect, it} from 'vitest';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import type {MarketStallId} from '../src/gen/market/marketTypes';
import type {StationLayout} from '../src/gen/stationTypes';
import {MARKET_PEOPLE} from '../src/market/marketPeople';
import {DRINK, drinkSipAt} from '../src/market/people/drinkClips';
import {PATRON_BOTTLE_ITEMS, bottleSpecOf} from '../src/market/people/bottle';
import {SEAT_REACH, seatAt, seatHeightOf} from '../src/market/people/seats';
import {combatWorld, loadCombatAssets, type CombatAssets} from './helpers/marketCombatFixture';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
async function loadGlb(rel: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.join(ROOT, rel));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

let A: CombatAssets;
/** The cola can as world/pickups.ts fits an item model (bottom-centre origin, its ITEM_DIMS height 0.122 m). */
let can: THREE.Object3D;
beforeAll(async () => {
  A = await loadCombatAssets();
  const g = await loadGlb('assets/models/item-cola-t25.glb');
  const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = 0.122 / size.y, m = g.scene.clone(true);
  m.scale.setScalar(s); m.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  can = new THREE.Group(); can.add(m);
});

/** The market as built now (layout v3: the settlement + the bar deck, its 'drink' posts naming their seats, the 'bar' stall). */
function barMarket(seed = 808) {
  const w = combatWorld(A, seed);
  expect(w.layout.market!.v).toBe(3);
  w.people.bottleSource = () => ({obj: can, item: 'cola', source: 'models.item_cola (test)'});
  return {w};
}
/** Standing posts (no seat): a version-2 layout (no bar) with `n` spots turned into 'drink' posts that name no seat. */
function standingPosts(seed = 808, n = 6) {
  const w = combatWorld(A, seed, {layoutVersion: 2, fresh: true, edit: (L: StationLayout) => {
    for (const s of L.market!.spots.filter(q => q.kind === 'idle' || q.kind === 'chat' || q.kind === 'work').slice(0, n)) s.kind = 'drink';
  }});
  w.people.bottleSource = () => ({obj: can, item: 'cola', source: 'models.item_cola (test)'});
  return {w};
}
type R = ReturnType<typeof barMarket>['w']['people']['residents'][number];
const patrons = (w: ReturnType<typeof barMarket>['w']) => w.people.residents.filter(r => r.drink);
const bonePos = (a: R['actor'], n: string) => { a.root.updateMatrixWorld(true); return new THREE.Vector3().setFromMatrixPosition(a.bone(n)!.matrixWorld); };

describe('seats (market/people/seats.ts)', () => {
  it('a chair\'s seat from its measured P7 surface, a stool / chair / sofa by name; work benches and wheelchairs are no seat', () => {
    expect(seatHeightOf('plasticStackChair')).toBeCloseTo(0.431, 3);
    expect(seatHeightOf('foldingChair')).toBeCloseTo(0.428, 3);
    expect(seatHeightOf('barStool')).toBe(0.72);
    expect(seatHeightOf('barStool', 0.7)).toBe(0.7); // (a stool's padded top is its height)
    expect(seatHeightOf('skyMuStool', 0.66)).toBe(0.66); // (layout v3's counter stools)
    expect(seatHeightOf('cafeChair')).toBe(0.43); // (layout v3's table chairs: the seat board at 0.41 + 0.02)
    expect(seatHeightOf('couch')).toBe(0.42);
    for (const k of ['repairBench', 'benchGrinderStand', 'labBench', 'wheelchair', 'crate', 'campTable']) expect(seatHeightOf(k), k).toBeNull();
    const spot = {x: 1, z: 1, y: 2.95, level: 1, yaw: 0, kind: 'drink' as const, area: 3};
    const p = (kind: string, x: number, level?: number) => ({kind, x, z: 1, y: 2.95, rot: 0, area: 3, hx: 0.25, hz: 0.25, h: 0.8, blocksSight: false, variant: 0, ...(level !== undefined ? {level} : {})}) as never;
    expect(seatAt(spot, [p('crate', 1, 1), p('foldingChair', 1.3, 1)])).toMatchObject({x: 1.3, prop: 1});
    expect(seatAt(spot, [p('foldingChair', 1 + SEAT_REACH + 0.05, 1)])).toBeNull();
    expect(seatAt(spot, [p('foldingChair', 1.1)])).toBeNull(); // (another storey)
    expect(seatAt(spot, [p('foldingChair', 1.1, 1)])!.y).toBeCloseTo(2.95 + 0.428, 3);
    // a post naming its seat (layout v3) takes that one, even past SEAT_REACH
    expect(seatAt({...spot, seat: 1}, [p('foldingChair', 1.1, 1), p('cafeChair', 1.9, 1)])).toMatchObject({x: 1.9, prop: 1, y: 2.95 + 0.43});
  });
});

describe('bar patrons drink', () => {
  it('the bar\'s regulars start at its \'drink\' posts playing a drinking loop, a bottle in the right hand, seated on the post\'s stool / chair', () => {
    const {w} = barMarket();
    w.build();
    const P = patrons(w);
    const nRes = w.people.residents.length, posts = w.people.spots.filter(s => s.kind === 'drink').length;
    expect(posts).toBeGreaterThanOrEqual(6);
    expect(P.length).toBe(Math.min(posts, Math.round(nRes * MARKET_PEOPLE.drink.regulars)));
    let seated = 0;
    for (const r of P) {
      const a = r.actor, s = w.people.spots[r.spot];
      expect(s.kind).toBe('drink');
      expect(r.regular).toBe(true);
      expect(a.loop).toBe(r.drink!.clip);
      expect(a.loop).toMatch(/^Drink(Sit)?2?(@\d+)?$/);
      // the bottle: held in the right hand, shown
      expect(r.bottle!.holder.visible).toBe(true);
      expect(r.bottle!.holder.parent).toBe(a.bone('R_Hand'));
      expect(r.bottle!.holder.name).toBe(`market-bottle-${PATRON_BOTTLE_ITEMS[1]}`);
      // on the post's own seat (layout v3: s.seat), at its seat height
      expect(s.seat).toBeDefined();
      const seat = w.layout.props[s.seat!], top = seatHeightOf(seat.kind, seat.h)!;
      expect(top).not.toBeNull();
      expect(r.drink!.seat).not.toBeNull();
      seated++;
      expect(a.loop).toMatch(/^DrinkSit2?@\d+$/);
      expect(Math.hypot(a.x - seat.x, a.z - seat.z)).toBeLessThan(0.05);
      a.animate(0.01); // (the clip's pose)
      const hips = bonePos(a, 'Hips').y - a.y;
      expect(hips, `${r.id} on a ${seat.kind}`).toBeGreaterThan((top + 0.05) * 0.94);
      expect(hips, `${r.id} on a ${seat.kind}`).toBeLessThan((top + DRINK.hipOverSeat + 0.05) * 1.06);
    }
    expect(seated).toBe(P.length);
    // everyone else: no bottle shown
    for (const r of w.people.residents) if (!r.drink) expect(r.bottle?.holder.visible ?? false).toBe(false);
  });

  it('the loop raises the bottle to the lips (its top at the mouth), sips and lowers it upright; patrons are staggered (phase, variant)', () => {
    const {w} = barMarket();
    w.build();
    const P = patrons(w);
    for (const r of P) {
      const a = r.actor, holder = r.bottle!.holder, spec = r.bottle!.spec, T = DRINK.T[r.drink!.variant];
      let minTop = Infinity, upright = 0, minTopAtSip = Infinity;
      for (let t = 0; t < T; t += 1 / 15) {
        a.animate(1 / 15); a.sync(); a.root.updateMatrixWorld(true);
        const top = new THREE.Vector3(0, spec.h - spec.grip, 0).applyMatrix4(holder.matrixWorld);
        const head = a.bone('Head')!, hq = new THREE.Quaternion(); head.getWorldQuaternion(hq);
        const lips = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).add(new THREE.Vector3(0, DRINK.mouth[1], 0.1).applyQuaternion(hq));
        const d = top.distanceTo(lips);
        minTop = Math.min(minTop, d);
        const axis = new THREE.Vector3(0, 1, 0).transformDirection(holder.matrixWorld);
        if (axis.y > 0.9) upright++;
        const time = (a as unknown as {actions: Map<string, THREE.AnimationAction>}).actions.get(r.drink!.clip)!.time;
        if (drinkSipAt(r.drink!.variant, time / T) > 0.98) minTopAtSip = Math.min(minTopAtSip, d);
      }
      expect(minTop, r.id).toBeLessThan(0.06); // the bottle's top at the lips (within the face's own depth)
      expect(minTopAtSip, r.id).toBeLessThan(0.06);
      expect(upright / (T * 15), r.id).toBeGreaterThan(0.4); // most of the loop it is held upright
    }
    // staggered: not all at the same point of the same loop
    const times = P.map(r => (r.actor as unknown as {actions: Map<string, THREE.AnimationAction>}).actions.get(r.drink!.clip)!.time.toFixed(2));
    expect(new Set(times).size).toBeGreaterThan(1);
    // both variants over a few stations
    const variants = new Set<number>();
    for (const seed of [808, 1234, 31]) { const {w: u} = barMarket(seed); u.build(); for (const r of patrons(u)) variants.add(r.drink!.variant); }
    expect(variants).toEqual(new Set([0, 1]));
  });

  it('patrons linger for more rounds and the regulars come back; a resident walking away puts the bottle away', () => {
    const {w} = barMarket();
    w.build();
    let walkingWithBottle = 0, maxAtBar = 0, minAtBar = Infinity;
    for (let i = 0; i < 30 * 240; i++) {
      w.frame(1 / 30);
      for (const r of w.people.residents) if (r.state === 'walk' && r.bottle?.holder.visible) walkingWithBottle++;
      if (i % 30 === 0) { const n = patrons(w).length; maxAtBar = Math.max(maxAtBar, n); minAtBar = Math.min(minAtBar, n); }
    }
    expect(walkingWithBottle).toBe(0);
    expect(w.people.counts.lingers).toBeGreaterThan(0);
    expect(w.people.counts.rounds).toBeGreaterThan(patrons(w).length); // more rounds than the opening ones
    expect(minAtBar).toBeGreaterThan(0); // the bar is never empty for long
    for (const r of patrons(w)) { expect(r.bottle!.holder.visible).toBe(true); expect(r.actor.loop).toBe(r.drink!.clip); }
  });

  it('the bartender (the \'bar\' stall\'s trader) works the counter between a word and a pause, and turns to talk to a customer', () => {
    const {w} = barMarket();
    w.build();
    const t = w.people.traders.find(x => x.stall.id === 'bar')!;
    expect(t.bartender).toBe(true);
    expect(w.people.traders.filter(x => x.bartender)).toEqual([t]); // (one bartender: the bar stall's)
    expect(t.actor.loop).toBe('Work');
    const loops = new Set<string>();
    for (let i = 0; i < 30 * 60; i++) { w.frame(1 / 30); loops.add(t.actor.loop); }
    expect(loops.has('Work')).toBe(true);
    expect(loops.size).toBeGreaterThan(1);
    // a customer at the bar's customer spot (in front of the counter): the bartender turns to talk
    const st = w.layout.market!.stalls.find(s => s.id === 'bar')!;
    Object.assign(w.player, {x: st.front.x, y: st.front.y, z: st.front.z});
    for (let i = 0; i < 20; i++) w.frame(1 / 30);
    expect(t.actor.loop).toBe('Talk');
  });

  it('a \'drink\' post with no seat (synthetic, on a version-2 layout without a bar): the patron drinks standing at the post', () => {
    const {w} = standingPosts();
    w.build();
    const P = patrons(w);
    expect(P.length).toBeGreaterThan(0);
    for (const r of P) {
      const s = w.people.spots[r.spot];
      expect(r.drink!.seat).toBeNull();
      expect(r.actor.loop).toMatch(/^Drink2?$/);
      expect(Math.hypot(r.actor.x - s.x, r.actor.z - s.z)).toBeLessThan(0.05);
      expect(r.bottle!.holder.visible).toBe(true);
      r.actor.animate(0.01);
      expect(bonePos(r.actor, 'Hips').y - r.actor.y).toBeGreaterThan(0.7); // standing
    }
    for (const t of w.people.traders) expect(t.bartender).toBe(false); // (no bar stall on v2)
  });

  it('hostile: the bottles are put away; the bar\'s people take part — a theft at the bar makes the bartender fight', () => {
    const {w} = barMarket();
    w.build();
    expect(patrons(w).length).toBeGreaterThan(0);
    w.combat.provoke({kind: 'theft', stall: 'bar' as MarketStallId});
    w.frame(1 / 30);
    for (const r of w.people.residents) { expect(r.drink).toBeNull(); expect(r.bottle?.holder.visible ?? false).toBe(false); }
    expect(w.combat.people.find(p => p.id === 'trader:bar')!.role).toBe('fight');
    expect(w.combat.people.some(p => p.id === 'trader:bar')).toBe(true);
  });

  it('a market without \'drink\' spots (layouts v1 / v2) has no patron, no bottle, no drinking loop', () => {
    for (const v of [1, 2]) {
      const w = combatWorld(A, 808, {layoutVersion: v});
      w.people.bottleSource = () => ({obj: can, item: 'cola', source: 'test'});
      w.build();
      expect(w.layout.market!.spots.some(s => s.kind === 'drink')).toBe(false);
      w.run(20);
      for (const r of w.people.residents) { expect(r.drink).toBeNull(); expect(r.bottle).toBeNull(); expect(r.regular).toBe(false); expect(r.actor.loop.startsWith('Drink')).toBe(false); }
      for (const t of w.people.traders) expect(t.bartender).toBe(false);
    }
  });

  it('the bottle: the beer\'s model when it has one, else the cola can — measured from its bounds (held low on a tall bottle, mid-can)', () => {
    expect(PATRON_BOTTLE_ITEMS).toEqual(['beer_lager', 'cola']);
    expect(bottleSpecOf(can)).toMatchObject({h: 0.122, grip: 0.061});
    const beer = new THREE.Group(); const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.235, 8)); cyl.position.y = 0.1175; beer.add(cyl);
    const b = bottleSpecOf(beer);
    expect(b.h).toBeCloseTo(0.235, 3);
    expect(b.grip / b.h).toBeLessThan(0.4);
  });
});
