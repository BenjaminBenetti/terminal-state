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
  /** Blocks whose nearest point lies within `radius` of the aperture are built; every footprint stays within `maxR` (draw distance). */
  radius: 132, maxR: 150,
  /** The city ground disc's radius (beyond every building; inside the Reactor's 230 m far plane from anywhere on the surface). */
  ground: 168,
  /** Building setback from the block edge / the gap between neighbours (seeded ranges). */
  setback: [0.8, 2.6] as readonly [number, number], gap: [0.6, 3.6] as readonly [number, number],
  /** A second (back) row needs this much block depth left behind the front row. */
  backRow: 13,
  /** Street clutter: cars / buses / rubble piles on the streets of rings <= clutterRing. */
  clutterRing: 2, cars: 14, buses: 3, streetRubble: 12,
} as const;

/** Role mix per ring (the rest of the weight = a collapsed lot). Ring 3+ uses the last row. */
const RING_MIX: readonly Partial<Record<SurfaceRole | 'collapsed', number>>[] = [
  {},
  {lowrise: 0.42, midrise: 0.34, tank: 0.05, collapsed: 0.19},
  {midrise: 0.44, highrise: 0.26, lowrise: 0.1, collapsed: 0.2},
  {highrise: 0.52, midrise: 0.34, collapsed: 0.14},
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
  /** Index into plan.blocks (-1: street clutter). */
  block: number;
}

export interface CityBlock { rect: ReactorRect; ring: number; i: number; j: number; collapsed: number }

export interface SurfaceCityPlan {
  /** Aperture centre (the city's centre) and the yard (plaza) rect. */
  centre: {x: number; z: number};
  plaza: ReactorRect;
  y: number;
  /** Street intervals across x (strips along z) / across z (strips along x), world m. */
  xGaps: readonly (readonly [number, number])[];
  zGaps: readonly (readonly [number, number])[];
  blocks: CityBlock[];
  placements: CityPlacement[];
  groundR: number;
  stats: {buildings: number; rubble: number; vehicles: number; tanks: number; byEntry: Record<string, number>; collapsedLots: number; maxDist: number};
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The four corners of a placement's footprint (world x / z). */
export function footprintCorners(p: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>): [number, number][] {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  // three.js rotation.y: local (x, z) -> world (x c + z s, -x s + z c)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const lx = a * p.hw, lz = b * p.hd;
    return [p.x + lx * c + lz * s, p.z - lx * s + lz * c] as [number, number];
  });
}

