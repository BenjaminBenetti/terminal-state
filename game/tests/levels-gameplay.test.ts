// Iteration 08 (Lane B): gameplay systems on stacked levels, on the hand-made three-level fixture
// (tests/helpers/levelFixture.ts): the player walks up and down real stairs by input (no snapping to
// another storey, no falling through floors, railings at deck edges, an unrailed edge is a drop),
// headroom / crouch under low ceilings, zombies chase across stair connectors, shots stop at a slab
// but pass an open light well, items / casings / debris settle on the right floor, loot stays unique
// per holder across storeys, interaction is occluded by slabs.

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {CELL, Grid, FLOOR, PathFinder, type Waypoint} from '../src/gen/grid';
import {levelsOf, singleLevel, Levels} from '../src/gen/levels';
import {Player, STAND_EYE, type MoveInput} from '../src/player/player';
import {PropIndex} from '../src/core/physics';
import {ZombieBrain, type BrainWorld} from '../src/ai/brain';
import {moveZombie, settleZombie} from '../src/ai/motor';
import {raycastWorld, rayCapsule} from '../src/combat/hitscan';
import {PhysicsSystem} from '../src/physics/world';
import {StaticQuery} from '../src/physics/staticQuery';
import {CasingSystem} from '../src/physics/casings';
import {DebrisSystem} from '../src/damage/debris';
import type {PickupLike} from '../src/physics/dynamicItems';
import {installCanvasShim} from './helpers/canvas2d';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager} from '../src/world/containers';
import {PickupManager} from '../src/world/pickups';
import {Inventory} from '../src/items/inventory';
import {FIX, levelFixture, type FixtureLayout} from './helpers/levelFixture';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {killImpulseStrength} from '../src/physics/world';
import type {RagdollTarget} from '../src/physics/ragdoll';
import {DamageSystem} from '../src/damage/system';
import {structuralKeyAt} from '../src/damage/materials';

