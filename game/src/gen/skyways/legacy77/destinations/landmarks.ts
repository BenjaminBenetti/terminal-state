// FROZEN GAME77 GENERATOR (task studio-skyways-rework-20261107-054512-01): a verbatim snapshot of gen/skyways/destinations/landmarks.ts at main
// be3173d (GAME77), kept ONLY to regenerate Skyways stations a player entered before the rework (layout versions 1 and 2:
// gen/skyways/layoutVersion.ts) byte-identically, so their saved holders / pickups / kills keep matching. Never edit (except a
// shared runtime bug fix that leaves the layout fingerprints of tests/skyways-dest-layout-version.test.ts unchanged).
// Task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS (A)): the LANDMARK courts' centrepieces (layout.skyways.landmarks:
// the hero kit piece at the court's spot, its plaque, the court's seating / planters / accent light). Called by destinations/index.ts.
//
// Per court (its own rng fork; the station placement kit gen/placeKit.ts on the court's storey, every prop lifted onto the court floor
// right after it is placed — absolute heights, like the ramen / atrium dressers):
//  1. the CENTREPIECE (kindsLandmarks.ts LANDMARK_KIND) at the court's spot: the dinosaur along the court's longer axis (head either
//     way), the clock tower's main dial / the orrery's front toward the court's main approach; a round collider for the fig tree /
//     fountain / orrery (+ the tree's trunk / the fountain's column as a collision-only upper part). It must stand under the ceiling
//     over its whole drawn footprint (+ headroom): in an atrium court that is the glass roof inside the skyway slab's opening; a hero
//     too tall for a low court (the fountain on a 3.9 m skyway-level court) is shrunk uniformly (never below LANDMARK_DRESS.minScale;
//     the placement's h carries the scale: world/skywaysDestinations.ts). A walking ring (1.2 m, else 0.8 / 0.6 m where the court's
//     walls allow no more) stays open round it. The GEESE hang high in the atrium instead (no floor footprint): inside the opening's
//     column so the flock flies at the galleries' eye level (its top at the court's clear height, LANDMARK_FAMILIES.geese, under the
//     roof with >= 1 m of cable), never lower than 2.3 m clear, its cables drawn up to the roof;
//  2. WALKING LANES (1.2 m) from every opening of the court (doorways / open sides) to the centrepiece's ring are reserved before
//     anything else is placed;
//  3. the court's PLAQUE (skyDPlaque, variant art.ts DEST_PLAQUE_OF) beside the main approach (the opening with the widest span),
//     just off its lane, facing the visitor;
//  4. SEATING: existing station benches round the centrepiece facing it (along a long hero's sides; the fig tree has its own ring
//     bench, so its benches stand further out), more in a big court, never on the reserved lanes / ring; PLANTERS (the existing
//     planter tree) on the diagonals (not in the fig tree's court);
//  5. a warm ACCENT light or two: warm ceiling fixtures near the centrepiece where a ceiling is within reach (an atrium court: under
//     the skyway slab at the opening's edge), never over the hero (lit / broken / flickering: the lighting pass rolls them like every
//     fixture of the court).
// Existing approved kinds only besides the destination kinds; deterministic from the rng it is given.
// keepLandmarkClear: the atrium greenery / food-court seating (gen/skyways/greenery.ts, which runs first) keep the courts' clear discs.

import type {Rng} from '../../../../core/rng';
import {SKYWAYS_DEST_PROPS} from '../../../../assets/skywaysDestProps.generated';
import {CELL, FLOOR, type Grid} from '../../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../../props';
import {levelGrid, makePlaceCtx, markCell, tryPlaceProp, type PlaceCtx, type PlaceOpts} from '../../../placeKit';
import type {Area, LightPlacement, Side, StationLayout} from '../../../stationTypes';
import {normYaw, quarter, segDist, yawToward} from '../addonFrame';
import type {SkywaysLandmark, SkywaysLandmarkFamily} from '../../skywaysTypes';
import {DEST_PLAQUE_OF} from './art';
import {LANDMARK_KIND, LANDMARK_ROUND, landmarkUppers, type LandmarksKind} from '../../destinations/kindsLandmarks';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The court dressing's distances / counts (m unless noted). */
export const LANDMARK_DRESS = {
  /** Walking ring kept round the centrepiece: tried in turn (a court's own walls / fixtures may leave only a narrower one). */
  rings: [1.2, 0.8, 0.6] as const,
  /** Headroom kept between a hero's top and the ceiling over it; the smallest uniform scale a hero may be shrunk to fit a low court. */
  headroom: 0.3, minScale: 0.55,
  /** Hung flock: clear underside, shortest cable drop to the ceiling. */
  underside: 2.3, cable: 1.0,
  /** Walking lanes from the court's openings to the centrepiece ring: half width. */
  laneHalf: 0.6,
  /** Seating / planters / accent lights per court (seeded within). */
  benches: [2, 4] as const, planters: [1, 3] as const, lights: [1, 2] as const,
  /** A court of at least this floor (m2) is big: more seating and planters. */
  bigCourt: 250, benchesBig: [4, 7] as const, plantersBig: [2, 5] as const,
  /** Accent fixtures only under a ceiling at most this high above the court floor. */
  lightReach: 6.0,
  /** Clear disc kept by the dressers that run first (greenery): the clear radius + this. */
  keepPad: 1.5,
} as const;

