// Task studio-fuel-cart-stairs-20261110-004505-01 (user: "Just let the player drag the carts up and down stairs"): FUEL CARTS ON
// STAIRS — the common cart mechanism on every level, pinned (it was never tested before: the first version's header even said "no
// climbing stairs", which was not what the floor rule did).
//  - every stair flight of every level type carries a cart DOWN and UP (the controller's own moves: world/fuelCartPhysics.ts);
//  - the REAL Player body drags a grabbed cart up three flights with landings and back down, then down to the service level and back, on
//    a generated Subway station: never torn out of the hand, the cart always ON the walking surface (never through it, never above it),
//    never a jump, the player never farther than the tether;
//  - let go on a flight it stops within centimetres and stays (a flat floor still lets it coast); walked into, it is pushed at the
//    push speed and stops with the player; shot, it barely moves;
//  - the REST POSE: on steps the cart lies on the nosing line (half a riser over the pitch line) pitched / rolled with the slope, exactly
//    upright on flat floor; held going down it is tilted back toward the player instead; the rest surface never dips under the built
//    steps and has no jumps along a whole run with its landings;
//  - the drawn cart is what the player aims at (the tilted handle grabs), its meshes carry the storey it stands on;
//  - a station record of a cart standing on a stair survives the save text exactly.
// The Bunker job (station cart -> three generators -> lift) is tests/bunker-cart-fuel-e2e.test.ts; the lift's own cases
// (doorway, parking, an empty shaft) are in tests/bunker-cargo-lift.test.ts.

import {afterEach, describe, expect, it} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import type {StationLayout} from '../src/gen/stationTypes';
import {levelsOf, type Levels} from '../src/gen/levels';
import {stepTop} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import {CART, cartFloorAt, cartRestPose, cartSurfaceAt, flightAt, footprintFloor, moveCart, pushTop, stepCart, type CartBody} from '../src/world/fuelCartPhysics';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {FUEL_CART} from '../src/world/fuelCarts';
import {FUEL, FUEL_LANE, stationFuelProblem, type StationFuelJSON} from '../src/fuel/fuel';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {parseSaveText} from '../src/save/validate';
import {DT, flatRoom, frame, holdE, lookAt, stationHost} from './helpers/fuelCartsHost';
import {CartBot, planCartRoute} from './helpers/cartBot';
import {Harness, sid} from './helpers/saveFixture';

installCanvasShim(false);

const LOG = '/tmp/fuel-cart-stairs.log';
writeFileSync(LOG, '');
const log = (s: string) => appendFileSync(LOG, s + '\n');
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

let subway: StationLayout | null = null;
/** Seed 4242: three flights up to the upper concourse (y 0 -> 5.05, 2 m wide, two landings), two down to the service level (-4). */
const SUBWAY = () => (subway ??= LEVELS.subway.generate('main', {levelSeed: 4242}));

/** The controller alone: a cart moved in 2 cm steps along the straight line between two points. */
function drive(levels: Levels, props: PropIndex, from: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}): boolean {
  const f0 = footprintFloor(levels, from.x, from.z, from.y);
  if (!f0) return false;
  const b: CartBody = {x: from.x, y: f0.floor, z: from.z, yaw: 0, vx: 0, vz: 0, level: f0.level, units: FUEL.cartUnits};
  for (let s = 0, stuck = 0; s < 20000; s++) {
    const rx = to.x - b.x, rz = to.z - b.z, rd = Math.hypot(rx, rz);
    if (rd < 0.12) return Math.abs(b.y - to.y) < 0.4;
    if (moveCart(b, {levels, props}, rx / rd * 0.02, rz / rd * 0.02)) stuck = 0;
    else if (++stuck > 2) return false;
  }
  return false;
}

