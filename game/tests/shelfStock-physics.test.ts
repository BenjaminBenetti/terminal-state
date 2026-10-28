// Iteration 08 (Lane S): filler stock physics — pellet hits wake exactly what they hit with the
// impulse at the hit point, an ordinary shotgun blast scatters a group of pieces with only local
// knock-on, everything settles on the right floor (also on an upper deck), the active-body budget
// holds, nothing is lost, duplicated, respawned or turned into loot.
import * as THREE from 'three';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {installStockCanvas, loadModel, stockProp} from './helpers/stockHelpers';
import {levelFixture, FIX} from './helpers/levelFixture';
import {CELL, FLOOR, Grid, SOLID, VOID} from '../src/gen/grid';
import {SHELF_TIER_Y, type PropPlacement} from '../src/gen/props';
import {PhysicsSystem} from '../src/physics/world';
import {FILLER_TUNING, MAX_ACTIVE_FILLER, rayCollider, type FillerPiece} from '../src/physics/fillerStock';
import {raycastWorld} from '../src/combat/hitscan';
import {ShelfStock} from '../src/world/shelfStock';
import {WEAPONS} from '../src/weapons/weapons';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

let uninstall: () => void = () => {};
let shelf: GLTF;
beforeAll(async () => { uninstall = await installStockCanvas(false); shelf = await loadModel('shelf.glb'); });
afterAll(() => uninstall());

/** A walled hall (floor 0) with a track bed strip, like tests/physics-dynamics.test.ts. */
function hall(props: PropPlacement[], seed = 77) {
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 30 ? SOLID : y >= 24 ? VOID : FLOOR);
  return {grid: g, props, trench: {floorY: -1.15}, areas: [{purpose: 'convenience'}], seed};
}

function scene(layout: {props: PropPlacement[]; seed: number}, audio: ConstructorParameters<typeof PhysicsSystem>[1] = null) {
  const ph = new PhysicsSystem(null, audio);
  ph.build(layout as never);
  const S = new ShelfStock();
  S.filler.attach(ph);
  ph.holderBoxes = p => S.physicsBoxes(p, null);
  S.build(layout as never, {models: {shelf}});
  return {ph, S};
}

const run = (ph: PhysicsSystem, seconds: number, each?: (f: number) => void) => { for (let f = 0; f < seconds * 60; f++) { ph.update(1 / 60); each?.(f); } };

/** Pellet directions of one ordinary shotgun shot (game.ts fire(): uniform disc in the hip-fire cone). */
function pellets(eye: THREE.Vector3, aim: THREE.Vector3, seed: number): THREE.Vector3[] {
  const def = WEAPONS.shotgun;
  const fwd = aim.clone().sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < def.pellets; i++) {
    const a = rnd() * Math.PI * 2, r = def.spreadHip * Math.sqrt(rnd());
    out.push(fwd.clone().addScaledVector(right, Math.tan(r) * Math.cos(a)).addScaledVector(up, Math.tan(r) * Math.sin(a)).normalize());
  }
  return out;
}

/** Fire one shotgun shot through the same entry point game.ts uses (pelletHit -> shoot). Returns the hit points. */
function blast(S: ShelfStock, props: PropPlacement[], eye: THREE.Vector3, aim: THREE.Vector3, seed: number): THREE.Vector3[] {
  const hits: THREE.Vector3[] = [];
  for (const dir of pellets(eye, aim, seed)) {
    const fh = S.pelletHit(eye, dir, WEAPONS.shotgun.range, {t: WEAPONS.shotgun.range, kind: 'none'}, props, false);
    if (!fh) continue;
    hits.push(fh.point.clone());
    S.shoot(fh, dir, WEAPONS.shotgun.damage);
  }
  return hits;
}

const moved = (p: FillerPiece) => p.p.distanceTo(p.home) > 0.03;
/**
 * Floor under a settled piece: the hall floor (0), or the track bed (trench floorY) over the VOID strip — iteration 12: light junk
 * (open boxes, empty bottles) rebounding off the shelf back can carry across the hall into the track bed; it must rest ON it.
 */