/** One court's dressing (QA / tests: landmarkDressOf). */
export interface LandmarkDress {
  id: string;
  family: SkywaysLandmarkFamily;
  kind: LandmarksKind;
  centre: PropPlacement | null;
  /** The collision-only upper parts (fig tree planter + trunk / fountain column). */
  upper: PropPlacement[];
  plaque: PropPlacement | null;
  benches: PropPlacement[];
  planters: PropPlacement[];
  lights: LightPlacement[];
  /** Uniform scale of the centrepiece (1: real size) and the walking ring kept round it (m). */
  scale: number;
  ring: number;
  /** The court's openings (world point on the boundary, its side, span in cells): the walking lanes run from them. */
  openings: {x: number; z: number; side: Side; n: number}[];
  /** Why something was skipped (diagnostics). */
  miss: string[];
}
const DRESSED = new WeakMap<StationLayout, LandmarkDress[]>();
/** Where each recorded placement / light was pushed (its index in layout.props / layout.lights at dressing time). */
const PUSHED = new WeakMap<object, number>();
/** The live record of a dressed one: the generator may later copy its prop / light records (track-extension reframing): same values. */
function live<T extends object>(list: readonly T[], rec: T, same: (a: T, b: T) => boolean): T {
  const i = PUSHED.get(rec);
  if (i !== undefined && list[i] && same(list[i], rec)) return list[i];
  return list.find(q => same(q, rec)) ?? rec;
}
const sameProp = (a: PropPlacement, b: PropPlacement) => a.kind === b.kind && a.variant === b.variant && a.x === b.x && a.y === b.y && a.z === b.z && (a.level ?? 0) === (b.level ?? 0);
const sameLight = (a: LightPlacement, b: LightPlacement) => a.x === b.x && a.y === b.y && a.z === b.z && a.area === b.area;
/** The landmark courts dressed into a layout (in dressing order; QA / tests), resolved to the layout's current records. */
export function landmarkDressOf(layout: StationLayout): readonly LandmarkDress[] {
  const P = (p: PropPlacement) => live(layout.props, p, sameProp);
  return (DRESSED.get(layout) ?? []).map(d => ({...d, centre: d.centre && P(d.centre), upper: d.upper.map(P), plaque: d.plaque && P(d.plaque), benches: d.benches.map(P),
    planters: d.planters.map(P), lights: d.lights.map(l => live(layout.lights, l, sameLight))}));
}

/** Footprint radius of a family's hero about its spot (round: its collider; box: its half diagonal; the dinosaur: its half depth). */
export function landmarkFootRadius(family: SkywaysLandmarkFamily): number {
  const def = PROP_DEFS[LANDMARK_KIND[family]];
  if (family === 'geese') return 0;
  if (family === 'dinosaur') return def.d / 2;
  return LANDMARK_ROUND.has(LANDMARK_KIND[family]) ? def.w / 2 : Math.hypot(def.w, def.d) / 2;
}
const courtAxis = (a: Area): 'x' | 'z' => (a.w >= a.h ? 'x' : 'z');

/**
 * Reserves (PlaceCtx.keep) the clear disc + walking ring of every landmark on the context's storey — for the dressers that run before
 * dressLandmark (the atrium greenery, the food-court seating): the dinosaur's is its long box along the court's axis.
 */