describe('every stair flight on every level carries a fuel cart down and up', () => {
  it('the controller moves a cart over each flight both ways (a prop on the straight line: round it)', () => {
    const worlds: [string, () => StationLayout][] = [];
    for (const id of LEVEL_IDS) {
      for (const seed of id === 'subway' ? [4242, 9001, 16920] : [9001]) worlds.push([`${id} ${seed}`, () => LEVELS[id].generate('main', {levelSeed: seed})]);
    }
    worlds.push(['bunker v1 9001', () => generateBunkerLevel({levelSeed: 9001, layoutVersion: 1})]);
    let flights = 0, rounded = 0;
    const kinds = new Map<string, number>();
    for (const [name, gen] of worlds) {
      const L = gen(), levels = levelsOf(L), props = new PropIndex(levels, L.props);
      let n = 0;
      for (const f of L.traversal.stairs) {
        n++; flights++;
        const k = `${Math.abs(f.a1 - f.a0).toFixed(1)} m${f.spec ? ' ' + f.spec : ''}`;
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
        for (const [a, b, dir] of [[f.top, f.bottom, 'down'], [f.bottom, f.top, 'up']] as const) {
          let ok = drive(levels, props, a, b);
          if (!ok) { rounded++; ok = planCartRoute({levels, props}, a, b, {reach: 0.6}) !== null; }
          expect(ok, `${name}: flight ${f.id} (${k}) ${dir}`).toBe(true);
        }
      }
      log(`${name}: ${n} flights, all both ways`);
    }
    log(`flights ${flights} (round a prop: ${rounded}); by width / class: ${[...kinds].map(([k, n]) => `${k} x${n}`).join(', ')}`);
    expect(flights).toBeGreaterThan(150);
    // every class the game has: the station stair, the transit stair, the stopped escalator; widths 1.5 m to 5 m
    expect([...kinds.keys()].some(k => /escalator/.test(k))).toBe(true);
    expect([...kinds.keys()].some(k => /transit/.test(k))).toBe(true);
    expect([...kinds.keys()].some(k => /^1\.5 m$/.test(k))).toBe(true);
  }, 300_000);
});

/** The Subway station, a full cart on the main level in front of the stair up, the player a pace behind its handle. */
function onSubway(units: number = FUEL.cartUnits) {
  const L = SUBWAY();
  const s = stationHost(L);
  live.push(s.rt);
  const {h, carts} = s;
  const up = L.traversal.stairs[0], down = L.traversal.stairs[3];
  // between the two stairs, on the upper stair's axis
  const x = up.bottom.x - 1.3, z = up.bottom.z;
  expect(footprintFloor(h.levels!, x, z, 0)).not.toBeNull();
  carts.spawn({uid: 'cart:s', units, x, y: 0, z, yaw: Math.PI / 2, level: 0});
  h.player.place(x - 1.0, z, -Math.PI / 2, 0);
  frame(h);
  const bot = new CartBot(h, carts, () => ({levels: h.levels!, props: h.propIndex}));
  const b = () => carts.bodyOf('cart:s')!;
  // every frame: the cart is exactly on the walking surface under its centre; no jump; the tether holds
  const seen = {maxStep: 0, maxOff: 0, maxSpeed: 0, maxDist: 0, frames: 0, lastY: b().y};
  h.frameHooks.push(() => {
    const c = b(), P = h.player;
    const sup = h.levels!.supportIn(c.x, c.z, c.y, CART.step);
    seen.maxOff = Math.max(seen.maxOff, sup ? Math.abs(sup.floor - c.y) : 99);
    seen.maxStep = Math.max(seen.maxStep, Math.abs(c.y - seen.lastY));
    seen.lastY = c.y;
    seen.maxSpeed = Math.max(seen.maxSpeed, Math.hypot(c.vx, c.vz));
    if (carts.grab) seen.maxDist = Math.max(seen.maxDist, Math.hypot(c.x - P.x, c.z - P.z));
    seen.frames++;
  });
  return {L, h, carts, bot, b, up, down, seen, top: L.traversal.stairs[2].top, low: L.traversal.stairs[4].bottom};
}

