// Task studio-beta-train-fuel-system-20261106-024923-01 (lane CART): the fuel cart's kinematic controller (world/fuelCartPhysics.ts) and
// the push / grab interaction (world/fuelCarts.ts) on a hand-built room (walls all round, a 1.15 m drop at x = 7 m like a platform
// edge) with the REAL Player body: a cart never passes a wall or rolls off the edge, a walking player pushes it (slowly, slower full)
// and never walks through it, a grabbed cart (E HELD: task train-interaction-ux-20261112; the hold's own cases are tests/
// drag-hold-fuel-cart.test.ts) is pulled out of a corner and steered, carts never overlap, a grab is let go by E / a hit / a menu /
// walking away, the drag slows the player and owns the mouse buttons; the composed cart's human-scale dimensions.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {CART, cartMass, footprintFloor, moveCart, pushTop, stepCart, type CartBody, type CartWorld} from '../src/world/fuelCartPhysics';
import {CART_LOOK, buildCartView} from '../src/world/fuelCartModel';
import {FUEL_CART} from '../src/world/fuelCarts';
import {FUEL} from '../src/fuel/fuel';
import {PORT} from '../src/fuel/trainPort';
import {combineModifiers} from '../src/player/modifiers';
import {DT, flatRoom, frame, holdE, lookAt, press, roomHost, run} from './helpers/fuelCartsHost';

const R = CART.radius;
const WALL = 0.5; // the room's inner wall faces: x / z = 0.5 and x = 10.5 / z = 6.5
const EDGE = 7; // the drop

const body = (x: number, z: number, units: number = FUEL.cartUnits, v: [number, number] = [0, 0]): CartBody => ({x, y: 0, z, yaw: 0, vx: v[0], vz: v[1], level: 0, units});
const cart = (uid: string, x: number, z: number, units: number = FUEL.cartUnits, yaw = 0) => ({uid, units, x, y: 0, z, yaw, level: 0});

describe('fuel cart controller (pure)', () => {
  const levels = flatRoom(EDGE);
  const w: CartWorld = {levels, props: null};

  it('the numbers are the design: radius = PORT.cartRadius, 150 kg full, a full cart pushes slower than an empty one', () => {
    expect(R).toBe(PORT.cartRadius);
    expect(cartMass(FUEL.cartUnits)).toBeCloseTo(150, 9);
    expect(cartMass(0)).toBe(CART.emptyKg);
    expect(pushTop(FUEL.cartUnits)).toBeLessThan(pushTop(0));
  });

  it('a free cart thrown at a wall stops at the wall (never through it)', () => {
    const b = body(2, 3, 8, [-3.2, 0]);
    let minX = Infinity;
    for (let t = 0; t < 3; t += DT) { stepCart(b, w, DT, null); minX = Math.min(minX, b.x); }
    expect(minX).toBeGreaterThanOrEqual(WALL + R - 1e-6);
    expect(b.x).toBeLessThan(WALL + R + 0.05);
    expect(Math.hypot(b.vx, b.vz)).toBe(0); // rolling resistance stopped it
    // a grab target BEHIND the wall: the spring presses it there, it stays out of the wall
    const g = body(1.5, 3);
    for (let t = 0; t < 3; t += DT) stepCart(g, w, DT, {x: -1, z: 3, vx: 0, vz: 0});
    expect(g.x).toBeGreaterThanOrEqual(WALL + R - 1e-6);
    // a corner: both walls hold
    const c = body(1.5, 1.5);
    for (let t = 0; t < 3; t += DT) stepCart(c, w, DT, {x: -2, z: -2, vx: 0, vz: 0});
    expect(c.x).toBeGreaterThanOrEqual(WALL + R - 1e-6);
    expect(c.z).toBeGreaterThanOrEqual(WALL + R - 1e-6);
  });

  it('never rolls off the platform edge: the footprint stays on the platform, sliding along the edge', () => {
    const rim = R * CART.rim;
    for (const v of [[3, 0], [2.2, 2.2], [2.2, -2.2]] as [number, number][]) {
      const b = body(5, 3.5, 8, v);
      for (let t = 0; t < 3; t += DT) {
        stepCart(b, w, DT, null);
        expect(b.y).toBe(0);
        expect(b.x).toBeLessThanOrEqual(EDGE - rim + 1e-6);
      }
    }
    // dragged toward the bed: held at the edge too
    const g = body(5, 3);
    for (let t = 0; t < 4; t += DT) stepCart(g, w, DT, {x: 9.5, z: 3.2, vx: 0, vz: 0});
    expect(g.x).toBeLessThanOrEqual(EDGE - rim + 1e-6);
    expect(g.x).toBeGreaterThan(EDGE - rim - 0.1);
    expect(g.y).toBe(0);
    // the floor rule itself: over the bed / a rim point over the bed = no footing
    expect(footprintFloor(levels, 8, 3, 0)).toBeNull();
    expect(footprintFloor(levels, EDGE - rim + 0.02, 3, 0)).toBeNull();
    expect(footprintFloor(levels, EDGE - rim - 0.02, 3, 0)?.floor).toBe(0);
    const b = body(EDGE - rim - 0.01, 3);
    expect(moveCart(b, w, 0.5, 0)).toBe(false); // straight at the edge: refused
    expect(moveCart(b, w, 0.3, 0.3)).toBe(true); // diagonally: slides along it
    expect(b.x).toBeCloseTo(EDGE - rim - 0.01, 9);
    expect(b.z).toBeCloseTo(3.3, 9);
  });
});

