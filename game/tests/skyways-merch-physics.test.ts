// Task studio-skywalk-variety-20261107-231448-01 (lane MERCH; user: "some store items do not move when shot, like the skates in the
// sports store. It is a standing rule … that items on top of counters / shelves should not be part of the counter / shelf and have
// physics, when shot!"). physics/merchOnHost.ts: movable on-host decor goes loose on its static host's top OR on a known open support
// inside the host's box (a loot holder's own surfaces, a declared PropDef.shelves, hooks), and a bullet that strikes open shelving goes on
// into it to the first resting shelf piece. Proven here through the REAL paths:
//  - the rule: where a piece stands, which supports count, the Office counter-well monitor still static (no known support);
//  - the bullet: raycastWorld stops at the slatwall bay's box (the cause), raycastShot reaches the skates inside it; never through a
//    closed holder or a host without known shelves;
//  - real Skyways stores (layout version 3 AND the live version 4, seeds found, not hard-coded): the real world render, damage system,
//    loot holders (their uncut surfaces) and physics; a buckshot volley into one sample of EVERY movable-kind @ host pair found resting
//    inside its host (skates, helmets, gloves, shin guards, books, model kits, camp stoves / lanterns, lab glassware, record crates, bin
//    blocks, hanging pots …) — it goes loose, moves, never sinks through the shelf it stood on, and comes to rest supported (a shelf, a
//    tier, the floor, another prop), asleep; a pot shot out of its basket falls and a real Player walking into it shoves it;
//  - the guard: every movable on-host decor resting inside its host on real seeds stands on a known open support (holder surface not
//    behind a door / declared shelf / hook), and no declared board starts inside any of its host's stock — the listed exceptions only.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {raycastWorld, type Vec3} from '../src/combat/hitscan';
import {DamageSystem} from '../src/damage/system';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {propPhysics} from '../src/damage/materials';
import {isLootHolderKind} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {shelfInfo} from '../src/world/containers';
import {holderBoxes} from '../src/physics/holderShapes';
import {PhysicsSystem} from '../src/physics/world';
import {SHELF_BOARD, hostRest, hostShelves, looseDecorKind, onDeclaredShelf, raycastShot, restsOnHost, shelfDecorIndex} from '../src/physics/merchOnHost';
import {contactRig, DT, stand, walkForward, type ContactRig} from './helpers/contactWalk';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const SEEDS = 10;
const VERSIONS = [3, 4] as const;
/** Movable decor kind @ host kind that deliberately stays on its host, with the reason (the audit row says the same). */
const EXCEPTIONS: Readonly<Record<string, string>> = {
  'skyMuFacedRecords@skyMuCoverWall': 'five LP sleeves are ONE prop (a 1.9 m row): it would fly as a single plank, so the board declares no shelves',
};

const gen = (seed: number, layoutVersion: number) => LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion} as never) as StationLayout;
const place = (kind: string, x: number, z: number, y = 0, extra: Partial<PropPlacement> = {}): PropPlacement => {
  const d = (PROP_DEFS as unknown as Record<string, {w: number; d: number; h: number}>)[kind];
  return {kind: kind as PropPlacement['kind'], x, z, y, rot: 0, area: 0, hx: d.w / 2, hz: d.d / 2, h: d.h, blocksSight: false, variant: 0, ...extra};
};
function room(): Grid {
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 1 || y < 2 || x >= 47 || y >= 31 ? SOLID : FLOOR);
  return g;
}
/** Host-local (x, z). */
function local(q: PropPlacement, x: number, z: number): [number, number] {
  const c = Math.cos(q.rot), s = Math.sin(q.rot), dx = x - q.x, dz = z - q.z;
  return [dx * c - dz * s, dx * s + dz * c];
}
type Surf = {y: number; x0: number; x1: number; z0: number; z1: number; part?: number};
/** The host's real open supports in its frame: a holder's UNCUT loot surfaces (as world/containers.ts collides them) or its declared shelves. */
function supportsOf(q: PropPlacement): readonly Surf[] {
  if (isLootHolderKind(q.kind)) return holderSurfaces(q.kind as never, (PROP_DEFS as unknown as Record<string, {w: number; d: number; h: number}>)[q.kind] as never, {shelf: shelfInfo()}) as Surf[];
  return hostShelves(q.kind) ?? [];
}

