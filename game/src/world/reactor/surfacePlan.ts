// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): THE RUINED CITY round the surface — a pure, seeded,
// deterministic plan (no three.js). User: "The player will see a city up there, with all the destroyed buildings … (however ofc the
// city is still destroyed)".
//
// The reactor's roof is a concrete yard (the PLAZA: the walkable surface, the aperture and the pit's roof slab, + a kerb). Round it:
//  - STREETS: the ring road's four legs run on outward as streets, and a cross street follows every block (a real street grid, jittered
//    block sizes per side), out to SURFACE_CITY.radius from the aperture;
//  - BLOCKS between the streets, by ring (1 = facing the plaza across the ring road, 2.., outward). Each block is filled ALONG ITS
//    FRONTAGE (the side toward the plaza): a row of buildings picked from the kit registry (surfaceKit.ts) by the ring's role mix —
//    low shop rows / apartment blocks / garages / mid-rises near, high-rises behind (a skyline that climbs away from the yard) —
//    each turned with its front to the street, scaled inside its entry's band to fit, with seeded gaps; a deep block gets a second
//    row facing the next street out. A role that does not fit (or a seeded "collapsed" pick) leaves a COLLAPSED LOT: a rubble field;
//  - STREET CLUTTER on the inner streets: wrecked cars / buses along the lanes (crashed off-axis, some up on the pavement), rubble
//    piles in the gutters and at building feet; a few water tanks on tall steel stands in the inner blocks.
// Guarantees (tests/reactor-surface-city.test.ts): every footprint is outside the plaza (so off the walk area and the aperture) and
// inside its block; no two footprints overlap; everything inside SURFACE_CITY.maxR of the aperture; counts within the registry caps.
//
// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CITY) — user: "It should have more buildings going back
// a little further, as you can easily tell the buildings end". The city now goes on into the rain mist in LAYERS:
//  - the NEAR rows (rings 1-2, as before: shops / apartments / garages / mid-rises facing the yard, high-rises behind);
//  - the OUTER BLOCKS (ring 3+, larger blocks): one to three tall buildings each from the far-skyline entries (surfaceKit.ts
//    `skyline`), turned with the street grid, now and then a block left collapsed;
//  - the OUTSKIRTS BELT beyond the street grid (no streets out there: the carriageways fade out toward `streetsR`): the skyline PEAKS —
//    towers / big ruined blocks round the whole horizon in two staggered rows facing the city, seeded heights, turns and gaps;
//  - the HORIZON CLOSURE: from eye points all along the plaza's edges, every eye-level bearing must end on a building (never the bare
//    ground running out to the sky's horizon behind the last row); the planner finds the bearings that still see through (street
//    vistas, collapsed lots, gaps between peaks) and stands a belt building across each.
// The whole city stays inside a TRIANGLE BUDGET (SURFACE_CITY.tris: every instance's model triangles), the near rows first.
// Reserved footprints (the PLANT's lots round the yard, surfacePlantPlan.ts) are never built on by any pass.

import {mulberry32} from '../../core/rng';
import type {ReactorRect} from '../../gen/reactor/reactorTypes';
import {resolveSurfaceKit, type SurfaceKitEntry, type SurfaceRole} from './surfaceKit';
import type {SurfaceSite} from './surfaceSite';

/** The city's tunables (m). */
export const SURFACE_CITY = {
  /** Kerb round the yard (plaza) beyond the walk area / pit roof; the ring road's width. */
  pad: 2, road: 14,
  /** Block size range (seeded per block along each axis), the cross streets' width, the pavement strip on each street edge. */
  block: [34, 46] as readonly [number, number], street: 12, pavement: 3,
  /** From this ring out the blocks are larger (outerBlock) and hold a few tall buildings each (the far-skyline entries). */
  outerRing: 3, outerBlock: [46, 60] as readonly [number, number],
  /** Blocks whose nearest point lies within `radius` of the aperture are built; every footprint stays within `maxR` (draw distance:
   *  surfaceCity.ts SURFACE_SKY.radius round any plaza eye, inside the outdoor far plane surface.ts SURFACE_RT.far). */
  radius: 172, maxR: 280,
  /** The carriageways / pavements fade out between streetsR - streetFade and streetsR (the outskirts beyond have no streets). */
  streetsR: 212, streetFade: 14,
  /** The city ground disc's radius: beyond every building and the outdoor sky dome round any plaza eye (the ground meets the sky). */
  ground: 345,
  /** Building setback from the block edge / the gap between neighbours (seeded ranges). */
  setback: [0.8, 2.6] as readonly [number, number], gap: [0.6, 3.6] as readonly [number, number],
  /** A second (back) row needs this much block depth left behind the front row. */
  backRow: 13,
  /** The inner blocks' front row (shops, apartments facing the yard) takes at most this depth: the taller back row stands behind it. */
  frontDepth: 24,
  /** Street clutter: cars / buses / rubble piles on the streets of rings <= clutterRing. */
  clutterRing: 2, cars: 14, buses: 3, streetRubble: 12,
  /** Rubble against the plaza parapet: about one heap per this many metres of edge; the parapet's thickness (surfaceCity.ts). */
  edgeRubbleEvery: 10, edgeRubbleReserve: 12, parapetT: 0.32,
  /** Outer blocks: buildings per block (seeded), an empty (collapsed) block's chance, their scale cap (nearer than the belt). */
  outer: {per: [1, 3] as readonly [number, number], collapsed: 0.12, scaleMax: 1.2},
  /** The outskirts belt: two staggered rows (centre radius bands); the skyline peaks (one per sector, at this chance); turned share;
   *  yaw jitter (rad) off facing the city. */
  belt: {rows: [[216, 234], [246, 262]] as readonly (readonly [number, number])[], sectors: 12, peak: 0.85, turned: 0.3, jitter: 0.42,
    /** The vista terminators' / closure buildings' radial depth cap (m): two rows fit between the streets and maxR. */
    depth: 28},
  /** Horizon closure: eye points every `eyeStep` m along the plaza edges (`eyeIn` m inside the deck); bearings seeing through wider
   *  than `minGap` rad get a belt building; every footprint's bearing span counts `margin` rad narrower each side (slack for the eyes
   *  between the samples); at most `fillers` closure buildings. */
  closure: {eyeStep: 5, eyeIn: 0.5, minGap: 0.0015, margin: 0.004, fillers: 60},
  /** Triangle budget (model triangles over every instance): the whole city / the outer blocks' share of it. */
  tris: {total: 1_450_000, outer: 260_000},
} as const;