export function keepLandmarkClear(ctx: PlaceCtx, layout: StationLayout): void {
  for (const lm of layout.skyways?.landmarks ?? []) {
    if (lm.level !== ctx.level) continue;
    const a = layout.areas[lm.area];
    const R = Math.max(lm.radius, landmarkFootRadius(lm.family)) + LANDMARK_DRESS.keepPad;
    const half = lm.family === 'dinosaur' ? Math.max(0, PROP_DEFS.skyDDinosaur.w / 2 - PROP_DEFS.skyDDinosaur.d / 2) : 0;
    const ax = a && courtAxis(a) === 'z' ? 0 : 1, az = 1 - ax;
    const x0 = lm.x - ax * half, z0 = lm.z - az * half, x1 = lm.x + ax * half, z1 = lm.z + az * half;
    keepCells(ctx, x0, z0, x1, z1, R);
  }
}

/** Marks the keep mask on the FLOOR cells whose centre lies within `half` of the segment a -> b. */
function keepCells(ctx: PlaceCtx, ax: number, az: number, bx: number, bz: number, half: number, area?: number): void {
  const g = ctx.g;
  for (let cy = Math.floor((Math.min(az, bz) - half) / CELL); cy <= Math.floor((Math.max(az, bz) + half) / CELL); cy++) {
    for (let cx = Math.floor((Math.min(ax, bx) - half) / CELL); cx <= Math.floor((Math.max(ax, bx) + half) / CELL); cx++) {
      if (!g.inBounds(cx, cy)) continue;
      const i = g.idx(cx, cy);
      if (g.cells[i] !== FLOOR || (area !== undefined && g.area[i] !== area)) continue;
      if (segDist((cx + 0.5) * CELL, (cy + 0.5) * CELL, ax, az, bx, bz) <= half) markCell(ctx, ctx.keep, i);
    }
  }
}

/**
 * The court's openings: runs of its boundary cells whose outward neighbour is walkable floor of another area (doorways, open sides
 * onto a corridor / the rest of the lobby), one per run, at the run's middle on the boundary line.
 */
export function courtOpenings(g: Grid, a: Area): {x: number; z: number; side: Side; n: number}[] {
  const out: {x: number; z: number; side: Side; n: number}[] = [];
  const own = (x: number, y: number) => g.inBounds(x, y) && g.area[g.idx(x, y)] === a.id && g.cells[g.idx(x, y)] === FLOOR;
  const open = (x: number, y: number) => g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR && g.area[g.idx(x, y)] !== a.id;
  const sides: [Side, number, number, number, number, number, number][] = [
    // side, start x, start y, step x, step y, outward dx, dy
    ['N', a.x, a.y, 1, 0, 0, -1], ['S', a.x, a.y + a.h - 1, 1, 0, 0, 1], ['W', a.x, a.y, 0, 1, -1, 0], ['E', a.x + a.w - 1, a.y, 0, 1, 1, 0],
  ];
  for (const [side, sx, sy, dx, dy, ox, oy] of sides) {
    const len = dx ? a.w : a.h;
    let run = -1;
    const flush = (end: number) => {
      if (run < 0) return;
      const mid = (run + end) / 2;
      const x = dx ? (sx + mid) * CELL : (ox > 0 ? sx + 1 : sx) * CELL, z = dy ? (sy + mid) * CELL : (oy > 0 ? sy + 1 : sy) * CELL;
      out.push({x: r3(x), z: r3(z), side, n: end - run});
      run = -1;
    };
    for (let k = 0; k < len; k++) {
      const x = sx + dx * k, y = sy + dy * k;
      if (own(x, y) && open(x + ox, y + oy)) { if (run < 0) run = k; } else flush(k);
    }
    flush(len);
  }
  return out;
}

/** Lowest ceiling over sample points (Infinity when unset). */
function minCeil(g: Grid, pts: readonly [number, number][]): number {
  let c = Infinity;
  for (const [x, z] of pts) c = Math.min(c, g.ceilAt(x, z));
  return c;
}
/** Sample points over a box (half extents) or a disc (radius r) round (x, z). */
function samples(x: number, z: number, hx: number, hz: number, disc: boolean): [number, number][] {
  const out: [number, number][] = [[x, z]];
  if (disc) {
    const r = Math.max(hx, hz);
    for (let k = 1; k <= Math.ceil(r / 0.5); k++) for (let j = 0; j < 16; j++) { const t = (j / 16) * 2 * Math.PI, d = Math.min(r, k * 0.5); out.push([x + Math.sin(t) * d, z + Math.cos(t) * d]); }
    return out;
  }
  const nx = Math.ceil((2 * hx) / 0.5), nz = Math.ceil((2 * hz) / 0.5);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) out.push([x - hx + (2 * hx * i) / nx, z - hz + (2 * hz * j) / nz]);
  return out;
}