// ---------------------------------------------------------------------------------------------
describe('the rule: where movable on-host decor may go loose', () => {
  it('top face / known open shelf inside the host / nothing: the classification every consumer reads', () => {
    const bay = place('wallBay', 6, 3);
    const deck = supportsOf(bay).find(s => s.y > 0.4 && s.y < 0.7)!;
    const skates = place('hkSkates', 6, 3 + (deck.z0 + deck.z1) / 2, deck.y, {host: 0});
    const top = place('hkHelmet', 6.3, 3, bay.h, {host: 0});
    const props = [bay, skates, top];
    expect(hostRest(skates, bay)).toBe('shelf');
    expect(hostRest(top, bay)).toBe('top');
    expect(restsOnHost(skates, props)).toBe('shelf'); // a loot holder: its loot surfaces are its shelves
    // a host that can move, a piece beside its host: never
    expect(hostRest(skates, place('rollingSuitcase', 6, 3))).toBeNull();
    expect(hostRest(place('hkSkates', 9, 3, 0.5, {host: 0}), bay)).toBeNull();
    // a declared bookcase: on a measured shelf yes, between two shelves no; a hanging-basket rail ([] = hooks): its hung pots yes
    const bc = place('skyDBookcase', 6, 3), sh = hostShelves('skyDBookcase')!;
    expect(sh.length).toBeGreaterThanOrEqual(6);
    const on = place('skyDBookStack', 6, 3, sh[2].y, {host: 0}), off = place('skyDBookStack', 6, 3, (sh[2].y + sh[3].y) / 2, {host: 0});
    expect(restsOnHost(on, [bc, on])).toBe('shelf');
    expect(restsOnHost(off, [bc, off])).toBeNull();
    expect(onDeclaredShelf(on, bc, sh)).toBe(true);
    const rail = place('storeGardenBasketRail', 6, 3, 2.4), pot = place('skyDGeraniumPot', 6.6, 3, 2.4, {host: 0});
    expect(hostShelves('storeGardenBasketRail')).toEqual([]);
    expect(restsOnHost(pot, [rail, pot])).toBe('shelf');
    expect(looseDecorKind('hkSkates') && looseDecorKind('skyDBookStack') && looseDecorKind('skyDGeraniumPot')).toBe(true);
  });

  it('isDynamicProp: shelf stock goes loose on a holder / declared shelf; the Office counter-well monitor (no known support) stays put', () => {
    const bay = place('wallBay', 6, 6), deck = supportsOf(bay).find(s => s.y > 0.4 && s.y < 0.7)!;
    const skates = place('hkSkates', 6, 6 + (deck.z0 + deck.z1) / 2, deck.y, {host: 0});
    const rd = place('receptionDesk', 14, 6), mon = place('officeMonitor', 14, 6, 0.74, {host: 2});
    const bc = place('skyDBookcase', 20, 6), sh = hostShelves('skyDBookcase')!, book = place('skyDBookStack', 20, 6, sh[1].y, {host: 4});
    const ph = new PhysicsSystem(null);
    ph.build({grid: room(), props: [bay, skates, rd, mon, bc, book], trench: {floorY: -1.15}} as never);
    expect(ph.dynamicItems.isDynamicProp(skates)).toBe(true);
    expect(ph.dynamicItems.isDynamicProp(book)).toBe(true);
    expect(ph.dynamicItems.isDynamicProp(mon)).toBe(false); // inside the counter's closed block (docs/prop-affordances.md: unchanged)
    expect(ph.dynamicItems.isDynamicProp(bay) || ph.dynamicItems.isDynamicProp(bc) || ph.dynamicItems.isDynamicProp(rd)).toBe(false);
  });
});

