// Task studio-perf-ao-train-continuity-20261110-022206-01 (lead: the journey lanes' shared contract): WHERE the player's train leaves and
// enters a station — the RIDE PORTALS of the parked car's track. Pure and deterministic (no three.js): a function of the finished
// layout and the car's placement, so it is the same for every layout version, an old save's station and a new one. Generation is
// untouched; nothing here mutates the layout.
//
// User: "the train visibly plows through real walls / black walls; the cuts into a fake tunnel and back are obvious."
// Before: the car followed a station tunnel's bends to within 4 m of the mouth and was then cut to the transit tunnel with the station
// still in view; a closed bed end was crossed through its end wall and barricade (only the black plane was hidden), or not at all.
//
// THE RULE NOW. The car always runs STRAIGHT along its own track. Beyond a PORTAL PLANE on that line it is inside the RIDE TUNNEL: one
// standard single-track box (RIDE_BOX), the same box the transit tunnel is (world/trainTransitTunnel.ts), co-axial with the track.
// The station is handed over to the transit (and the transit back to a station) only when the portal plane is RIDE_PORTAL.dark behind
// (ahead of) the whole car: beyond the tunnel murk's sight, so nothing in view changes at either hand-over.
//
// Two kinds of portal, by what the layout has at that bed end:
//  - 'gate'   a CLOSED bed end (no station tunnel continues it): the plane is the bed end face. The end face carries a static
//             headwall with a steel gate in the ride-box opening (instead of the black plane and the barricade); the gate swings open
//             for the car and shuts behind it. Rooms the layout has behind that end face are never drawn into the box (see `box`).
//  - 'breach' a station tunnel continues the end (open mouth, walkable): the car runs along the tunnel's axis-aligned first straight and
//             leaves it through a headwall that stands across the tunnel only while a ride uses it, at the end of that straight
//             (before the first bend / the cap). The walkable tunnel, its bends, its cap and the grid are untouched.
//
// `box` is the world-axis-aligned volume the ride tunnel occupies beyond the plane (tracks run along world X). While a ride uses a
// portal, everything the station draws inside that volume is hidden (world/ridePortalRuntime.ts) and the station's baked light field
// reads zero in it: a tunnel through rock, whatever the layout has there.

import type {StationLayout} from '../gen/stationTypes';
import type {BedEnd, TrackTunnel} from '../gen/trackExt/types';
import {playerTrainPlacement, type TrainPlacement} from '../gen/playerTrain';

/** The ride tunnel's cross-section (m): half width either side of the track centre line, ceiling above the BED (the trench floor). */
export const RIDE_BOX = {
  /** 1.95: the box of a 2.0 m track offset fits inside every bed (4.5 m single, 8 m double: two boxes side by side); car side clearance 0.46. */
  half: 1.95,
  /** Below every bed ceiling (the lowest is 4.95 above its bed); the car's roof is 4.15 above the bed. */
  ceil: 4.8,
} as const;

/** Portal tuning (m). */
export const RIDE_PORTAL = {
  /**
   * The hand-over distance: the portal plane this far behind the car's trailing end (departure) / ahead of its leading end (arrival).
   * In the tunnel murk (FogExp2 0.043) 52 m leaves 0.7 % of a surface's light: the plane's opening is out of sight.
   */
  dark: 52,
  /** How far beyond the plane the station's geometry is cleared out of the box (the car's furthest point + its sight). */
  cut: 132,
  /** Margin (m) of `box` around the ride box (a surface lying exactly on a box face goes too). */
  skin: 0.03,
  /** A breach plane stands this far before the end of the tunnel's first straight, and at least `capClear` before its cap. */
  breachBack: 0.25, capClear: 2.5,
  /** ... and never closer than this to the bed end face (config: a first straight is at least 6 m). */
  breachMin: 1,
} as const;

export type PortalKind = 'gate' | 'breach';

