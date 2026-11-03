// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): WHERE the moving train runs in a station (pure, no three.js).
//
// A RidePlan is one bed end of the parked car's track: a polyline RideRoute of the track centre line starting at the placement's car
// centre (u = 0), straight along the bed to the bed end face (u = uMouth), then on along the TrackTunnel that continues that end
// (layout.extensions.tunnels with the placement's trench and `from` = that end: TunnelFrame.point(s, lat) at the track's lateral
// offset, every 0.5 m, through the first straight and the arcs to the cap) — or, where no tunnel continues the end ('bed-end'), straight
// on through the bed's black end plane (world/builder.ts "tunnel mouths fade to black"). The car rides the route with its two bogies
// at u ± bogie (the body is the chord between them: on an arc it cuts the curve like a real car), local +X = sgn · the chord.
//
// Task studio-beta-campaign-polish-20261103-063841-01 (lane TRAIN, item 16): THE CAR ALWAYS RUNS FRONT FIRST. The player's car has
// one cab (local +X) and no turning loop, so a rear-first departure or an arrival from the "wrong" end meant a reversal in the dark
// (stop, dwell, run the other way) or a rear-first arrival. Now:
//  - DEPARTURE runs +u through the FRONT end (sgn = +1): its tunnel when one continues it (hand-over at uDark: the whole car DARK_S past
//    the mouth, never closer than CAP_CLEAR to the cap), else its bed end;
//  - ARRIVAL runs -u from the REAR end (sgn = -1: the car comes out of the end behind the parked car, cab leading) and stops exactly at
//    the placement: that end's tunnel when one continues it (start at uDark), else its bed end.
// The transit never reverses (world/trainRide.ts), so the portal depends only on the destination's placement: every level, seed,
// multi-hop route and dev deep link gets the same, correct one.
// A BED END is crossed one of two ways (world/trainRide.ts picks): where the corridor beyond the end face is clear rock (bedEndClear)
// the transit box continues the bed as a short stub and the car runs through the (hidden) end plane to uDark; where rooms stand
// behind the end face (the Subway / Office front ends: end halls, hatches) the car never passes the plane — it hands over / appears
// at uEdge, its leading / trailing end RIDE_ROUTE.planeClear inside the black end plane.

import type {StationLayout} from '../gen/stationTypes';
import type {BedEnd, TrackTunnel} from '../gen/trackExt/types';
import {CELL, SOLID, type Grid} from '../gen/grid';
import type {TrainPlacement} from '../gen/playerTrain';
import {TunnelFrame} from './trackExt/frame';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';

/** Route tuning (m). */
export const RIDE_ROUTE = {
  /** The whole car this far inside the tunnel = in darkness (hand-over / arrival start). */
  darkS: 4,
  /** The car's leading end never comes closer than this to a tunnel's cap. */
  capClear: 3,
  /** Sample spacing along the tunnel. */
  step: 0.5,
  /** A bed-end route continues this far past the end plane. */
  bedRunOut: 24,
  /** Bed end without a stub: the car's leading (departure) / trailing (arrival) end stays this far inside the black end plane. */
  planeClear: 0.45,
  /**
   * The stub that continues a clear bed end: the transit box's cross-section (half width from the track centre, height above the bed;
   * = trainTransitTunnel.ts TRANSIT.halfWidth / ceil) and the corridor length beyond the end face that must be free of open floor.
   */
  stub: {halfWidth: 2.4, height: 4.8, length: 40},
} as const;

export interface RouteSample { x: number; z: number; tx: number; tz: number }

/** A polyline of the track centre line with arc length (linear extrapolation beyond both ends). */
export class RideRoute {
  readonly pts: {x: number; z: number}[];
  readonly cum: Float64Array;
  readonly length: number;

