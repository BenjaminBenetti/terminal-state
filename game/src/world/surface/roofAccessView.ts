// Task studio-surface-run-field-followup-20261116-211729-01 (lane INTERIOR): THE REACHABLE ROOF'S LOOK — a version-2 district building
// with `roofAccess` (gen/surface/rooms/deepStores.ts carveRoof): the walkable roof inside the parapet and the stair BULKHEAD on it.
// Who draws what:
//  - the builder (world/builder.ts) draws the roof's floor on the roof level's FLOOR cells (SurfaceArch.floorKey: 'surface-roof', the
//    outdoor flat look), no ceiling over it (SurfaceArch.ceilKey false: open sky), the top landing inside the bulkhead and the roof
//    door's jambs / soffit (a carved doorway of the landing). The roof cells' own wall faces drop (SurfaceArch.remapFaces): against the
//    parapet ring LOOK's parapet inner face stands, against the bulkhead its walls are drawn here;
//  - here (into SurfaceArch's part accumulators: level-0 architecture, so the bulkhead reads from the street like the facade it stands
//    on), in place of the plain roof deck: the rim of roof deck between the parapet's inner face and the walkable cells, the bulkhead's
//    walls (roof sides from the roof surface, the roof door's opening cut out; facade sides above the parapet) and its cap, and the roof
//    door's frame. The leaf is AIR's door runtime (world/surface/airDoors.ts). The level culler shows the street from the roof: the
//    roof's open air is a SKY volume of level 0 (world/levelCulling.ts slabs.sky; world/builder.ts).
// Pure geometry (no materials); v1 districts have no `roofAccess`, so nothing here runs for them.

import type {SurfaceRoofAccess} from '../../gen/surface/surfaceTypes';
import type {Side, StationLayout} from '../../gen/stationTypes';
import type {SkyVolume} from '../levelCulling';
import {SIDE_NORMAL, type BuildingLook} from './archPlan';
import {surfaceArchScale} from './archMaterials';

/** The part sink of SurfaceArch's accumulators (structural: arch.ts Quads / TintView). */
interface Sink {
  quad(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void;
  quadFacing(p: readonly (readonly number[])[], facing: readonly number[], n: readonly number[], uv: readonly (readonly number[])[]): void;
}
type Acc = (key: string, x: number, z: number) => Sink;

/** Roof-door frame sizes (m): the street entrances' (world/surface/arch.ts buildBuilding). */
const FRAME = {jamb: 0.12, depth: 0.08, head: 0.14} as const;
/** The bulkhead cap's thickness over its walls (m). */
const CAP = 0.15;

/** Statistics of the parts drawn (QA / tests). */
export interface RoofAccessParts { rim: number; walls: number; cap: number; frame: number }

/** The world rect's side plane and extent along it. */
function sideOf(r: {x0: number; z0: number; x1: number; z1: number}, side: Side): {alongX: boolean; n: number; plane: number; s0: number; s1: number} {
  const {alongX, n} = SIDE_NORMAL[side];
  const plane = side === 'N' ? r.z0 : side === 'S' ? r.z1 : side === 'W' ? r.x0 : r.x1;
  return {alongX, n, plane, s0: alongX ? r.x0 : r.z0, s1: alongX ? r.x1 : r.z1};
}

/** An axis-aligned box's faces (outward normals, world-metre UVs); `bottom` false: no underside (a cap sitting on walls). */
function capBox(q: Sink, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, bottom = false): void {
  if (x1 - x0 < 1e-5 || y1 - y0 < 1e-5 || z1 - z0 < 1e-5) return;
  if (bottom) q.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  q.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]]);
  q.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  q.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]);
  q.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]);
  q.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
}

/**
 * The roof's parts of building `bl` (its `roofAccess` = ra) into the accumulators `A` (see the module doc). `deck` = the parapet's
 * inner rect at the roof surface (LOOK's deck rect: the footprint inset by the parapet thickness).
 */