/** Dresses one landmark court; returns the props placed. */
export function dressLandmark(layout: StationLayout, rng: Rng, lm: SkywaysLandmark): number {
  const kind = LANDMARK_KIND[lm.family];
  const res: LandmarkDress = {id: lm.id, family: lm.family, kind, centre: null, upper: [], plaque: null, benches: [], planters: [], lights: [], scale: 1, ring: 0, openings: [], miss: []};
  let list = DRESSED.get(layout);
  if (!list) DRESSED.set(layout, (list = []));
  list.push(res);
  const area = layout.areas[lm.area], lv = lm.level;
  if (!area) { res.miss.push('no court area'); return 0; }
  const g = levelGrid(layout, lv), p0 = layout.props.length;
  const ctx = makePlaceCtx(layout, rng, lv, {x0: area.x - 3, y0: area.y - 3, x1: area.x + area.w + 2, y1: area.y + area.h + 2});
  const floor = g.floorAt(lm.x, lm.z);
  /** Through the kit (local height frame), then lifted onto the court floor. */
  const put = (k: PropKind, x: number, z: number, rot: number, o: PlaceOpts = {}): PropPlacement | null => {
    const p = tryPlaceProp(ctx, area, k, r3(x), r3(z), r3(rot), o);
    if (p) { p.y = r3(p.y + g.floorAt(p.x, p.z)); PUSHED.set(p, layout.props.length - 1); }
    return p;
  };
  res.openings = courtOpenings(g, area);
  const main = res.openings.reduce<LandmarkDress['openings'][number] | null>((b, o) => (!b || o.n > b.n ? o : b), null);
  const toMain = main ? yawToward(main.x - lm.x, main.z - lm.z) : 0;

  // --- 1. the centrepiece -------------------------------------------------------------------------------------------------------
  let R0 = landmarkFootRadius(lm.family);
  if (lm.family === 'geese') {
    res.centre = hangFlock(layout, g, area, lm, floor, res);
    R0 = lm.radius;
  } else {
    const def = PROP_DEFS[kind], round = LANDMARK_ROUND.has(kind);
    const axis = courtAxis(area);
    const yaw = kind === 'skyDDinosaur' ? (axis === 'x' ? rng.pick([0, Math.PI]) : rng.pick([Math.PI / 2, -Math.PI / 2])) : toMain;
    const rot = round ? 0 : quarter(yaw);
    // the drawn model's footprint (the table's size; round heroes: their disc) must stand under the ceiling (+ headroom)
    const row = landmarkModelSize(kind);
    const turned = Math.abs(Math.sin(rot)) > 0.5;
    const vhx = (turned ? row.d : row.w) / 2, vhz = (turned ? row.w : row.d) / 2;
    /**
     * The largest uniform scale (1, 0.95, ... minScale; 0: none) the hero may stand at at (x, z): its whole drawn footprint over carved
     * floor (no crown / tail into a wall) and under the ceiling (+ headroom).
     */
    const fitAt = (x: number, z: number): number => {
      const f0 = g.floorAt(x, z);
      for (let k = 1; k >= LANDMARK_DRESS.minScale - 1e-9; k = Math.round((k - 0.05) * 100) / 100) {
        const pts = samples(x, z, vhx * k, vhz * k, round);
        if (pts.some(([px, pz]) => { const [cx, cy] = g.cellOf(px, pz); return !g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR; })) continue;
        if (minCeil(g, pts) - f0 - LANDMARK_DRESS.headroom >= row.h * k) return k;
      }
      return 0;
    };
    // the spot, else nudged up to 3 m (a stair approach / door zone reaching into the disc)
    const nudges: [number, number][] = [[0, 0]];
    for (const d of [0.5, 1, 1.5, 2, 2.5, 3]) for (let j = 0; j < 8; j++) nudges.push([r3(Math.sin((j * Math.PI) / 4) * d), r3(Math.cos((j * Math.PI) / 4) * d)]);
    let low = 0;
    find: for (const ring of LANDMARK_DRESS.rings) {
      for (const [dx, dz] of nudges) {
        const s = fitAt(lm.x + dx, lm.z + dz);
        if (!(s >= LANDMARK_DRESS.minScale)) { low++; continue; }
        const p = put(kind, lm.x + dx, lm.z + dz, rot, {laneOk: true, plazaOk: true, ring, h: r3(def.h * s)});
        if (!p) continue;
        if (round) { p.rot = r3(normYaw(yaw)); p.round = true; p.hx = p.hz = r3((def.w / 2) * s); } else { const f = footprint(kind, rot); p.hx = r3(f.hx * s); p.hz = r3(f.hz * s); }
        res.centre = p; res.ring = ring; res.scale = s;
        break find;
      }
    }
    if (!res.centre) res.miss.push(low ? `centrepiece spot taken / ceiling too low (${low} spots under ${LANDMARK_DRESS.minScale} scale)` : 'centrepiece spot taken');
    const c = res.centre;
    // the collision-only upper parts, each resting on the part below (never drawn)
    let below = c ? layout.props.indexOf(c) : -1;
    for (const up of c ? landmarkUppers(kind) : []) {
      const s = res.scale;
      const u: PropPlacement = {kind, x: c!.x, z: c!.z, y: r3(c!.y + up.y0 * s), rot: c!.rot, area: area.id, hx: r3(up.r * s), hz: r3(up.r * s), h: r3((up.y1 - up.y0) * s),
        blocksSight: false, variant: up.variant, round: true, host: below, ...(lv ? {level: lv} : {})};
      layout.props.push(u);
      res.upper.push(u);
      below = layout.props.length - 1;
      PUSHED.set(u, below);
    }
    if (c) R0 = round ? c.hx : kind === 'skyDDinosaur' ? Math.min(c.hx, c.hz) : Math.max(c.hx, c.hz);
  }
  // the floor kept open round the hero: the kit reserves its ring as whole cells round the footprint's cells (+ up to one cell)
  const ext = res.ring ? (Math.ceil(res.ring / CELL - 1e-6) + 1) * CELL : LANDMARK_DRESS.rings[0];
  const c0 = res.centre && lm.family !== 'geese' ? res.centre : null;
  /** The hero's half extent toward a unit direction (its box / disc; the flock: the clear radius). */
  const halfToward = (ux: number, uz: number): number => (c0 ? (c0.round ? c0.hx : Math.abs(ux) * c0.hx + Math.abs(uz) * c0.hz) : R0);
  const ringR = R0 + ext;
  /** Everything round the hero is laid out from where it actually stands (a nudged hero moved off the spot). */
  const X = c0?.x ?? lm.x, Z = c0?.z ?? lm.z;

  // --- 2. walking lanes from every opening to the centrepiece's ring --------------------------------------------------------------
  for (const o of res.openings) {
    if (o.n < 2) continue;
    const d = Math.hypot(o.x - X, o.z - Z);
    if (d <= ringR) continue;
    const ux = (X - o.x) / d, uz = (Z - o.z) / d;
    keepCells(ctx, o.x, o.z, o.x + ux * (d - ringR), o.z + uz * (d - ringR), LANDMARK_DRESS.laneHalf, area.id);
  }

  // --- 3. the plaque beside the main approach, facing the visitor -----------------------------------------------------------------
  {
    // the main approach first, then the court's other openings by span, then the four sides (a court too shallow on that side)
    const dirs = [toMain, ...res.openings.slice().sort((p, q) => q.n - p.n).map(o => yawToward(o.x - X, o.z - Z)), 0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const variant = DEST_PLAQUE_OF[lm.family], dep = PROP_DEFS.skyDPlaque.d / 2;
    // (the station's desire lines crossed the court's middle before the hero stood there: the reserved lanes above replace them)
    outer: for (const yaw of dirs) {
      const ux = Math.sin(yaw), uz = Math.cos(yaw), rot = quarter(yaw), base = halfToward(ux, uz) + ext + dep + 0.15;
      for (const radial of [0, 0.5, 1.0, 1.6, 2.4]) for (const lateral of [1.3, -1.3, 1.9, -1.9, 2.6, -2.6]) {
        const x = X + ux * (base + radial) + uz * lateral, z = Z + uz * (base + radial) - ux * lateral;
        const p = put('skyDPlaque', x, z, rot, {plazaOk: true, laneOk: true, variant});
        if (p) { res.plaque = p; break outer; }
      }
    }
    if (!res.plaque) res.miss.push('no plaque spot');
  }

  // --- 4. benches facing the centrepiece; planters on the diagonals ---------------------------------------------------------------
  {
    // a big court gets more seating / greenery than a small atrium floor (court floor m2)
    const m2 = area.w * area.h * CELL * CELL, big = m2 >= LANDMARK_DRESS.bigCourt;
    const bd = PROP_DEFS.bench.d;
    const extra = lm.family === 'fig-tree' ? 1.5 : 0.1;
    // bench slots round the hero (all four sides: the reserved walking lanes / ring and the plaque are already taken, so the way in
    // stays open): straight on, else flanking the lane coming in on that side, along a long hero's sides
    const slots: [number, number, number][] = []; // direction (unit x, z) + offset along the tangent
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as [number, number][]) {
      const L = c0 ? Math.abs(dz) * c0.hx + Math.abs(dx) * c0.hz : 0; // the hero's half length along this side
      const ts = L > 2 ? [-0.5 * L, 0.5 * L, 0] : [0, 1.6, -1.6];
      for (const t of ts) slots.push([dx, dz, t]);
    }
    const [n0, n1] = big ? LANDMARK_DRESS.benchesBig : LANDMARK_DRESS.benches;
    let n = rng.int(n0, n1);
    for (const [dx, dz, t] of rng.shuffle(slots)) {
      if (n <= 0) break;
      const dist = halfToward(dx, dz) + ext + bd / 2 + extra;
      // the slot, else a little further out / slid along the side
      bench: for (const out of [0, 0.8, 1.6, 2.6, 3.6]) for (const side of [0, 0.9, -0.9]) {
        const x = X + dx * (dist + out) - dz * (t + side), z = Z + dz * (dist + out) + dx * (t + side);
        const p = put('bench', x, z, quarter(yawToward(-dx, -dz)), {plazaOk: true, laneOk: true, front: 0.6});
        if (p) { res.benches.push(p); n--; break bench; }
      }
    }
    if (lm.family !== 'fig-tree') {
      const pw = PROP_DEFS.planterTree.w;
      const [k0, k1] = big ? LANDMARK_DRESS.plantersBig : LANDMARK_DRESS.planters;
      let k = rng.int(k0, k1);
      for (const [dx, dz] of rng.shuffle([[1, 1], [1, -1], [-1, 1], [-1, -1]] as [number, number][])) {
        if (k <= 0) break;
        const hx = c0 ? c0.hx : R0, hz = c0 ? c0.hz : R0;
        for (const out of [0, 1.0, 2.0, 3.0]) {
          const x = X + dx * (hx + ext + pw / 2 + 0.3 + out), z = Z + dz * (hz + ext + pw / 2 + 0.3 + out);
          const p = put('planterTree', x, z, 0, {plazaOk: true, laneOk: true, ring: 0.6});
          if (p) { res.planters.push(p); k--; break; }
        }
      }
    }
  }

  // --- 5. warm accent light(s) near the centrepiece, under a ceiling within reach ------------------------------------------------
  {
    let n = rng.int(...LANDMARK_DRESS.lights);
    const a0 = rng.range(0, 2 * Math.PI), c = res.centre;
    const used: [number, number][] = [];
    for (let j = 0; j < 8 && n > 0; j++) {
      const t = a0 + (j % 2 ? Math.PI : 0) + Math.floor(j / 2) * (Math.PI / 4);
      for (let d = R0 + 1.0; d <= 9.0; d += 0.5) {
        const x = X + Math.sin(t) * d, z = Z + Math.cos(t) * d;
        const [cx, cy] = g.cellOf(x, z);
        if (!g.inBounds(cx, cy) || g.area[g.idx(cx, cy)] !== area.id || g.cells[g.idx(cx, cy)] !== FLOOR) break;
        const ceil = g.ceilAt(x, z);
        if (!Number.isFinite(ceil) || ceil - floor > LANDMARK_DRESS.lightReach) continue;
        if (c && Math.abs(x - c.x) < c.hx + 0.3 && Math.abs(z - c.z) < c.hz + 0.3) continue;
        if (layout.lights.some(l => (l.level ?? 0) === lv && Math.hypot(l.x - x, l.z - z) < 1.5) || used.some(([ux, uz]) => Math.hypot(ux - x, uz - z) < 3)) continue;
        const l: LightPlacement = {x: r3(x), y: r3(ceil - 0.08), z: r3(z), rot: area.w >= area.h ? 0 : Math.PI / 2, area: area.id, broken: false, flicker: false, warm: true, power: 0.9, dying: false};
        if (lv) l.level = lv;
        layout.lights.push(l);
        res.lights.push(l);
        PUSHED.set(l, layout.lights.length - 1);
        used.push([x, z]);
        n--;
        break;
      }
    }
  }
  return layout.props.length - p0;
}

