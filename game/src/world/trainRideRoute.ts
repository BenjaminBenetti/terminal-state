// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): WHERE the moving train runs in a station (pure, no three.js).
//
// Task studio-beta-campaign-polish-20261103-063841-01 (lane TRAIN, item 16): THE CAR ALWAYS RUNS FRONT FIRST. The player's car has
// one cab (local +X) and no turning loop, so:
//  - DEPARTURE runs +u through the FRONT end (sgn = +1: the cab leads);
//  - ARRIVAL runs -u from the REAR end (sgn = -1: the car comes out of the end behind the parked car, cab leading) and stops exactly at
//    the placement.
// The transit never reverses (world/trainRide.ts), so the portal depends only on the destination's placement: every level, seed,
// multi-hop route and dev deep link gets the same, correct one.
//
// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane RIDE): THE CAR ALWAYS RUNS STRAIGHT. User: "the train visibly plows
// through real walls / black walls; the cuts into a fake tunnel and back are obvious." Before, a plan followed the station tunnel's
// bends to within 4 m of its mouth (radius 17-30 m: the 16 m body cut the walls), or crossed a closed bed end through its end wall
// ('stub') or stopped at its black plane ('edge'), and the car was cut to the transit with the station still in view.
// Now a RidePlan is one RIDE PORTAL of the parked car's track (world/ridePortal.ts, the lead's contract): the straight line along the
// track from the placement's car centre (u = 0) through the portal's plane (u = uPlane) — a gate in a closed bed end, or a breach at
// the end of a station tunnel's axis-aligned first straight — into the ride tunnel beyond it, to the hand-over (u = uHand: the whole
// car RIDE_PORTAL.dark beyond the plane, out of the tunnel murk's sight) and a little further (uMax). No bends, no cap, no modes.

import type {StationLayout} from '../gen/stationTypes';
import type {BedEnd} from '../gen/trackExt/types';
import type {TrainPlacement} from '../gen/playerTrain';
import {handU, planeU, ridePortals, type RidePortal} from './ridePortal';

/** Route tuning (m). */
export const RIDE_ROUTE = {
  /** The straight line continues this far beyond the hand-over (a late frame never runs off the route's end). */
  runOut: 12,
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
  /** The portal of the parked car's track this plan runs through: the departure's FRONT (the cab's end), the arrival's REAR. */
  which: 'front' | 'rear';
  portal: RidePortal;
  end: BedEnd;
  /** What the layout has at that bed end: a station tunnel continues it (a 'breach' portal) or it is closed (a 'gate'). */
  kind: 'tunnel' | 'bed-end';
  /** layout.extensions.tunnels id of that station tunnel (-1: a closed bed end). */
  tunnel: number;
  /** The straight track centre line from the placement's car centre outward through the plane. */
  route: RideRoute;
  /** Car-centre u at the bed end face. */
  uMouth: number;
  /** Car-centre u with the car's centre in the portal plane (ridePortal.ts planeU). */
  uPlane: number;
  /** Car-centre u of the hand-over (departure) / the arrival start: the whole car RIDE_PORTAL.dark beyond the plane (handU). */
  uHand: number;
  /** Largest car-centre u of the route (uHand + RIDE_ROUTE.runOut). */
  uMax: number;
  /** +1: the car's front (local +X) points along +u; -1: against it. */
  sgn: 1 | -1;
}

/** The straight plan through one portal of the parked car's track (see the file header). */
export function ridePlan(layout: StationLayout, p: TrainPlacement, which: 'front' | 'rear'): RidePlan {
  const portal = ridePortals(layout, p)[which];
  const uPlane = planeU(portal, p), uHand = handU(portal, p), uMax = uHand + RIDE_ROUTE.runOut;
  const route = new RideRoute([{x: p.x, z: p.z}, {x: p.x + portal.out * uMax, z: p.z}]);
  return {
    which, portal, end: portal.end, kind: portal.kind === 'breach' ? 'tunnel' : 'bed-end', tunnel: portal.tunnel, route,
    uMouth: Math.abs(portal.faceX - p.x), uPlane, uHand, uMax, sgn: (portal.out * p.front) as 1 | -1,
  };
}

/** The departure plan (item 16): ALWAYS the FRONT portal (sgn = +1: the cab leads). */
export function departurePlan(layout: StationLayout, p: TrainPlacement): RidePlan {
  return ridePlan(layout, p, 'front');
}

/**
 * The arrival plan (item 16): ALWAYS the REAR portal — the car comes out of the end behind the parked car, cab first (sgn = -1, so
 * arriveDir = +1). No direction argument: the transit always runs front first.
 */
export function arrivalPlan(layout: StationLayout, p: TrainPlacement): RidePlan {
  return ridePlan(layout, p, 'rear');
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