  constructor(points: readonly {x: number; z: number}[]) {
    const pts: {x: number; z: number}[] = [];
    for (const p of points) { const q = pts[pts.length - 1]; if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 1e-6) pts.push({x: p.x, z: p.z}); }
    if (pts.length < 2) throw new Error('RideRoute: needs two distinct points');
    this.pts = pts;
    this.cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    this.length = this.cum[pts.length - 1];
  }

  /** Point + unit tangent (direction of +u) at arc length u. */
  at(u: number, out: RouteSample = {x: 0, z: 0, tx: 1, tz: 0}): RouteSample {
    const P = this.pts, C = this.cum, n = P.length;
    let i: number;
    if (u <= 0) i = 0;
    else if (u >= this.length) i = n - 2;
    else { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= u) lo = m; else hi = m; } i = lo; }
    const a = P[i], b = P[i + 1], len = C[i + 1] - C[i] || 1e-9;
    const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len, d = u - C[i];
    out.x = a.x + tx * d; out.z = a.z + tz * d; out.tx = tx; out.tz = tz;
    return out;
  }
}

export interface RidePlan {
  end: BedEnd;
  kind: 'tunnel' | 'bed-end';
  /** layout.extensions.tunnels id (-1: bed end). */
  tunnel: number;
  route: RideRoute;
  /** Arc length from the placement's car centre to the bed end face. */
  uMouth: number;
  /** +1: the car's front (local +X) points along +u; -1: against it. */
  sgn: 1 | -1;
  /** Car-centre u of the hand-over (departure) / the arrival start: the whole car in darkness. */
  uDark: number;
  /** Largest car-centre u (the leading end CAP_CLEAR before the cap; a bed-end route: its run-out). */
  uMax: number;
  /** Bed end: the car-centre u with the car's outer end RIDE_ROUTE.planeClear inside the end plane (no-stub hand-over / arrival start). */
  uEdge: number;
  /** The tunnel's track lateral offset (0 on a bed end). */
  lat: number;
}

/** The tunnel continuing `end` of the placement's bed (null: none). */
export function tunnelAt(layout: StationLayout, p: Pick<TrainPlacement, 'trenchIndex'>, end: BedEnd): TrackTunnel | null {
  return (layout.extensions?.tunnels ?? []).find(t => t.trench === p.trenchIndex && t.from === end && t.path.length >= 2) ?? null;
}

/** The route plan of one bed end (see the file header). */
export function ridePlan(layout: StationLayout, p: TrainPlacement, end: BedEnd, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): RidePlan {
  const t = layout.trenches[p.trenchIndex];
  const endX = end === 'x0' ? t.x0 : t.x1, e = end === 'x1' ? 1 : -1;
  const sgn = (e * p.front) as 1 | -1;
  const uMouth = Math.abs(endX - p.x), L2 = spec.length / 2, R = RIDE_ROUTE;
  const tn = tunnelAt(layout, p, end);
  const pts: {x: number; z: number}[] = [{x: p.x, z: p.z}, {x: endX, z: p.z}];
  if (tn) {
    const f = new TunnelFrame(tn);
    const pl = f.project(endX, p.z).lat;
    const lat = tn.rails.length ? tn.rails.reduce((b, r) => (Math.abs(r - pl) < Math.abs(b - pl) ? r : b), tn.rails[0]) : pl;
    const sEnd = Math.min(tn.length, tn.cap?.s ?? tn.length);
    for (let s = R.step; s < sEnd - 1e-6; s += R.step) { const [x, z] = f.point(s, lat); pts.push({x, z}); }
    const [x, z] = f.point(sEnd, lat);
    pts.push({x, z});
    const route = new RideRoute(pts);
    const uMax = Math.max(0, route.length - R.capClear - L2);
    const uDark = Math.max(0, Math.min(uMouth + R.darkS + L2, uMax)); // (a short tunnel: as deep as its cap allows)
    if (uMax > uMouth) return {end, kind: 'tunnel', tunnel: tn.id, route, uMouth, sgn, uDark, uMax, lat, uEdge: uDark};
  }
  pts.length = 1;
  pts.push({x: endX + e * R.bedRunOut, z: p.z});
  const route = new RideRoute(pts);
  // the stub run: the whole car DARK_S past the end face (as in a tunnel); without a stub: the car's outer end just inside the plane
  return {end, kind: 'bed-end', tunnel: -1, route, uMouth, sgn, uDark: uMouth + L2 + R.darkS, uMax: route.length, lat: 0, uEdge: Math.max(0, uMouth - L2 - R.planeClear)};
}