/** The drawn size of a hero (its model table row: front +Z, metres). */
function landmarkModelSize(kind: LandmarksKind): {w: number; h: number; d: number} {
  const def = PROP_DEFS[kind] as {w: number; h: number; d: number};
  const m = LANDMARK_MODEL_ROWS[kind];
  return m ?? def;
}
const LANDMARK_MODEL_ROWS: Partial<Record<LandmarksKind, {w: number; h: number; d: number}>> = {
  skyDClock: SKYWAYS_DEST_PROPS.skyways_d_lm_clock, skyDDinosaur: SKYWAYS_DEST_PROPS.skyways_d_lm_dino, skyDFigTree: SKYWAYS_DEST_PROPS.skyways_d_lm_tree,
  skyDFountain: SKYWAYS_DEST_PROPS.skyways_d_lm_fountain, skyDGeese: SKYWAYS_DEST_PROPS.skyways_d_lm_geese, skyDOrrery: SKYWAYS_DEST_PROPS.skyways_d_lm_orrery,
};

/**
 * The geese: hung inside the atrium opening's column (every point of the flock's footprint under the glass roof, over walkable floor),
 * the flock's top at the court's clear height (LANDMARK_FAMILIES.geese) below the roof with >= 1 m of cable, its underside >= 2.3 m
 * clear; its long side along the court's longer axis where it fits; shrunk (never below minScale) where the opening is too small.
 * Mounted: no floor footprint (never in the collision index), static.
 */