/** A world-axis-aligned box (x0 < x1, y0 < y1, z0 < z1). */
export interface Box3 { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

/** A rectangle in a portal plane (world z / y). */
export interface PlaneRect { z0: number; z1: number; y0: number; y1: number }

export interface RidePortal {
  /** The bed end of the car's trench this portal belongs to. */
  end: BedEnd;
  kind: PortalKind;
  /** World X direction from the station INTO the ride tunnel (+1 for 'x1', -1 for 'x0'). */
  out: 1 | -1;
  /** layout.trenches index. */
  trench: number;
  /** layout.extensions.tunnels id of the station tunnel a 'breach' leaves (-1: a gate). */
  tunnel: number;
  /** World x of the portal plane; `faceX` = the bed end face; `sFace` = |x - faceX| (0 for a gate). */
  x: number;
  faceX: number;
  sFace: number;
  /** The track centre line (world z), the bed (trench floor) and the rail tops (world y). */
  z: number;
  bedY: number;
  railTopY: number;
  /** The cross-section the plane closes: the bed end face (gate) / the station tunnel's section (breach). */
  face: PlaneRect;
  /** The ride-box opening in the plane (the gate's leaves close exactly this). */
  opening: PlaneRect;
  /**
   * Other tracks of the same closed end face: their ride-box openings, closed by a gate that never opens (a consistent end wall).
   * Empty for a breach and on a single-track bed.
   */
  dummies: PlaneRect[];
  /** The volume the ride tunnel occupies beyond the plane, with RIDE_PORTAL.skin (what the station must not draw into). */
  box: Box3;
}

/** The bed end the car's FRONT points at (the departure end) and the one behind it (the arrival end). */
export function rideEnds(p: Pick<TrainPlacement, 'front'>): {front: BedEnd; rear: BedEnd} {
  return p.front > 0 ? {front: 'x1', rear: 'x0'} : {front: 'x0', rear: 'x1'};
}

/** The station tunnel continuing `end` of trench `trench` (null: a closed end). */
export function tunnelOfEnd(layout: StationLayout, trench: number, end: BedEnd): TrackTunnel | null {
  return (layout.extensions?.tunnels ?? []).find(t => t.trench === trench && t.from === end && t.path.length >= 2) ?? null;
}

/** Arc length (m from the bed end face) of a breach plane in station tunnel `tn`. */
export function breachS(tn: Pick<TrackTunnel, 'firstStraight' | 'length' | 'cap'>): number {
  const R = RIDE_PORTAL;
  const capS = Math.min(tn.length, tn.cap?.s ?? tn.length);
  const straight = Number.isFinite(tn.firstStraight) && tn.firstStraight > 0 ? tn.firstStraight : capS;
  return Math.max(R.breachMin, Math.min(straight - R.breachBack, capS - R.capClear));
}

/** The portal of bed end `end` of the car's trench (see the file header). */
export function ridePortal(layout: StationLayout, p: TrainPlacement, end: BedEnd): RidePortal {
  const t = layout.trenches[p.trenchIndex];
  if (!t) throw new Error(`ride portal: no trench ${p.trenchIndex}`);
  const out: 1 | -1 = end === 'x1' ? 1 : -1, faceX = end === 'x1' ? t.x1 : t.x0;
  const tn = tunnelOfEnd(layout, p.trenchIndex, end);
  const sFace = tn ? breachS(tn) : 0;
  const x = faceX + out * sFace;
  const B = RIDE_BOX, k = RIDE_PORTAL.skin;
  const open = (z: number): PlaneRect => ({z0: z - B.half, z1: z + B.half, y0: t.floorY, y1: t.floorY + B.ceil});
  let face: PlaneRect;
  if (tn) {
    // the tunnel's own section at the plane (its first straight runs in line with the bed: centre z = the path's start)
    const zc = tn.path[0].z;
    face = {z0: zc - tn.width / 2, z1: zc + tn.width / 2, y0: tn.floorY, y1: tn.ceilY};
  } else face = {z0: t.z0, z1: t.z1, y0: t.floorY, y1: t.ceil};
  const dummies = tn ? [] : t.tracks.filter((_, i) => i !== p.trackIndex).map(open);
  const xa = x, xb = x + out * RIDE_PORTAL.cut;
  return {
    end, kind: tn ? 'breach' : 'gate', out, trench: p.trenchIndex, tunnel: tn ? tn.id : -1, x, faceX, sFace,
    z: p.z, bedY: t.floorY, railTopY: p.railTopY, face, opening: open(p.z), dummies,
    box: {x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: t.floorY - k, y1: t.floorY + B.ceil + k, z0: p.z - B.half - k, z1: p.z + B.half + k},
  };
}

export interface RidePortals { front: RidePortal; rear: RidePortal }

const cache = new WeakMap<StationLayout, Map<TrainPlacement, RidePortals>>();

/** Both portals of the parked car's track: `front` = the departure end (the cab's), `rear` = the arrival end. Memoized per layout + placement. */
export function ridePortals(layout: StationLayout, p: TrainPlacement): RidePortals {
  let m = cache.get(layout);
  if (!m) cache.set(layout, (m = new Map()));
  let r = m.get(p);
  if (!r) { const e = rideEnds(p); m.set(p, (r = {front: ridePortal(layout, p, e.front), rear: ridePortal(layout, p, e.rear)})); }
  return r;
}

/** `${trench}:${end}` (world/trackExt/view.ts endKey) of a portal's bed end. */
export const portalEndKey = (q: Pick<RidePortal, 'trench' | 'end'>): string => `${q.trench}:${q.end}`;

/**
 * The closed bed ends that carry a ride GATE (a headwall + gate instead of the black end plane and the barricade): the 'gate' portals
 * of the car's track. Empty when the level has no car (`p` null). The world builders skip their plane / barricade for these keys.
 */
export function gatedEnds(layout: StationLayout, p: TrainPlacement | null): Set<string> {
  const out = new Set<string>();
  if (!p) return out;
  const r = ridePortals(layout, p);
  for (const q of [r.front, r.rear]) if (q.kind === 'gate') out.add(portalEndKey(q));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Lane PORTAL: the gate's reveal, the cut and the shell's ring at a breach plane

/**
 * The static gate of a 'gate' portal (world/ridePortalView.ts), m. The headwall's front stands `proud` in front of the bed end face
 * and the shut leaves just behind it: over the end wall's own fittings (the tunnel cables on their brackets and the pipes: up to
 * 0.11 m proud), inside the player's collision radius of that wall (0.3 m; the old barricade stood at 0.12 m), so the camera never
 * reaches them. The portal frame stands INSIDE the opening's edge (`post` / `lintel`: on an 8 m double-track end face the two
 * openings are 0.1 m apart and 0.05 m from the side walls), between the front and the end face: it lines the reveal.
 */
export const RIDE_GATE = {proud: 0.16, post: 0.08, lintel: 0.1} as const;

/** The cut's tolerance (m): a triangle / instance reaching no further than this to the station side of the front plane is beyond it. */
export const RIDE_CUT = {back: 0.01} as const;

/**
 * World x of the plane the station is cut at ("the front"): a breach's portal plane; a gate's headwall front (RIDE_GATE.proud before
 * the end face — the slab between them holds the gate's reveal and the end wall's fittings behind the headwall).
 */
export function portalFront(q: Pick<RidePortal, 'kind' | 'x' | 'out'>): number {
  return q.kind === 'gate' ? q.x - q.out * RIDE_GATE.proud : q.x;
}

/** What the station must not draw while a ride uses a portal: its box, a gate's from the headwall front on. */
export interface PortalCut { box: Box3; front: number; out: 1 | -1 }

export function portalCut(q: Pick<RidePortal, 'kind' | 'x' | 'out' | 'box'>): PortalCut {
  const front = portalFront(q), b = q.box;
  return {box: q.out > 0 ? {...b, x0: Math.min(b.x0, front)} : {...b, x1: Math.max(b.x1, front)}, front, out: q.out};
}

/**
 * THE CUT RULE (world/ridePortalRuntime.ts; one rule for triangles, instances and whole objects, by their world bounds): hidden when
 * the bounds overlap the cut's box AND lie beyond its front plane (to RIDE_CUT.back). Whatever reaches the station side of the front
 * stays drawn whole (nothing on the station side is ever hidden): the bed's floor and rails running up to a gate, a station tunnel's
 * first straight up to a breach (its shell has a ring at the plane: breachStations below).
 */
export function cutHides(c: PortalCut, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  if (!boxOverlaps(c.box, x0, y0, z0, x1, y1, z1)) return false;
  return c.out > 0 ? x0 >= c.front - RIDE_CUT.back : x1 <= c.front + RIDE_CUT.back;
}

/**
 * Arc lengths at which station tunnel `tn`'s shell gets a ring (world/trackExt/shell.ts renderStations): its breach plane when the
 * parked car's track leaves through it — so no shell quad (walls, ceiling, ballast, rails, tray) straddles the plane and the cut is
 * exact there (a straight run is one quad per chunk otherwise). Empty for every other tunnel and on a level without a car.
 */
export function breachStations(layout: StationLayout, tn: Pick<TrackTunnel, 'id' | 'trench'>): number[] {
  const p = playerTrainPlacement(layout);
  if (!p || tn.trench !== p.trenchIndex) return [];
  const r = ridePortals(layout, p);
  for (const q of [r.front, r.rear]) if (q.kind === 'breach' && q.tunnel === tn.id) return [q.sFace];
  return [];
}

/** Car-centre distance (m, along the track from the placement) at which the car's centre is in the portal plane. */
export function planeU(q: Pick<RidePortal, 'x'>, p: Pick<TrainPlacement, 'x'>): number {
  return Math.abs(q.x - p.x);
}

/** Car-centre distance of the hand-over (departure) / the arrival start: the whole car RIDE_PORTAL.dark beyond the plane. */
export function handU(q: Pick<RidePortal, 'x'>, p: Pick<TrainPlacement, 'x' | 'length'>): number {
  return planeU(q, p) + p.length / 2 + RIDE_PORTAL.dark;
}

/** How far on the station side of the plane the culling stand-in stands (m), and its margin inside the opening's edges. */
export const PORTAL_EYE = {back: 0.5, inset: 0.25} as const;

/**
 * The level culler's stand-in for an eye beyond portal `q`'s plane (world/levelCulling.ts LevelCuller.eyeProxy): the point of the
 * portal's opening nearest to the eye, PORTAL_EYE.back on the station side — what the eye can still see of the station it sees
 * through that opening. An eye on the station side of the plane is left alone. Moves `eye` in place; true when it did.
 */
export function portalEye(q: Pick<RidePortal, 'x' | 'out' | 'opening'>, eye: {x: number; y: number; z: number}): boolean {
  if ((eye.x - q.x) * q.out <= 0) return false;
  const o = q.opening, k = PORTAL_EYE.inset;
  eye.x = q.x - q.out * PORTAL_EYE.back;
  eye.y = Math.min(o.y1 - k, Math.max(o.y0 + k, eye.y));
  eye.z = Math.min(o.z1 - k, Math.max(o.z0 + k, eye.z));
  return true;
}

/** Is world point (x, y, z) inside box `b`? */
export function inBox(b: Box3, x: number, y: number, z: number): boolean {
  return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1;
}

/** Does the axis-aligned box [min, max] overlap box `b` (open intervals: touching faces do not count)? */
export function boxOverlaps(b: Box3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  return x1 > b.x0 && x0 < b.x1 && y1 > b.y0 && y0 < b.y1 && z1 > b.z0 && z0 < b.z1;
}