/** Separating-axis test of two footprints (true = they overlap by more than `eps`). */
export function footprintsOverlap(a: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>, b: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>, eps = 0.02): boolean {
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
 * rect (kept inside the yard). Same inputs, same plan.
 */
export function planSurfaceCity(site: SurfaceSite, seed: number, available: (key: string) => boolean, pit?: ReactorRect): SurfaceCityPlan {
  const C = SURFACE_CITY, rnd = mulberry32((seed ^ 0x5c17e5) >>> 0);
  const kit = resolveSurfaceKit(available);
  const plaza = surfacePlaza(site, pit), cx = site.hole.x, cz = site.hole.z, y = site.y;
  const between = (a: number, b: number) => a + (b - a) * rnd();
  // --- the street grid: block intervals outward on each side of the yard (the ring road's legs first) ---
  const sideIntervals = (lo: number, hi: number, centre: number): {blocks: [number, number][]; gaps: [number, number][]} => {
    const blocks: [number, number][] = [[lo, hi]], gaps: [number, number][] = [];
    for (const dir of [1, -1]) {
      let edge = dir > 0 ? hi : lo;
      gaps.push(dir > 0 ? [edge, edge + C.road] : [edge - C.road, edge]);
      edge += dir * C.road;
      while (Math.abs(edge - centre) < C.radius) {
        const w = between(C.block[0], C.block[1]);
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
  const used = new Map<string, number>();
  const room = (e: SurfaceKitEntry) => (used.get(e.id) ?? 0) < e.max;
  const inReach = (p: Pick<CityPlacement, 'x' | 'z' | 'yaw' | 'hw' | 'hd'>) => footprintCorners(p).every(([x, z]) => Math.hypot(x - cx, z - cz) <= C.maxR);
  const pick = (list: readonly SurfaceKitEntry[], ring: number): SurfaceKitEntry | null => {
    const ok = list.filter(e => ring >= e.rings[0] && ring <= e.rings[1] && room(e));
    const tot = ok.reduce((s, e) => s + e.weight, 0);
    let r = rnd() * tot;
    for (const e of ok) if ((r -= e.weight) <= 0) return e;
    return ok[ok.length - 1] ?? null;
  };
  const push = (p: CityPlacement) => { placements.push(p); used.set(p.entry, (used.get(p.entry) ?? 0) + 1); };
  const rubbleEntry = () => kit.rubble.find(room) ?? null;
  /** A rubble field over a lot (local frame: centre, along / across axes). */
  const collapsedLot = (bi: number, ring: number, ox: number, oz: number, ux: number, uz: number, w: number, d: number) => {
    blocks[bi].collapsed++;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const e = rubbleEntry();
      if (!e) return;
      const s = between(Math.max(e.scale[0], 1.3), e.scale[1]);
      const hw = (e.dims[0] * s) / 2, hd = (e.dims[2] * s) / 2;
      // place inside the lot (its own footprint fits: scale down to the lot)
      const fit = Math.min(1, (w / 2) / Math.max(hw, hd), (d / 2) / Math.max(hw, hd));
      const ss = s * fit;
      if (ss < e.scale[0]) continue;
      const r = Math.max(hw, hd) * fit, au = (rnd() - 0.5) * Math.max(0, w - 2 * r), av = (rnd() - 0.5) * Math.max(0, d - 2 * r);
      const p: CityPlacement = {entry: e.id, role: 'rubble', kind: 'rubble', x: r3(ox + ux * au - uz * av), z: r3(oz + uz * au + ux * av), y, yaw: r3(rnd() * Math.PI * 2),
        scale: r3(ss), hw: r3((e.dims[0] * ss) / 2), hd: r3((e.dims[2] * ss) / 2), h: r3(e.dims[1] * ss), ring, tone: r3(rnd()), block: bi};
      if (placements.some(q => q.block === bi && footprintsOverlap(p, q)) || !inReach(p)) continue;
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
      const e = role === 'collapsed' ? null : pick(kit[role as SurfaceRole], ring);
      let placed = false;
      if (e) {
        let s = between(e.scale[0], e.scale[1]);
        const isTank = e.role === 'tank';
        const fw = (k: number) => e.dims[0] * k + (isTank ? 1.5 : 0), fd = (k: number) => e.dims[2] * k + (isTank ? 1.5 : 0);
        // shrink inside the band to fit the depth / the frontage left
        const kMax = Math.min((D - sb - 0.6) / fd(1), (L - u - 0.3) / fw(1));
        if (kMax >= e.scale[0]) {
          s = Math.min(s, kMax);
          const w = fw(s), d = fd(s);
          const au = u + w / 2, av = sb + d / 2;
          const x = ox + ux * au + nx * av, z = oz + uz * au + nz * av;
          // front (model +Z * front) toward the street (-n): rotation.y = atan2(dir.x, dir.z)
          const fx = -nx * e.front, fz = -nz * e.front;
          const yaw = Math.atan2(fx, fz) + (isTank ? rnd() * Math.PI * 2 : (rnd() - 0.5) * 0.04);
          const p: CityPlacement = {entry: e.id, role: e.role, kind: isTank ? 'tank' : 'building', x: r3(x), z: r3(z), y, yaw: r3(yaw), scale: r3(s),
            hw: r3((e.dims[0] * s) / 2), hd: r3((e.dims[2] * s) / 2), h: r3(e.dims[1] * s + (e.stand ?? 0)), ring, tone: r3(rnd()), block: bi};
          // the jittered footprint must stay in its block, off the yard and inside the draw distance
          if (footprintInside(p, blk) && !footprintInRect(p, plaza, 0.5) && inReach(p) && !placements.some(q => q.block === bi && footprintsOverlap(p, q))) {
            push(p);
            u += w + between(C.gap[0], C.gap[1]);
            deepest = Math.max(deepest, sb + d);
            placed = true;
          }
        }
      }
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
  blocks.forEach((b, bi) => {
    const r = b.rect, W = r.x1 - r.x0, H = r.z1 - r.z0;
    // the frontage faces the yard: the axis of the larger ring offset (diagonal blocks: seeded)
    const alongZ = Math.abs(b.i) > Math.abs(b.j) || (Math.abs(b.i) === Math.abs(b.j) && rnd() < 0.5);
    if (alongZ) {
      // the front side is the x edge nearer the centre; rows run along z; n points into the block (away from the yard)
      const s = Math.sign(b.i) || 1, x0 = s > 0 ? r.x0 : r.x1;
      const d1 = row(bi, b.ring, x0, r.z0, 0, 1, s, 0, H, W, 1);
      if (W - d1 >= C.backRow) row(bi, b.ring + 1, s > 0 ? r.x1 : r.x0, r.z0, 0, 1, -s, 0, H, W - d1 - 0.8, 1.6);
    } else {
      const s = Math.sign(b.j) || 1, z0 = s > 0 ? r.z0 : r.z1;
      const d1 = row(bi, b.ring, r.x0, z0, 1, 0, 0, s, W, H, 1);
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
      const e = pick(kit[role], 0);
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
      if (footprintInRect(p, plaza, 1) || !inReach(p) || placements.some(q => footprintsOverlap(p, q, -0.4))) continue;
      push(p);
      k++;
    }
  };
  clutter('bus', C.buses);
  clutter('car', C.cars);
  clutter('rubble', C.streetRubble);
  // --- stats ---
  const byEntry: Record<string, number> = {};
  let maxDist = 0;
  for (const p of placements) {
    byEntry[p.entry] = (byEntry[p.entry] ?? 0) + 1;
    for (const [x, z] of footprintCorners(p)) maxDist = Math.max(maxDist, Math.hypot(x - cx, z - cz));
  }
  return {
    centre: {x: cx, z: cz}, plaza, y, xGaps: X.gaps, zGaps: Z.gaps, blocks, placements, groundR: C.ground,
    stats: {
      buildings: placements.filter(p => p.kind === 'building').length, rubble: placements.filter(p => p.kind === 'rubble').length,
      vehicles: placements.filter(p => p.kind === 'vehicle').length, tanks: placements.filter(p => p.kind === 'tank').length,
      byEntry, collapsedLots: blocks.reduce((s, b) => s + b.collapsed, 0), maxDist: r3(maxDist),
    },
  };
}

/**
 * The ground's street mask at (x, z): 1 = carriageway, 0.5 = pavement, 0 = lot / yard (CPU mirror of the builder's 1-D mask rows).
 * Inside the yard: 0.
 */
export function streetMaskAt(plan: Pick<SurfaceCityPlan, 'xGaps' | 'zGaps' | 'plaza'>, x: number, z: number): number {
  const P = plan.plaza;
  if (x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1) return 0;
  const one = (gaps: readonly (readonly [number, number])[], v: number) => {
    for (const [a, b] of gaps) if (v >= a && v <= b) return v - a < SURFACE_CITY.pavement || b - v < SURFACE_CITY.pavement ? 0.5 : 1;
    return 0;
  };
  return Math.max(one(plan.xGaps, x), one(plan.zGaps, z));
}