function hangFlock(layout: StationLayout, g: Grid, area: Area, lm: SkywaysLandmark, floor: number, res: LandmarkDress): PropPlacement | null {
  const kind = 'skyDGeese', def = PROP_DEFS[kind], lv = lm.level;
  const rots = courtAxis(area) === 'x' ? [0, Math.PI / 2] : [Math.PI / 2, 0];
  for (const s of [1, 0.9, 0.8, 0.7, 0.6]) {
    if (s < LANDMARK_DRESS.minScale) break;
    for (const rot of rots) {
      const turned = Math.abs(Math.sin(rot)) > 0.5;
      const hx = ((turned ? def.d : def.w) / 2) * s, hz = ((turned ? def.w : def.d) / 2) * s, h = def.h * s;
      const pts = samples(lm.x, lm.z, hx, hz, false);
      if (pts.some(([x, z]) => { const [cx, cy] = g.cellOf(x, z); return !g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR; })) continue;
      const ceil = minCeil(g, pts);
      if (!Number.isFinite(ceil)) continue;
      const top = floor + Math.min(lm.height, ceil - floor - LANDMARK_DRESS.cable), bottom = top - h;
      if (bottom - floor < LANDMARK_DRESS.underside) continue;
      // nothing else up there: no fixture in the flock's volume, no prop reaching into it
      if (layout.lights.some(l => (l.level ?? 0) === lv && Math.abs(l.x - lm.x) < hx + 0.3 && Math.abs(l.z - lm.z) < hz + 0.3 && l.y > bottom - 0.3 && l.y < top + 0.3)) continue;
      if (layout.props.some(q => (q.level ?? 0) === lv && Math.abs(q.x - lm.x) < q.hx + hx && Math.abs(q.z - lm.z) < q.hz + hz && q.y < top && q.y + q.h > bottom)) continue;
      const p: PropPlacement = {kind, x: r3(lm.x), z: r3(lm.z), y: r3(bottom), rot: r3(rot), area: area.id, hx: r3(hx), hz: r3(hz), h: r3(h), blocksSight: false, variant: 0, mounted: true,
        ...(lv ? {level: lv} : {})};
      layout.props.push(p);
      PUSHED.set(p, layout.props.length - 1);
      res.scale = s;
      return p;
    }
  }
  res.miss.push('flock does not fit the opening');
  return null;
}