describe('the bullet: into open shelving, never through a closed holder or a block without known shelves', () => {
  it('raycastWorld stops at the bay\'s box (the cause); raycastShot reaches the skates on its deck', () => {
    const bay = place('wallBay', 6, 3.4), deck = supportsOf(bay).find(s => s.y > 0.4 && s.y < 0.7)!;
    const skates = place('hkSkates', 6, 3.4 + (deck.z0 + deck.z1) / 2, deck.y, {host: 0});
    const cab = place('cabinetTall', 12, 3.4), inner = supportsOf(cab).find(s => s.y > 0.3)!;
    const kits = place('skyDModelKits', 12, 3.4 + (inner.z0 + inner.z1) / 2, inner.y, {host: 2});
    const rd = place('receptionDesk', 18, 3.4), mon = place('officeMonitor', 18, 3.4, 0.74, {host: 4});
    const props = [bay, skates, cab, kits, rd, mon], g = room();
    const shoot = (x: number, y: number) => { const o: Vec3 = {x, y, z: 8}, d = new THREE.Vector3(0, 0, 3.4 - 8).normalize(); return {o, d: {x: d.x, y: d.y, z: d.z}}; };
    const a = shoot(skates.x, skates.y + skates.h / 2);
    expect(raycastWorld(g, props, a.o, a.d, 20, -1.15).prop).toBe(0); // the bay's front face
    const hit = raycastShot(g, props, a.o, a.d, 20, -1.15);
    expect(hit.prop).toBe(1);
    expect(hit.t).toBeCloseTo(8 - (skates.z + skates.hz), 3);
    expect(hit.nz).toBe(1);
    // a closed cabinet / the counter block: the bullet stops at their box
    const b = shoot(kits.x, kits.y + kits.h / 2), c = shoot(mon.x, mon.y + 0.2);
    expect(raycastShot(g, props, b.o, b.d, 20, -1.15).prop).toBe(2);
    expect(raycastShot(g, props, c.o, c.d, 20, -1.15).prop).toBe(4);
    // a loose piece has no box: the bay takes the ray again (DamageSystem.knockPickups then hits the body inside it)
    skates.h = 0;
    expect(raycastShot(g, props, a.o, a.d, 20, -1.15).prop).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// real Skyways layouts

interface Sample { seed: number; v: number; key: string; index: number }
let samples: Sample[] = [];
const guard = {checked: 0, keys: new Set<string>(), exceptions: 0};
beforeAll(() => {
  const seen = new Set<string>();
  for (const v of VERSIONS) for (let seed = 1; seed <= SEEDS; seed++) {
    const l = gen(seed, v);
    l.props.forEach((p, i) => {
      if (p.host === undefined || !looseDecorKind(p.kind)) return;
      const q = l.props[p.host];
      if (hostRest(p, q) !== 'shelf') return;
      const key = `${p.kind}@${q.kind}`;
      guard.keys.add(key);
      // one sample per pair and layout version (the bullet must be able to enter: not an enclosed holder)
      if (!EXCEPTIONS[key] && !seen.has(`${v}:${key}`) && shelfDecorIndex(l.props).get(p.host)?.includes(i)) { seen.add(`${v}:${key}`); samples.push({seed, v, key, index: i}); }
    });
  }
  samples = samples.sort((a, b) => a.v - b.v || a.seed - b.seed);
}, 600_000);

describe('real Skyways stores (layout versions 3 and 4)', () => {
  it('the guard: every movable on-host decor resting inside its host stands on a known open support; no declared board starts inside its stock', () => {
    for (const v of VERSIONS) for (let seed = 1; seed <= SEEDS; seed++) {
      const l = gen(seed, v);
      const byHost = new Map<number, number[]>();
      l.props.forEach((p, i) => {
        if (p.host === undefined || !looseDecorKind(p.kind)) return;
        const q = l.props[p.host], why = `v${v} seed ${seed} #${i} ${p.kind}@${q.kind}`;
        if (hostRest(p, q) !== 'shelf') return;
        const key = `${p.kind}@${q.kind}`;
        if (EXCEPTIONS[key]) { expect(restsOnHost(p, l.props), `${why}: an exception stays put`).toBeNull(); guard.exceptions++; return; }
        expect(restsOnHost(p, l.props), why).toBe('shelf');
        const sup = supportsOf(q), ly = p.y - q.y, [lx, lz] = local(q, p.x, p.z);
        if (isLootHolderKind(q.kind)) {
          const s = sup.find(f => Math.abs(f.y - ly) < 0.03 && lx >= f.x0 - 0.02 && lx <= f.x1 + 0.02 && lz >= f.z0 - 0.02 && lz <= f.z1 + 0.02);
          expect(s, `${why}: on one of the holder's surfaces`).toBeTruthy();
          expect(s!.part, `${why}: an open surface, not behind a door / in a drawer`).toBeUndefined();
        } else if (sup.length) expect(onDeclaredShelf(p, q, sup as never), `${why}: on a declared shelf`).toBe(true);
        guard.checked++;
        const l2 = byHost.get(p.host);
        if (l2) l2.push(i); else byHost.set(p.host, [i]);
      });
      // a declared host's boards (as physics/world.ts builds them) never start inside any of its stock (it would pop when loose)
      for (const [hi, list] of byHost) {
        const q = l.props[hi], sh = hostShelves(q.kind);
        if (isLootHolderKind(q.kind) || !sh?.length) continue;
        const boards = holderBoxes(q, sh, {slab: SHELF_BOARD}) ?? [];
        for (const i of list) {
          const p = l.props[i], box = new THREE.Box3(new THREE.Vector3(p.x - p.hx + 0.005, p.y + 0.005, p.z - p.hz + 0.005), new THREE.Vector3(p.x + p.hx - 0.005, p.y + p.h - 0.005, p.z + p.hz - 0.005));
          for (const b of boards) expect(b.intersectsBox(box), `v${v} seed ${seed} ${p.kind} #${i} vs a board of ${q.kind}`).toBe(false);
        }
      }
    }
    expect(guard.checked).toBeGreaterThan(500);
    // not vacuous: the stores' shelf stock is all here
    for (const k of ['hkSkates@wallBay', 'hkHelmet@wallBay', 'skyDBookStack@skyDBookcase', 'skyDBookStack@bookstoreBookcase', 'skyDModelKits@shelf', 'campStove@retailGondola',
      'skyMuBinRecords@skyDRecordBins', 'skyDGeraniumPot@storeGardenBasketRail', 'labMicroscope@shelf']) expect(guard.keys.has(k), k).toBe(true);
    // every movable kind found on a shelf is classified dynamic in the physics audit
    for (const key of guard.keys) expect(PROP_PHYSICS_AUDIT[key.split('@')[0]]?.cls, key).toBe('dynamic');
  }, 600_000);

  it('a buckshot volley into one sample of every movable-kind @ host pair: it goes loose, moves, never sinks through its shelf, rests supported', () => {
    expect(samples.length).toBeGreaterThanOrEqual(16);
    const keys = new Set(samples.map(s => s.key));
    for (const k of ['hkSkates@wallBay', 'skyDBookStack@skyDBookcase', 'skyMuBinRecords@skyDRecordBins', 'campStove@retailGondola', 'skyDModelKits@shelf']) expect(keys.has(k), k).toBe(true);
    const bySeed = new Map<string, Sample[]>();
    for (const s of samples) { const k = `${s.v}:${s.seed}`; const l = bySeed.get(k); if (l) l.push(s); else bySeed.set(k, [s]); }
    let tested = 0;
    const versions = new Set<number>();
    for (const list of bySeed.values()) {
      const {rig, sys} = realRig(gen(list[0].seed, list[0].v));
      for (const s of list) {
        const why = `v${s.v} seed ${s.seed} ${s.key} #${s.index}`;
        const r = shootSample(rig, sys, s.index, why);
        if (!r) continue;
        tested++;
        versions.add(s.v);
      }
    }
    expect(tested, 'samples reached by a bullet').toBeGreaterThanOrEqual(Math.ceil(samples.length * 0.85));
    expect([...versions].sort()).toEqual([3, 4]);
  }, 900_000);

  it('Blue Line Sports: skates shot off the boot wall; a geranium pot shot out of its basket falls and a real Player shoves it along the floor', () => {
    let pushed = 0;
    for (const v of VERSIONS) {
      const sk = samples.find(s => s.v === v && s.key === 'hkSkates@wallBay');
      expect(sk, `v${v}: a hockey store with skates`).toBeTruthy();
      const {rig, sys} = realRig(gen(sk!.seed, v));
      expect(shootSample(rig, sys, sk!.index, `v${v} skates`), `v${v}: the skates were hit`).toBeTruthy();
      expect(sys.counts.propsShoved).toBeGreaterThan(0);
      const pot = samples.find(s => s.v === v && s.key === 'skyDGeraniumPot@storeGardenBasketRail');
      if (!pot) continue;
      const {rig: rg, sys: sy} = pot.seed === sk!.seed ? {rig, sys} : realRig(gen(pot.seed, v));
      const res = shootSample(rg, sy, pot.index, `v${v} pot`);
      expect(res, `v${v}: the pot was hit`).toBeTruthy();
      const q = rg.layout.props[pot.index], floor = rg.L.floorAt(res!.end.x, res!.end.z, res!.minY + 0.02, 0.05);
      expect(res!.minY - floor, 'the hung pot fell to the floor').toBeLessThan(0.08);
      // a real Player walks into it: it is shoved along the floor (contact on a loose prop; no shot)
      const at = standPoint(rg, res!.end);
      if (!at) continue;
      stand(rg, at);
      walkForward(rg, 1.6);
      for (let k = 0; k < 120; k++) rg.ph.update(DT);
      const after = posOf(rg, q)!;
      expect(after.p.distanceTo(res!.end), 'shoved by the walker').toBeGreaterThan(0.1);
      pushed++;
    }
    expect(pushed, 'a pot shoved by the Player on at least one layout version').toBeGreaterThan(0);
  }, 900_000);
});

// ---------------------------------------------------------------------------------------------
// helpers: the real rig (contactWalk: render, holders, pickups, physics, a Player) + the game's damage system, wired like game.ts

function realRig(layout: StationLayout): {rig: ContactRig; sys: DamageSystem} {
  const rig = contactRig(layout, {containers: 'skyways'});
  const cm = rig.cm!, pk = rig.pickups!;
  const sys = new DamageSystem(null, null);
  let s = 7;
  sys.rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  sys.build(layout, null, [rig.world.group, cm.group], {
    physics: rig.ph, ownMeshes: p => cm.ownMeshes(p), pickups: () => pk.list,
    lots: (o, d, maxT) => cm.shotLots(o, d, maxT).map(l => ({holder: l.holder, lotId: l.lotId, t: l.t})),
    lotsIn: box => cm.lotsInBox(box),
  });
  return {rig, sys};
}

const SHOT = {damage: 15, pellet: true, weapon: 'shotgun'} as const;
/** A buckshot volley along (o, d), each pellet like Game.fire: raycastShot, knockPickups, hitWorld. */
function volley(rig: ContactRig, sys: DamageSystem, o: Vec3, d: Vec3, n = 9): void {
  sys.beginShot();
  for (let k = 0; k < n; k++) {
    const wh = raycastShot(rig.L, rig.layout.props, o, d, 8, rig.layout.trench.floorY);
    const end = new THREE.Vector3(o.x + d.x * wh.t, o.y + d.y * wh.t, o.z + d.z * wh.t);
    sys.knockPickups(o, d, wh.t, wh, SHOT);
    if (wh.kind !== 'none') sys.hitWorld(wh, end, new THREE.Vector3(d.x, d.y, d.z), SHOT);
  }
}

/** A loose piece as drawn: its body's object matrix -> centre, lowest corner, footprint. */
function posOf(rig: ContactRig, p: PropPlacement): {p: THREE.Vector3; minY: number; box: THREE.Box3} | null {
  const e = rig.ph.dynamicItems.loose().find(q => q.prop === p);
  if (!e) return null;
  const box = new THREE.Box3();
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) box.expandByPoint(new THREE.Vector3(e.center.x + sx * e.half.x, e.center.y + sy * e.half.y, e.center.z + sz * e.half.z).applyMatrix4(e.matrix));
  const c = e.center.clone().applyMatrix4(e.matrix);
  if (propPhysics(p.kind).shape !== 'cylinder') return {p: c, minY: box.min.y, box};
  // a cylinder collider (radius half.x, axis = the body's local Y): its true lowest point, not its box corner's
  const up = new THREE.Vector3(0, 1, 0).transformDirection(e.matrix), uy = Math.abs(up.y);
  return {p: c, minY: c.y - e.half.y * uy - e.half.x * Math.sqrt(Math.max(0, 1 - uy * uy)), box};
}

/** The highest support top at or just under `minY` overlapping the footprint: the floor, a host surface, a prop's top, a loose body. */
function supportUnder(rig: ContactRig, self: PropPlacement, box: THREE.Box3, minY: number): number {
  const c = box.getCenter(new THREE.Vector3());
  let best = rig.L.floorAt(c.x, c.z, minY + 0.02, 0.05);
  const take = (top: number) => { if (top <= minY + 0.05 && top > best) best = top; };
  const over = (x0: number, x1: number, z0: number, z1: number) => x1 > box.min.x && x0 < box.max.x && z1 > box.min.z && z0 < box.max.z;
  for (const q of rig.layout.props) {
    if (q === self) continue;
    if (q.h > 0.02 && over(q.x - q.hx, q.x + q.hx, q.z - q.hz, q.z + q.hz)) take(q.y + q.h);
    if (Math.abs(q.x - c.x) > 3 || Math.abs(q.z - c.z) > 3) continue;
    for (const s of supportsOf(q)) {
      // the surface's world rect (hosts turn in quarter turns)
      const a = new THREE.Vector3(), b = new THREE.Box3(), cs = Math.cos(q.rot), sn = Math.sin(q.rot);
      for (const lx of [s.x0, s.x1]) for (const lz of [s.z0, s.z1]) b.expandByPoint(a.set(q.x + lx * cs + lz * sn, 0, q.z - lx * sn + lz * cs));
      if (over(b.min.x, b.max.x, b.min.z, b.max.z)) take(q.y + s.y);
    }
  }
  for (const e of rig.ph.dynamicItems.loose()) {
    if (e.prop === self) continue;
    const o = posOf(rig, e.prop);
    if (o && over(o.box.min.x, o.box.max.x, o.box.min.z, o.box.max.z)) take(o.box.max.y);
  }
  return best;
}

/** Aim at a resting shelf piece from the open side(s) of its host until raycastShot reaches it; volley; settle; check. */
function shootSample(rig: ContactRig, sys: DamageSystem, index: number, why: string): {end: THREE.Vector3; minY: number} | null {
  const props = rig.layout.props, p = props[index], q = props[p.host!];
  if (p.h <= 0.02) return null; // knocked loose by an earlier sample's volley next to it
  const c = new THREE.Vector3(p.x, p.y + p.h * 0.5, p.z);
  const dirs: THREE.Vector3[] = [];
  const radial = new THREE.Vector3(p.x - q.x, 0, p.z - q.z);
  for (const f of [new THREE.Vector3(Math.sin(p.rot), 0, Math.cos(p.rot)), new THREE.Vector3(Math.sin(q.rot), 0, Math.cos(q.rot)), radial.lengthSq() > 1e-4 ? radial.normalize() : null]) {
    if (!f) continue;
    // (from the side first: a piece standing against a wall / a back panel only rocks under a volley straight into it)
    for (const yaw of [0.6, -0.6, 0]) for (const up of [0.15, -0.35, 0.55]) dirs.push(f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).setY(up).normalize());
  }
  // every open line from which a bullet reaches it while it rests (the volley takes the first; a piece boxed in by its neighbours / a
  // wall only rocks — then the next line, as a player would step aside and shoot again)
  const aims: {o: Vec3; d: Vec3}[] = [];
  for (const u of dirs) {
    const o = c.clone().addScaledVector(u, 1.3), d = c.clone().sub(o).normalize();
    const wh = raycastShot(rig.L, props, o, d, 8, rig.layout.trench.floorY);
    if (wh.kind === 'prop' && wh.prop === index) aims.push({o, d});
  }
  if (!aims.length) return null;
  const start = c.clone(), y0 = p.y, sup = supportsOf(q), [lx, lz] = local(q, p.x, p.z);
  const deck = sup.find(s => Math.abs(s.y - (y0 - q.y)) < 0.07 && lx >= s.x0 - 0.02 && lx <= s.x1 + 0.02 && lz >= s.z0 - 0.02 && lz <= s.z1 + 0.02);
  const shoved = sys.counts.propsShoved;
  let sank = false, volleys = 0;
  for (const aim of aims) {
    if (volleys >= 3) break;
    if (volleys > 0 && !rig.ph.dynamicItems.rayHits(aim.o, aim.d, 3, []).some(h => h.prop === p)) continue; // (it no longer stands on that line)
    volley(rig, sys, aim.o, aim.d);
    volleys++;
    if (volleys === 1) {
      expect(p.h, `${why}: loose (no stationary box left)`).toBe(0);
      expect(sys.counts.propsShoved, `${why}: shoved by the volley`).toBeGreaterThan(shoved);
    }
    for (let k = 0; k < 360; k++) {
      rig.ph.update(DT);
      const now = posOf(rig, p);
      if (!now || !deck) continue;
      const [nx, nz] = local(q, now.p.x, now.p.z);
      if (nx > deck.x0 + 0.03 && nx < deck.x1 - 0.03 && nz > deck.z0 + 0.03 && nz < deck.z1 - 0.03 && now.minY < y0 - 0.07) sank = true;
    }
    const at = posOf(rig, p);
    if (at && at.p.distanceTo(start) > 0.02) break;
  }
  const end = posOf(rig, p);
  expect(end, `${why}: still a loose body`).toBeTruthy();
  expect(rig.ph.dynamicItems.stats().propsAwake, `${why}: settled (asleep)`).toBe(0);
  expect(sank, `${why}: sank through the shelf it stood on`).toBe(false);
  expect(end!.p.distanceTo(start), `${why}: it moved (${volleys} volleys, ${sys.counts.propsShoved - shoved} pellets shoved it)`).toBeGreaterThan(0.02);
  const under = supportUnder(rig, p, end!.box, end!.minY);
  expect(end!.minY - under, `${why}: resting on something (not floating): min y ${end!.minY.toFixed(3)} support ${under.toFixed(3)} (stood at ${y0.toFixed(3)}, host ${q.kind} at ${q.y.toFixed(3)}; ends at ${end!.p.x.toFixed(2)}, ${end!.p.y.toFixed(2)}, ${end!.p.z.toFixed(2)})`).toBeLessThan(0.07);
  expect(end!.minY - under, `${why}: not sunk into its support`).toBeGreaterThan(-0.08);
  return {end: end!.p, minY: end!.minY};
}

/** A stand point 1.1 m from `at` on free floor of its storey (facing it), or null. */
function standPoint(rig: ContactRig, at: THREE.Vector3): {x: number; z: number; yaw: number; y: number} | null {
  const feet = rig.L.floorAt(at.x, at.z, at.y + 0.1);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, ax = Math.sin(a), az = Math.cos(a);
    let ok = true;
    for (let s = 0.25; s <= 1.5 && ok; s += 0.1) {
      const x = at.x + ax * s, z = at.z + az * s;
      for (const dx of [-0.36, 0, 0.36]) {
        const px = x + az * dx, pz = z - ax * dx, cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
        if (rig.L.blocksAt(cx, cz, px, pz, feet) || Math.abs(rig.L.floorAt(px, pz, feet + 0.1) - feet) > 0.05) ok = false;
      }
      if (rig.layout.props.some(q => q.h > 0.05 && !q.mounted && q.y < feet + 1.8 && q.y + q.h > feet + 0.05 && Math.abs(q.x - x) < q.hx + 0.4 && Math.abs(q.z - z) < q.hz + 0.4)) ok = false;
    }
    if (ok) return {x: at.x + ax * 1.1, z: at.z + az * 1.1, yaw: Math.atan2(ax, az), y: feet};
  }
  return null;
}