const floorUnder = (L: {grid: Grid; trench: {floorY: number}}, p: FillerPiece) => {
  const [cx, cy] = L.grid.cellOf(p.p.x, p.p.z);
  return L.grid.inBounds(cx, cy) && L.grid.get(cx, cy) === VOID ? L.trench.floorY : 0;
};

describe('pellet hits', () => {
  it('a ray wakes exactly the piece it hits and pushes it at the hit point (off-centre hits spin it)', () => {
    const sh = stockProp('stockShelf', 8, 3, {variant: 1});
    const L = hall([sh]);
    const {ph, S} = scene(L);
    // the front-most upright piece on the middle board
    const cands = S.filler.pieces.filter(p => S.holders[p.holder].placements[p.id - S.holders[p.holder].first].board === 1 && p.above.length === 0 && Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(p.q).y) > 0.99);
    const target = cands.sort((a, b) => b.p.z - a.p.z)[0];
    expect(target).toBeTruthy();
    const half = target.spec.half;
    const eye = new THREE.Vector3(target.p.x + half[0] * 0.55, target.p.y + half[1] * 0.3, target.p.z + 2.2);
    const dir = new THREE.Vector3(0, 0, -1);
    const fh = S.pelletHit(eye, dir, 30, {t: 30, kind: 'none'}, L.props, false)!;
    expect(fh.piece).toBe(target);
    // exact test: the hit lies on the piece's own collider surface
    expect(rayCollider(target.spec, target.p, target.q, eye, dir, 30)!.t).toBeCloseTo(fh.t, 6);
    expect(fh.t).toBeGreaterThan(2.2 - half[2] - 0.05);
    const others = S.filler.pieces.filter(p => p !== target).map(p => p.p.clone());
    S.shoot(fh, dir, WEAPONS.shotgun.damage);
    const b = target.body!;
    expect(target.state).toBe('awake');
    expect(b.velocity.z).toBeLessThan(-0.5); // pushed along the pellet's travel
    expect(b.velocity.y).toBeGreaterThan(0); // and lifted
    expect(b.angularVelocity.length()).toBeGreaterThan(0.5); // off-centre: spin
    // nothing else moved or woke at the moment of the hit (no radial blast): only what rested on it, what the
    // pellet went on to pierce behind light packaging, and its local splash — neighbours on the SAME board within
    // FILLER_TUNING.splashRadius of the impact
    expect(S.filler.awake).toBeLessThanOrEqual(1 + S.filler.counts.supportLoss + S.pierced + S.filler.counts.splashed); // (a pierced piece may also be splashed)
    const board = (p: FillerPiece) => S.holders[p.holder].placements[p.id - S.holders[p.holder].first].board;
    for (const p of S.filler.moving()) {
      if (p === target || target.above.includes(p.id)) continue;
      expect(board(p)).toBe(1);
      expect(Math.hypot(p.home.x - fh.point.x, p.home.z - fh.point.z)).toBeLessThan(FILLER_TUNING.splashRadius + 0.6); // splash or the pierced piece behind
    }
    // a splashed neighbour is jostled, never launched like a direct hit (capped; mostly along the pellet, into the
    // shelf): one hit without piercing on a fresh copy of the shelf
    {
      const {S: S2} = scene(hall([stockProp('stockShelf', 8, 3, {variant: 1})]));
      const t2 = S2.filler.pieces[target.id];
      expect(S2.filler.shoot(t2, fh.point, dir, WEAPONS.shotgun.damage * FILLER_TUNING.impulsePerDamage, fh.normal)).toBe(true);
      const splashed = S2.filler.moving().filter(p => p !== t2 && !t2.above.includes(p.id));
      expect(splashed.length).toBeGreaterThan(0);
      for (const p of splashed) expect(p.body!.velocity.length()).toBeLessThanOrEqual(FILLER_TUNING.splashMaxDv + 1e-6);
    }
    S.filler.pieces.filter(p => p !== target).forEach((p, i) => expect(p.p.distanceTo(others[i])).toBe(0));
    run(ph, 6);
    expect(S.filler.awake).toBe(0);
    expect(moved(target)).toBe(true);
  });

  it('pellets enter a stocked holder box; an actor in front stops them; glazed holders also take the hit on glass', () => {
    const sh = stockProp('stockShelf', 8, 3, {variant: 0}), cooler = stockProp('shopCooler', 12, 3);
    const L = hall([sh, cooler]);
    const {S} = scene(L);
    // iteration 12: abandoned (low junk) stock — aim at a real front piece of the shelf's middle boards rather than a fixed
    // height over a board (a crushed can or a wrapper is lower than the old fresh packages)
    const front = S.filler.pieces.filter(p => p.holder === 0 && p.home.y > 0.5 && p.home.y < 1.5).sort((a, b) => b.p.z - a.p.z || Math.abs(a.p.x - 8) - Math.abs(b.p.x - 8))[0];
    const eye = new THREE.Vector3(front.p.x, 1.2, 6), dir = front.p.clone().sub(eye).normalize();
    // the world hit is the shelf's AABB front face; the pellet continues into it and finds stock
    const tBox = (6 - (3 + sh.hz)) / -dir.z;
    const fh = S.pelletHit(eye, dir, tBox, {t: tBox, kind: 'prop', prop: 0}, L.props, false);
    expect(fh).toBeTruthy();
    expect(fh!.t).toBeGreaterThan(tBox);
    expect(fh!.glass).toBe(false);
    // a zombie in front (actor hit nearer than the box): stock behind it is not reached
    expect(S.pelletHit(eye, dir, tBox - 0.5, {t: tBox, kind: 'prop', prop: 0}, L.props, true)).toBe(null);
    // cooler: through the glass to the drinks, flagged so the glass takes the hit too
    const ch0 = S.holders.find(h => h.kind === 'shopCooler')!;
    const drink = S.filler.pieces.slice(ch0.first, ch0.first + ch0.count).sort((a, b) => b.p.z - a.p.z)[0]; // a front-row drink
    const ce = new THREE.Vector3(drink.p.x, drink.p.y, 5), cd = new THREE.Vector3(0, 0, -1);
    const ct = (5 - (3 + cooler.hz)) / -cd.z;
    const ch = S.pelletHit(ce, cd, ct, {t: ct, kind: 'prop', prop: 1}, L.props, false);
    expect(ch!.piece).toBe(drink);
    expect(ch!.glass).toBe(true);
  });
});

