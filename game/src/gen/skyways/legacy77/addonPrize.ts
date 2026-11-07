// FROZEN GAME77 GENERATOR (task studio-skyways-rework-20261107-054512-01): a verbatim snapshot of gen/skyways/addonPrize.ts at main
// be3173d (GAME77), kept ONLY to regenerate Skyways stations a player entered before the rework (layout versions 1 and 2:
// gen/skyways/layoutVersion.ts) byte-identically, so their saved holders / pickups / kills keep matching. Never edit (except a
// shared runtime bug fix that leaves the layout fingerprints of tests/skyways-dest-layout-version.test.ts unchanged).
// Task studio-skyways-level-20261106-054448 (lane ADDON): the PRIZE-CAR atrium of a Skyways level (addon.id 'prize-car') — dresses the
// carved 'Grand prize atrium' round the car's spot (addon.car: lane CAR renders and spawns the car itself; nothing is ever placed there):
//  - a ring of chrome rope STANCHIONS round the car (radius SKYWAYS_PRIZE_RING from its spot: >= 1.2 m outside its body everywhere),
//    OPEN where the car's way to the entry passes (the exit lane stays clear for driving); world/skywaysAddonRuntime.ts hangs the red
//    velvet ropes between neighbouring posts (and drops them when a post is knocked over) and draws the low dark TURNTABLE disc under
//    the car's spot (render only, no collision: the car drives off it);
//  - the GRAND PRIZE DRAW board (the Codex art: never any text that says the car can be driven / entered / used) on its stand beyond
//    the car, facing the entry;
//  - a couple of planters (existing kind) by the walls.
// Reserved (PlaceCtx.keep): 1.5 m in front of every door and the exit lane (car -> entry, the car's width + 2 x 1.2 m) first; the car
// body + 1.2 m right after the ring (the posts stand outside it by construction). Pure data; the rng is consumed only here.

import {CELL} from '../../grid';
import {PROP_DEFS, type PropPlacement} from '../../props';
import {wallRange, wallSpot} from '../../placeKit';
import type {Side} from '../../stationTypes';
import {SKYWAYS_CAR} from '../../../assets/skywaysCar.generated';
import {SKYWAYS_STANCHION} from '../addonKinds';
import {AddonDresser, doorPoint, quarter, r3, segDist, yawToward} from './addonFrame';

/** Ring radius (m from the car's spot) of the stanchions: the body's half diagonal + 1.2 m + the base + a margin. */
export const SKYWAYS_PRIZE_RING = r3(Math.hypot(SKYWAYS_CAR.length / 2, SKYWAYS_CAR.width / 2) + 1.2 + SKYWAYS_STANCHION.radius + 0.12);
/** Stanchions on the full ring (the exit lane's share is left out). */
export const SKYWAYS_PRIZE_POSTS = 12;
/** Half width of the exit lane (car -> entry): half the car's width + 1.2 m. */
export const SKYWAYS_PRIZE_LANE_HALF = r3(SKYWAYS_CAR.width / 2 + 1.2);
/** Turntable disc radius (render only): the body's half diagonal + a rim. */
export const SKYWAYS_TURNTABLE_R = r3(Math.hypot(SKYWAYS_CAR.length / 2, SKYWAYS_CAR.width / 2) + 0.15);
/** Velvet rope: longest gap a rope spans (posts farther apart get none), its sag at rest (m). */
export const SKYWAYS_ROPE = {maxSpan: 2.9, slack: 1.06} as const;

export interface PrizeCarResult {
  stanchions: PropPlacement[];
  board: PropPlacement | null;
  planters: PropPlacement[];
  /** The exit lane (world segment, half width) kept clear. */
  lane: {ax: number; az: number; bx: number; bz: number; half: number} | null;
}

