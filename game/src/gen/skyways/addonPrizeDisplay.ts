// Task studio-skyways-rework-20261107-054512-01 (layout version 3; user: "prize car in public walkway / atrium, not separate room"): the
// PRIZE DISPLAY — the 'prize-car' add-on dressed where gen/skyways/carve.ts carvePrizeDisplay put it: in the host's skyway court, in the
// middle of the public circulation, like a real prize draw (addon.display; addon.hall = the display zone, addon.car = the car's spot):
//  - a ring of chrome rope STANCHIONS round the car (SKYWAYS_PRIZE_RING: >= 1.2 m outside its body everywhere), OPEN where the car's
//    nose points (its way out toward the nearest bridge landing stays clear: the exit lane, the car's width + 2 x 1.2 m); the runtime
//    (world/skywaysAddonRuntime.ts) hangs the velvet ropes between neighbouring posts and draws the turntable disc under the car;
//  - the GRAND PRIZE DRAW board on its stand behind the car, facing the way the car looks (the existing art: ordinary prize-draw
//    branding, nothing that says the car can be driven);
//  - two planters flanking the board.
// The same pieces as the GAME77 showroom (gen/skyways/addonPrize.ts), without a room: no walls, no doors of its own.

import {CELL} from '../grid';
import type {StationLayout} from '../stationTypes';
import type {Rng} from '../../core/rng';
import {SKYWAYS_CAR} from '../../assets/skywaysCar.generated';
import {SKYWAYS_STANCHION} from './addonKinds';
import {AddonDresser, quarter, r3, segDist, yawToward} from './addonFrame';
import {SKYWAYS_PRIZE_LANE_HALF, SKYWAYS_PRIZE_POSTS, SKYWAYS_PRIZE_RING, type PrizeCarResult} from './addonPrize';

/** How far ahead of the car the kept exit lane reaches (m, from its spot). */
export const SKYWAYS_DISPLAY_LANE = 7.5;

/** The dresser of a display: its window / masks over the court piece the car stands in (no add-on rooms: `areas` stays empty). */
export function prizeDisplayDresser(layout: StationLayout, rng: Rng): AddonDresser {
  const addon = layout.skyways!.addon, court = layout.areas[addon.car!.area];
  return new AddonDresser(layout, rng, {...addon, areas: [court.id]}, court);
}

export function dressPrizeDisplay(d: AddonDresser): PrizeCarResult {
  const car = d.addon.car!;
  const res: PrizeCarResult = {stanchions: [], board: null, planters: [], lane: null};
  // --- reserved: the exit lane (nose -> the way out), the car body + 1.2 m ---------------------------------------------------------
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
  const out: [number, number] = [car.x + fx * SKYWAYS_DISPLAY_LANE, car.z + fz * SKYWAYS_DISPLAY_LANE];
  d.keepSegment(car.x, car.z, out[0], out[1], SKYWAYS_PRIZE_LANE_HALF);
  res.lane = {ax: car.x, az: car.z, bx: r3(out[0]), bz: r3(out[1]), half: SKYWAYS_PRIZE_LANE_HALF};
  const hl = SKYWAYS_CAR.length / 2, hw = SKYWAYS_CAR.width / 2, reach = 1.2 + CELL * Math.SQRT1_2;
  for (let cy = Math.floor((car.z - 5) / CELL); cy <= Math.floor((car.z + 5) / CELL); cy++) for (let cx = Math.floor((car.x - 5) / CELL); cx <= Math.floor((car.x + 5) / CELL); cx++) {
    const dx = (cx + 0.5) * CELL - car.x, dz = (cy + 0.5) * CELL - car.z;
    const lz = dx * fx + dz * fz, lx = dx * -fz + dz * fx;
    if (Math.hypot(Math.max(0, Math.abs(lz) - hl), Math.max(0, Math.abs(lx) - hw)) <= reach) d.keepCell(cx, cy);
  }
  // --- the stanchion ring (consecutive in layout.props, by angle round the spot; the exit lane's share left open) ----------------
  const R = SKYWAYS_PRIZE_RING, toOut = Math.atan2(out[0] - car.x, out[1] - car.z);
  for (let k = 0; k < SKYWAYS_PRIZE_POSTS; k++) {
    const a = toOut + Math.PI / SKYWAYS_PRIZE_POSTS + (2 * Math.PI * k) / SKYWAYS_PRIZE_POSTS;
    const x = car.x + Math.sin(a) * R, z = car.z + Math.cos(a) * R;
    if (segDist(x, z, car.x, car.z, out[0], out[1]) < SKYWAYS_PRIZE_LANE_HALF + SKYWAYS_STANCHION.radius + 0.1) continue;
    const p = d.putRound('skywaysPrizeStanchion', x, z, yawToward(x - car.x, z - car.z), {checkZone: false});
    if (p) res.stanchions.push(p);
  }
  if (res.stanchions.length < SKYWAYS_PRIZE_POSTS / 2) d.skipped.push(`prize display: ${res.stanchions.length} stanchions`);
  // --- the prize-draw board behind the car, facing the way it looks; planters either side of it --------------------------------
  const back = Math.atan2(-fx, -fz);
  for (const da of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25]) {
    if (res.board) break;
    for (const r of [R + 1.0, R + 1.4, R + 2.2]) {
      const x = car.x + Math.sin(back + da) * r, z = car.z + Math.cos(back + da) * r;
      res.board = d.put('skywaysPrizeBoard', x, z, quarter(yawToward(car.x - x, car.z - z)), {front: 0.8});
      if (res.board) break;
    }
  }
  if (!res.board) d.skipped.push('prize display: no room for the prize board');
  else {
    const b = res.board, sx = Math.cos(b.rot), sz = -Math.sin(b.rot);
    for (const s of [-1, 1]) {
      const p = d.put('planterTree', b.x + sx * s * 1.9, b.z + sz * s * 1.9, b.rot, {front: 0.6});
      if (p) res.planters.push(p);
    }
  }
  return res;
}