describe('an ordinary shotgun blast into a stocked shelf', () => {
  /**
   * Game-feel target (primary, after browser QA): one ordinary 9-pellet hip-fire shot at 2.6 m into a FULL
   * board (41 pieces on the grocery shelf's 2nd board) — >= 20 pieces displaced > 5 cm, >= 8 on the floor, a
   * piece >= 1.5 m away, everything settled in bounds, never more than the body cap. Six pellet patterns:
   * the first must meet the target on its own, the mean of all six too, and none may be a dud.
   */
  it('one ordinary shot at 2.6 m sends a full board flying (measured target), coherent and bounded', () => {
    const results: {hits: number; disp: number; floor: number; max: number}[] = [];
    for (let shot = 0; shot < 6; shot++) {
      const sh = stockProp('stockShelf', 8, 3, {variant: 1});
      const L = hall([sh], 2024);
      const {ph, S} = scene(L);
      expect(S.holders[0].placements.filter(p => p.board === 1).length).toBeGreaterThanOrEqual(20); // iteration 12: abandoned (junk) stock — was 41 fresh packages
      const eye = new THREE.Vector3(8, 1.6, 3 + sh.hz + 2.6), aim = new THREE.Vector3(8, SHELF_TIER_Y[1] + 0.12, 3.12);
      // the game's own path: world ray (the shelf box is the hit) -> pelletHit -> shoot
      let hits = 0;
      for (const dir of pellets(eye, aim, 11 + shot * 7919)) {
        const d = {x: dir.x, y: dir.y, z: dir.z};
        const wh = raycastWorld(L.grid, L.props, eye, d, WEAPONS.shotgun.range, L.trench.floorY);
        const fh = S.pelletHit(eye, d, wh.t, wh, L.props, false);
        if (!fh) continue;
        hits++;
        S.shoot(fh, dir, WEAPONS.shotgun.damage);
      }
      let maxAwake = 0;
      run(ph, 10, () => { maxAwake = Math.max(maxAwake, S.filler.awake); });
      expect(maxAwake).toBeLessThanOrEqual(MAX_ACTIVE_FILLER);
      expect(S.filler.awake + S.filler.stats().frozen).toBe(0);
      const D = S.filler.displacement(ph.statics);
      expect(D.belowFloor + D.outside).toBe(0);
      for (const p of S.filler.pieces) { expect(p.box.min.y).toBeGreaterThan(floorUnder(L, p) - 0.025); expect(Math.abs(p.p.z - 3)).toBeLessThan(11); }
      // the boards above / below keep their stock: the blast is local
      expect(S.filler.pieces.filter(p => p.home.y > SHELF_TIER_Y[3]).every(p => !moved(p))).toBe(true);
      results.push({hits, disp: S.filler.pieces.filter(q => q.p.distanceTo(q.home) > 0.05).length,
        floor: S.filler.pieces.filter(q => q.home.y > 0.3 && q.box.min.y < 0.06).length, max: D.maxDisplacement});
    }
    const [first] = results;
    expect(first.disp).toBeGreaterThanOrEqual(20);
    expect(first.floor).toBeGreaterThanOrEqual(8);
    expect(first.max).toBeGreaterThanOrEqual(1.5);
    const mean = (k: 'disp' | 'floor' | 'max') => results.reduce((a, r) => a + r[k], 0) / results.length;
    expect(mean('disp')).toBeGreaterThanOrEqual(20);
    expect(mean('floor')).toBeGreaterThanOrEqual(8);
    expect(mean('max')).toBeGreaterThanOrEqual(1.5);
    for (const r of results) { expect(r.disp).toBeGreaterThanOrEqual(10); expect(r.floor).toBeGreaterThanOrEqual(5); }
  });

  it('sends a group of pieces flying, keeps knock-on local, and everything settles on boards / the floor', () => {
    let totalMoved = 0, offShelf = 0;
    for (const variant of [0, 1, 2]) {
      const sh = stockProp('stockShelf', 8, 3, {variant});
      const L = hall([sh], 100 + variant);
      const {ph, S} = scene(L);
      // iteration 12: aimed at the middle of what stands on the board round x = 8 (the lower, gappier junk stock) — was a fixed
      // 0.12 m over the board, made for the old full blocks of fresh packages
      const onBoard = S.filler.pieces.filter(p => S.holders[p.holder].placements[p.id - S.holders[p.holder].first].board === 1 && Math.abs(p.p.x - 8) < 0.3);
      const mid = onBoard.reduce((v, p) => v.add(p.p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, onBoard.length));
      const eye = new THREE.Vector3(8.1, 1.6, 3 + sh.hz + 2.5), aim = new THREE.Vector3(mid.x, mid.y, 3.1);
      const hits = blast(S, L.props, eye, aim, 11 + variant);
      expect(hits.length).toBeGreaterThanOrEqual(4); // most pellets of a 9-pellet shot land in the stock
      let maxAwake = 0;
      run(ph, 0.6, () => { maxAwake = Math.max(maxAwake, S.filler.awake); });
      const after = S.filler.pieces.filter(moved);
      expect(after.length, `variant ${variant}`).toBeGreaterThanOrEqual(5); // several separate pieces fly / tumble
      // knock-on is local: nothing far from every pellet impact moved
      for (const p of S.filler.pieces) {
        const near = Math.min(...hits.map(h => h.distanceTo(p.home)));
        if (near > 0.85) expect(p.p.distanceTo(p.home), `piece ${p.id} ${near.toFixed(2)} m from the impacts`).toBe(0);
      }
      // the boards above and below the hit one keep their stock (a blast is not a shop-wide shove)
      const top = S.filler.pieces.filter(p => p.home.y > SHELF_TIER_Y[3]);
      expect(top.every(p => !moved(p))).toBe(true);
      run(ph, 10);
      expect(S.filler.awake).toBe(0);
      expect(S.filler.stats().frozen).toBe(0);
      const D = S.filler.displacement(ph.statics);
      expect(D.belowFloor).toBe(0);
      expect(D.outside).toBe(0);
      for (const p of S.filler.pieces) {
        expect(Number.isFinite(p.p.x + p.p.y + p.p.z)).toBe(true);
        expect(p.box.min.y).toBeGreaterThan(floorUnder(L, p) - 0.025); // on (not through) the floor (the hall's, or the track bed's)
      }
      totalMoved += S.filler.pieces.filter(moved).length;
      offShelf += S.filler.pieces.filter(p => p.box.min.y < 0.08 && p.home.y > 0.3).length;
      expect(maxAwake).toBeLessThanOrEqual(MAX_ACTIVE_FILLER);
    }
    expect(totalMoved).toBeGreaterThan(20);
    expect(offShelf).toBeGreaterThan(0); // some of it lands on the floor
  });

  it('clatters through the existing impact bank only, rate-limited (no sound storm)', () => {
    const calls: {t: number; fam: string; speed: number}[] = [];
    let clock = 0;
    const sh = stockProp('stockShelf', 8, 3, {variant: 0});
    const L = hall([sh], 3);
    const {ph, S} = scene(L, {physImpact: (_x, _y, _z, speed, fam) => calls.push({t: clock, fam, speed})});
    blast(S, L.props, new THREE.Vector3(8, 1.6, 5.7), new THREE.Vector3(8, 0.75, 3.1), 9);
    blast(S, L.props, new THREE.Vector3(8, 1.6, 5.7), new THREE.Vector3(8, 1.3, 3.1), 10);
    run(ph, 6, () => { clock += 1 / 60; });
    expect(calls.length).toBeGreaterThan(3); // things audibly clatter
    for (const c of calls) { expect(['can', 'light', 'glass']).toContain(c.fam); expect(c.speed).toBeGreaterThanOrEqual(0.7); }
    for (const c of calls) expect(calls.filter(q => q.t >= c.t && q.t < c.t + 1).length).toBeLessThanOrEqual(6 + 14);
  });

  it('is deterministic: the same shot gives the same result', () => {
    const final = () => {
      const sh = stockProp('stockShelf', 8, 3, {variant: 1});
      const L = hall([sh], 5);
      const {ph, S} = scene(L);
      blast(S, L.props, new THREE.Vector3(8, 1.6, 5.7), new THREE.Vector3(8, 0.75, 3.1), 3);
      run(ph, 5);
      return S.filler.pieces.map(p => `${p.p.x.toFixed(4)},${p.p.y.toFixed(4)},${p.p.z.toFixed(4)}`).join('|');
    };
    expect(final()).toBe(final());
  });
});