describe('the real Player drags a cart over a Subway station\'s stairs', () => {
  it('up three flights with landings, back down, down to the service level and back up: never torn away, always on the surface, no jump', () => {
    const {h, carts, bot, b, seen, top, low, up} = onSubway();
    const start = {...b()};
    const legs: [string, {x: number; y: number; z: number}][] = [
      ['up to the upper concourse', {x: top.x + Math.sign(top.x - up.bottom.x) * 1.2, y: top.y, z: top.z}],
      ['back down to the main level', {x: start.x, y: 0, z: start.z}],
      ['down to the service level', {x: low.x + Math.sign(low.x - start.x) * 1.0, y: low.y, z: low.z}],
      ['back up to the main level', {x: start.x, y: 0, z: start.z}],
    ];
    let t = 0;
    for (const [name, to] of legs) {
      const r = bot.dragTo('cart:s', to.x, to.y, to.z, {arrive: 0.5});
      log(`subway 4242 ${name}: ok ${r.ok} ${r.t.toFixed(1)} s, forced let-go ${r.forcedLetGo}, cart y ${r.yMin.toFixed(2)} .. ${r.yMax.toFixed(2)} ${r.why ?? ''}`);
      expect(r.ok, `${name}: ${r.why}`).toBe(true);
      expect(r.forcedLetGo, name).toBe(0);
      expect(Math.abs(b().y - to.y), name).toBeLessThan(0.02);
      t += r.t;
    }
    expect(carts.grab?.cart.uid).toBe('cart:s');
    expect(seen.maxOff).toBeLessThan(1e-6); // the body is ON the pitch line / floor every frame
    expect(seen.maxStep).toBeLessThan(0.05); // no pop, no launch (a frame at full speed on the pitch: 3.3 cm)
    expect(seen.maxSpeed).toBeLessThanOrEqual(CART.maxSpeed + 1e-6);
    expect(seen.maxDist).toBeLessThan(FUEL_CART.farDist);
    expect(carts.all().map(c => [c.uid, c.units])).toEqual([['cart:s', FUEL.cartUnits]]); // moving a cart never touches its fuel
    log(`  ${seen.frames} frames, ${t.toFixed(0)} s: worst surface offset ${seen.maxOff.toExponential(1)} m, worst frame step ${(seen.maxStep * 100).toFixed(1)} cm, tether ${seen.maxDist.toFixed(2)} m`);
    void h;
  }, 120_000);

  it('let go on a flight: it stops within centimetres and stays, lying on the steps; on flat floor it still coasts; the tilted handle grabs', () => {
    const {h, carts, bot, b, up} = onSubway();
    const P = h.player, dirX = Math.sign(up.top.x - up.bottom.x);
    // a running start up the first flight, then E with W still held (the cart moving)
    const lead = bot.dragTo('cart:s', (up.s0 + up.s1) / 2 - dirX * 0.9, 0.3, up.bottom.z, {arrive: 0.5});
    expect(lead.ok, lead.why).toBe(true);
    for (let t = 0; t < 0.5; t += DT) { P.yaw = Math.atan2(-dirX, 0); h.keys.held.add('KeyW'); frame(h); }
    expect(flightAt(h.levels!, b().x, b().z, b().y)).not.toBeNull();
    const v0 = Math.hypot(b().vx, b().vz), at = {x: b().x, z: b().z};
    expect(v0).toBeGreaterThan(0.8);
    h.keys.hits.add('KeyE');
    frame(h);
    h.keys.held.delete('KeyW');
    expect(carts.grab).toBeNull();
    for (let t = 0; t < 1; t += DT) frame(h);
    const coast = Math.hypot(b().x - at.x, b().z - at.z);
    log(`let go on a flight at ${v0.toFixed(2)} m/s: coasted ${(coast * 100).toFixed(1)} cm`);
    expect(coast).toBeLessThan(0.08);
    expect(Math.hypot(b().vx, b().vz)).toBe(0);
    const rest = {...b()};
    for (let t = 0; t < 3; t += DT) frame(h);
    expect([b().x, b().y, b().z]).toEqual([rest.x, rest.y, rest.z]); // it stays where it was let go
    expect(cartFloorAt(h.levels!, rest.x, rest.z, rest.y)?.floor).toBeCloseTo(rest.y, 9);
    // drawn lying on the steps: front (uphill) up by the stair's slope, lifted half a riser onto the nosing line
    const pose = carts.poseOf('cart:s')!, slope = Math.atan(up.riser / up.tread);
    expect(Math.abs(pose.pitch)).toBeCloseTo(slope, 1);
    expect(pose.dy).toBeCloseTo(up.riser / 2, 2);
    const g = carts.viewOf('cart:s')!;
    expect(g.rotation.order).toBe('YXZ');
    expect(g.rotation.x).toBeCloseTo(-pose.pitch, 9);
    expect(g.position.y).toBeCloseTo(rest.y + pose.dy, 9);
    // the handle is where it is drawn (well off the upright handle): aiming there grabs
    const drawn = bot.handleOf('cart:s');
    const upright = {x: rest.x + Math.sin(rest.yaw) * CART_LOOK.handle.z, y: rest.y + CART_LOOK.handle.y, z: rest.z + Math.cos(rest.yaw) * CART_LOOK.handle.z};
    expect(Math.hypot(drawn.x - upright.x, drawn.y - upright.y, drawn.z - upright.z)).toBeGreaterThan(0.35);
    lookAt(h, drawn.x, drawn.y, drawn.z);
    frame(h);
    expect(carts.aim?.cart.uid).toBe('cart:s');
    expect(carts.prompt).toMatch(/Hold \[E\]<\/b> Drag the fuel cart/);
    const eye = new THREE.Vector3(), dir = new THREE.Vector3();
    h.camera.getWorldPosition(eye); h.camera.getWorldDirection(dir);
    const hit = eye.clone().addScaledVector(dir, carts.aim!.t);
    // (the ray enters the frame's aim cylinder — 0.27 m round the drawn uprights — on its way to the drawn handle)
    const toDrawn = Math.hypot(hit.x - drawn.x, hit.y - drawn.y, hit.z - drawn.z);
    expect(toDrawn).toBeLessThan(CART_LOOK.frame.r + 0.2);
    expect(toDrawn).toBeLessThan(Math.hypot(hit.x - upright.x, hit.y - upright.y, hit.z - upright.z));
    holdE(h); // (E held: the drag starts with a hold)
    expect(carts.grab?.cart.uid).toBe('cart:s');
    // --- the same speed on flat floor still coasts on its rolling resistance (the existing feel, unchanged): the controller alone ---
    const room = flatRoom(), fb: CartBody = {x: 2, y: 0, z: 3, yaw: 0, vx: v0, vz: 0, level: 0, units: FUEL.cartUnits};
    for (let t = 0; t < 4; t += DT) stepCart(fb, {levels: room, props: null}, DT, null);
    log(`the same ${v0.toFixed(2)} m/s on flat floor: coasted ${((fb.x - 2) * 100).toFixed(0)} cm`);
    expect(fb.x - 2).toBeCloseTo((v0 * v0) / (2 * CART.rollDecel), 1);
    expect(cartRestPose(room, fb)).toEqual({dy: 0, pitch: 0, roll: 0}); // upright on flat floor, exactly
  }, 120_000);

  it('a free cart on a flight: walked into it is pushed at most at the push speed and stops with the player; shot, it barely moves', () => {
    const {h, carts, bot, b, up} = onSubway();
    const P = h.player, dirX = Math.sign(up.top.x - up.bottom.x), mid = (up.s0 + up.s1) / 2;
    expect(bot.dragTo('cart:s', mid, 0.8, up.bottom.z, {arrive: 0.4}).ok).toBe(true);
    bot.letGo();
    bot.wait(0.5);
    expect(flightAt(h.levels!, b().x, b().z, b().y)).not.toBeNull();
    // the player goes round and walks into it from above (down the stair)
    const y = b().y;
    P.place(b().x + dirX * 1.1, b().z, Math.atan2(dirX, 0), h.levels!.supportAt(b().x + dirX * 1.1, b().z, y + 1)!.floor);
    frame(h);
    const x0 = b().x;
    let vmax = 0;
    for (let t = 0; t < 1.2; t += DT) { h.keys.held.add('KeyW'); frame(h); vmax = Math.max(vmax, Math.hypot(b().vx, b().vz)); }
    h.keys.held.delete('KeyW');
    const pushed = Math.abs(b().x - x0);
    expect(pushed).toBeGreaterThan(0.3);
    expect(vmax).toBeLessThanOrEqual(pushTop(FUEL.cartUnits) + 1e-6);
    const x1 = b().x;
    for (let t = 0; t < 1; t += DT) frame(h);
    expect(Math.abs(b().x - x1)).toBeLessThan(0.1); // no coasting down the stair once the player stops
    expect(Math.hypot(b().vx, b().vz)).toBe(0);
    expect(cartFloorAt(h.levels!, b().x, b().z, b().y)).not.toBeNull();
    // a bullet down the stair: stopped by the cart, a shove that dies on the steps
    const c = b(), o = new THREE.Vector3(c.x + dirX * 3, c.y + 2.4, c.z), d = new THREE.Vector3(c.x - o.x, c.y + 0.5 - o.y, 0).normalize();
    const x2 = c.x;
    expect(carts.bulletHit({t: 12}, o.clone().addScaledVector(d, 12), d, 40)).toBe(true);
    expect(Math.hypot(b().vx, b().vz)).toBeGreaterThan(0.3);
    for (let t = 0; t < 1; t += DT) frame(h);
    expect(Math.abs(b().x - x2)).toBeLessThan(0.08);
    expect(Math.hypot(b().vx, b().vz)).toBe(0);
  }, 120_000);

  it('held going DOWN a stair the cart is tilted back toward the player, wheels on the step behind; let go, it settles nose-down on the steps', () => {
    const {h, carts, bot, b, down} = onSubway();
    const slope = Math.atan(down.riser / down.tread), d = CART.radius * CART.rim;
    // half way down the first service flight, still held
    expect(bot.dragTo('cart:s', (down.s0 + down.s1) / 2, (down.h0 + down.h1) / 2, down.bottom.z, {arrive: 0.35}).ok).toBe(true);
    bot.wait(0.8);
    expect(carts.grab?.cart.uid).toBe('cart:s');
    expect(flightAt(h.levels!, b().x, b().z, b().y)).not.toBeNull();
    // the front (the drum, away from the player) points down the stair
    const front = {x: Math.sin(b().yaw), z: Math.cos(b().yaw)};
    const ahead = h.levels!.supportIn(b().x + front.x * 0.25, b().z + front.z * 0.25, b().y, 0.5)!.floor;
    expect(ahead).toBeLessThan(b().y - 0.1);
    const held = carts.poseOf('cart:s')!;
    expect(held.pitch).toBeCloseTo(slope, 1); // tilted BACK (front up) by the stair's own angle
    expect(held.dy).toBeCloseTo(down.riser / 2 + 2 * d * Math.tan(slope), 1); // the wheels' end rests on the nosing line behind it
    // let go: it eases onto the steps, nose down with the slope
    bot.letGo();
    bot.wait(1);
    const rest = carts.poseOf('cart:s')!;
    expect(rest.pitch).toBeCloseTo(-slope, 1);
    expect(rest.dy).toBeCloseTo(down.riser / 2, 2);
    expect(Math.hypot(b().vx, b().vz)).toBe(0);
    // grabbed again: tilted back again
    expect(bot.grab('cart:s')).toBe(true);
    bot.wait(0.8);
    expect(carts.poseOf('cart:s')!.pitch).toBeGreaterThan(0.3);
  }, 120_000);

  it('its meshes carry the storey it stands on after a stair (level marks follow the cart)', () => {
    const {h, carts, bot, b, low} = onSubway();
    const marks = () => { const s = new Set<number>(); carts.viewOf('cart:s')!.traverse(o => { if ((o as THREE.Mesh).isMesh) s.add(o.userData.level as number); }); return [...s]; };
    expect(marks()).toEqual([0]);
    const start = {...b()};
    expect(bot.dragTo('cart:s', low.x + Math.sign(low.x - start.x) * 1.0, low.y, low.z, {arrive: 0.5}).ok).toBe(true);
    const lv = b().level;
    expect(lv).not.toBe(0);
    expect(h.levels!.list.find(q => q.id === lv)!.baseY).toBeCloseTo(low.y, 2);
    expect(marks()).toEqual([lv]);
  }, 120_000);
});

