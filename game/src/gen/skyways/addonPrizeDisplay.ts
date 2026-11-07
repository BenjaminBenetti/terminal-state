// Task studio-skyways-rework-20261107-054512-01 (layout version 3; user: "prize car in public walkway / atrium, not separate room"): the
// PRIZE DISPLAY — the 'prize-car' add-on dressed where gen/skyways/carve.ts carvePrizeDisplay put it: in the host's skyway court, in the
// middle of the public circulation, like a real prize draw (addon.display; addon.hall = the display zone, addon.car = the car's spot):
//  - chrome rope STANCHIONS in a rounded rectangle 1.2 m off the car's body, OPEN where its nose points (the way out toward the nearest
//    bridge landing stays clear: the exit lane, the car's width + 2 x 1.2 m); the runtime (world/skywaysAddonRuntime.ts) hangs the
//    velvet ropes between neighbouring posts and draws the turntable disc under the car;
//  - the GRAND PRIZE DRAW board on its stand behind the car, facing the way the car looks (the existing art: ordinary prize-draw
//    branding, nothing that says the car can be driven);
//  - two planters flanking the board.
// The same pieces as the GAME77 showroom (gen/skyways/addonPrize.ts), without a room: no walls, no doors of its own.

import {CELL} from '../grid';
import type {StationLayout} from '../stationTypes';
import type {Rng} from '../../core/rng';
import {SKYWAYS_CAR} from '../../assets/skywaysCar.generated';
import {SKYWAYS_STANCHION} from './addonKinds';
import {AddonDresser, quarter, r3, yawToward} from './addonFrame';
import {SKYWAYS_PRIZE_LANE_HALF, type PrizeCarResult} from './addonPrize';

/** How far ahead of the car the kept exit lane reaches (m, from its spot). */
export const SKYWAYS_DISPLAY_LANE = 7.5;

/** The dresser of a display: its window / masks over the public court pieces round the display zone (+ 6 m; the zone may span the
 *  court's pieces round a stair well), the car's own piece as its hall (no add-on rooms: `areas` stays empty in the record). */
export function prizeDisplayDresser(layout: StationLayout, rng: Rng): AddonDresser {
  const addon = layout.skyways!.addon, court = layout.areas[addon.car!.area], g = layout.levels[addon.level].grid, h = addon.hall;
  const ids = new Set<number>([court.id]);
  for (let cy = Math.floor((h.z0 - 6) / CELL); cy <= Math.floor((h.z1 + 6) / CELL); cy++) for (let cx = Math.floor((h.x0 - 6) / CELL); cx <= Math.floor((h.x1 + 6) / CELL); cx++) {
    if (!g.inBounds(cx, cy)) continue;
    const a = layout.areas[g.area[g.idx(cx, cy)]];
    if (a && a.publicSpace && (a.level ?? 0) === addon.level && a.kind === 'concourse' && (a.type === 'retail-arcade' || a.type === 'concourse')) ids.add(a.id);
  }
  return new AddonDresser(layout, rng, {...addon, areas: [...ids]}, court);
}

/** The dresser's court piece under (x, z) (else the car's). */
function pieceAt(d: AddonDresser, x: number, z: number) {
  const g = d.layout.levels[d.level].grid, [cx, cy] = g.cellOf(x, z);
  const id = g.inBounds(cx, cy) ? g.area[g.idx(cx, cy)] : -1;
  return d.own.has(id) ? d.layout.areas[id] : d.hall;
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
  // --- the stanchions: a rounded rectangle 1.2 m off the body (a real prize-draw display ropes the car off close; compact enough for a
  // narrow court), posts at most 2.4 m apart in order round the car (the runtime's ropes join neighbours), open across the exit lane
  // (offset: the kept body clearance — 1.2 m + a cell's half diagonal — plus the post's base and a margin)
  const r0 = SKYWAYS_STANCHION.radius, off = reach + r0 + 0.1, A = hl + off, B = hw + off, rc = 0.6;
  const loop: [number, number][] = []; // car frame: (lateral, longitudinal +ahead)
  const edge = (ax: number, az: number, bx: number, bz: number) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2.4)); for (let i = 0; i < n; i++) loop.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]); };
  // corners cut by rc (a rounded look), counter-clockwise from the front-left
  edge(-B + rc, A, -B, A - rc); edge(-B, A - rc, -B, -A + rc); edge(-B, -A + rc, -B + rc, -A); edge(-B + rc, -A, B - rc, -A);
  edge(B - rc, -A, B, -A + rc); edge(B, -A + rc, B, A - rc); edge(B, A - rc, B - rc, A); edge(B - rc, A, -B + rc, A);
  // start just past the lane's right edge so the gap is one contiguous stretch of the order
  const laneW = SKYWAYS_PRIZE_LANE_HALF + r0 + 0.1;
  const k0 = loop.findIndex(([lx, lz]) => lz > 0 && lx > laneW);
  const order = k0 < 0 ? loop : [...loop.slice(k0), ...loop.slice(0, k0)];
  for (const [lx, lz] of order) {
    if (lz > 0 && Math.abs(lx) < laneW) continue; // the exit lane ahead stays open
    const x = car.x + fx * lz - fz * lx, z = car.z + fz * lz + fx * lx;
    const p = d.putRound('skywaysPrizeStanchion', x, z, yawToward(x - car.x, z - car.z), {checkZone: false, area: pieceAt(d, x, z)});
    if (p) res.stanchions.push(p);
  }
  if (res.stanchions.length < 6) d.skipped.push(`prize display: ${res.stanchions.length} stanchions`);
  const R = A; // (the board stands just behind the rectangle's back rope)
  // --- the prize-draw board behind the car, facing the way it looks; planters either side of it --------------------------------
  const back = Math.atan2(-fx, -fz);
  // behind the car first, then round the ring (never into the exit lane ahead of it)
  for (const da of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25, 1.6, -1.6, 1.95, -1.95, 2.3, -2.3]) {
    if (res.board) break;
    for (const r of [R + 1.0, R + 1.4, R + 2.2, R + 3.2, R + 4.4]) {
      const x = car.x + Math.sin(back + da) * r, z = car.z + Math.cos(back + da) * r;
      res.board = d.put('skywaysPrizeBoard', x, z, quarter(yawToward(car.x - x, car.z - z)), {front: 0.8, area: pieceAt(d, x, z)});
      if (res.board) break;
    }
  }
  if (!res.board) d.skipped.push('prize display: no room for the prize board');
  else {
    const b = res.board, sx = Math.cos(b.rot), sz = -Math.sin(b.rot);
    for (const s of [-1, 1]) {
      const p = d.put('planterTree', b.x + sx * s * 1.9, b.z + sz * s * 1.9, b.rot, {front: 0.6, area: pieceAt(d, b.x + sx * s * 1.9, b.z + sz * s * 1.9)});
      if (p) res.planters.push(p);
    }
  }
  return res;
}
