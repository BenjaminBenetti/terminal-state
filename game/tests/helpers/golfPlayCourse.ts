// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): a synthetic mini-golf lane for the ball / putter tests —
// a walled room (floor y = 0), a straight lane of 0.5 m turf pieces (golfGreen; golfCup at `cupX`) between 8 cm bumper rails 11 cm tall
// standing on the turf, closed at the far end, simulated by the REAL PhysicsSystem (its static chunks build the golf colliders from
// gen/skyways/events/golfContract.ts golfColliderBoxes) with REAL golf-ball pickups (world/pickups.ts PickupManager: the code-built ball).
import * as THREE from 'three';
import {expect} from 'vitest';
import {installCanvasShim, ShimContext} from './canvas2d';
import {FLOOR, Grid, SOLID} from '../../src/gen/grid';
import type {PropKind, PropPlacement} from '../../src/gen/props';
import {PhysicsSystem} from '../../src/physics/world';
import {PickupManager, type Pickup} from '../../src/world/pickups';
import {Inventory} from '../../src/items/inventory';
import {GOLF_BALL_ITEM, GOLF_BALL_R, GOLF_GREEN_H, golfBallInCup} from '../../src/gen/skyways/events/golfContract';
import {golfBallCentre} from '../../src/physics/golfBall';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {}; // (item stand-in label atlases clip their cells)

export const DT = 1 / 60;
/** The lane: along +x from X0, centred on z = LANE_Z, 0.5 m wide inside its rails. */
export const LANE_Z = 8, X0 = 4, HALF = 0.25, RAIL_T = 0.08, RAIL_H = 0.11;
/** The ball centre's limit inside the rails (touching a rail face). */
export const INNER = HALF - GOLF_BALL_R;
/** The turf top and a ball resting on it (centre height). */
export const TURF = GOLF_GREEN_H, ON_TURF = GOLF_GREEN_H + GOLF_BALL_R;

const piece = (kind: string, x: number, z: number, hx: number, hz: number, y: number, h: number): PropPlacement =>
  ({kind: kind as PropKind, x, z, y, rot: 0, area: 0, hx, hz, h, blocksSight: false, variant: 0});

/** The lane's layout: `len` m of turf (0.5 m pieces; the cup piece centred at cupX), rails both sides, both ends closed; optional walls (cells). */
export function golfLane(o: {cupX?: number | null; len?: number; solid?: [number, number][]} = {}) {
  const len = o.len ?? 10, cupX = o.cupX ?? null;
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 30 ? SOLID : FLOOR);
  for (const [x, y] of o.solid ?? []) g.set(x, y, SOLID);
  const props: PropPlacement[] = [];
  for (let k = 0; k < len * 2; k++) {
    const x = X0 + 0.25 + k * 0.5;
    props.push(piece(cupX !== null && Math.abs(x - cupX) < 1e-6 ? 'golfCup' : 'golfGreen', x, LANE_Z, 0.25, 0.25, 0, GOLF_GREEN_H));
  }
  for (let k = 0; k < len; k++) for (const s of [-1, 1]) props.push(piece('golfRail', X0 + 0.5 + k, LANE_Z + s * (HALF + RAIL_T / 2), 0.5, RAIL_T / 2, GOLF_GREEN_H, RAIL_H));
  // the end rails: across the far end and (just off the first turf piece) across the tee end
  for (const x of [X0 + len + RAIL_T / 2, X0 - RAIL_T / 2]) props.push(piece('golfRail', x, LANE_Z, RAIL_T / 2, HALF + RAIL_T, GOLF_GREEN_H, RAIL_H));
  return {grid: g, props, trench: {floorY: -1.15}};
}
export type GolfLane = ReturnType<typeof golfLane>;

/** The real physics + pickups over a lane. */
export function golfWorld(layout: GolfLane = golfLane()) {
  const ph = new PhysicsSystem(null);
  ph.build(layout);
  const pm = new PickupManager({});
  const inv = new Inventory();
  ph.dynamicItems.pickups = () => pm.list;
  const centre = (p: Pickup, out = new THREE.Vector3()) => golfBallCentre(p.obj, out);
  const cup = layout.props.find(p => p.kind === ('golfCup' as PropKind)) ?? null;
  return {
    layout, ph, pm, inv, cup, centre,
    /** A golf-ball pickup resting on the turf at (x, z) (y: its bottom; the turf top by default). */
    ball: (x: number, z: number, y = TURF): Pickup => pm.add(inv.makeStack(GOLF_BALL_ITEM, 1), x, y, z, 0),
    step: (seconds: number, each?: (t: number) => void) => { for (let t = 0; t < seconds - 1e-9; t += DT) { ph.update(DT); each?.(t); } },
    inCup: (p: Pickup) => { const c = golfBallCentre(p.obj, new THREE.Vector3()); return !!cup && golfBallInCup(cup, c.x, c.y, c.z); },
    awake: () => ph.dynamicItems.stats().itemsAwake,
  };
}
export type GolfWorld = ReturnType<typeof golfWorld>;

/** Putt `p` along (dx, dz) at `speed` and run until every ball rests (or `T` s); the centre track every step. */
export function puttAndRun(w: GolfWorld, p: Pickup, dx: number, dz: number, speed: number, T = 15) {
  const start = w.centre(p).clone();
  expect(w.ph.dynamicItems.putt(p, dx, dz, speed)).toBe(true);
  const track: THREE.Vector3[] = [];
  let t = 0;
  for (; t < T; t += DT) {
    w.ph.update(DT);
    track.push(w.centre(p).clone());
    if (w.awake() === 0) break;
  }
  const end = w.centre(p).clone();
  return {start, end, track, t, dist: Math.hypot(end.x - start.x, end.z - start.z)};
}