describe('fuel cart push / grab (system, real Player)', () => {
  it('a walking player pushes a free cart slowly (a full one slower) and never walks through it', () => {
    const dist: Record<string, number> = {};
    for (const units of [FUEL.cartUnits, 0]) {
      const {h, carts} = roomHost();
      carts.spawn(cart('c', 3.2, 3.5, units));
      h.player.place(2, 3.5, -Math.PI / 2); // facing +X
      frame(h);
      h.keys.held.add('KeyW');
      let minGap = Infinity, top = 0;
      for (let t = 0; t < 2; t += DT) {
        frame(h);
        const b = carts.bodyOf('c')!;
        minGap = Math.min(minGap, Math.hypot(b.x - h.player.x, b.z - h.player.z));
        top = Math.max(top, Math.hypot(b.vx, b.vz));
      }
      const b = carts.bodyOf('c')!;
      expect(minGap).toBeGreaterThanOrEqual(h.player.radius + R - 1e-6); // never inside the cart
      expect(top).toBeLessThanOrEqual(pushTop(units) + 1e-6);
      expect(b.x - 3.2).toBeGreaterThan(0.4); // it moved along the push
      expect(Math.abs(b.z - 3.5)).toBeLessThan(0.05);
      expect(h.player.x).toBeLessThan(b.x); // the player is still behind it
      dist[units] = b.x - 3.2;
      expect(carts.counts.pushes).toBeGreaterThan(0);
    }
    expect(dist[FUEL.cartUnits]).toBeLessThan(dist[0]);
  });

  it('a cart pushed into a wall stops; the player stops behind it (no walking through)', () => {
    const {h, carts} = roomHost();
    carts.spawn(cart('c', 1.6, 3.5));
    h.player.place(2.6, 3.5, Math.PI / 2); // facing -X, the cart between the player and the wall
    frame(h);
    h.keys.held.add('KeyW');
    run(h, 3);
    const b = carts.bodyOf('c')!;
    expect(b.x).toBeGreaterThanOrEqual(WALL + R - 1e-6);
    expect(b.x).toBeLessThan(WALL + R + 0.03);
    expect(h.player.x - b.x).toBeGreaterThanOrEqual(h.player.radius + R - 1e-6);
  });

  it('grab (E HELD on the handle within reach): pulled out of a corner, steered, trailing the player; E lets go', () => {
    const {h, carts} = roomHost();
    carts.spawn(cart('c', WALL + R + 0.01, WALL + R + 0.01, FUEL.cartUnits, Math.PI)); // in the corner, handle toward +Z
    h.player.place(1.9, 2.3, 0);
    frame(h);
    const b = carts.bodyOf('c')!;
    // too far: no prompt, E is not taken
    h.player.place(4, 4, 0);
    frame(h);
    lookAt(h, b.x, b.y + CART_LOOK.handle.y, b.z);
    frame(h);
    expect(carts.prompt).toBeNull();
    expect(carts.onInteract()).toBe(false);
    // within reach, aimed at the handle
    h.player.place(1.25, 2.05, 0);
    frame(h);
    lookAt(h, b.x + Math.sin(b.yaw) * CART_LOOK.handle.z, b.y + CART_LOOK.handle.y, b.z + Math.cos(b.yaw) * CART_LOOK.handle.z);
    frame(h);
    expect(carts.prompt).toMatch(/Hold \[E\]<\/b> Drag the fuel cart · 2 tanks/);
    holdE(h);
    expect(carts.grab).not.toBeNull();
    expect(carts.prompt).toMatch(/Let go/);
    expect(h.inputOwners.some(f => f())).toBe(true); // no shot / ADS / item use while dragging
    expect(combineModifiers(h.modifierSources as never).speedMult).toBeCloseTo(FUEL_CART.speedMult, 9);
    // walk backwards out of the room's corner (look stays on the cart: it follows the hand point in front of the player)
    h.player.yaw = Math.atan2(-(b.x - h.player.x), -(b.z - h.player.z));
    h.player.pitch = -0.4;
    h.keys.held.add('KeyS');
    let topSpeed = 0;
    for (let t = 0; t < 2.5; t += DT) { frame(h); topSpeed = Math.max(topSpeed, Math.hypot(h.player.vx, h.player.vz)); }
    h.keys.held.clear();
    run(h, 1);
    expect(carts.grab).not.toBeNull();
    expect(Math.hypot(b.x - (WALL + R), b.z - (WALL + R))).toBeGreaterThan(1.5); // out of the corner
    expect(topSpeed).toBeLessThanOrEqual(3.4 * FUEL_CART.speedMult + 0.05); // the drag slows the walk
    expect(Math.hypot(b.x - h.player.x, b.z - h.player.z)).toBeCloseTo(FUEL_CART.hold, 1); // at the hand point
    // it trails the player: its handle side (-Z local) faces the player
    const front = {x: Math.sin(b.yaw), z: Math.cos(b.yaw)}, away = {x: b.x - h.player.x, z: b.z - h.player.z};
    expect((front.x * away.x + front.z * away.z) / Math.hypot(away.x, away.z)).toBeGreaterThan(0.95);
    // steer: turn left and walk: the cart swings round with the hand point
    h.player.yaw += Math.PI / 2;
    h.keys.held.add('KeyW');
    run(h, 1.2);
    h.keys.held.clear();
    run(h, 0.8);
    const f2 = {x: -Math.sin(h.player.yaw), z: -Math.cos(h.player.yaw)}, rel = {x: b.x - h.player.x, z: b.z - h.player.z};
    expect((f2.x * rel.x + f2.z * rel.z) / Math.hypot(rel.x, rel.z)).toBeGreaterThan(0.9);
    press(h, 'KeyE');
    expect(carts.grab).toBeNull();
    expect(h.inputOwners.some(f => f())).toBe(false);
    expect(combineModifiers(h.modifierSources as never).speedMult).toBe(1);
  });

  it('a grab is let go by a hit, a menu, death, and a cart stuck behind a wall', () => {
    const {h, carts} = roomHost();
    carts.spawn(cart('c', 3, 3.5, FUEL.cartUnits, Math.PI / 2));
    const grabNow = () => {
      h.player.place(1.7, 3.5, -Math.PI / 2);
      frame(h);
      const b = carts.bodyOf('c')!;
      lookAt(h, b.x - 0.19, b.y + 1.0, b.z);
      holdE(h);
      expect(carts.grab).not.toBeNull();
    };
    grabNow();
    for (const f of h.hitListeners) (f as (x: unknown) => void)({amount: 5});
    expect(carts.grab).toBeNull();
    grabNow();
    for (const f of h.stateListeners) (f as (s: string, p: string) => void)('paused', 'playing');
    expect(carts.grab).toBeNull();
    grabNow();
    h.player.alive = false;
    frame(h);
    expect(carts.grab).toBeNull();
    h.player.alive = true;
    // the player walks away through a gap the cart cannot follow (teleport stands in for it): too far -> let go
    grabNow();
    h.player.place(8.5, 3.5, Math.PI / 2);
    run(h, 0.6);
    expect(carts.grab).toBeNull();
    expect(h.toasts).toContain('The cart is stuck — you let go');
  });

  it('a bullet whose world hit lies behind a cart stops on it and shoves it along the shot (bounded, a full cart less)', () => {
    const shove: Record<number, number> = {};
    for (const units of [FUEL.cartUnits, 0]) {
      const {h, carts} = roomHost();
      carts.spawn(cart('c', 5, 3.5, units));
      expect(h.bulletHitHandlers).toHaveLength(1);
      const shoot = (z: number, damage: number) => {
        // a ray from (2, 1.0, z) along +X (a little down) to the far wall (x = 10.5)
        const dir = new THREE.Vector3(1, -0.05, 0).normalize(), t = (10.5 - 2) / dir.x;
        const point = new THREE.Vector3(2, 1.0, z).addScaledVector(dir, t);
        return h.bulletHitHandlers!.some(f => (f as (wh: unknown, p: THREE.Vector3, d: THREE.Vector3, s: number, dmg: number) => boolean)({t, kind: 'wall', nx: -1, ny: 0, nz: 0}, point, dir, 1, damage));
      };
      expect(shoot(5.5, 30)).toBe(false); // passes beside it: the wall takes it
      expect(carts.bodyOf('c')!.vx).toBe(0);
      expect(shoot(3.5, 30)).toBe(true); // through the cart: stopped there
      const b = carts.bodyOf('c')!;
      expect(b.vx).toBeGreaterThan(0);
      expect(b.vx).toBeLessThanOrEqual(FUEL_CART.bulletMaxDv + 1e-9);
      expect(Math.abs(b.vz)).toBeLessThan(1e-9);
      shove[units] = b.vx;
      run(h, 2);
      expect(b.x).toBeGreaterThan(5.02); // it rolled a little, then stopped (rolling resistance)
      expect(Math.hypot(b.vx, b.vz)).toBe(0);
      expect(carts.counts.bullets).toBe(1);
    }
    expect(shove[FUEL.cartUnits]).toBeLessThan(shove[0]);
  });

  it('carts never overlap: a pushed cart shoves the next one', () => {
    const {h, carts} = roomHost();
    carts.spawn(cart('a', 3.2, 3.5));
    carts.spawn(cart('b', 4.0, 3.55));
    h.player.place(2, 3.5, -Math.PI / 2);
    frame(h);
    h.keys.held.add('KeyW');
    let minGap = Infinity;
    for (let t = 0; t < 3; t += DT) {
      frame(h);
      const a = carts.bodyOf('a')!, b = carts.bodyOf('b')!;
      minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.z - b.z));
    }
    expect(minGap).toBeGreaterThan(2 * R - 0.02);
    expect(carts.bodyOf('b')!.x).toBeGreaterThan(4.2); // it was shoved
  });
});