/** Role mix per ring (the rest of the weight = a collapsed lot). Ring 3+ uses the last row (the back rows of ring-2 blocks). */
const RING_MIX: readonly Partial<Record<SurfaceRole | 'collapsed', number>>[] = [
  {},
  {lowrise: 0.45, midrise: 0.36, tank: 0.06, collapsed: 0.13},
  {midrise: 0.46, highrise: 0.3, lowrise: 0.12, collapsed: 0.12},
  {highrise: 0.56, midrise: 0.34, collapsed: 0.1},
];

export type CityKind = 'building' | 'rubble' | 'vehicle' | 'tank';

/** One placed kit instance. Footprint = an oriented box (centre x / z, half extents along the model's own x / z, yaw). */
export interface CityPlacement {
  entry: string;
  role: SurfaceRole;
  kind: CityKind;
  x: number; z: number; y: number;
  /** three.js rotation.y of the model. */
  yaw: number;
  scale: number;
  hw: number; hd: number; h: number;
  ring: number;
  /** Seeded per-instance tone (0..1): the builder's subtle tint variation. */
  tone: number;
  /** Index into plan.blocks (-1: street clutter / the parapet's rubble / the outskirts belt). */
  block: number;
  /** Rubble heaped against the plaza parapet (inside the yard's kerb, outside every walkable cell). */
  edge?: true;
  /** The outskirts belt beyond the street grid: a vista terminator at the end of a ring-road leg ('vista'), a horizon-closure
   *  building ('closure') or a skyline peak ('peak'). */
  belt?: 'vista' | 'closure' | 'peak';
}

export interface CityBlock { rect: ReactorRect; ring: number; i: number; j: number; collapsed: number }

/**
 * An oriented footprint on the ground (centre x / z, half extents along its own x / z, three.js yaw). Task reactor-surface-redesign-
 * credits-20261103 (primary contract): the PLANT's reserved lots (surfacePlantPlan.ts: the vent towers, the plant structures round the
 * yard) — the city never builds, heaps rubble or parks a wreck on one.
 */
export type CityFootprint = Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>;

export interface SurfaceCityPlan {
  /** Aperture centre (the city's centre) and the yard (plaza) rect. */
  centre: {x: number; z: number};
  plaza: ReactorRect;
  y: number;
  /** Street intervals across x (strips along z) / across z (strips along x), world m. */
  xGaps: readonly (readonly [number, number])[];
  zGaps: readonly (readonly [number, number])[];
  /** The street strips end round the centre at this radius (fading over SURFACE_CITY.streetFade): the outskirts have no streets. */
  streetsR: number;
  blocks: CityBlock[];
  placements: CityPlacement[];
  groundR: number;
  stats: {
    buildings: number; rubble: number; vehicles: number; tanks: number; byEntry: Record<string, number>; collapsedLots: number; maxDist: number;
    /** Model triangles over every instance; the outer blocks' / the belt's building counts (vista terminators, peaks, closure fillers). */
    tris: number; outer: number; vistas: number; peaks: number; fillers: number;
    /** Eye-level bearings still open after the closure (over the closure's own eye samples; 0 = the horizon is closed). */
    open: number;
    /** Why lot picks did not fit (fit: the frontage / depth; block / yard / reach / overlap: the jittered footprint). */
    rejects: Record<string, number>;
  };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const TAU = Math.PI * 2;
/** Angle wrapped into (-pi, pi]. */
const wrapPi = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);

/** The four corners of a placement's footprint (world x / z). */
export function footprintCorners(p: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>): [number, number][] {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  // three.js rotation.y: local (x, z) -> world (x c + z s, -x s + z c)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const lx = a * p.hw, lz = b * p.hd;
    return [p.x + lx * c + lz * s, p.z - lx * s + lz * c] as [number, number];
  });
}

/** Separating-axis test of two footprints (true = they overlap by more than `eps`; a negative eps asks for that much clearance). */
export function footprintsOverlap(a: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>, b: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>, eps = 0.02): boolean {
  // (exact early out: one of a's face normals lies within 45 deg of the centre line, and along it the two footprints' projections
  // sit inside their circumcircles' — far-apart pairs are separated on that axis, the same answer the full test gives)
  if (Math.hypot(a.x - b.x, a.z - b.z) * Math.SQRT1_2 - Math.hypot(a.hw, a.hd) - Math.hypot(b.hw, b.hd) > -eps + 1e-9) return false;
  const ca = footprintCorners(a), cb = footprintCorners(b);
  for (const q of [a, b]) {
    const c = Math.cos(q.yaw), s = Math.sin(q.yaw);
    for (const [ax, az] of [[c, -s], [s, c]]) {
      const pa = ca.map(([x, z]) => x * ax + z * az), pb = cb.map(([x, z]) => x * ax + z * az);
      if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps) return false;
    }
  }
  return true;
}

/** Does a footprint reach into rect `r` (grown by `pad`)? */
export function footprintInRect(p: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>, r: ReactorRect, pad = 0): boolean {
  return footprintsOverlap(p, {x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, yaw: 0, hw: (r.x1 - r.x0) / 2 + pad, hd: (r.z1 - r.z0) / 2 + pad}, 0);
}

/** Every footprint corner inside rect `r`. */
export function footprintInside(p: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>, r: ReactorRect, eps = 1e-6): boolean {
  return footprintCorners(p).every(([x, z]) => x >= r.x0 - eps && x <= r.x1 + eps && z >= r.z0 - eps && z <= r.z1 + eps);
}

/** Distance from (x, z) to a footprint (0 inside it). */
export function footprintDist(p: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>, x: number, z: number): number {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), X = x - p.x, Z = z - p.z;
  // world -> local (the inverse of footprintCorners' rotation)
  const lx = X * c - Z * s, lz = X * s + Z * c;
  return Math.hypot(Math.max(Math.abs(lx) - p.hw, 0), Math.max(Math.abs(lz) - p.hd, 0));
}