export function dressPrizeCar(d: AddonDresser): PrizeCarResult {
  const {layout, hall, rng, fr} = d;
  const res: PrizeCarResult = {stanchions: [], board: null, planters: [], lane: null};
  const car = d.addon.car;
  if (!car) { d.skipped.push('prize car: no car spot'); return res; }
  const E = doorPoint(d.entry, hall);
  const ein: [number, number] = [E.x + E.nx * 0.6, E.z + E.nz * 0.6];
  // --- reserved: door strips, the car body + 1.2 m, the exit lane --------------------------------------------------------------
  for (const door of layout.doors) if (door.a === hall.id || door.b === hall.id) d.keepDoor(door, hall, 1.5);
  d.keepSegment(car.x, car.z, ein[0], ein[1], SKYWAYS_PRIZE_LANE_HALF);
  res.lane = {ax: car.x, az: car.z, bx: r3(ein[0]), bz: r3(ein[1]), half: SKYWAYS_PRIZE_LANE_HALF};

  // --- the stanchion ring (consecutive in layout.props, by angle round the spot; the lane's share left open) --------------------
  const R = SKYWAYS_PRIZE_RING, toEntry = Math.atan2(ein[0] - car.x, ein[1] - car.z);
  for (let k = 0; k < SKYWAYS_PRIZE_POSTS; k++) {
    // start just past the lane so the ring's gap is one contiguous arc
    const a = toEntry + Math.PI / SKYWAYS_PRIZE_POSTS + (2 * Math.PI * k) / SKYWAYS_PRIZE_POSTS;
    const x = car.x + Math.sin(a) * R, z = car.z + Math.cos(a) * R;
    if (segDist(x, z, car.x, car.z, ein[0], ein[1]) < SKYWAYS_PRIZE_LANE_HALF + SKYWAYS_STANCHION.radius + 0.1) continue;
    // the eye ring (+Z side) faces out of the ring
    const p = d.putRound('skywaysPrizeStanchion', x, z, yawToward(x - car.x, z - car.z), {checkZone: false});
    if (p) res.stanchions.push(p);
  }
  if (res.stanchions.length < SKYWAYS_PRIZE_POSTS / 2) d.skipped.push(`prize car: ${res.stanchions.length} stanchions`);
  // the car body + 1.2 m: every cell whose centre lies within that clearance + a cell's half diagonal (so no later box reaches it);
  // the posts stand on the ring outside it (their true distance from the body >= 1.2 m by the ring radius)
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), hl = SKYWAYS_CAR.length / 2, hw = SKYWAYS_CAR.width / 2, reach = 1.2 + CELL * Math.SQRT1_2;
  for (let cy = Math.floor((car.z - 5) / CELL); cy <= Math.floor((car.z + 5) / CELL); cy++) for (let cx = Math.floor((car.x - 5) / CELL); cx <= Math.floor((car.x + 5) / CELL); cx++) {
    const dx = (cx + 0.5) * CELL - car.x, dz = (cy + 0.5) * CELL - car.z;
    const lz = dx * fx + dz * fz, lx = dx * -fz + dz * fx;
    if (Math.hypot(Math.max(0, Math.abs(lz) - hl), Math.max(0, Math.abs(lx) - hw)) <= reach) d.keepCell(cx, cy);
  }

  // --- the prize-draw board beyond the car (as seen from the entry), facing the entry -----------------------------------------
  const away = Math.atan2(car.x - ein[0], car.z - ein[1]);
  for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
    if (res.board) break;
    for (const r of [R + 1.6, R + 2.4, R + 3.2]) {
      const x = car.x + Math.sin(away + da) * r, z = car.z + Math.cos(away + da) * r;
      res.board = d.put('skywaysPrizeBoard', x, z, quarter(yawToward(ein[0] - x, ein[1] - z)), {front: 0.8});
      if (res.board) break;
    }
  }
  if (!res.board) {
    // the wall opposite the entry, its back to it
    const [lo, hi] = wallRange(hall, fr.back);
    for (let t = 0; t < 16 && !res.board; t++) {
      const s = wallSpot(hall, fr.back, rng.range(lo + 1.2, hi - 1.2), 'skywaysPrizeBoard');
      res.board = d.put('skywaysPrizeBoard', s.x, s.z, s.rot, {front: 0.8});
    }
  }
  if (!res.board) d.skipped.push('prize car: no room for the prize board');

  // --- planters by the walls (corners first) ---------------------------------------------------------------------------------
  const want = rng.int(2, 4);
  const sides: Side[] = rng.shuffle(['N', 'S', 'E', 'W'] as Side[]);
  for (const side of sides) {
    if (res.planters.length >= want) break;
    const [lo, hi] = wallRange(hall, side);
    const w = PROP_DEFS.planterTree.w;
    for (const t of rng.shuffle([lo + w / 2 + 0.6, hi - w / 2 - 0.6, (lo + hi) / 2 + rng.range(-3, 3)])) {
      if (res.planters.length >= want) break;
      const s = wallSpot(hall, side, Math.round(t * 2) / 2, 'planterTree');
      const p = d.put('planterTree', s.x, s.z, s.rot, {front: 0.6});
      if (p) res.planters.push(p);
    }
  }
  return res;
}