describe('budget, persistence, no loot', () => {
  it('never simulates more than MAX_ACTIVE_FILLER; frozen pieces resume; nothing is lost, duplicated or respawned', () => {
    const props = [0, 1, 2, 3].map(i => stockProp('stockShelf', 6 + i * 1.3, 3, {variant: i % 3}));
    const L = hall(props, 9);
    const {ph, S} = scene(L);
    const n = S.filler.pieces.length;
    expect(n).toBeGreaterThan(150);
    let maxAwake = 0, sawFrozen = false;
    // a storm of hits: every piece once, 6 per frame
    const all = [...S.filler.pieces];
    for (let f = 0; f < all.length / 6 + 240; f++) {
      for (const p of all.slice(f * 6, f * 6 + 6)) S.filler.shoot(p, p.p.clone(), new THREE.Vector3(0.3, 0, -1).normalize(), 1.2);
      ph.update(1 / 60);
      maxAwake = Math.max(maxAwake, S.filler.awake);
      sawFrozen ||= S.filler.stats().frozen > 0;
      expect(S.filler.awake).toBeLessThanOrEqual(MAX_ACTIVE_FILLER);
    }
    expect(maxAwake).toBe(MAX_ACTIVE_FILLER);
    expect(sawFrozen).toBe(true);
    run(ph, 20);
    const st = S.filler.stats();
    expect(st.awake + st.frozen).toBe(0);
    expect(st.counts.reactivated).toBeGreaterThan(0);
    expect(S.filler.pieces.length).toBe(n); // nothing erased / duplicated
    expect(new Set(S.filler.pieces.map(p => p.id)).size).toBe(n);
    for (const p of S.filler.pieces) { expect(Number.isFinite(p.p.y)).toBe(true); expect(p.box.min.y).toBeGreaterThan(floorUnder(L, p) - 0.025); }
    // moved pieces stay where they settled (no respawn on the shelf)
    const rest = S.filler.pieces.map(p => p.p.clone());
    run(ph, 3);
    S.filler.pieces.forEach((p, i) => expect(p.p.distanceTo(rest[i])).toBe(0));
    expect(S.filler.pieces.filter(moved).length).toBeGreaterThan(n * 0.5);
    // rendering follows: no piece left in the moving set, every rest vertex range rewritten
    expect(S.filler.moving().length).toBe(0);
    expect(S.stats().drawCalls.moving).toBe(0);
  });

  it('filler never becomes a pickup; a flying piece hands real loot it hits to the existing detach path', () => {
    const sh = stockProp('stockShelf', 8, 3, {variant: 0});
    const L = hall([sh]);
    const {ph, S} = scene(L);
    const lifted: THREE.Box3[] = [];
    ph.dynamicItems.liftLots = box => { lifted.push(box.clone()); return []; };
    const pickups: unknown[] = [];
    ph.dynamicItems.pickups = () => pickups as never;
    blast(S, L.props, new THREE.Vector3(8, 1.6, 5.7), new THREE.Vector3(8, 0.75, 3.1), 4);
    run(ph, 4);
    expect(lifted.length).toBeGreaterThan(0); // swept boxes of fast pieces were offered to the loot lift
    expect(pickups.length).toBe(0);
    for (const p of S.filler.pieces) expect((p as unknown as {stack?: unknown}).stack).toBeUndefined();
  });

  it('walkers kick knocked-down stock lying at their feet, never stock still on its shelf', () => {
    const sh = stockProp('stockShelf', 8, 3, {variant: 1});
    const L = hall([sh]);
    const {ph, S} = scene(L);
    // knock one piece off: it lands on the floor in front of the shelf and settles there
    const floorPiece = S.filler.pieces.find(p => p.spec.shape === 'cylinder' && p.above.length === 0)!;
    const b = S.filler.wake(floorPiece)!;
    b.position.set(8.3, 0.2, 4.2);
    run(ph, 4);
    expect(floorPiece.state).toBe('rest');
    expect(floorPiece.box.min.y).toBeLessThan(0.03);
    const shelfPiece = S.filler.pieces.find(p => !p.moved && p.home.y > 0.6)!;
    const at = floorPiece.p.clone();
    // a walker crosses it at walking speed
    const walker = {id: {}, x: at.x - 1.2, z: at.z, y: 0, r: 0.3};
    ph.dynamicItems.walkers = () => [walker];
    for (let f = 0; f < 90; f++) { walker.x += 1.8 / 60; ph.update(1 / 60); }
    expect(S.filler.counts.kicks).toBeGreaterThan(0);
    run(ph, 4);
    expect(floorPiece.p.distanceTo(at)).toBeGreaterThan(0.05);
    expect(floorPiece.p.x).toBeGreaterThan(at.x); // along the walker's motion
    expect(shelfPiece.p.distanceTo(shelfPiece.home)).toBe(0);
  });
});