export function buildRoofAccess(bl: BuildingLook, ra: SurfaceRoofAccess, deck: {x0: number; z0: number; x1: number; z1: number}, A: Acc): RoofAccessParts {
  const st: RoofAccessParts = {rim: 0, walls: 0, cap: 0, frame: 0};
  const fp = bl.b.footprint, B = ra.bulkhead, Wk = ra.walk, y = ra.y, yc = y + B.h, yTop = bl.top;
  const fac = bl.key, sc = surfaceArchScale(fac) ?? {u: 1, v: 1};
  // the rim of deck round the walkable cells (under the parapet's inner face .. the cells' edge)
  const rim: [number, number, number, number][] = [
    [deck.x0, deck.x1, deck.z0, Wk.z0], [deck.x0, deck.x1, Wk.z1, deck.z1],
    [deck.x0, Wk.x0, Wk.z0, Wk.z1], [Wk.x1, deck.x1, Wk.z0, Wk.z1],
  ];
  for (const [xa, xb, za, zb] of rim) {
    if (xb - xa < 1e-3 || zb - za < 1e-3) continue;
    A('surface-roof', (xa + xb) / 2, (za + zb) / 2).quad([[xa, y, za], [xa, y, zb], [xb, y, zb], [xb, y, za]], [0, 1, 0], [[xa / 2, -za / 2], [xa / 2, -zb / 2], [xb / 2, -zb / 2], [xb / 2, -za / 2]]);
    st.rim++;
  }
  // the cap: a slab on the bulkhead's walls (its top and its edge band; the inside is the top landing's ceiling, the builder's)
  capBox(A('surface-coping', (B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2), B.x0, B.x1, yc, yc + CAP, B.z0, B.z1);
  st.cap++;
  // the walls: per side of the bulkhead — on a facade plane above the parapet it stands on, else from the roof surface (the walkable
  // cells and the rim alike) to the cap, the roof door's opening cut out of its side
  const e = ra.door && ra.door.door !== 'boarded' ? ra.door : null;
  for (const side of ['N', 'S', 'W', 'E'] as const) {
    const s = sideOf(B, side), f = sideOf(fp, side);
    const nrm = s.alongX ? [0, 0, s.n] : [s.n, 0, 0];
    const pt = (a: number, yy: number): number[] => (s.alongX ? [a, yy, s.plane] : [s.plane, yy, a]);
    const u = (a: number) => (s.alongX ? (s.n > 0 ? a : -a) : (s.n > 0 ? -a : a)) / sc.u;
    const wall = (a0: number, a1: number, y0: number, y1: number) => {
      if (a1 - a0 < 1e-3 || y1 - y0 < 1e-3) return;
      A(fac, s.alongX ? (a0 + a1) / 2 : s.plane, s.alongX ? s.plane : (a0 + a1) / 2)
        .quadFacing([pt(a0, y0), pt(a1, y0), pt(a1, y1), pt(a0, y1)], nrm, nrm, [[u(a0), y0 / sc.v], [u(a1), y0 / sc.v], [u(a1), y1 / sc.v], [u(a0), y1 / sc.v]]);
      st.walls++;
    };
    if (Math.abs(s.plane - f.plane) < 1e-3) { wall(s.s0, s.s1, yTop, yc); continue; }
    if (e && e.side === side) {
      const c = s.alongX ? e.x : e.z, d0 = Math.max(s.s0, c - e.width / 2), d1 = Math.min(s.s1, c + e.width / 2), dh = Math.min(yc, y + e.height);
      wall(s.s0, d0, y, yc); wall(d1, s.s1, y, yc); wall(d0, d1, dh, yc);
    } else wall(s.s0, s.s1, y, yc);
  }
  // the roof door's frame (the entrances' trim: two jambs and a head on the bulkhead's outer face)
  if (e) {
    const s = sideOf(B, e.side), c = s.alongX ? e.x : e.z, hw = e.width / 2, top = y + e.height;
    const box = (a0: number, a1: number, y0: number, y1: number) => {
      const d0 = s.plane + s.n * -0.02, d1 = s.plane + s.n * FRAME.depth, lo = Math.min(d0, d1), hi = Math.max(d0, d1);
      const [x0, x1, z0, z1] = s.alongX ? [a0, a1, lo, hi] : [lo, hi, a0, a1];
      capBox(A(bl.trimKey, (x0 + x1) / 2, (z0 + z1) / 2), x0, x1, y0, y1, z0, z1, true);
      st.frame++;
    };
    box(c - hw - FRAME.jamb, c - hw, y, top);
    box(c + hw, c + hw + FRAME.jamb, y, top);
    box(c - hw - FRAME.jamb, c + hw + FRAME.jamb, top, Math.min(top + FRAME.head, yc));
  }
  return st;
}

/** How far under the roof surface (m) a roof's sky volume starts (an eye is ~1.6 m over it; crouched ~1 m). */
const SKY_UNDER = 0.3;

/**
 * The level culler's SKY volumes of a district (world/builder.ts slabs.sky): every reachable roof's walk rect from just under its surface
 * up, on level 0 — from a roof the street and the facades render as from the street. [] without roofs (v1: nothing passed).
 */
export function surfaceSkyVolumes(layout: StationLayout): SkyVolume[] {
  const out: SkyVolume[] = [];
  for (const b of layout.surface?.buildings ?? []) {
    const ra = b.roofAccess;
    if (ra) out.push({x0: ra.walk.x0, z0: ra.walk.z0, x1: ra.walk.x1, z1: ra.walk.z1, y0: ra.y - SKY_UNDER, level: 0});
  }
  return out;
}