/** The bearings [lo, hi] (rad, lo <= hi) a footprint spans seen from (ex, ez) at eye level (null: the eye stands inside it). */
export function bearingSpan(p: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>, ex: number, ez: number): [number, number] | null {
  if (footprintDist(p, ex, ez) <= 1e-6) return null;
  const mid = Math.atan2(p.z - ez, p.x - ex);
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of footprintCorners(p)) {
    const d = wrapPi(Math.atan2(z - ez, x - ex) - mid);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [mid + lo, mid + hi];
}

/**
 * The OPEN bearings from an eye: the [a, b] intervals (rad, 0 <= a < 2 pi, b > a; one may wrap past 2 pi) that no span covers, wider
 * than `minGap`. `spans`: bearing spans (bearingSpan), each counted `margin` narrower on both sides.
 */
export function openBearings(spans: readonly (readonly [number, number])[], margin = 0, minGap = 0): [number, number][] {
  const iv: [number, number][] = [];
  for (const [lo0, hi0] of spans) {
    const w = hi0 - lo0 - 2 * margin;
    if (w <= 0) continue;
    if (w >= TAU) return [];
    const lo = (((lo0 + margin) % TAU) + TAU) % TAU, hi = lo + w;
    if (hi > TAU) iv.push([lo, TAU], [0, hi - TAU]); else iv.push([lo, hi]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cur = 0;
  for (const [a, b] of iv) {
    if (a > cur) gaps.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < TAU) gaps.push([cur, TAU]);
  // the gap through 0 / 2 pi is one gap
  if (gaps.length > 1 && gaps[0][0] === 0 && gaps[gaps.length - 1][1] === TAU) {
    const last = gaps.pop()!, first = gaps.shift()!;
    gaps.push([last[0], TAU + first[1]]);
  }
  return gaps.filter(([a, b]) => b - a > minGap);
}

/** The horizon closure's eye points (x, z): along every plaza edge, `eyeIn` m inside the deck, at most `eyeStep` m apart (ends included). */
export function closureEyes(site: Pick<SurfaceSite, 'edges'>, step: number = SURFACE_CITY.closure.eyeStep, inset: number = SURFACE_CITY.closure.eyeIn): [number, number][] {
  const out: [number, number][] = [];
  for (const e of site.edges) {
    const L = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
    if (L < 1e-3) continue;
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= n; k++) out.push([e.x0 + ((e.x1 - e.x0) * k) / n - e.nx * inset, e.z0 + ((e.z1 - e.z0) * k) / n - e.nz * inset]);
  }
  return out;
}

/** The yard: the walk area, its shelters, the aperture and the pit roof, + the kerb. */
export function surfacePlaza(site: SurfaceSite, pit?: ReactorRect): ReactorRect {
  const rs = [...site.walk, site.bounds, ...site.shelters.map(s => s.rect), {x0: site.hole.x - site.hole.r, z0: site.hole.z - site.hole.r, x1: site.hole.x + site.hole.r, z1: site.hole.z + site.hole.r}, ...(pit ? [pit] : [])];
  const P = SURFACE_CITY.pad;
  return {x0: Math.min(...rs.map(r => r.x0)) - P, z0: Math.min(...rs.map(r => r.z0)) - P, x1: Math.max(...rs.map(r => r.x1)) + P, z1: Math.max(...rs.map(r => r.z1)) + P};
}

/** Distance from (x, z) to rect r (0 inside). */
const rectDist = (r: ReactorRect, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/**
 * Plan the city. `available(key)`: is the model delivered (the lazy library has it / the catalogue lists it). `pit`: the pit's roof
 * rect (kept inside the yard). `reserved`: footprints no pass may build on (the PLANT's lots). Same inputs, same plan.
 */
export function planSurfaceCity(site: SurfaceSite, seed: number, available: (key: string) => boolean, pit?: ReactorRect, reserved: readonly CityFootprint[] = []): SurfaceCityPlan {
  const C = SURFACE_CITY, rnd = mulberry32((seed ^ 0x5c17e5) >>> 0);
  const all = resolveSurfaceKit(available);
  const split = (skyline: boolean) => Object.fromEntries(Object.entries(all).map(([r, l]) => [r, l.filter(e => !!e.skyline === skyline)])) as Record<SurfaceRole, SurfaceKitEntry[]>;
  // the near rows / clutter pick the city entries; the outer blocks and the belt the far-skyline entries
  const kit = split(false), sky = split(true);
  const plaza = surfacePlaza(site, pit), cx = site.hole.x, cz = site.hole.z, y = site.y;
  const between = (a: number, b: number) => a + (b - a) * rnd();
  // --- the street grid: block intervals outward on each side of the yard (the ring road's legs first; larger blocks from outerRing) ---
  const sideIntervals = (lo: number, hi: number, centre: number): {blocks: [number, number][]; gaps: [number, number][]} => {
    const blocks: [number, number][] = [[lo, hi]], gaps: [number, number][] = [];
    for (const dir of [1, -1]) {
      let edge = dir > 0 ? hi : lo;
      gaps.push(dir > 0 ? [edge, edge + C.road] : [edge - C.road, edge]);
      edge += dir * C.road;
      for (let ring = 1; Math.abs(edge - centre) < C.radius; ring++) {
        const bw = ring >= C.outerRing ? C.outerBlock : C.block;
        const w = between(bw[0], bw[1]);
        blocks.push(dir > 0 ? [edge, edge + w] : [edge - w, edge]);
        edge += dir * w;
        gaps.push(dir > 0 ? [edge, edge + C.street] : [edge - C.street, edge]);
        edge += dir * C.street;
      }
    }
    blocks.sort((a, b) => a[0] - b[0]);
    gaps.sort((a, b) => a[0] - b[0]);
    return {blocks, gaps};
  };
  const X = sideIntervals(plaza.x0, plaza.x1, cx), Z = sideIntervals(plaza.z0, plaza.z1, cz);
  const ix0 = X.blocks.findIndex(b => b[0] === plaza.x0), iz0 = Z.blocks.findIndex(b => b[0] === plaza.z0);
  // --- blocks ---
  const blocks: CityBlock[] = [];
  X.blocks.forEach((bx, ii) => Z.blocks.forEach((bz, jj) => {
    const i = ii - ix0, j = jj - iz0;
    if (i === 0 && j === 0) return; // the yard
    const rect = {x0: bx[0], z0: bz[0], x1: bx[1], z1: bz[1]};
    if (rectDist(rect, cx, cz) > C.radius) return;
    blocks.push({rect, ring: Math.max(Math.abs(i), Math.abs(j)), i, j, collapsed: 0});
  }));
  const placements: CityPlacement[] = [];
  const used = new Map<string, number>(), rejects: Record<string, number> = {};
  const reject = (k: string) => { rejects[k] = (rejects[k] ?? 0) + 1; };
  let tris = 0;
  /** Under its cap and inside the triangle budget (`budget`: the pass's own ceiling on the running total). */
  const room = (e: SurfaceKitEntry, budget: number = C.tris.total) => (used.get(e.id) ?? 0) < e.max && tris + e.tris <= Math.min(budget, C.tris.total);
  const inReach = (p: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>) => footprintCorners(p).every(([x, z]) => Math.hypot(x - cx, z - cz) <= C.maxR);
  /** On a reserved (plant) lot? */
  const onReserved = (p: CityFootprint) => reserved.some(r => footprintsOverlap(p, r));
  const pick = (list: readonly SurfaceKitEntry[], ring: number, budget?: number): SurfaceKitEntry | null => {
    const ok = list.filter(e => ring >= e.rings[0] && ring <= e.rings[1] && room(e, budget));
    const tot = ok.reduce((s, e) => s + e.weight, 0);
    let r = rnd() * tot;
    for (const e of ok) if ((r -= e.weight) <= 0) return e;
    return ok[ok.length - 1] ?? null;
  };
  const push = (p: CityPlacement) => {
    placements.push(p);
    used.set(p.entry, (used.get(p.entry) ?? 0) + 1);
    tris += all[p.role].find(e => e.id === p.entry)?.tris ?? 0;
  };
  // (the parapet's rubble keeps a reserve of the rubble cap: the lots and the streets stop short of it)
  const rubbleEntry = (edge = false) => kit.rubble.find(e => (used.get(e.id) ?? 0) < e.max - (edge ? 0 : C.edgeRubbleReserve) && room(e)) ?? null;
  /** A rubble field over a lot (local frame: centre, along / across axes). */
  const collapsedLot = (bi: number, ring: number, ox: number, oz: number, ux: number, uz: number, w: number, d: number) => {
    blocks[bi].collapsed++;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const e = rubbleEntry();
      if (!e) return;
      const s = between(Math.max(e.scale[0], 1.3), e.scale[1]);
      const hw = (e.dims[0] * s) / 2, hd = (e.dims[2] * s) / 2;
      // place inside the lot at any yaw (its footprint's circumradius fits: scale down to the lot)
      const R0 = Math.hypot(hw, hd), fit = Math.min(1, (w / 2) / R0, (d / 2) / R0);
      const ss = s * fit;
      if (ss < e.scale[0]) continue;
      const r = R0 * fit, au = (rnd() - 0.5) * Math.max(0, w - 2 * r), av = (rnd() - 0.5) * Math.max(0, d - 2 * r);
      const p: CityPlacement = {entry: e.id, role: 'rubble', kind: 'rubble', x: r3(ox + ux * au - uz * av), z: r3(oz + uz * au + ux * av), y, yaw: r3(rnd() * Math.PI * 2),
        scale: r3(ss), hw: r3((e.dims[0] * ss) / 2), hd: r3((e.dims[2] * ss) / 2), h: r3(e.dims[1] * ss), ring, tone: r3(rnd()), block: bi};
      if (!footprintInside(p, blocks[bi].rect) || placements.some(q => q.block === bi && footprintsOverlap(p, q)) || !inReach(p) || onReserved(p)) continue;
      push(p);
    }
  };
  /**
   * One ROW along a block side: `ox / oz` = the frontage start corner, (ux, uz) = along the frontage, (nx, nz) = INTO the block (the
   * street-side normal is its opposite), L = frontage length, D = depth budget. Returns the deepest building depth used.
   */
  const row = (bi: number, ring: number, ox: number, oz: number, ux: number, uz: number, nx: number, nz: number, L: number, D: number, tallBias: number): number => {
    const blk = blocks[bi].rect;
    let u = between(0.4, 2.5), deepest = 0;
    const mix = RING_MIX[Math.min(ring, RING_MIX.length - 1)];
    for (let guard = 0; u < L - 6 && guard < 24; guard++) {
      // the role for this lot (the back row leans taller)
      const roles = Object.entries(mix) as [SurfaceRole | 'collapsed', number][];
      const weights = roles.map(([r, w]) => (r === 'highrise' || r === 'midrise' ? w * tallBias : w));
      let rr = rnd() * weights.reduce((s, w) => s + w, 0), role: SurfaceRole | 'collapsed' = 'collapsed';
      for (let k = 0; k < roles.length; k++) if ((rr -= weights[k]) <= 0) { role = roles[k][0]; break; }
      const sb = between(C.setback[0], C.setback[1]);
      /** Place entry `e` at the cursor (scaled inside its band to fit the depth / the frontage left); false = it does not fit. */
      const tryPlace = (e: SurfaceKitEntry | null): boolean => {
        if (!e) return false;
        const isTank = e.role === 'tank', pad = isTank ? 1.5 : 0;
        // front to the street; a high-rise that only fits turned stands with its narrow end on the street (front along it)
        const fit = (turn: boolean) => {
          const fw = (k: number) => e.dims[turn ? 2 : 0] * k + pad, fd = (k: number) => e.dims[turn ? 0 : 2] * k + pad;
          return {fw, fd, kMax: Math.min((D - sb - 0.6) / fd(1), (L - u - 0.3) / fw(1)), turn};
        };
        let f = fit(false);
        if (f.kMax < e.scale[0] && e.role === 'highrise') f = fit(true);
        if (f.kMax < e.scale[0]) { reject('fit:' + e.role); return false; }
        const s = Math.min(between(e.scale[0], e.scale[1]), f.kMax);
        const w = f.fw(s), d = f.fd(s);
        const au = u + w / 2, av = sb + d / 2;
        const x = ox + ux * au + nx * av, z = oz + uz * au + nz * av;
        // front (model +Z * front) toward the street (-n): rotation.y = atan2(dir.x, dir.z); turned: a quarter turn more
        const fx = -nx * e.front, fz = -nz * e.front;
        const yaw = Math.atan2(fx, fz) + (f.turn ? Math.PI / 2 : 0) + (isTank ? rnd() * Math.PI * 2 : (rnd() - 0.5) * 0.04);
        const p: CityPlacement = {entry: e.id, role: e.role, kind: isTank ? 'tank' : 'building', x: r3(x), z: r3(z), y, yaw: r3(yaw), scale: r3(s),
          hw: r3((e.dims[0] * s) / 2), hd: r3((e.dims[2] * s) / 2), h: r3(e.dims[1] * s + (e.stand ?? 0)), ring, tone: r3(rnd()), block: bi};
        // the jittered footprint must stay in its block, off the yard and inside the draw distance
        const why = !footprintInside(p, blk) ? 'block' : footprintInRect(p, plaza, 0.5) ? 'yard' : !inReach(p) ? 'reach' : onReserved(p) ? 'reserved' : placements.some(q => q.block === bi && footprintsOverlap(p, q)) ? 'overlap' : null;
        if (why) { reject(why + ':' + e.role); return false; }
        push(p);
        u += w + between(C.gap[0], C.gap[1]);
        deepest = Math.max(deepest, sb + d);
        return true;
      };
      // the drawn role, else a smaller one that fits what is left (a mid-rise, a shop row), else a collapsed lot
      reject('pick:' + role);
      let placed = role !== 'collapsed' && tryPlace(pick(kit[role as SurfaceRole], ring));
      if (!placed && role !== 'collapsed') for (const alt of ['midrise', 'lowrise'] as SurfaceRole[]) if (!placed && alt !== role) placed = tryPlace(pick(kit[alt], Math.min(ring, 3)));
      if (!placed) {
        // a collapsed lot (seeded pick, or nothing fits here)
        const w = Math.min(L - u, between(9, 17)), d = Math.min(D - 1, between(9, 18));
        if (w < 5 || d < 5) break;
        const au = u + w / 2, av = 0.5 + d / 2;
        collapsedLot(bi, ring, ox + ux * au + nx * av, oz + uz * au + nz * av, ux, uz, w - 1, d - 1);
        u += w + between(C.gap[0], C.gap[1]);
        deepest = Math.max(deepest, d);
      }
    }
    return deepest;
  };
  /** The block's frontage axis: rows run along z (the block lies beside the yard in x) — the axis of the larger ring offset. */
  const frontAlongZ = (b: CityBlock) => Math.abs(b.i) > Math.abs(b.j) || (Math.abs(b.i) === Math.abs(b.j) && rnd() < 0.5);
  blocks.forEach((b, bi) => {
    if (b.ring >= C.outerRing) return; // (the outer pass below)
    const r = b.rect, W = r.x1 - r.x0, H = r.z1 - r.z0;
    // the frontage faces the yard: the axis of the larger ring offset (diagonal blocks: seeded)
    if (frontAlongZ(b)) {
      // the front side is the x edge nearer the centre; rows run along z; n points into the block (away from the yard)
      const s = Math.sign(b.i) || 1, x0 = s > 0 ? r.x0 : r.x1;
      const d1 = row(bi, b.ring, x0, r.z0, 0, 1, s, 0, H, b.ring === 1 ? Math.min(W, C.frontDepth) : W, 1);
      if (W - d1 >= C.backRow) row(bi, b.ring + 1, s > 0 ? r.x1 : r.x0, r.z0, 0, 1, -s, 0, H, W - d1 - 0.8, 1.6);
    } else {
      const s = Math.sign(b.j) || 1, z0 = s > 0 ? r.z0 : r.z1;
      const d1 = row(bi, b.ring, r.x0, z0, 1, 0, 0, s, W, b.ring === 1 ? Math.min(H, C.frontDepth) : H, 1);
      if (H - d1 >= C.backRow) row(bi, b.ring + 1, r.x0, s > 0 ? r.z1 : r.z0, 1, 0, 0, -s, W, H - d1 - 0.8, 1.6);
    }
  });
  // --- street clutter: wrecks along the lanes of the inner streets, rubble in the gutters ---
  const streets: {axis: 'x' | 'z'; a0: number; a1: number}[] = [
    ...X.gaps.filter(g => Math.min(Math.abs(g[0] - cx), Math.abs(g[1] - cx)) < C.road + C.clutterRing * (C.block[1] + C.street)).map(g => ({axis: 'z' as const, a0: g[0], a1: g[1]})),
    ...Z.gaps.filter(g => Math.min(Math.abs(g[0] - cz), Math.abs(g[1] - cz)) < C.road + C.clutterRing * (C.block[1] + C.street)).map(g => ({axis: 'x' as const, a0: g[0], a1: g[1]})),
  ];
  const clutter = (role: 'car' | 'bus' | 'rubble', n: number) => {
    for (let k = 0, tries = 0; k < n && tries < n * 40 && streets.length; tries++) {
      const e = role === 'rubble' ? rubbleEntry() : pick(kit[role], 0);
      if (!e) return;
      const st = streets[Math.floor(rnd() * streets.length)];
      const wdt = st.a1 - st.a0, s = between(e.scale[0], role === 'rubble' ? Math.min(e.scale[1], 1.5) : e.scale[1]);
      const across = st.a0 + (role === 'rubble' ? (rnd() < 0.5 ? between(0.5, 3) : wdt - between(0.5, 3)) : rnd() < 0.15 ? between(0.8, 2.2) : between(C.pavement + 1.2, wdt - C.pavement - 1.2));
      const along = (st.axis === 'z' ? cz : cx) + (rnd() * 2 - 1) * (C.road + C.clutterRing * (C.block[1] + C.street));
      const x = st.axis === 'z' ? across : along, z = st.axis === 'z' ? along : across;
      // vehicles: the body (model X) along the street, crashed off-axis; rubble any way
      const base = st.axis === 'x' ? 0 : Math.PI / 2;
      const yaw = role === 'rubble' ? rnd() * Math.PI * 2 : base + (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * (role === 'car' ? 1.2 : 0.35);
      const p: CityPlacement = {entry: e.id, role, kind: role === 'rubble' ? 'rubble' : 'vehicle', x: r3(x), z: r3(z), y, yaw: r3(yaw), scale: r3(s),
        hw: r3((e.dims[0] * s) / 2), hd: r3((e.dims[2] * s) / 2), h: r3(e.dims[1] * s), ring: 0, tone: r3(rnd()), block: -1};
      if (footprintInRect(p, plaza, 1) || !inReach(p) || onReserved(p) || placements.some(q => footprintsOverlap(p, q, -0.4))) continue;
      push(p);
      k++;
    }
  };
  clutter('bus', C.buses);
  clutter('car', C.cars);
  clutter('rubble', C.streetRubble);
  // --- rubble heaped against the plaza parapet's outer face (beyond the edges: never on a walkable cell, never near the opening) ---
  for (const ed of site.edges) {
    const L = Math.hypot(ed.x1 - ed.x0, ed.z1 - ed.z0);
    if (L < 5) continue;
    for (let m = 0, k = Math.floor(L / C.edgeRubbleEvery + rnd()); m < k; m++) {
      const e = rubbleEntry(true);
      if (!e) break;
      const s = between(0.5, 1.05), hw = (e.dims[0] * s) / 2, hd = (e.dims[2] * s) / 2, rr = Math.hypot(hw, hd);
      // against the parapet's outer face at any yaw: its circumradius past the wall (never back over the edge onto the deck)
      const t = between(0.12, 0.88), off = C.parapetT + Math.hypot(hw, hd) + between(0.06, 0.6);
      const p: CityPlacement = {entry: e.id, role: 'rubble', kind: 'rubble', x: r3(ed.x0 + (ed.x1 - ed.x0) * t + ed.nx * off), z: r3(ed.z0 + (ed.z1 - ed.z0) * t + ed.nz * off), y,
        yaw: r3(rnd() * Math.PI * 2), scale: r3(s), hw: r3(hw), hd: r3(hd), h: r3(e.dims[1] * s), ring: 0, tone: r3(rnd()), block: -1, edge: true};
      if (site.walk.some(w => footprintInRect(p, w, 0.05)) || Math.hypot(p.x - cx, p.z - cz) < site.hole.keepR + rr || onReserved(p) || placements.some(q => footprintsOverlap(p, q, -0.2))) continue;
      push(p);
    }
  }
  // --- THE OUTER BLOCKS (ring >= outerRing): one to three tall far-skyline buildings each, turned with the grid (nearest blocks first) ---
  const pickSky = (roleFirst: SurfaceRole, budget?: number, only: (e: SurfaceKitEntry) => boolean = () => true): SurfaceKitEntry | null =>
    pick(sky[roleFirst].filter(only), 99, budget) ?? pick(sky[roleFirst === 'highrise' ? 'midrise' : 'highrise'].filter(only), 99, budget);
  /** Shallow enough (radial depth at its smallest scale) for the belt's two rows: the vistas / closure stand facing the city. */
  const shallow = (e: SurfaceKitEntry) => e.dims[2] * e.scale[0] <= C.belt.depth;
  /** A scale for a shallow belt building: inside its band, its depth at most belt.depth. */
  const shallowScale = (e: SurfaceKitEntry, lo = 0, hi = 1) => {
    const top = Math.max(e.scale[0], Math.min(e.scale[1], C.belt.depth / e.dims[2]));
    return between(e.scale[0] + (top - e.scale[0]) * lo, e.scale[0] + (top - e.scale[0]) * hi);
  };
  /** Yaw turning model +Z * front toward world direction (dx, dz). */
  const yawToward = (e: SurfaceKitEntry, dx: number, dz: number) => Math.atan2(dx * e.front, dz * e.front);
  const mk = (e: SurfaceKitEntry, x: number, z: number, yaw: number, s: number, ring: number, block: number, belt?: CityPlacement['belt']): CityPlacement => ({
    entry: e.id, role: e.role, kind: 'building', x: r3(x), z: r3(z), y, yaw: r3(yaw), scale: r3(s), hw: r3((e.dims[0] * s) / 2), hd: r3((e.dims[2] * s) / 2),
    h: r3(e.dims[1] * s), ring, tone: r3(rnd()), block, ...(belt ? {belt} : {}),
  });
  const outerBudget = tris + C.tris.outer;
  let outerCount = 0;
  const outer = blocks.map((b, bi) => ({b, bi})).filter(o => o.b.ring >= C.outerRing).sort((u, v) => rectDist(u.b.rect, cx, cz) - rectDist(v.b.rect, cx, cz));
  for (const {b, bi} of outer) {
    const alongZ = frontAlongZ(b);
    if (rnd() < C.outer.collapsed) { b.collapsed++; continue; }
    const r = b.rect, n = C.outer.per[0] + Math.floor(rnd() * (C.outer.per[1] - C.outer.per[0] + 1));
    // toward the yard-side street
    const tx = alongZ ? -(Math.sign(b.i) || 1) : 0, tz = alongZ ? 0 : -(Math.sign(b.j) || 1);
    for (let k = 0, tries = 0; k < n && tries < n * 5; tries++) {
      const e = pickSky(rnd() < 0.62 ? 'highrise' : 'midrise', outerBudget);
      if (!e) break;
      const s = between(e.scale[0], Math.max(e.scale[0], Math.min(e.scale[1], C.outer.scaleMax)));
      const turned = rnd() < 0.3;
      const yaw = yawToward(e, tx, tz) + (turned ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.06;
      const probe = mk(e, 0, 0, yaw, s, b.ring, bi);
      const cs = footprintCorners(probe), ax = Math.max(...cs.map(q => Math.abs(q[0]))), az = Math.max(...cs.map(q => Math.abs(q[1])));
      const sb = between(C.setback[0], C.setback[1]);
      const fx = r.x1 - r.x0 - 2 * (ax + sb), fz = r.z1 - r.z0 - 2 * (az + sb);
      if (fx < 0 || fz < 0) { reject('fit:outer'); continue; }
      const p = mk(e, r.x0 + sb + ax + rnd() * fx, r.z0 + sb + az + rnd() * fz, yaw, s, b.ring, bi);
      const why = !footprintInside(p, r) ? 'block' : !inReach(p) ? 'reach' : onReserved(p) ? 'reserved' : placements.some(q => q.block === bi && footprintsOverlap(p, q, -1.5)) ? 'overlap' : null;
      if (why) { reject(why + ':outer'); continue; }
      push(p);
      outerCount++;
      k++;
    }
  }
  // --- THE OUTSKIRTS BELT (beyond the street grid's carriageways): every footprint off the streets, clear of everything placed ---
  const strips: ReactorRect[] = [
    ...X.gaps.map(([a, b]) => ({x0: a, x1: b, z0: cz - C.streetsR, z1: cz + C.streetsR})),
    ...Z.gaps.map(([a, b]) => ({x0: cx - C.streetsR, x1: cx + C.streetsR, z0: a, z1: b})),
  ];
  /** Why a belt footprint may not stand (cheapest tests first: reach, its bounding box against the yard / the street strips). */
  const beltWhy = (p: CityPlacement): string | null => {
    const cs = footprintCorners(p);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of cs) {
      if (Math.hypot(x - cx, z - cz) > C.maxR) return 'reach';
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const boxHits = (r: ReactorRect, pad: number) => x1 > r.x0 - pad && x0 < r.x1 + pad && z1 > r.z0 - pad && z0 < r.z1 + pad;
    if (boxHits(plaza, 2) && footprintInRect(p, plaza, 2)) return 'yard';
    if (footprintDist(p, cx, cz) < C.streetsR && strips.some(s => boxHits(s, 0.5) && footprintInRect(p, s, 0.5))) return 'street';
    if (onReserved(p)) return 'reserved';
    return placements.some(q => footprintsOverlap(p, q, -1.2)) ? 'overlap' : null;
  };
  /** A belt building at bearing `th` / radius `rad` from the centre, facing the city (yaw jitter `jit`, `turned` a quarter turn). */
  const beltAt = (e: SurfaceKitEntry, s: number, th: number, rad: number, turned: boolean, jit: number, ring: number, kind: NonNullable<CityPlacement['belt']>) =>
    mk(e, cx + Math.cos(th) * rad, cz + Math.sin(th) * rad, yawToward(e, -Math.cos(th), -Math.sin(th)) + (turned ? Math.PI / 2 : 0) + jit, s, ring, -1, kind);
  const B = C.belt, rows = B.rows;
  // --- VISTA TERMINATORS: the ring road's four legs run straight out from the yard — each end gets a tall building across its axis,
  //     just past the street grid's circle (a terminated vista: the eye looking down the street ends on a facade, not the horizon) ---
  let vistas = 0;
  const legs: [number, number, 'x' | 'z'][] = [
    ...X.gaps.filter(gp => gp[0] === plaza.x1 || gp[1] === plaza.x0).map(gp => [gp[0], gp[1], 'x'] as [number, number, 'x']),
    ...Z.gaps.filter(gp => gp[0] === plaza.z1 || gp[1] === plaza.z0).map(gp => [gp[0], gp[1], 'z'] as [number, number, 'z']),
  ];
  for (const [a, b, ax] of legs) for (const dir of [1, -1]) {
    const e = pickSky('highrise', undefined, shallow);
    if (!e) break;
    let s = shallowScale(e);
    // across the street (front facing back down it, toward the yard), centred on its axis (+ a little seeded drift along the frontage)
    const off = (a + b) / 2 - (ax === 'x' ? cx : cz) + (rnd() - 0.5) * 6;
    for (let t = 0; t < 5; t++, s = Math.max(e.scale[0], s * 0.92)) {
      // (its near face just clear of the street grid's circle; further out on a retry)
      const along = C.streetsR + e.dims[2] * s * 0.5 + 1.5 + t * 6;
      const x = ax === 'x' ? cx + off : cx + dir * along, z = ax === 'x' ? cz + dir * along : cz + off;
      const p = mk(e, x, z, yawToward(e, ax === 'x' ? 0 : -dir, ax === 'x' ? -dir : 0) + (rnd() - 0.5) * 0.08, s, C.outerRing + 1, -1, 'vista');
      const why = beltWhy(p);
      if (!why) { push(p); vistas++; break; }
      reject(why + ':vista');
    }
  }
  // --- THE HORIZON CLOSURE: stand a belt building across every eye-level bearing that still sees through the city (first, while
  //     the belt is free: the street vistas get their buildings), then THE SKYLINE PEAKS round it, then the closure once more ---
  const eyes = closureEyes(site);
  const W = C.closure;
  const spansOf = (eye: readonly [number, number]) => placements.filter(p => p.kind === 'building').map(p => bearingSpan(p, eye[0], eye[1])).filter((s): s is [number, number] => !!s);
  const spans = eyes.map(spansOf);
  // each eye's open bearings (recomputed only where a new building crosses one of them)
  const gaps = spans.map(l => openBearings(l, W.margin, W.minGap));
  const crosses = (sp: readonly [number, number], gl: readonly [number, number][]) =>
    gl.some(([a, b]) => [-TAU, 0, TAU].some(o => sp[0] + o < b && sp[1] + o > a));
  // a slot that failed three times (seen from neighbouring eyes it is the same place out on the belt) is not tried again
  const failed = new Map<string, number>(), tried = new Set<string>();
  let fillers = 0;
  /** Every eye's spans / open bearings gain a new building's. */
  const addSpans = (p: CityPlacement) => spans.forEach((l, k) => {
    const sp = bearingSpan(p, eyes[k][0], eyes[k][1]);
    if (!sp) return;
    l.push(sp);
    if (crosses(sp, gaps[k])) gaps[k] = openBearings(l, W.margin, W.minGap);
  });
  const closureOn = sky.highrise.length + sky.midrise.length > 0;
  const close = () => {
    for (let it = 0; closureOn && fillers < W.fillers && it < W.fillers * 3; it++) {
      // the widest open bearing over every eye (skipping tried / failed slots)
      let ei = -1, g: [number, number] = [0, 0], key = '', slot = '';
      for (let k = 0; k < eyes.length; k++) {
        for (const o of gaps[k]) {
          if (ei >= 0 && o[1] - o[0] <= g[1] - g[0]) continue;
          const kk = `${k}:${Math.round(o[0] * 400)}`, m = (o[0] + o[1]) / 2;
          const sl = `${Math.round((eyes[k][0] + Math.cos(m) * 240 - cx) / 12)},${Math.round((eyes[k][1] + Math.sin(m) * 240 - cz) / 12)}`;
          if (tried.has(kk) || (failed.get(sl) ?? 0) >= 3) continue;
          ei = k; g = o; key = kk; slot = sl;
        }
      }
      if (ei < 0) break;
      tried.add(key);
      const [ex, ez] = eyes[ei], ox = ex - cx, oz = ez - cz;
      let done = false;
      for (let t = 0; !done && t < 6; t++) {
        // shallow buildings facing the city (the row behind stays free for the next slot); a turned one only as the last resort
        const turned = t === 5, ent = pickSky(t % 3 === 2 ? 'midrise' : 'highrise', undefined, shallow);
        if (!ent) break;
        const s = t < 2 ? shallowScale(ent) : ent.scale[0], jit = (rnd() - 0.5) * (turned ? 0.06 : 0.2);
        // facing the city: the half-width it shows the eye (the front; turned: the side) and its radial half-depth
        const half = (turned ? ent.dims[2] : ent.dims[0]) * s * 0.5, depth = (turned ? ent.dims[0] : ent.dims[2]) * s * 0.5;
        // radii along the ray: just clear of the street grid's circle first, out to the farthest that keeps its corners inside maxR,
        // then nearer (between the outer blocks, off their streets)
        const rMax = Math.sqrt(Math.max(0, C.maxR * C.maxR - half * half)) - depth - 1.5, r0 = Math.min(rMax, C.streetsR + depth + 1);
        const radii = [0, 1, 0.5, 0.25, 0.75].map(f => r0 + (rMax - r0) * f).concat([r0 - 12, r0 - 24]);
        for (const rad of radii) {
          if (done) break;
          // the bearings it may stand at and still close the gap (its span seen from the eye, a little narrowed); a gap wider than one
          // building closes from its start (the next round takes the rest)
          const reachT = Math.hypot(ox, oz) + rad, al = Math.atan((half - 1.5) / reachT) - 2 * W.margin;
          if (al <= 0) continue;
          const lo = g[1] + W.margin - al, hi = g[0] - W.margin + al;
          const mids = lo <= hi ? [0.5, 0.12, 0.88].map(f => lo + (hi - lo) * f) : [g[0] - W.margin + al];
          for (const mid of mids) {
            const dx = Math.cos(mid), dz = Math.sin(mid), bb = ox * dx + oz * dz, disc = bb * bb - (ox * ox + oz * oz - rad * rad);
            if (disc < 0) continue;
            const dist = -bb + Math.sqrt(disc), px = ex + dx * dist, pz = ez + dz * dist;
            const ring = C.outerRing + 1 + (rad >= rows[rows.length - 1][0] ? rows.length - 1 : 0);
            const p = beltAt(ent, s, Math.atan2(pz - cz, px - cx), rad, turned, jit, ring, 'closure');
            const why = beltWhy(p);
            if (why) { reject(why + ':closure'); continue; }
            push(p);
            fillers++;
            addSpans(p);
            done = true;
            break;
          }
        }
      }
      if (!done) { failed.set(slot, (failed.get(slot) ?? 0) + 1); reject('dead:closure'); }
    }
  };
  close();
  // --- the skyline peaks: one per sector (seeded), the tallest silhouettes ---
  let peaks = 0;
  const a0 = rnd() * TAU;
  for (let k = 0; k < B.sectors; k++) {
    if (rnd() > B.peak) continue;
    // the tallest silhouettes (most high-rises, scaled toward the top of their band); a few bearings / both rows in its sector
    const e = pickSky(rnd() < 0.8 ? 'highrise' : 'midrise');
    if (!e) break;
    const turned = rnd() < B.turned, jit = (rnd() - 0.5) * 2 * B.jitter;
    let s = between((e.scale[0] + e.scale[1]) / 2, e.scale[1]);
    for (let t = 0; t < 6; t++) {
      const th = a0 + ((k + 0.1 + 0.8 * rnd()) * TAU) / B.sectors;
      const ri = (k + t) % rows.length, rad = between(rows[ri][0], rows[ri][1]);
      const p = beltAt(e, s, th, rad, turned, jit, C.outerRing + 1 + ri, 'peak');
      const why = beltWhy(p);
      if (!why) { push(p); addSpans(p); peaks++; break; }
      reject(why + ':peak');
      if (t % 2) s = Math.max(e.scale[0], s * 0.9);
    }
  }
  tried.clear();
  close();
  const open = closureOn ? spans.reduce((s, l) => s + openBearings(l, 0, W.minGap).length, 0) : 0;
  // --- stats ---
  const byEntry: Record<string, number> = {};
  let maxDist = 0;
  for (const p of placements) {
    byEntry[p.entry] = (byEntry[p.entry] ?? 0) + 1;
    for (const [x, z] of footprintCorners(p)) maxDist = Math.max(maxDist, Math.hypot(x - cx, z - cz));
  }
  return {
    centre: {x: cx, z: cz}, plaza, y, xGaps: X.gaps, zGaps: Z.gaps, streetsR: C.streetsR, blocks, placements, groundR: C.ground,
    stats: {
      buildings: placements.filter(p => p.kind === 'building').length, rubble: placements.filter(p => p.kind === 'rubble').length,
      vehicles: placements.filter(p => p.kind === 'vehicle').length, tanks: placements.filter(p => p.kind === 'tank').length,
      byEntry, collapsedLots: blocks.reduce((s, b) => s + b.collapsed, 0), maxDist: r3(maxDist),
      tris, outer: outerCount, vistas, peaks, fillers, open, rejects,
    },
  };
}

/** The street grid's fade toward the outskirts at (x, z): 1 inside streetsR - streetFade, 0 from streetsR out (smoothstep, as the shader). */
export function streetFadeAt(plan: Pick<SurfaceCityPlan, 'centre' | 'streetsR'>, x: number, z: number): number {
  const d = Math.hypot(x - plan.centre.x, z - plan.centre.z), e0 = plan.streetsR - SURFACE_CITY.streetFade;
  const t = Math.min(1, Math.max(0, (d - e0) / (plan.streetsR - e0)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The ground's street mask at (x, z): 1 = carriageway, 0.5 = pavement, 0 = lot / yard (CPU mirror of the builder's 1-D mask rows),
 * faded out toward the outskirts (streetFadeAt). Inside the yard: 0.
 */
export function streetMaskAt(plan: Pick<SurfaceCityPlan, 'xGaps' | 'zGaps' | 'plaza' | 'centre' | 'streetsR'>, x: number, z: number): number {
  const P = plan.plaza;
  if (x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1) return 0;
  const one = (gaps: readonly (readonly [number, number])[], v: number) => {
    for (const [a, b] of gaps) if (v >= a && v <= b) return v - a < SURFACE_CITY.pavement || b - v < SURFACE_CITY.pavement ? 0.5 : 1;
    return 0;
  };
  const m = Math.max(one(plan.xGaps, x), one(plan.zGaps, z));
  return m ? m * streetFadeAt(plan, x, z) : 0;
}
