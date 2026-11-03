// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): WHERE the moving train runs in a station (pure, no three.js).
//
// A RidePlan is one bed end of the parked car's track: a polyline RideRoute of the track centre line starting at the placement's car
// centre (u = 0), straight along the bed to the bed end face (u = uMouth), then on along the TrackTunnel that continues that end
// (layout.extensions.tunnels with the placement's trench and `from` = that end: TunnelFrame.point(s, lat) at the track's lateral
// offset, every 0.5 m, through the first straight and the arcs to the cap) — or, where no tunnel continues the end ('bed-end'), straight
// on through the bed's black end plane (world/builder.ts "tunnel mouths fade to black"). The car rides the route with its two bogies
// at u ± bogie (the body is the chord between them: on an arc it cuts the curve like a real car), local +X = sgn · the chord.
//
// DEPARTURE runs +u from the placement and hands over to the transit loop at uDark (the whole car DARK_S past the tunnel mouth, never
// closer than CAP_CLEAR to the cap); its end: the FRONT end when a tunnel continues it, else the rear end's tunnel (rear-first), else
// the front bed end (the documented fallback: the car runs into the black end plane and hands over before the camera reaches it).
// ARRIVAL runs -u from uDark to 0 and stops exactly at the placement; its end: a tunnel end the car can come out of in the transit's
// direction of travel (front- or rear-first, as it travelled), else any tunnel end (the transit reverses first), else a bed end.

import type {StationLayout} from '../gen/stationTypes';
import type {BedEnd, TrackTunnel} from '../gen/trackExt/types';
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
  /** Bed end: the camera hands over this far before it would reach the black end plane. */
  planeClear: 0.45,
  /** Bed-end arrival: the car starts this far behind the end plane (its leading end). */
  planeStart: 0.5,
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
    if (uMax > uMouth) return {end, kind: 'tunnel', tunnel: tn.id, route, uMouth, sgn, uDark, uMax, lat};
  }
  pts.length = 1;
  pts.push({x: endX + e * R.bedRunOut, z: p.z});
  const route = new RideRoute(pts);
  return {end, kind: 'bed-end', tunnel: -1, route, uMouth, sgn, uDark: uMouth + L2 + R.planeStart, uMax: route.length, lat: 0};
}

const endOf = (worldSign: number): BedEnd => (worldSign > 0 ? 'x1' : 'x0');

/** The departure plan: the front end's tunnel, else the rear end's tunnel (rear-first), else the front bed end. */
export function departurePlan(layout: StationLayout, p: TrainPlacement, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): RidePlan {
  const front = ridePlan(layout, p, endOf(p.front), spec);
  if (front.kind === 'tunnel') return front;
  const rear = ridePlan(layout, p, endOf(-p.front), spec);
  return rear.kind === 'tunnel' ? rear : front;
}

/**
 * The arrival plan for a car travelling `dir` (+1 front-first, -1 rear-first): the tunnel end it comes out of in that direction, else
 * the other tunnel end (the transit reverses first), else the bed end in that direction.
 */
export function arrivalPlan(layout: StationLayout, p: TrainPlacement, dir: 1 | -1, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): RidePlan {
  // arriving runs -u: front-first iff sgn = -1, i.e. the end at world sign -dir * front
  const want = ridePlan(layout, p, endOf(-dir * p.front), spec);
  if (want.kind === 'tunnel') return want;
  const other = ridePlan(layout, p, endOf(dir * p.front), spec);
  return other.kind === 'tunnel' ? other : want;
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
