// Task studio-skywalk-events-20261115-193624-01 (lead, integration): the mini-golf on a REAL generated course. GOLF-COURSE's dresser
// (gen/skyways/events/golfDress.ts) lays the greens / cups / rails of a layout-version-7 Skyways station; GOLF-PLAY's ball physics
// (physics/golfBall.ts, the cup = a gap in golfColliderBoxes) and putter stroke (combat/putterStrike.ts) were proven on a synthetic lane
// built to the shared contract. Here the two meet on the generated layout itself:
//  - the REAL PhysicsSystem over the whole station (every storey; the course's colliders from its own pieces), the REAL tee ball pickup at
//    the dresser's pose: at rest it stays on its tee (on the turf, not floating, not sinking);
//  - the putter's stroke (strikeGolfBall: the feet behind the ball, facing the cup, the charge that gives the pace) sends the SAME pickup
//    rolling down a straight hole: it drops THROUGH the cup's gap and settles below the turf line (golfBallInCup), no teleport;
//  - a putt with too little pace stops short on the turf; one ball, never another one spawned; deterministic.
import {describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {PropPlacement} from '../src/gen/props';
import {PhysicsSystem} from '../src/physics/world';
import {PickupManager, type Pickup} from '../src/world/pickups';
import {Inventory} from '../src/items/inventory';
import {GOLF_BALL_ITEM, GOLF_BALL_R, GOLF_GREEN_H, golfBallInCup} from '../src/gen/skyways/events/golfContract';
import {GOLF_ROLL, golfBallCentre} from '../src/physics/golfBall';
import {PUTT_POWER} from '../src/weapons/putter';
import {strikeGolfBall} from '../src/combat/putterStrike';
import type {SkywaysGolfHole} from '../src/gen/skyways/events/golfTypes';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {};

const DT = 1 / 60;
const gen = (seed: number) => LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 7} as never) as StationLayout;
/** The charge whose putt leaves at `v` m/s (weapons/putter.ts puttSpeed, inverted). */
const chargeFor = (v: number) => (v * v - PUTT_POWER.minSpeed ** 2) / (PUTT_POWER.maxSpeed ** 2 - PUTT_POWER.minSpeed ** 2);

function course(L: StationLayout) {
  const ph = new PhysicsSystem(null);
  ph.build(L);
  const pm = new PickupManager({});
  ph.dynamicItems.pickups = () => pm.list;
  const inv = new Inventory();
  return {ph, pm, inv};
}

/** A straight hole (its ball line tee -> cup has no corner) and its cup piece. */
function straightHoles(L: StationLayout): {h: SkywaysGolfHole; cup: PropPlacement}[] {
  const G = L.skyways!.addon.golf!;
  return G.holes.filter(h => (h.path?.length ?? 2) === 2).map(h => ({h, cup: L.props.find(p => (p.kind as string) === 'golfCup' && Math.hypot(p.x - h.cup.x, p.z - h.cup.z) < 0.3)!}));
}

/** The tee ball of hole `h` (its own layout pickup, at rest first), struck by the putter toward the cup at launch speed `v`. */
function puttHole(L: StationLayout, h: SkywaysGolfHole, v: number) {
  const w = course(L), lp = L.pickups[h.ball!];
  const ball: Pickup = w.pm.add(w.inv.makeStack(lp.itemId, 1), lp.x, lp.y, lp.z, lp.yaw ?? 0);
  const centre = () => golfBallCentre(ball.obj, new THREE.Vector3());
  // settle: the tee ball stays on its tee (nothing wakes it)
  for (let t = 0; t < 0.5; t += DT) w.ph.update(DT);
  const c0 = centre();
  const dx = h.cup.x - c0.x, dz = h.cup.z - c0.z, d = Math.hypot(dx, dz);
  // the stroke: feet 0.5 m behind the ball on the line, on the storey floor (the turf is 6 cm above it), facing the cup
  const base = L.levels[L.skyways!.addon.level].baseY, feet = {x: c0.x - dx / d * 0.5, y: base, z: c0.z - dz / d * 0.5};
  const strike = strikeGolfBall({
    balls: () => w.pm.list.filter(p => p.stack.itemId === GOLF_BALL_ITEM).map(p => { const q = golfBallCentre(p.obj, new THREE.Vector3()); return {ball: p, x: q.x, y: q.y, z: q.z}; }),
    putt: (p, ux, uz, s) => w.ph.dynamicItems.putt(p, ux, uz, s),
  }, feet, dx, dz, chargeFor(v));
  const track: number[][] = [];
  let t = 0;
  for (; t < 20; t += DT) {
    w.ph.update(DT);
    const q = centre();
    track.push([+t.toFixed(3), +q.x.toFixed(3), +q.y.toFixed(4), +q.z.toFixed(3)]);
    if (t > 0.5 && w.ph.dynamicItems.stats().itemsAwake === 0) break;
  }
  return {w, ball, strike, c0, d, v, end: centre(), t, track, balls: w.pm.list.filter(p => p.stack.itemId === GOLF_BALL_ITEM).length};
}

