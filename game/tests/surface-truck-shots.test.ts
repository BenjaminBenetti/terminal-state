// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK, follow-up 1; lead: "Bullets vs the truck: hitscan must stop at the truck body
// (no shooting through the cab/body), glass panes react like the car's if the car's do; add a test"): one bullet in Game.fire's order
// (game.ts: the world ray -> SkywaysCar.shotStop -> the enemies up to the world hit -> a world hit's handlers, Game.bulletHit) —
//  - a shot at the truck's side (the bed, the cab) ENDS on its body: the world hit is clipped there (a wall hit of no storey band, so no
//    window pane / prop / cell is attributed behind it), a zombie on the line beyond is never hit, the truck claims it (a metal impact);
//  - through the cab glass (the measured windscreen): the same — the vehicle's glass has no pane state, exactly like the car's, whose
//    shots at its glass are metal impacts too;
//  - not stopped: a shooter inside the body box, a ray over the roof, a world hit in front of the truck, no truck in the world; an
//    open-air ray (no world hit at all) is stopped;
//  - the car (Skyways layout) keeps today's behaviour exactly: its shotStop never changes a hit (TRUCK_DEF.stopsShots only).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {raycastShot} from '../src/physics/merchOnHost';
import {nearestEnemyHit, type RayEnemy} from '../src/combat/enemyRay';
import type {WorldHit} from '../src/combat/hitscan';
import type {PropPlacement} from '../src/gen/props';
import {CAR_SPEC, carToWorld} from '../src/world/skywaysCarSpec';
import {CAR_DEF, type SkywaysCar} from '../src/world/skywaysCar';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {TRUCK_SPEC} from '../src/world/surface/truckSpec';
import {TRUCK_DEF} from '../src/world/surface/truckVehicle';
import {carHost, teardown, type CarTestHost} from './helpers/skywaysCarHost';
import {truckHost} from './helpers/surfaceTruckHost';

type V = {x: number; y: number; z: number};
type Handler = (wh: WorldHit, p: THREE.Vector3, d: THREE.Vector3, shot: number, damage: number) => boolean;

/** A standing enemy's ray volume (a torso capsule) at (x, z). */
const enemyAt = (x: number, z: number): RayEnemy => ({brain: {alive: true}, hitVolumes: [{part: 'torso', a: {x, y: 0.9, z}, b: {x, y: 1.6, z}, r: 0.3}]});

/** One bullet from `o` toward `to`, in Game.fire's order. `open`: the world hit before the vehicle's stop; `hit`: the enemy hit. */
function shoot(h: CarTestHost, car: SkywaysCar, o: V, to: V, enemies: RayEnemy[] = [], wh0?: WorldHit) {
  const len = Math.hypot(to.x - o.x, to.y - o.y, to.z - o.z), d = {x: (to.x - o.x) / len, y: (to.y - o.y) / len, z: (to.z - o.z) / len};
  const wh = wh0 ?? raycastShot(h.levels!, (h.layout as unknown as {props: PropPlacement[]}).props, o, d, 80, -50);
  const open = {...wh};
  const stopped = car.shotStop(o, d, wh);
  const eh = nearestEnemyHit(o, d, wh.t, enemies);
  let claimed = false;
  if (!eh && wh.kind !== 'none') {
    const point = new THREE.Vector3(o.x + d.x * wh.t, o.y + d.y * wh.t, o.z + d.z * wh.t), dir = new THREE.Vector3(d.x, d.y, d.z);
    for (const f of h.bulletHitHandlers as unknown as Handler[]) if (f(wh, point, dir, 1, 30)) { claimed = true; break; }
  }
  return {wh, open, stopped, hit: eh?.enemy ?? null, claimed, d};
}

/** A world point of the truck's frame (x right, z back), `y` above its body. */
function at(car: SkywaysCar, x: number, y: number, z: number): V {
  const b = car.body!, p = carToWorld(b.x, b.z, b.yaw, x, z);
  return {x: p.x, y: b.y + y, z: p.z};
}