installCanvasShim(false);
{
  const ctx0 = (globalThis as unknown as {document: {createElement(t: string): {getContext(k: string): object}}}).document.createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx0) as Record<string, unknown>;
  for (const k of ['clip', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse']) if (typeof proto[k] !== 'function') proto[k] = () => {};
}

const DT = 1 / 60;
const opts = {aiming: false, speedMult: 1, canSprint: true};
class Keys implements MoveInput {
  held = new Set<string>();
  taps = new Set<string>();
  clears = 0;
  down(c: string) { return this.held.has(c); }
  hit(c: string) { return this.taps.has(c); }
}

const fx = levelFixture();
const L = levelsOf(fx);
const props = new PropIndex(L, fx.props);
const pf = new PathFinder(L);

interface Trace { frames: number; maxDy: number; airborne: number; minY: number; maxY: number }
/** Walks the player along waypoints with W held, facing the next one; returns frames (or -1) and a vertical trace. */
function walk(p: Player, path: Waypoint[], maxFrames: number, world: Levels = L, pi: PropIndex = props): Trace {
  const k = new Keys();
  k.held.add('KeyW');
  let i = 0, prev = p.y;
  const tr: Trace = {frames: -1, maxDy: 0, airborne: 0, minY: p.y, maxY: p.y};
  for (let f = 0; f < maxFrames; f++) {
    while (i < path.length && Math.hypot(path[i][0] - p.x, path[i][1] - p.z) < 0.3 && (path[i][3] === undefined || Math.abs(path[i][3]! - p.y) < 1)) i++;
    if (i >= path.length) { tr.frames = f; return tr; }
    p.yaw = Math.atan2(-(path[i][0] - p.x), -(path[i][1] - p.z));
    p.update(DT, k, world, pi, opts);
    if (!p.grounded) tr.airborne++;
    tr.maxDy = Math.max(tr.maxDy, Math.abs(p.y - prev));
    tr.minY = Math.min(tr.minY, p.y); tr.maxY = Math.max(tr.maxY, p.y);
    prev = p.y;
  }
  return tr;
}
const route = (p: Player, x: number, z: number, y: number) => {
  const path = pf.find(p.x, p.z, x, z, 0.34, 40000, {ay: p.y, by: y});
  expect(path, `path to ${x},${y},${z}`).not.toBeNull();
  return path!;
};

describe('player on stacked levels (real input, ordinary stairs)', () => {
  it('up U1 to the deck, over the slab, down U2, down D1 to the lower crossing, under the tracks and up D2: no snap, no fall', () => {
    const p = new Player();
    p.spawn(4, 8.5, 0, 0);
    const legs: [string, number, number, number][] = [
      ['deck (U1)', 23, 8, FIX.upperY], ['over the bench / slab', 22.5, 3.6, FIX.upperY], ['platform B (U2)', 6, 18, 0],
      ['lower crossing (D1)', 6.5, 12, FIX.lowerY], ['platform A (D2)', 4, 6, 0],
    ];
    for (const [name, x, z, y] of legs) {
      const tr = walk(p, route(p, x, z, y), 60 * 40);
      expect(tr.frames, `${name}: reached`).toBeGreaterThan(0);
      expect(p.y, `${name}: on its storey`).toBeCloseTo(y, 2);
      // a step onto the low end of a flight from its side is <= STEP_UP; a storey snap would be metres
      expect(tr.maxDy, `${name}: no snap between storeys (max ${tr.maxDy.toFixed(3)} m/frame)`).toBeLessThan(0.46);
      expect(tr.airborne, `${name}: never left the ground`).toBe(0);
      expect(L.levelAt(p.x, p.z, p.y)).toBe(L.supportAt(x, z, y)!.level);
    }
    expect(p.hp).toBe(p.maxHp);
  });

  it('walking under and over a slab edge never changes storey; the deck railing stops you at the edge', () => {
    const p = new Player();
    // platform A, from the double-height hall in under the deck
    p.spawn(28, 6, Math.PI / 2, 0);
    let tr = walk(p, [[21.5, 6]], 600);
    expect(tr.frames).toBeGreaterThan(0);
    expect(tr.maxY).toBeLessThan(0.01);
    expect(tr.airborne).toBe(0);
    // on the deck, along it above the platform / bed / platform
    p.spawn(23, 3.6, 0, FIX.upperY);
    tr = walk(p, [[23, 9], [21, 10], [21, 15], [25, 15], [25, 20]], 60 * 20);
    expect(tr.frames).toBeGreaterThan(0);
    expect(tr.minY).toBeCloseTo(FIX.upperY, 5);
    expect(tr.airborne).toBe(0);
    // push west into the deck edge over the hall (railed at x = 20): stays on the deck
    p.spawn(21, 6.5, Math.PI / 2, FIX.upperY); // yaw +pi/2 faces -x
    const k = new Keys();
    k.held.add('KeyW');
    for (let f = 0; f < 120; f++) p.update(DT, k, L, props, opts);
    expect(p.x).toBeGreaterThan(20 + p.radius - 0.05);
    expect(p.y).toBeCloseTo(FIX.upperY, 5);
    // and toward the light-well railing (x = 22 west face)
    p.spawn(21, 12, -Math.PI / 2, FIX.upperY); // yaw -pi/2 faces +x
    for (let f = 0; f < 120; f++) p.update(DT, k, L, props, opts);
    expect(p.x).toBeLessThan(22 - p.radius + 0.05);
    expect(p.y).toBeCloseTo(FIX.upperY, 5);
  });

  it('an unrailed deck edge is a drop: you fall to the platform below and land unhurt (no fall damage)', () => {
    const open = levelFixture({rails: 'none'});
    const O = levelsOf(open);
    const p = new Player();
    p.spawn(21, 6.5, Math.PI / 2, FIX.upperY);
    const k = new Keys();
    k.held.add('KeyW');
    let landed = false, fell = false;
    for (let f = 0; f < 240; f++) { p.update(DT, k, O, new PropIndex(O, open.props), opts); if (!p.grounded) fell = true; if (p.justLanded) landed = true; }
    expect(fell).toBe(true);
    expect(landed).toBe(true);
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.x).toBeLessThan(20);
    expect(p.hp).toBe(p.maxHp);
  });

  it('through the light well: a body that falls through the aperture lands in the track bed, not on the deck', () => {
    const open = levelFixture({rails: 'none'});
    const O = levelsOf(open);
    const p = new Player();
    p.spawn(21.5, 12, -Math.PI / 2, FIX.upperY);
    const k = new Keys();
    k.held.add('KeyW');
    for (let f = 0; f < 50; f++) p.update(DT, k, O, null, opts);
    k.held.clear();
    for (let f = 0; f < 120; f++) p.update(DT, k, O, null, opts);
    expect(p.y).toBeCloseTo(FIX.bedY, 4);
    expect(p.grounded).toBe(true);
  });

  it('headroom: stand blocked under a 1.45 m duct (crouch in, cannot stand, crouch out); jumps clamp under a 1.9 m soffit', () => {
    const duct = FIX.duct, soffit = FIX.soffit;
    const p = new Player();
    const mouthZ = (duct.y0 + duct.y1 + 1) / 2 * CELL;
    p.spawn((duct.x1 + 1) * CELL + 0.8, mouthZ, Math.PI / 2, FIX.lowerY); // in the crossing, facing the duct (-x)
    const k = new Keys();
    k.held.add('KeyW');
    for (let f = 0; f < 90; f++) p.update(DT, k, L, props, opts);
    expect(p.x, 'standing: stopped at the duct mouth').toBeGreaterThan((duct.x1 + 1) * CELL + p.radius - 0.05);
    k.taps.add('KeyC');
    p.update(DT, k, L, props, opts);
    k.taps.clear();
    for (let f = 0; f < 150; f++) p.update(DT, k, L, props, opts);
    expect(p.crouched).toBe(true);
    expect(p.x, 'crouched: inside the duct').toBeLessThan((duct.x1 + 1) * CELL - 0.4);
    k.held.clear();
    k.taps.add('KeyC'); // try to stand up
    p.update(DT, k, L, props, opts);
    k.taps.clear();
    for (let f = 0; f < 30; f++) p.update(DT, k, L, props, opts);
    expect(p.crouched).toBe(true);
    expect(p.standBlocked).toBe(true);
    expect(p.eye).toBeLessThan(FIX.lowerY + duct.clear);
    // back out (S) and stand up in the crossing
    k.held.add('KeyS');
    for (let f = 0; f < 150; f++) p.update(DT, k, L, props, opts);
    k.held.clear();
    for (let f = 0; f < 30; f++) p.update(DT, k, L, props, opts);
    expect(p.crouched).toBe(false);
    // soffit bay: a standing jump is clamped below the 1.9 m ceiling
    p.spawn((soffit.x0 + soffit.x1 + 1) / 2 * CELL, (soffit.y0 + soffit.y1 + 1) / 2 * CELL, 0, FIX.lowerY);
    let top = p.y;
    k.taps.add('Space');
    p.update(DT, k, L, props, opts);
    k.taps.clear();
    for (let f = 0; f < 60; f++) { p.update(DT, k, L, props, opts); top = Math.max(top, p.y); }
    expect(top + STAND_EYE + 0.12).toBeLessThanOrEqual(FIX.lowerY + soffit.clear + 1e-6);
    expect(top).toBeGreaterThan(FIX.lowerY + 0.05);
    expect(p.y).toBeCloseTo(FIX.lowerY, 5);
  });
});

