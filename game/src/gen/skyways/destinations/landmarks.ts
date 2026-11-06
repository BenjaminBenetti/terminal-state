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
//  4. SEATING: existing station benches round the centrepiece facing it (the dinosaur: along its long sides; the fig tree has its own
//     ring bench, so its benches stand further out), never on the approach side; PLANTERS (the existing planter tree) on the
//     diagonals (not in the fig tree's court);
//  5. a warm ACCENT light or two: steady warm ceiling fixtures near the centrepiece where a ceiling is within reach (an atrium court:
//     under the skyway slab at the opening's edge), never over the hero.
// Existing approved kinds only besides the destination kinds; deterministic from the rng it is given.
// keepLandmarkClear: the atrium greenery / food-court seating (gen/skyways/greenery.ts, which runs first) keep the courts' clear discs.

import type {Rng} from '../../../core/rng';
import {SKYWAYS_DEST_PROPS} from '../../../assets/skywaysDestProps.generated';
import {CELL, FLOOR, type Grid} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {levelGrid, makePlaceCtx, markCell, tryPlaceProp, type PlaceCtx, type PlaceOpts} from '../../placeKit';
import type {Area, LightPlacement, Side, StationLayout} from '../../stationTypes';
import {normYaw, quarter, segDist, yawToward} from '../addonFrame';
import type {SkywaysLandmark, SkywaysLandmarkFamily} from '../skywaysTypes';
import {DEST_PLAQUE_OF} from './art';
import {LANDMARK_KIND, LANDMARK_ROUND, landmarkUppers, type LandmarksKind} from './kindsLandmarks';

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
/** The landmark courts dressed into a layout (in dressing order). */
export const landmarkDressOf = (layout: StationLayout): readonly LandmarkDress[] => DRESSED.get(layout) ?? [];

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
    if (p) p.y = r3(p.y + g.floorAt(p.x, p.z));
    if (!p && LM_DEBUG.on) LM_DEBUG.log.push(`${lm.family} ${k} @${r3(x - lm.x)},${r3(z - lm.z)} r${r3(rot)}: ${whyNot(ctx, area, k, x, z, rot)}`);
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
    const clear = minCeil(g, samples(lm.x, lm.z, vhx, vhz, round)) - floor;
    let s = Math.min(1, (clear - LANDMARK_DRESS.headroom) / row.h);
    if (s < 1) s = Math.floor(s * 100) / 100;
    if (!(s >= LANDMARK_DRESS.minScale)) res.miss.push(`ceiling ${r3(clear)} m too low`);
    else {
      // the spot, else nudged up to 3 m (a stair approach / door zone reaching into the disc)
      const nudges: [number, number][] = [[0, 0]];
      for (const d of [0.5, 1, 1.5, 2, 2.5, 3]) for (let j = 0; j < 8; j++) nudges.push([r3(Math.sin((j * Math.PI) / 4) * d), r3(Math.cos((j * Math.PI) / 4) * d)]);
      for (const ring of LANDMARK_DRESS.rings) {
        for (const [dx, dz] of nudges) {
          const p = put(kind, lm.x + dx, lm.z + dz, rot, {laneOk: true, plazaOk: true, ring, h: r3(def.h * s)});
          if (!p) continue;
          if (round) { p.rot = r3(normYaw(yaw)); p.round = true; p.hx = p.hz = r3((def.w / 2) * s); } else { const f = footprint(kind, rot); p.hx = r3(f.hx * s); p.hz = r3(f.hz * s); }
          res.centre = p; res.ring = ring; res.scale = s;
          break;
        }
        if (res.centre) break;
      }
      if (!res.centre) res.miss.push('centrepiece spot taken');
    }
    const c = res.centre;
    // the collision-only upper parts, each resting on the part below (never drawn)
    let below = c ? layout.props.indexOf(c) : -1;
    for (const up of c ? landmarkUppers(kind) : []) {
      const u: PropPlacement = {kind, x: c!.x, z: c!.z, y: r3(c!.y + up.y0 * s), rot: c!.rot, area: area.id, hx: r3(up.r * s), hz: r3(up.r * s), h: r3((up.y1 - up.y0) * s),
        blocksSight: false, variant: up.variant, round: true, host: below, ...(lv ? {level: lv} : {})};
      layout.props.push(u);
      res.upper.push(u);
      below = layout.props.length - 1;
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
    const bd = PROP_DEFS.bench.d;
    const extra = lm.family === 'fig-tree' ? 1.5 : 0.1;
    const cand: [number, number, number][] = []; // direction (unit x, z) + offset along the tangent
    const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dz] of dirs) {
      // never on the approach side (the plaque and the way in)
      if (main && dx * Math.sin(toMain) + dz * Math.cos(toMain) > 0.7) continue;
      if (lm.family === 'dinosaur') {
        const along = c0 ? c0.hx >= c0.hz : courtAxis(area) === 'x';
        if ((along && dx !== 0) || (!along && dz !== 0)) continue; // only its long sides
        const L = c0 ? (along ? c0.hx : c0.hz) : 3;
        for (const t of [-0.45 * L, 0.45 * L]) cand.push([dx, dz, t]);
      } else cand.push([dx, dz, 0]);
    }
    // a bench faces the hero straight on, else flanks the walking lane coming in on that side (+-1.6 m along the tangent), else a
    // little further out
    let n = rng.int(...LANDMARK_DRESS.benches);
    for (const [dx, dz, t] of rng.shuffle(cand)) {
      if (n <= 0) break;
      const dist = halfToward(dx, dz) + ext + bd / 2 + extra;
      bench: for (const out of [0, 0.6, 1.2]) for (const side of t ? [0, Math.sign(t) * 0.8] : [0, 1.6, -1.6]) {
        const x = X + dx * (dist + out) - dz * (t + side), z = Z + dz * (dist + out) + dx * (t + side);
        const p = put('bench', x, z, quarter(yawToward(-dx, -dz)), {plazaOk: true, laneOk: true, front: 0.6});
        if (p) { res.benches.push(p); n--; break bench; }
      }
    }
    if (lm.family !== 'fig-tree') {
      const pw = PROP_DEFS.planterTree.w;
      let k = rng.int(...LANDMARK_DRESS.planters);
      for (const [dx, dz] of rng.shuffle([[1, 1], [1, -1], [-1, 1], [-1, -1]] as [number, number][])) {
        if (k <= 0) break;
        const hx = c0 ? c0.hx : R0, hz = c0 ? c0.hz : R0;
        const x = X + dx * (hx + ext + pw / 2 + 0.3), z = Z + dz * (hz + ext + pw / 2 + 0.3);
        const p = put('planterTree', x, z, 0, {plazaOk: true, laneOk: true, ring: 0.6});
        if (p) { res.planters.push(p); k--; }
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
      res.scale = s;
      return p;
    }
  }
  res.miss.push('flock does not fit the opening');
  return null;
}

// DEBUG (temporary)
export const LM_DEBUG = {on: false, log: [] as string[]};
function whyNot(ctx: PlaceCtx, area: Area, kind: PropKind, x: number, z: number, rot: number): string {
  const g = ctx.g, {hx, hz} = footprint(kind, rot);
  const e = 0.04, x0 = Math.floor((x - hx + e) / CELL), y0 = Math.floor((z - hz + e) / CELL), x1 = Math.floor((x + hx - e) / CELL), y1 = Math.floor((z + hz - e) / CELL);
  const why: Record<string, number> = {};
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (!g.inBounds(cx, cy)) { why.oob = (why.oob ?? 0) + 1; continue; }
    const i = g.idx(cx, cy);
    const r = g.cells[i] !== FLOOR ? 'cell' : g.area[i] !== area.id ? 'area' : g.blocked[i] ? 'blocked' : ctx.keep[i] ? 'keep' : ctx.edge[i] ? 'edge' : ctx.doorCell[i] ? 'doorCell' : ctx.zone[i] ? 'zone' : ctx.lane[i] ? 'lane' : ctx.plaza[i] ? 'plaza' : '';
    if (r) why[r] = (why[r] ?? 0) + 1;
  }
  return JSON.stringify(why);
}