const endOf = (worldSign: number): BedEnd => (worldSign > 0 ? 'x1' : 'x0');

/** The departure plan (item 16): ALWAYS the FRONT end — its tunnel, else its bed end (sgn = +1: the cab leads). */
export function departurePlan(layout: StationLayout, p: TrainPlacement, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): RidePlan {
  return ridePlan(layout, p, endOf(p.front), spec);
}

/**
 * The arrival plan (item 16): ALWAYS the REAR end — the car comes out of the end behind the parked car, cab first (sgn = -1, so
 * arriveDir = +1): its tunnel, else its bed end. No direction argument: the transit always runs front first.
 */
export function arrivalPlan(layout: StationLayout, p: TrainPlacement, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): RidePlan {
  return ridePlan(layout, p, endOf(-p.front), spec);
}

/** Levels-like (gen/levels.ts Levels) or a single Grid. */
export type RideLevels = {count: number; grid(level: number): Grid} | Grid;

/**
 * True when the corridor beyond a bed end is clear (item 16): no level has an open cell (floor below the top, ceiling above the bed)
 * within RIDE_ROUTE.stub.length past the end face across the whole trench end face and the stub box, from the bed up to the higher of
 * the box top and the trench ceiling. Only then may the transit box continue the bed as a stub (the end plane hidden while the car
 * passes): rooms behind an end face (end halls, service hatches) would otherwise cut through the box / the car.
 */
export function bedEndClear(levels: RideLevels, layout: StationLayout, p: TrainPlacement, end: BedEnd): boolean {
  const t = layout.trenches[p.trenchIndex];
  if (!t) return false;
  const S = RIDE_ROUTE.stub, e = end === 'x1' ? 1 : -1, ex = end === 'x1' ? t.x1 : t.x0;
  const z0 = Math.min(t.z0, p.z - S.halfWidth), z1 = Math.max(t.z1, p.z + S.halfWidth);
  const yLo = t.floorY, yHi = Math.max(t.floorY + S.height, t.ceil);
  const grids: Grid[] = 'cells' in levels ? [levels] : Array.from({length: levels.count}, (_, k) => levels.grid(k));
  for (let s = CELL / 2; s <= S.length; s += CELL / 2) {
    const x = ex + e * s, cx = Math.floor(x / CELL);
    for (let z = z0 + 0.05; z <= z1 - 0.05 + 1e-9; z += CELL / 2) {
      const cy = Math.floor(z / CELL);
      for (const g of grids) {
        if (!g.inBounds(cx, cy)) continue;
        const i = g.idx(cx, cy);
        if (g.cells[i] === SOLID) continue;
        if (g.floorAt(x, z) < yHi && g.ceilAt(x, z) > yLo) return false;
      }
    }
  }
  return true;
}

/** Direction of travel of a plan relative to the car: departure (+u) and arrival (-u); +1 = front-first. */
export const departDir = (plan: RidePlan): 1 | -1 => plan.sgn;
export const arriveDir = (plan: RidePlan): 1 | -1 => (-plan.sgn) as 1 | -1;

/** The car pose on a plan's route at car-centre u: the chord between the bogies (centre, local +X axis = sgn · chord). */
export function routePose(plan: RidePlan, u: number, bogie: number, out: {x: number; z: number; ax: number; az: number} = {x: 0, z: 0, ax: 1, az: 0}): {x: number; z: number; ax: number; az: number} {
  const a = plan.route.at(u - bogie, scratchA), b = plan.route.at(u + bogie, scratchB);
  let dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  out.x = (a.x + b.x) / 2; out.z = (a.z + b.z) / 2; out.ax = plan.sgn * dx; out.az = plan.sgn * dz;
  return out;
}
const scratchA: RouteSample = {x: 0, z: 0, tx: 1, tz: 0}, scratchB: RouteSample = {x: 0, z: 0, tx: 1, tz: 0};