// ---------------------------------------------------------------------------------------------
// AI

function mulberry(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The game's brain world (game.ts brainWorld) on stacked levels. */
function world(px: number, py: number, pz: number, rand: () => number): BrainWorld {
  return {
    px, pz, py, playerAlive: true,
    los: (ax, az, bx, bz, ay, by) => (ay !== undefined && by !== undefined ? L.lineOfSight({x: ax, y: ay + 1.5, z: az}, {x: bx, y: by + 1.5, z: bz}) : L.main.lineOfSight(ax, az, bx, bz)),
    walkClear: (ax, az, bx, bz, r, ay, by) => L.walkLineClear(ax, ay ?? 0, az, bx, bz, r, by),
    findPath: (ax, az, bx, bz, o) => pf.find(ax, az, bx, bz, 0.34, 26000, o),
    randomNear: () => null,
    rand,
  };
}
function chase(z: ZombieBrain, px: number, py: number, pz: number, seconds: number): {reached: boolean; minDy: number; hitThroughSlab: boolean; levels: Set<number>} {
  const w = world(px, py, pz, mulberry(11));
  z.hear(px, pz, 80, py);
  let reached = false, hitThroughSlab = false, minDy = Infinity;
  const levels = new Set<number>();
  for (let f = 0; f < seconds * 60 && !reached; f++) {
    const out = z.update(DT, w);
    // the game's body turn (game.ts updateZombies)
    if (out.face !== null) { let d = out.face - z.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); const turn = (z.state === 'attack' ? 7 : z.stats.turnRate ?? 4.5) * DT; z.yaw += Math.max(-turn, Math.min(turn, d)); }
    if (out.attackHit && Math.abs(z.y - py) > 1) hitThroughSlab = true;
    moveZombie(z, out, DT, L, props);
    settleZombie(z, L, props);
    levels.add(L.levelAt(z.x, z.z, z.y));
    minDy = Math.min(minDy, Math.abs(z.y - py));
    if (Math.abs(z.y - py) < 0.1 && Math.hypot(z.x - px, z.z - pz) < 1.6) reached = true;
  }
  return {reached, minDy, hitThroughSlab, levels};
}