describe('fuel cart look (human scale)', () => {
  it('handle top 1.20 m, drum 0.45 m wide / lid at 0.72 m on the nose plate; the footprint hugs PORT.cartRadius', () => {
    expect(CART_LOOK.height).toBeCloseTo(1.2, 6);
    expect(CART_LOOK.drumR * 2).toBeCloseTo(0.455, 2);
    expect(CART_LOOK.drumH).toBeCloseTo(0.648, 3);
    expect(CART_LOOK.drumTop).toBeCloseTo(0.721, 3);
    expect(CART_LOOK.halfD).toBeLessThanOrEqual(R); // front / back of the footprint inside the circle
    expect(Math.hypot(CART_LOOK.halfW, CART_LOOK.halfD)).toBeLessThan(R + 0.05); // only the wheel corners poke out, a few cm
    // the stand-in (no models in Node): grounded, the same height, named as a stand-in
    const v = buildCartView();
    expect(v.standIn).toBe(true);
    expect(v.group.getObjectByName('fuel-cart-stand-in')).toBeTruthy();
    v.group.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(v.body);
    expect(bb.min.y).toBeCloseTo(0, 2);
    expect(bb.max.y).toBeGreaterThan(1.15);
    expect(bb.max.y).toBeLessThan(1.21);
    expect(bb.max.x - bb.min.x).toBeLessThan(0.52);
  });
});