describe('mini-golf on a real generated course (layout version 7)', () => {
  for (const seed of [5, 12]) it(`seed ${seed}: the tee ball rests on the turf; a putter stroke at the right pace holes it on a straight hole; too soft stops short`, () => {
    const L = gen(seed);
    expect(L.skyways!.addon.id).toBe('mini-golf');
    const holes = straightHoles(L);
    expect(holes.length, `seed ${seed}: a straight hole`).toBeGreaterThan(0);
    const {h, cup} = holes[0];
    expect(cup, `seed ${seed}: the cup piece of hole ${h.n}`).toBeDefined();
    const top = h.cup.y; // the green's top (world y)

    // the pace: arriving at ~0.6 m/s (the roll is v^2 / (2 decel): GOLF_ROLL), from the tee ball's rest centre
    const lp = L.pickups[h.ball!], d0 = Math.hypot(h.cup.x - lp.x, h.cup.z - lp.z);
    const hit = puttHole(L, h, Math.sqrt(0.6 * 0.6 + 2 * GOLF_ROLL.decel * d0));
    expect(hit.strike, 'the stroke met the tee ball').not.toBeNull();
    expect(hit.strike!.speed).toBeCloseTo(hit.v, 3);
    expect(hit.c0.y, 'at rest on its tee: the turf top + r').toBeCloseTo(top + GOLF_BALL_R, 2);
    expect(golfBallInCup(cup, hit.end.x, hit.end.y, hit.end.z), `seed ${seed} hole ${h.n}: in the cup at ${hit.end.toArray().map(n => n.toFixed(3))}`).toBe(true);
    expect(hit.end.y, 'below the turf line (dropped through the gap)').toBeLessThan(top - GOLF_GREEN_H + GOLF_BALL_R + 0.01);
    expect(hit.w.ph.dynamicItems.stats().itemsAwake).toBe(0);
    expect(hit.balls).toBe(1); // the same pickup, nothing spawned
    // it ROLLED there: a continuous track over the turf (no jump bigger than one step at the launch speed)
    for (let i = 1; i < hit.track.length; i++) expect(Math.hypot(hit.track[i][1] - hit.track[i - 1][1], hit.track[i][3] - hit.track[i - 1][3])).toBeLessThan(hit.v * DT * 1.5 + 1e-3);

    // too soft (60 % of the pace that just reaches the cup) stops short, on the turf
    const soft = puttHole(L, h, Math.sqrt(2 * GOLF_ROLL.decel * d0) * 0.6);
    expect(golfBallInCup(cup, soft.end.x, soft.end.y, soft.end.z)).toBe(false);
    expect(soft.end.y, 'stopped short on the turf').toBeCloseTo(top + GOLF_BALL_R, 2);
    expect(Math.hypot(soft.end.x - h.cup.x, soft.end.z - h.cup.z)).toBeGreaterThan(0.2);

    // deterministic
    const again = puttHole(L, h, hit.v);
    expect(again.end.toArray()).toEqual(hit.end.toArray());
    if (process.env.LL_GOLF_REAL_OUT) writeFileSync(`${process.env.LL_GOLF_REAL_OUT}-seed${seed}.json`, JSON.stringify({seed, hole: h.n, design: h.design, distance: hit.d, launch: hit.v, restAt: hit.end.toArray(), seconds: hit.t, cup: h.cup, softRestAt: soft.end.toArray(), track: hit.track.filter((_, i) => i % 6 === 0)}, null, 1));
  }, 300000);
});