describe('the rest pose on steps (pure)', () => {
  it('on a flight: on the nosing line, pitched / rolled with the slope by the cart\'s heading; flat floor: exactly upright', () => {
    const L = SUBWAY(), levels = levelsOf(L), f = L.traversal.stairs[0];
    const slope = Math.atan(f.riser / f.tread), x = (f.s0 + f.s1) / 2, z = (f.a0 + f.a1) / 2, dirX = Math.sign(f.s1 - f.s0) * Math.sign(f.h1 - f.h0); // uphill along +x?
    const y = levels.supportIn(x, z, (f.h0 + f.h1) / 2, 0.5)!.floor;
    expect(flightAt(levels, x, z, y)).not.toBeNull();
    const body = (yaw: number): CartBody => ({x, y, z, yaw, vx: 0, vz: 0, level: 0, units: 8});
    // front (sin yaw, cos yaw): facing uphill / downhill / across
    const uphill = cartRestPose(levels, body(dirX > 0 ? Math.PI / 2 : -Math.PI / 2));
    expect(uphill.pitch).toBeCloseTo(slope, 6);
    expect(uphill.roll).toBeCloseTo(0, 9);
    expect(uphill.dy).toBeCloseTo(f.riser / 2, 6);
    const downhill = cartRestPose(levels, body(dirX > 0 ? -Math.PI / 2 : Math.PI / 2));
    expect(downhill.pitch).toBeCloseTo(-slope, 6);
    expect(downhill.dy).toBeCloseTo(f.riser / 2, 6);
    const across = cartRestPose(levels, body(0)); // front +z; its +x side points along world +x
    expect(across.pitch).toBeCloseTo(0, 9);
    expect(across.roll).toBeCloseTo(dirX > 0 ? slope : -slope, 6);
    // flat floor
    const flat = cartRestPose(levels, {x: f.bottom.x - Math.sign(f.s1 - f.s0) * 1.5, y: f.bottom.y, z, yaw: 0.7, vx: 0, vz: 0, level: 0, units: 8});
    expect(flat).toEqual({dy: 0, pitch: 0, roll: 0});
    expect(flightAt(levels, f.bottom.x - Math.sign(f.s1 - f.s0) * 1.5, z, f.bottom.y)).toBeNull();
  });

  it('the rest surface along a whole run (three flights, two landings): never under the built steps, never more than a riser over them, no jumps', () => {
    const L = SUBWAY(), levels = levelsOf(L), fl = L.traversal.stairs.slice(0, 3), z = (fl[0].a0 + fl[0].a1) / 2;
    const x0 = Math.min(fl[0].bottom.x, fl[2].top.x) - 1, x1 = Math.max(fl[0].bottom.x, fl[2].top.x) + 1;
    const rising = fl[2].top.x > fl[0].bottom.x;
    let y = rising ? fl[0].bottom.y : fl[2].top.y, prev: number | null = null, worstGap = 0, worstJump = 0, onSteps = 0;
    for (let x = x0; x <= x1; x += 0.01) {
      const sup = levels.supportIn(x, z, y, 0.5);
      expect(sup, `support at ${x.toFixed(2)}`).not.toBeNull();
      y = sup!.floor;
      const surf = cartSurfaceAt(levels, x, z, y)!;
      const R = flightAt(levels, x, z, y);
      const built = R ? stepTop(R, x) : y; // the tread tops as built (world/traversalBuilder.ts)
      expect(surf, `at ${x.toFixed(2)}`).toBeGreaterThanOrEqual(built - 1e-9);
      worstGap = Math.max(worstGap, surf - built);
      if (prev !== null) worstJump = Math.max(worstJump, Math.abs(surf - prev));
      prev = surf;
      if (R) onSteps++;
    }
    const riser = fl[0].riser;
    expect(onSteps).toBeGreaterThan(700);
    expect(worstGap).toBeLessThanOrEqual(riser + 1e-9);
    expect(worstJump).toBeLessThan(0.014); // (1 cm of run: at most 1.2 cm of height on the last half tread)
    log(`rest surface over a 3-flight run: worst height over the built steps ${(worstGap * 100).toFixed(1)} cm (riser ${(riser * 100).toFixed(1)} cm), worst change per cm ${(worstJump * 100).toFixed(2)} cm`);
  });

  it('the Bunker\'s vault threshold (0.28 m steps a cell): the cart rocks over them, its base never under the step it stands on', () => {
    const L = generateBunkerLevel({levelSeed: 9001}), levels = levelsOf(L), v = L.bunker!.vaultDoor;
    let tilted = 0, top = 0;
    for (let dz = -2.6; dz <= 2.6; dz += 0.02) {
      const sup = levels.supportAt(v.x, v.z + dz, 1.2);
      if (!sup) continue;
      const b: CartBody = {x: v.x, y: sup.floor, z: v.z + dz, yaw: 0, vx: 0, vz: 0, level: 0, units: 8};
      const p = cartRestPose(levels, b);
      expect(p.dy).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.abs(p.pitch)).toBeLessThanOrEqual(CART.maxTilt);
      if (Math.abs(p.pitch) > 0.1) tilted++;
      top = Math.max(top, sup.floor);
    }
    expect(top).toBeCloseTo(0.84, 2);
    expect(tilted).toBeGreaterThan(20);
  });
});