describe('hung key blanks and crated fruit (derived key wall / juice-bar crates)', () => {
  it('a shot key blank drops off its hook onto the bench / floor; shot fruit tumbles out of its crate and rolls to a stop', () => {
    const bench = stockProp('repairBench', 8, 3, {variant: 0}), bar = stockProp('blenderBar', 14, 3);
    const L = hall([bench, bar]);
    const {ph, S} = scene(L);
    const keys = S.filler.pieces.filter(p => S.pieceInfo(p.id).arch === 'key');
    const fruit = S.filler.pieces.filter(p => S.pieceInfo(p.id).arch === 'fruit');
    expect(keys.length).toBeGreaterThan(60);
    expect(fruit.length).toBeGreaterThan(12);
    // hung: no key rests on anything (nothing under it), all within the key wall
    for (const k of keys) { expect(k.p.y).toBeGreaterThan(1.05); expect(k.p.z).toBeLessThan(3 - 0.2); }
    // a pellet into the lowest row of the key wall, and one into the front of the big crate
    const key = keys.sort((a, b) => a.p.y - b.p.y || b.p.z - a.p.z)[0];
    const kEye = new THREE.Vector3(key.p.x, key.p.y + 0.004, 5.5), kDir = new THREE.Vector3(0, 0, -1);
    const kh = S.pelletHit(kEye, kDir, 30, {t: 30, kind: 'none'}, L.props, false)!;
    expect(S.pieceInfo(kh.piece.id).arch).toBe('key');
    S.shoot(kh, kDir, WEAPONS.shotgun.damage);
    const ball = fruit.sort((a, b) => b.p.y - a.p.y || b.p.z - a.p.z)[0];
    const fEye = new THREE.Vector3(ball.p.x + 0.01, ball.p.y + 0.6, 5.2), fDir = ball.p.clone().sub(fEye).normalize();
    const fhit = S.pelletHit(fEye, fDir, 30, {t: 30, kind: 'none'}, L.props, false)!;
    expect(S.pieceInfo(fhit.piece.id).arch).toBe('fruit');
    S.shoot(fhit, fDir, WEAPONS.shotgun.damage);
    run(ph, 12);
    expect(S.filler.awake + S.filler.stats().frozen).toBe(0);
    const D = S.filler.displacement(ph.statics);
    expect(D.belowFloor + D.outside).toBe(0);
    const k = S.filler.pieces[kh.piece.id], f = S.filler.pieces[fhit.piece.id];
    expect(moved(k)).toBe(true);
    expect(moved(f)).toBe(true);
    // a hit blank takes only its hook's others with it; falling blanks brush past the rows below (no cascade)
    expect(keys.filter(moved).length).toBeLessThanOrEqual(3);
    // settled on a real surface: the floor, the bench top (0.9 m), the juice-bar counter (0.865 m) / a crate floor
    // or the fruit in it — never inside the bench / counter, never rolled away across the hall
    for (const p of [...S.filler.pieces.filter(moved)]) {
      const y = p.box.min.y, at = `${S.pieceInfo(p.id).arch} ${p.id} at ${p.p.toArray().map(v => v.toFixed(2))}`;
      const onFloor = y > -0.025 && y < 0.03, onTop = y > 0.85;
      const inBench = Math.abs(p.p.x - 8) < 0.78 && Math.abs(p.p.z - 3) < 0.28 && y < 0.88 && y > 0.03;
      const inCounter = Math.abs(p.p.x - 14) < 0.86 && Math.abs(p.p.z - 3) < 0.33 && y < 0.85 && y > 0.03;
      expect(onFloor || onTop, at).toBe(true);
      expect(inBench || inCounter, at).toBe(false);
      expect(p.p.distanceTo(p.home), at).toBeLessThan(5);
    }
  });
});