describe('zombies across levels', () => {
  it('a zombie on platform B chases the player up U2 onto the deck', () => {
    const z = new ZombieBrain('shambler', 30, 18, 0);
    z.y = 0;
    const t0 = performance.now();
    const r = chase(z, 23, FIX.upperY, 8, 30);
    console.info(`[levels] chase B -> deck: ${r.reached} in ${(performance.now() - t0).toFixed(0)} ms sim, levels ${[...r.levels]}`);
    expect(r.reached, `zombie at ${z.x.toFixed(1)},${z.y.toFixed(2)},${z.z.toFixed(1)} state ${z.state}`).toBe(true);
    expect(r.levels.has(1)).toBe(true);
  });

  it('a zombie on the deck right above the player cannot see / hit him through the slab; it comes down the stairs', () => {
    const z = new ZombieBrain('shambler', 22.6, 6.5, Math.PI);
    z.y = FIX.upperY;
    const w = world(22.6, 0, 7.2, mulberry(3));
    for (let f = 0; f < 30; f++) z.update(DT, w);
    expect(z.aware).toBe(false); // no sight through the slab (2D sight would see him 0.7 m away)
    expect(L.main.lineOfSight(22.6, 6.5, 22.6, 7.2)).toBe(true);
    const r = chase(z, 22.6, 0, 7.2, 40);
    expect(r.hitThroughSlab).toBe(false);
    expect(r.reached, `zombie at ${z.x.toFixed(1)},${z.y.toFixed(2)},${z.z.toFixed(1)} state ${z.state}`).toBe(true);
  });

  it('a zombie in the lower crossing chases a player on platform A up D2; a quadruped (no ladders) uses stairs too', () => {
    const z = new ZombieBrain('shambler', 6.5, 16, 0);
    z.y = FIX.lowerY;
    const r = chase(z, 10, 0, 6, 40);
    expect(r.reached, `zombie at ${z.x.toFixed(1)},${z.y.toFixed(2)},${z.z.toFixed(1)} state ${z.state}`).toBe(true);
    expect(r.levels.has(2) && r.levels.has(0)).toBe(true);
    const path = pf.find(6.5, 16, 10, 6, 0.34, 26000, {ay: FIX.lowerY, by: 0, noLinks: true, drops: true});
    expect(path).not.toBeNull();
  });

  it('path performance on the fixture (repeated cross-level searches)', () => {
    const pts: [number, number, number][] = [[4, 8.5, 0], [23, 8, FIX.upperY], [6.5, 12, FIX.lowerY], [30, 18, 0], [24, 20, FIX.upperY], [6.5, 40 * CELL, FIX.lowerY]];
    const t0 = performance.now();
    let n = 0;
    for (let r = 0; r < 5; r++) for (const a of pts) for (const b of pts) { if (a === b) continue; expect(pf.find(a[0], a[1], b[0], b[1], 0.34, 26000, {ay: a[2], by: b[2], drops: true})).not.toBeNull(); n++; }
    const ms = (performance.now() - t0) / n;
    console.info(`[levels] fixture cross-level path: ${ms.toFixed(3)} ms avg over ${n}`);
    expect(ms).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------------------------
// Combat / interaction

describe('shots and interaction respect slabs', () => {
  const chest = (x: number, y: number, z: number) => ({a: {x, y: y + 0.9, z}, b: {x, y: y + 1.45, z}, r: 0.2});
  const shoot = (eye: {x: number; y: number; z: number}, target: {x: number; y: number; z: number}) => {
    const c = chest(target.x, target.y, target.z);
    const mid = {x: target.x, y: target.y + 1.2, z: target.z};
    const d = new THREE.Vector3(mid.x - eye.x, mid.y - eye.y, mid.z - eye.z).normalize();
    const D = {x: d.x, y: d.y, z: d.z};
    const wh = raycastWorld(L, fx.props, eye, D, 80, FIX.bedY);
    const tz = rayCapsule(eye, D, c.a, c.b, c.r);
    return {hit: tz < wh.t, wh};
  };
  it('deck -> zombie under the deck: the slab takes the bullet (floor, normal up); deck -> bed through the light well: hit', () => {
    const a = shoot({x: 21.5, y: FIX.upperY + 1.62, z: 9}, {x: 23, y: 0, z: 7});
    expect(a.hit).toBe(false);
    expect(a.wh.kind).toBe('floor');
    expect(a.wh.level).toBe(1);
    const b = shoot({x: 21.9, y: FIX.upperY + 1.62, z: 12}, {x: 23.4, y: FIX.bedY, z: 12.2});
    expect(b.hit).toBe(true);
    // from under the deck upward at a zombie on the deck: the slab underside (ceiling, normal down)
    const c = shoot({x: 22, y: 1.62, z: 15}, {x: 23, y: FIX.upperY, z: 17});
    expect(c.hit).toBe(false);
    expect(c.wh.kind).toBe('ceiling');
    expect(c.wh.ny).toBe(-1);
    // platform A -> platform B across the bed under the deck (same storey): hit
    expect(shoot({x: 24, y: 1.62, z: 8}, {x: 24.5, y: 0, z: 17}).hit).toBe(true);
    // lower crossing <-> platform: never
    expect(shoot({x: 6.5, y: FIX.lowerY + 1.62, z: 8}, {x: 4, y: 0, z: 8}).hit).toBe(false);
  });

  it('structural damage lands on the right surface: slab underside (ceiling, normal down, level 0), deck floor (level 1 material)', () => {
    const sys = new DamageSystem(null, null);
    sys.rand = mulberry(4);
    sys.build(fx, null, [], {});
    const o = {x: 22.6, y: 1.62, z: 7};
    const up = raycastWorld(L, fx.props, o, {x: 0, y: 1, z: 0}, 30, FIX.bedY);
    const hu = sys.hitWorld(up, new THREE.Vector3(o.x, o.y + up.t, o.z), new THREE.Vector3(0, 1, 0), {damage: 24, pellet: false, weapon: 'rifle'});
    expect(hu.object).toBe('ceiling');
    expect(hu.normal.y).toBe(-1);
    expect(hu.point.y).toBeCloseTo(FIX.underDeckCeil, 4);
    expect(hu.level).toBe(0);
    const od = {x: 22.6, y: FIX.upperY + 1.62, z: 9};
    const dn = raycastWorld(L, fx.props, od, {x: 0, y: -1, z: 0}, 30, FIX.bedY);
    const hd = sys.hitWorld(dn, new THREE.Vector3(od.x, od.y - dn.t, od.z), new THREE.Vector3(0, -1, 0), {damage: 24, pellet: false, weapon: 'rifle'});
    expect(hd.object).toBe('floor');
    expect(hd.normal.y).toBe(1);
    expect(hd.level).toBe(1);
    expect(hd.point.y).toBeCloseTo(FIX.upperY, 4);
    // the deck's material comes from the deck (upper concourse), not the platform slab under it
    const w = {areas: fx.areas, trenches: fx.trenches};
    expect(structuralKeyAt('floor', 22.6, FIX.upperY, 9, 0, 0, {...w, grid: L.grid(1)})).toBe('terrazzo');
    expect(structuralKeyAt('floor', 22.6, 0, 9, 0, 0, {...w, grid: L.grid(0)})).not.toBe('terrazzo');
    expect(sys.stats().craters).toBe(2);
  });

  it('pickup / holder targeting is occluded by a slab (micro layout: crawl space under a thin floor, within reach)', () => {
    // two levels: a 0.6 m crawl space (level 0) under a floor at 0.7 m (level 1)
    const g0 = new Grid(12, 12), g1 = new Grid(12, 12);
    for (let y = 1; y < 11; y++) for (let x = 1; x < 11; x++) {
      let i = g0.idx(x, y); g0.cells[i] = FLOOR; g0.floor[i] = 0; g0.ceil[i] = 0.6;
      i = g1.idx(x, y); g1.cells[i] = FLOOR; g1.floor[i] = 0.7; g1.ceil[i] = 3.5;
    }
    const M = new Levels([{id: 0, role: 'main', grid: g0, baseY: 0}, {id: 1, role: 'upper', grid: g1, baseY: 0.7}]);
    const pm = new PickupManager({});
    const inv = new Inventory();
    const below = pm.add(inv.makeStack('ammo_rifle', 5), 3.0, 0, 3.0, 0);
    const eye = new THREE.Vector3(2.7, 0.7 + STAND_EYE, 3.0);
    const look = new THREE.Vector3(below.x - eye.x, below.y + 0.08 - eye.y, below.z - eye.z).normalize();
    expect(eye.distanceTo(new THREE.Vector3(below.x, below.y + 0.08, below.z))).toBeLessThan(2.6);
    expect(pm.target(eye, look, g0), 'legacy 2D test would take it through the floor').toBe(below);
    expect(pm.target(eye, look, M), 'stacked levels: hidden under the floor').toBeNull();
    // on the same storey it is targetable
    const onTop = pm.add(inv.makeStack('ammo_rifle', 5), 3.2, 0.7, 3.0, 0);
    const look2 = new THREE.Vector3(onTop.x - eye.x, onTop.y + 0.08 - eye.y, onTop.z - eye.z).normalize();
    expect(pm.target(eye, look2, M)).toBe(onTop);
    void singleLevel;
  });
});

// ---------------------------------------------------------------------------------------------
// Physics

function can(x: number, y: number, z: number, id = 'cola'): PickupLike {
  const obj = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.033, 0.033, 0.122, 12);
  geo.translate(0, 0.061, 0);
  obj.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()));
  obj.position.set(x, y, z);
  const scene = new THREE.Group();
  scene.add(obj);
  scene.updateMatrixWorld(true);
  return {stack: {itemId: id, uid: Math.floor(x * 1000 + z), count: 1}, x, y, z, obj};
}
const runPh = (ph: PhysicsSystem, s: number) => { for (let t = 0; t < s; t += DT) ph.update(DT); };

describe('physics settles on the right floor', () => {
  it('statics: ground / ceilings / solids per band (deck, slab underside, aperture, lower crossing)', () => {
    const q = new StaticQuery(fx);
    expect(q.cellGround(22, 6, 0.5)).toBe(0);
    expect(q.cellGround(22, 6, FIX.upperY + 0.2)).toBe(FIX.upperY);
    expect(q.cellGround(22, 6, FIX.upperY - 0.1)).toBe(FIX.upperY); // sunk into the deck: lifted back
    expect(q.ceilAbove(22, 6, 1)).toBeCloseTo(FIX.underDeckCeil, 5);
    expect(q.cellGround(23, 12, FIX.upperY + 0.2)).toBeCloseTo(FIX.bedY, 5); // aperture: falls to the bed
    expect(q.cellGround(6.5, 6, FIX.lowerY + 0.5)).toBe(FIX.lowerY);
    expect(q.insideSolid(22, 4.6, 6)).toBe(true);
    expect(q.blocked(25.95, 4.6, 6, 0.02)).toBe(true); // inside the slab edge (seen from the hall)
    expect(q.blocked(26.05, 4.6, 6, 0.02)).toBe(false); // the hall beside it
    const cs = q.columnSolids(Math.floor(22 / CELL), Math.floor(6 / CELL), q.minFloor - 0.5);
    expect(cs.solids.map(s => [+s.y0.toFixed(2), +s.y1.toFixed(2)])).toEqual([[+(q.minFloor - 0.5).toFixed(2), 0], [4.4, FIX.upperY]]);
  });

  it('an item shot on the deck stays on the deck (the light-well railing stops it); unrailed, it falls through to the bed; one under the slab lands on the platform', () => {
    const bottom = (p: PickupLike) => new THREE.Box3().setFromObject(p.obj).min.y;
    const ph = new PhysicsSystem(null);
    ph.build(fx);
    const deck = can(23, FIX.upperY, 8.5), railed = can(21.8, FIX.upperY, 12.1), under = can(22.6, 3.9, 7);
    ph.dynamicItems.shootPickup(deck, new THREE.Vector3(22.97, FIX.upperY + 0.09, 8.5), new THREE.Vector3(0.2, 0, 1).normalize(), 0.5);
    ph.dynamicItems.shootPickup(railed, new THREE.Vector3(21.77, FIX.upperY + 0.06, 12.1), new THREE.Vector3(1, 0.2, 0).normalize(), 1.1);
    ph.dynamicItems.shootPickup(under, new THREE.Vector3(22.6, 3.96, 6.97), new THREE.Vector3(0, 1, 0.1).normalize(), 1.0);
    runPh(ph, 10);
    console.info(`[levels] items settle: deck ${bottom(deck).toFixed(3)}, at the railed well ${bottom(railed).toFixed(3)} x ${railed.obj.position.x.toFixed(2)}, under ${bottom(under).toFixed(3)}`);
    expect(bottom(deck)).toBeGreaterThan(FIX.upperY - 0.02);
    expect(bottom(deck)).toBeLessThan(FIX.upperY + 0.08);
    expect(bottom(railed)).toBeGreaterThan(FIX.upperY - 0.02); // the railing kept it on the deck
    expect(railed.obj.position.x).toBeLessThan(22);
    expect(bottom(under)).toBeGreaterThan(-0.02);
    expect(bottom(under)).toBeLessThan(0.08);
    expect(ph.dynamicItems.stats().items).toBe(3); // nothing lost
    ph.dispose();
    // no railings: the same shot sends the can over the edge, down the light well onto the track bed
    const ph2 = new PhysicsSystem(null);
    ph2.build(levelFixture({rails: 'none'}));
    const well = can(21.8, FIX.upperY, 12.1);
    ph2.dynamicItems.shootPickup(well, new THREE.Vector3(21.77, FIX.upperY + 0.06, 12.1), new THREE.Vector3(1, 0.2, 0).normalize(), 1.1);
    runPh(ph2, 10);
    console.info(`[levels] unrailed well: ${bottom(well).toFixed(3)} at x ${well.obj.position.x.toFixed(2)}`);
    expect(bottom(well)).toBeLessThan(FIX.bedY + 0.08);
    expect(bottom(well)).toBeGreaterThan(FIX.bedY - 0.02);
    ph2.dispose();
  });

  it('casings and debris: rest on the deck, fall through the light well, bounce off the slab underside', () => {
    const q = new StaticQuery(fx);
    const cs = new CasingSystem();
    cs.setStatics(q);
    cs.rand = () => 0.5;
    cs.eject(new THREE.Vector3(23, FIX.upperY + 1.3, 8), new THREE.Vector3(0.3, 0.2, 0.1), 'rifle');
    cs.eject(new THREE.Vector3(22.9, FIX.upperY + 1.3, 12), new THREE.Vector3(0.2, 0.1, 0), 'rifle', undefined, 0.3); // dropped into the light well
    cs.eject(new THREE.Vector3(22.6, 3.8, 7), new THREE.Vector3(0, 1, 0), 'shell', undefined, 4);
    let maxUnder = -Infinity;
    for (let i = 0; i < 900; i++) { cs.update(DT); const c = cs.list().find(k => k.kind === 'shell'); if (c) maxUnder = Math.max(maxUnder, c.y); }
    const list = cs.list();
    const rifle = list.filter(c => c.kind === 'rifle').sort((a, b) => b.y - a.y);
    expect(rifle[0].y).toBeGreaterThan(FIX.upperY - 0.01);
    expect(rifle[0].y).toBeLessThan(FIX.upperY + 0.03);
    expect(rifle[1].y).toBeLessThan(FIX.bedY + 0.03);
    const shell = list.find(c => c.kind === 'shell')!;
    expect(maxUnder).toBeLessThan(FIX.underDeckCeil);
    expect(shell.y).toBeLessThan(0.05);
    const deb = new DebrisSystem();
    deb.setStatics(q);
    deb.rand = mulberry(9);
    deb.spawn({x: 22.6, y: 4.0, z: 7.2, vx: 0, vy: 5, vz: 0.2, size: 0.04, color: new THREE.Color(0x888888), shape: 'chunk'});
    let top = -Infinity;
    for (let i = 0; i < 300; i++) { deb.update(DT); for (const pool of Object.values(deb.pools)) for (const pc of pool.pieces) if (pc.live) top = Math.max(top, pc.pos.y); }
    expect(top).toBeLessThan(FIX.underDeckCeil);
  });

  it('cannon statics: the deck slab box, the slab under the bed over the crossing, flight treads, railings', () => {
    const ph = new PhysicsSystem(null);
    ph.build(fx);
    const span = 8 * CELL;
    const key = (x: number, z: number) => (Math.floor(z / span) + 4096) * 8192 + (Math.floor(x / span) + 4096);
    const build = (x: number, z: number) => (ph as unknown as {buildChunk(k: number): import('cannon-es').Body[]}).buildChunk(key(x, z));
    const tops = (bs: import('cannon-es').Body[]) => bs.map(b => {
      const h = (b.shapes[0] as import('cannon-es').Box).halfExtents;
      return {y0: b.position.y - h.y, y1: b.position.y + h.y, x0: b.position.x - h.x, x1: b.position.x + h.x, z0: b.position.z - h.z, z1: b.position.z + h.z};
    });
    const deck = tops(build(22.5, 6.5));
    expect(deck.some(b => Math.abs(b.y0 - 4.4) < 1e-3 && Math.abs(b.y1 - FIX.upperY) < 1e-3)).toBe(true); // the deck slab
    const cross = tops(build(6.5, 12));
    expect(cross.some(b => Math.abs(b.y0 - FIX.lowerCeil) < 1e-3 && Math.abs(b.y1 - FIX.bedY) < 1e-3)).toBe(true); // slab under the bed
    // a deck-edge railing (flat, level 1) becomes a thin box in the chunk holding its midpoint
    const rl = L.rails.find(r => r.level === 1 && r.x0 === 20 && r.x1 === 20)!;
    const rails = tops(build(20.01, (rl.z0 + rl.z1) / 2));
    expect(rails.some(b => b.x1 - b.x0 < 0.1 && Math.abs(b.y0 - FIX.upperY) < 1e-3 && b.y1 > FIX.upperY + 1)).toBe(true);
    ph.dispose();
  });
});

describe('ragdolls on stacked levels', () => {
  const rig = JSON.parse(readFileSync(fileURLToPath(new URL('../public/assets/derivatives/zombie-rigged.json', import.meta.url)), 'utf8')) as {skeleton: {joints: {name: string; parent: string | null; bindWorldPosition: [number, number, number]}[]}};
  class Body implements RagdollTarget {
    readonly root = new THREE.Group();
    readonly bones = new Map<string, THREE.Bone>();
    ragdolled = false;
    readonly scale = 1;
    readonly coated = false;
    constructor(x: number, y: number, z: number, yaw: number, private readonly vel = new THREE.Vector3()) {
      for (const j of rig.skeleton.joints) {
        const b = new THREE.Bone();
        b.name = j.name;
        const p = j.parent ? rig.skeleton.joints.find(q => q.name === j.parent)!.bindWorldPosition : [0, 0, 0];
        b.position.set(j.bindWorldPosition[0] - p[0], j.bindWorldPosition[1] - p[1], j.bindWorldPosition[2] - p[2]);
        (j.parent ? this.bones.get(j.parent)! : this.root).add(b);
        this.bones.set(j.name, b);
      }
      this.root.position.set(x, y, z);
      this.root.rotation.y = yaw;
      this.root.updateMatrixWorld(true);
    }
    bone(n: string) { return this.bones.get(n); }
    boneVelocity(_n: string, out: THREE.Vector3) { return out.copy(this.vel); }
    beginRagdoll() { this.ragdolled = true; }
    setCullSphere() {}
    points(): THREE.Vector3[] { this.root.updateMatrixWorld(true); return [...this.bones.values()].map(b => b.getWorldPosition(new THREE.Vector3())); }
  }
  it('a corpse shot on the deck collapses onto the deck; one under the deck stays below the slab underside', () => {
    const ph = new PhysicsSystem(null);
    ph.build(fx);
    const onDeck = new Body(23.2, FIX.upperY, 18, 0.4, new THREE.Vector3(0.4, 0, 0.6));
    const under = new Body(23.2, 0, 6.6, 2.2, new THREE.Vector3(0, 0.5, 0));
    expect(ph.ragdoll(onDeck, {dir: new THREE.Vector3(0.3, -0.1, 1).normalize(), point: {x: 23.2, y: FIX.upperY + 1.3, z: 18}, strength: killImpulseStrength('shotgun', 9, 9)})).toBe(true);
    expect(ph.ragdoll(under, {dir: new THREE.Vector3(0, 0.15, 1).normalize(), point: {x: 23.2, y: 1.3, z: 6.6}, strength: killImpulseStrength('shotgun', 9, 9)})).toBe(true);
    let minDeck = Infinity, maxUnder = -Infinity;
    for (let t = 0; t < 6; t += DT) {
      ph.update(DT);
      for (const p of onDeck.points()) minDeck = Math.min(minDeck, p.y);
      for (const p of under.points()) maxUnder = Math.max(maxUnder, p.y);
    }
    const restDeck = Math.max(...onDeck.points().map(p => p.y));
    console.info(`[levels] ragdolls: deck min ${minDeck.toFixed(3)} rest top ${restDeck.toFixed(3)}; under max ${maxUnder.toFixed(3)}`);
    expect(minDeck).toBeGreaterThan(FIX.upperY - 0.08); // never through the deck
    expect(restDeck).toBeLessThan(FIX.upperY + 0.8); // lying on it
    expect(maxUnder).toBeLessThan(FIX.underDeckCeil); // never up through the slab
    expect(Math.min(...under.points().map(p => p.y))).toBeGreaterThan(-0.08);
    ph.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// Loot

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}

describe('finite loot across storeys', () => {
  const build = (l: FixtureLayout) => {
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const inv = new Inventory();
    const cm = new ContainerManager({}, mats, () => inv);
    cm.build(l);
    return {cm, inv};
  };
  it('holders stacked in one column on two storeys are distinct (serials, rolled loot); a rebuild is identical; taking from one leaves the other', () => {
    const l = levelFixture();
    const {cm, inv} = build(l);
    const cabs = cm.all.filter(h => h.kind === 'cabinetTall');
    expect(cabs.length).toBe(2);
    expect(cabs[0].serial).not.toBe(cabs[1].serial);
    expect(Math.abs(cabs[0].prop.y - cabs[1].prop.y)).toBeCloseTo(FIX.upperY, 5);
    const snap = (m: ContainerManager) => m.all.map(h => `${h.serial}:${h.kind}:${h.prop.y}:${h.state.lots.map(x => `${x.id}/${x.itemId}x${x.count}`).join(',')}`).join('|');
    const first = snap(cm);
    expect(snap(build(levelFixture()).cm)).toBe(first); // deterministic, no reroll
    const deckCab = cabs.find(h => h.prop.y > 1)!, mainCab = cabs.find(h => h.prop.y < 1)!;
    const mainBefore = JSON.stringify(mainCab.state.lots);
    const total = deckCab.state.lots.reduce((n, x) => n + x.count, 0);
    // open + take everything from the deck cabinet
    for (let i = 0; i < 6 && deckCab.state.lots.length; i++) cm.interact(deckCab);
    const got = inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0);
    expect(JSON.stringify(mainCab.state.lots)).toBe(mainBefore);
    if (total > 0) expect(got).toBeGreaterThan(0);
    // taking again gives nothing more (finite)
    const after = inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0);
    for (let i = 0; i < 4; i++) cm.interact(deckCab);
    expect(inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0)).toBe(after);
  });
});