describe('a cart standing on a stair in a save', () => {
  it('its station record (pose on the pitch line, the lower storey, its fuel, its uid) survives the save text exactly', () => {
    const {h, carts, bot, b, low} = onSubway(5);
    const start = {...b()};
    // half way down the second service flight
    const f = SUBWAY().traversal.stairs[4];
    expect(bot.dragTo('cart:s', (f.s0 + f.s1) / 2, (f.h0 + f.h1) / 2, low.z, {arrive: 0.4}).ok).toBe(true);
    bot.letGo();
    bot.wait(1);
    expect(flightAt(h.levels!, b().x, b().z, b().y)).not.toBeNull();
    const [rec] = carts.stationRecords();
    expect(rec.uid).toBe('cart:s');
    expect(rec.units).toBe(5);
    expect(rec.y).toBeLessThan(-2.2);
    expect(rec.y).toBeGreaterThan(-3.8);
    const lane: StationFuelJSON = {v: 2, realized: true, carts: [rec], lots: []};
    expect(stationFuelProblem(lane)).toBeNull();
    const H = new Harness();
    const key = {level: 'subway' as const, section: 'main', station: sid(0)};
    H.run.setLaneStore(FUEL_LANE, lane, key);
    const p = parseSaveText(saveFileText(H.file('arrival', 1)));
    expect(p.ok, p.ok ? '' : p.error).toBe(true);
    const back = ((p as {value: SaveFileV1Like}).value.run.memories[`${sid(0)}:main`].lanes as Record<string, StationFuelJSON>)[FUEL_LANE];
    expect(back).toEqual(lane);
    // and that record in a fresh world: the same cart, there, once
    const again = stationHost(SUBWAY());
    live.push(again.rt);
    again.carts.loadStation(back.carts);
    frame(again.h);
    expect(again.carts.all().map(c => [c.uid, c.units])).toEqual([['cart:s', 5]]);
    const nb = again.carts.bodyOf('cart:s')!;
    expect(Math.hypot(nb.x - rec.x, nb.z - rec.z)).toBeLessThan(1e-6);
    expect(nb.y).toBeCloseTo(rec.y, 3);
    expect(nb.level).toBe(rec.level);
    expect(again.carts.poseOf('cart:s')!.pitch).toBeCloseTo(carts.poseOf('cart:s')!.pitch, 3);
    void start;
  }, 120_000);
});