describe('bullets vs the truck', () => {
  it('a shot at its side (the bed, the cab) ends on the body: nothing behind it is hit, the truck claims it as a metal impact', () => {
    const {h, car} = truckHost();
    expect(TRUCK_DEF.stopsShots).toBe(true);
    let n = 0;
    for (const lz of [2.0, -3.0]) { // (the bed under its cover; the cab)
      const o = at(car, -8, 1.8, lz), to = at(car, 8, 1.8, lz), z = enemyAt(at(car, 4, 0, lz).x, at(car, 4, 0, lz).z);
      // (the line really reaches the zombie without the truck)
      expect(nearestEnemyHit(o, {x: (to.x - o.x) / 16, y: 0, z: (to.z - o.z) / 16}, 80, [z])?.enemy, `${lz}: on the line`).toBe(z);
      const r = shoot(h, car, o, to, [z]);
      expect(r.stopped, `${lz}`).toBe(true);
      expect(r.open.t).toBeGreaterThan(12);
      expect(r.wh.t).toBeCloseTo(8 - (TRUCK_SPEC.width / 2 - 0.06), 6);
      expect([r.wh.kind, r.wh.level, r.wh.prop, r.wh.cell]).toEqual(['wall', -1, undefined, undefined]);
      expect(r.wh.nx).toBeCloseTo(-r.d.x, 9);
      expect(r.hit, `${lz}: the zombie behind the truck is not hit`).toBeNull();
      expect(r.claimed).toBe(true);
      expect(car.counts.bullets).toBe(++n);
    }
    expect(h.sfxCalls.filter(s => s === 'bullet').length).toBe(2);
    expect(h.propHits).toEqual([]);
    // a zombie IN FRONT of the truck on the same line is hit as ever
    const o = at(car, -8, 1.8, 2), to = at(car, 8, 1.8, 2), front = enemyAt(at(car, -4, 0, 2).x, at(car, -4, 0, 2).z);
    expect(shoot(h, car, o, to, [front]).hit).toBe(front);
  });

  it('through the cab glass (the measured windscreen): stopped at the cab like any of its panels — the car\'s glass is a metal impact too', () => {
    const {h, car} = truckHost();
    const g = TRUCK_ANCHORS.glass.find(q => q.name === 'windscreen-left')!, gx = (g.x0 + g.x1) / 2, gy = (g.y0 + g.y1) / 2;
    const o = at(car, gx, gy, -12), to = at(car, gx, gy, 12), z = enemyAt(at(car, gx, 0, 6).x, at(car, gx, 0, 6).z);
    const r = shoot(h, car, o, to, [z]);
    expect(r.stopped).toBe(true);
    // (the box's front face: at the windscreen's plane)
    expect(r.wh.t).toBeCloseTo(12 - (TRUCK_SPEC.length / 2 - 0.1), 6);
    expect(Math.abs(-12 + r.wh.t - (g.z0 + g.z1) / 2)).toBeLessThan(0.1);
    expect([r.hit, r.claimed, r.wh.kind]).toEqual([null, true, 'wall']);
    expect([h.broken, h.propHits]).toEqual([[], []]);
    // the car: a shot at its windscreen (between its measured base and top edges) is its metal impact (bulletHit on the world hit behind
    // it) — no pane, no glass state either
    const c = carHost(), cb = c.car.body!, wy = cb.y + (CAR_SPEC.cowl.y + CAR_SPEC.header.y) / 2, ex = CAR_SPEC.eye.x;
    const co0 = carToWorld(cb.x, cb.z, cb.yaw, ex, -8), co = {x: co0.x, y: wy, z: co0.z};
    const cd = new THREE.Vector3(Math.sin(cb.yaw), 0, Math.cos(cb.yaw)); // (the car's +Z: nose to tail)
    const cwh = raycastShot(c.h.levels!, [], co, cd, 80, -50);
    expect(c.car.shotStop(co, cd, cwh)).toBe(false);
    const point = new THREE.Vector3(co.x, co.y, co.z).addScaledVector(cd, cwh.t);
    expect((c.h.bulletHitHandlers as unknown as Handler[]).some(f => f(cwh, point, cd, 1, 30))).toBe(true);
    expect([c.car.counts.bullets, c.h.sfxCalls.includes('bullet'), c.h.broken]).toEqual([1, true, []]);
  });

  it('not stopped: from inside the body box, over the roof, a world hit before the truck, no truck here; an open-air ray is stopped', () => {
    const {h, car} = truckHost();
    // the shooter in the cab (its eye: inside the box)
    const eye = TRUCK_ANCHORS.eye;
    const inside = shoot(h, car, at(car, eye.x, eye.y, eye.z), at(car, 8, eye.y, eye.z));
    expect([inside.stopped, inside.wh]).toEqual([false, inside.open]);
    // over the roof
    const over = shoot(h, car, at(car, -8, TRUCK_SPEC.height + 0.3, 0), at(car, 8, TRUCK_SPEC.height + 0.3, 0));
    expect([over.stopped, over.wh]).toEqual([false, over.open]);
    // a wall 3 m in front of the truck's side takes it first
    const wall: WorldHit = {t: 3, kind: 'wall', nx: 1, ny: 0, nz: 0, level: 0, cell: 7};
    const before = shoot(h, car, at(car, -8, 1.8, 0), at(car, 8, 1.8, 0), [], wall);
    expect([before.stopped, before.wh]).toEqual([false, {t: 3, kind: 'wall', nx: 1, ny: 0, nz: 0, level: 0, cell: 7}]);
    // open air (the ray's own range, no world hit): the body is the hit
    const air: WorldHit = {t: 80, kind: 'none', nx: 0, ny: 0, nz: 0};
    const sky = shoot(h, car, at(car, -8, 1.8, 0), at(car, 8, 1.8, 0), [], air);
    expect([sky.stopped, sky.wh.kind, sky.claimed]).toEqual([true, 'wall', true]);
    expect(sky.wh.t).toBeCloseTo(8 - (TRUCK_SPEC.width / 2 - 0.06), 6);
    // no truck in this world (torn down)
    const o = at(car, -8, 1.8, 0), to = at(car, 8, 1.8, 0);
    teardown(h);
    const gone = shoot(h, car, o, to);
    expect([gone.stopped, gone.wh]).toEqual([false, gone.open]);
  });

  it('the car keeps today\'s behaviour: its definition does not stop shots, so its shotStop never changes a hit', () => {
    expect(CAR_DEF.stopsShots).toBeUndefined();
    const {h, car} = carHost(), b = car.body!;
    const o0 = carToWorld(b.x, b.z, b.yaw, -6, 0), o = {x: o0.x, y: b.y + 0.8, z: o0.z};
    const t0 = carToWorld(b.x, b.z, b.yaw, 6, 0), to = {x: t0.x, y: b.y + 0.8, z: t0.z};
    const r = shoot(h, car, o, to);
    expect([r.stopped, r.wh]).toEqual([false, r.open]);
  });
});