describe('levels', () => {
  it('stock on an upper-deck shelf settles on the deck (its own storey), not the floor below', () => {
    // several shots: the railed light well 1.3 m behind the shelf and the railed deck edge 2.5 m to its side
    // are never cleared by splashed / rebounding stock (coherent, local reaction)
    for (const seed of [21, 22, 23, 24]) {
      const L = levelFixture();
      const sh = stockProp('stockShelf', 22.5, 14.5, {variant: 1, y: FIX.upperY, level: 1, area: 2});
      L.props.push(sh);
      const {ph, S} = scene(L);
      const pieces = S.filler.pieces;
      expect(pieces.length).toBeGreaterThan(20);
      for (const p of pieces) expect(p.home.y).toBeGreaterThan(FIX.upperY); // dressed at the deck's absolute height
      const eye = new THREE.Vector3(22.6, FIX.upperY + 1.6, 14.5 + sh.hz + 2.5), aim = new THREE.Vector3(22.5, FIX.upperY + SHELF_TIER_Y[1] + 0.12, 14.6);
      const hits = blast(S, L.props, eye, aim, seed);
      expect(hits.length).toBeGreaterThan(2);
      run(ph, 10);
      expect(S.filler.awake).toBe(0);
      const D = S.filler.displacement(ph.statics);
      expect(D.moved).toBeGreaterThan(3);
      expect(D.belowFloor).toBe(0);
      for (const p of pieces) {
        expect(p.box.min.y, `shot ${seed} piece ${p.id}`).toBeGreaterThan(FIX.upperY - 0.025);
        expect(p.p.y).toBeLessThan(FIX.upperCeil);
      }
    }
    void CELL;
  });
});
