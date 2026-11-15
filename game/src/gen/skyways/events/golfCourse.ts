// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-COURSE): the mini-golf COURSE's pure geometry — the hall's
// rows of hole bays with their walking aisles, the hole designs, and each hole built into axis-aligned course pieces (turf deck pieces,
// the cup piece, bumper rail runs, obstacles) that obey the physics contract (gen/skyways/events/golfContract.ts). Pure data: no
// placement, no grid (gen/skyways/events/golfDress.ts places the pieces and checks them against the hall).
//
// A hole is designed in its BAY's local frame: s along the row (0..bw), t from the promenade edge (t = 0, where the tee end is) toward
// the wall (t = bd). Its playing area is a union of rects (lanes of GOLF_LANE m, wider greens); the bumper rails run round the union's
// outline OUTSIDE it (GOLF_RAIL.t thick, standing on the deck, which extends under them); a tier is a raised part of the deck (rails on it
// stand on the tier); obstacles stand on the turf. The deck (play + rails + turf fills) is cut into rects round the cup square and the
// tier lines, then into pieces of hypot(hx, hz) <= GOLF_PIECE_MAX_R.
//
// Designs (at most once each per course while another still fits): straight, dogleg (L), zigzag (Z), gate (a tunnel arch), obstacle (a
// centre block + side kickers), island (a split route round an island), tier (a raised tee tier stepping down), hairpin (U-turn back
// to the promenade), plateau (a wide green with scattered blocks). Every hole's ball line (path: tee -> corners -> cup) clears its own
// rails / blocks / arch posts by a ball radius (golfPathClear).

import type {Rng} from '../../../core/rng';
import {GOLF_ARCH, GOLF_BALL_R, GOLF_CUP_PIECE, GOLF_LANE, GOLF_PIECE_MAX_R, GOLF_RAIL} from './golfContract';
import type {GolfDesign} from './golfTypes';

/** An axis-aligned rect (local s / t as x / z, or world x / z). */
export interface GRect { x0: number; z0: number; x1: number; z1: number }
export interface GPt { x: number; z: number }

/** A hole's design in its bay's local frame (x = s along the row, z = t from the promenade edge). */
export interface HolePlan {
  design: GolfDesign;
  par: number;
  play: GRect[];
  /** Turf deck that is not playing area (a hairpin's divider between its lanes). */
  fill: GRect[];
  /** Raised deck regions (their rails included): the tee tier. */
  tier: GRect[];
  /** Painted bumper blocks on the turf (with their paint variant offset). */
  blocks: GRect[];
  /** Tunnel arch centres: each spans the lane across s, the ball runs through it along t. */
  arches: GPt[];
  tee: GPt;
  cup: GPt;
  /** The ball's line tee -> corners -> cup. */
  path: GPt[];
}

/** A built hole (same frame as its plan): deck pieces, the cup piece's square, rail runs, obstacles. */
export interface BuiltHole {
  plan: HolePlan;
  deck: {r: GRect; tier: boolean}[];
  cup: GRect;
  rails: {r: GRect; tier: boolean; side: Side}[];
  /** The playing area's outline edges (outward normal side): the flag stands outside one beside the cup. */
  edges: OutlineEdge[];
}
type Side = 'N' | 'S' | 'W' | 'E';
export interface OutlineEdge { side: Side; c: number; a: number; b: number }

const T = GOLF_RAIL.t;
/** Playing area inset from the bay's side / far edges (a rail + a little) and from its promenade edge (room for the tee sign). */
export const GOLF_BAY_MARGIN = T + 0.04;
export const GOLF_TEE_MARGIN = 0.36;
const M = GOLF_BAY_MARGIN, T0 = GOLF_TEE_MARGIN, LW = GOLF_LANE;
const EPS = 1e-6;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const R = (x0: number, z0: number, x1: number, z1: number): GRect => ({x0: r4(Math.min(x0, x1)), z0: r4(Math.min(z0, z1)), x1: r4(Math.max(x0, x1)), z1: r4(Math.max(z0, z1))});
const P = (x: number, z: number): GPt => ({x: r4(x), z: r4(z)});
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** A block of half sizes (hs, ht) at (s, t). */
const blockAt = (s: number, t: number, hs: number, ht: number): GRect => R(s - hs, t - ht, s + hs, t + ht);

// ---------------------------------------------------------------------------------------------
// Hole designs

type DesignFn = (bw: number, bd: number, rng: Rng) => HolePlan | null;
const empty = (design: GolfDesign, par: number): Omit<HolePlan, 'play' | 'tee' | 'cup' | 'path'> => ({design, par, fill: [], tier: [], blocks: [], arches: []});

const straight: DesignFn = (bw, bd, rng) => {
  const len = bd - M - T0;
  if (len < 2.6 || bw < LW + 2 * M) return null;
  const w = bw >= 1.2 + 2 * M + 0.4 && rng.chance(0.5) ? 1.2 : LW;
  const sc = clamp(bw / 2 + rng.range(-0.4, 0.4), M + w / 2, bw - M - w / 2), t1 = bd - M;
  const tee = P(sc, T0 + 0.45), cup = P(sc + rng.range(-1, 1) * (w / 2 - 0.3), t1 - 0.55);
  return {...empty('straight', 2), play: [R(sc - w / 2, T0, sc + w / 2, t1)], tee, cup, path: [tee, cup]};
};

const dogleg: DesignFn = (bw, bd, rng) => {
  const len = bd - M - T0;
  if (len < 2.6 || bw < 2 * M + LW + 1.5) return null;
  const sA = M + LW / 2, sB = Math.max(sA + 1.5, bw - M - LW / 2 - rng.range(0, Math.max(0, bw - 2 * M - LW - 2.6))), tC = bd - M;
  const tee = P(sA, T0 + 0.45), corner = P(sA, tC - LW / 2), cup = P(sB - 0.05, tC - LW / 2);
  return {...empty('dogleg', 3), play: [R(sA - LW / 2, T0, sA + LW / 2, tC), R(sA - LW / 2, tC - LW, sB + LW / 2, tC)], tee, cup, path: [tee, corner, cup]};
};

const zigzag: DesignFn = (bw, bd, rng) => {
  const t0 = T0, tE = bd - M;
  if (tE - t0 < 3.7 || bw < 2 * M + 2 * LW + 0.6) return null;
  const sA = M + LW / 2, sB = Math.min(bw - M - LW / 2, sA + 3.4);
  const lo = t0 + LW / 2 + 0.9, hi = tE - LW / 2 - 0.9, tm = clamp((t0 + tE) / 2 + rng.range(-0.25, 0.25), lo, hi);
  if (hi < lo) return null;
  const tee = P(sA, t0 + 0.45), cup = P(sB, tE - 0.55);
  return {...empty('zigzag', 3), play: [R(sA - LW / 2, t0, sA + LW / 2, tm + LW / 2), R(sA - LW / 2, tm - LW / 2, sB + LW / 2, tm + LW / 2), R(sB - LW / 2, tm - LW / 2, sB + LW / 2, tE)],
    tee, cup, path: [tee, P(sA, tm), P(sB, tm), cup]};
};

const gate: DesignFn = (bw, bd, rng) => {
  const t1 = bd - M, len = t1 - T0;
  if (len < 3.2 || bw < LW + 2 * M) return null;
  const sc = clamp(bw / 2 + rng.range(-0.5, 0.5), M + LW / 2, bw - M - LW / 2);
  const tee = P(sc, T0 + 0.45), cup = P(sc, t1 - 0.55);
  const arches = len >= 5.4 ? [P(sc, T0 + len * 0.36), P(sc, T0 + len * 0.66)] : [P(sc, T0 + len * (0.5 + rng.range(-0.06, 0.06)))];
  return {...empty('gate', 3), play: [R(sc - LW / 2, T0, sc + LW / 2, t1)], arches, tee, cup, path: [tee, cup]};
};

const obstacle: DesignFn = (bw, bd, rng) => {
  const t1 = bd - M, len = t1 - T0, w = 1.5;
  if (len < 3.4 || bw < w + 2 * M) return null;
  const sc = clamp(bw / 2 + rng.range(-0.3, 0.3), M + w / 2, bw - M - w / 2), tm = T0 + len * 0.52, side = rng.chance(0.5) ? 1 : -1;
  const tee = P(sc, T0 + 0.45), cup = P(sc - side * 0.1, t1 - 0.55);
  const blocks = [blockAt(sc, tm, 0.18, 0.18), blockAt(sc - side * (w / 2 - 0.15), T0 + len * 0.3, 0.15, 0.1), blockAt(sc + side * (w / 2 - 0.15), T0 + len * 0.76, 0.15, 0.1)];
  return {...empty('obstacle', 3), play: [R(sc - w / 2, T0, sc + w / 2, t1)], blocks, tee, cup, path: [tee, P(sc + side * 0.45, tm), cup]};
};

const island: DesignFn = (bw, bd, rng) => {
  const t1 = bd - M, len = t1 - T0, w = 2.2;
  if (len < 3.8 || bw < w + 2 * M) return null;
  const sc = clamp(bw / 2 + rng.range(-0.3, 0.3), M + w / 2, bw - M - w / 2);
  const ti0 = T0 + 0.95, ti1 = Math.max(ti0 + 0.8, t1 - 1.1 - rng.range(0, Math.max(0, len - 4.6))), side = rng.chance(0.5) ? 1 : -1, ch = 0.35 + (w / 2 - 0.35) / 2;
  const tee = P(sc, T0 + 0.45), cup = P(sc, t1 - 0.55);
  return {...empty('island', 3), play: [R(sc - w / 2, T0, sc + w / 2, t1)], blocks: [R(sc - 0.35, ti0, sc + 0.35, ti1)], tee, cup,
    path: [tee, P(sc + side * ch, ti0), P(sc + side * ch, ti1), cup]};
};

const tier: DesignFn = (bw, bd, rng) => {
  const t1 = bd - M, len = t1 - T0;
  if (len < 3.4 || bw < LW + 2 * M) return null;
  const tS = T0 + rng.range(1.2, 1.6);
  if (bw >= 2 * M + LW + 1.5 && rng.chance(0.6)) {
    // the tier, then a dogleg on the lower green
    const sA = M + LW / 2, sB = bw - M - LW / 2, tC = t1;
    const tee = P(sA, T0 + 0.45), cup = P(sB - 0.05, tC - LW / 2);
    return {...empty('tier', 3), play: [R(sA - LW / 2, T0, sA + LW / 2, tC), R(sA - LW / 2, tC - LW, sB + LW / 2, tC)], tier: [R(sA - LW / 2 - T, T0 - T, sA + LW / 2 + T, tS)],
      tee, cup, path: [tee, P(sA, tC - LW / 2), cup]};
  }
  const sc = clamp(bw / 2 + rng.range(-0.4, 0.4), M + LW / 2, bw - M - LW / 2);
  const tee = P(sc, T0 + 0.45), cup = P(sc, t1 - 0.55);
  return {...empty('tier', 2), play: [R(sc - LW / 2, T0, sc + LW / 2, t1)], tier: [R(sc - LW / 2 - T, T0 - T, sc + LW / 2 + T, tS)], tee, cup, path: [tee, cup]};
};

const hairpin: DesignFn = (bw, bd) => {
  const tE = bd - M, len = tE - T0;
  if (len < 3.0 || bw < 2 * M + 2 * LW + 0.5) return null;
  const sA = M + LW / 2, sB = sA + LW + 0.5;
  const tee = P(sA, T0 + 0.45), cup = P(sB, T0 + 0.6);
  return {...empty('hairpin', 3), play: [R(sA - LW / 2, T0, sA + LW / 2, tE), R(sA - LW / 2, tE - LW, sB + LW / 2, tE), R(sB - LW / 2, T0, sB + LW / 2, tE)],
    fill: [R(sA + LW / 2, T0 - T, sB - LW / 2, tE - LW)], tee, cup, path: [tee, P(sA, tE - LW / 2), P(sB, tE - LW / 2), cup]};
};

const plateau: DesignFn = (bw, bd, rng) => {
  const t1 = bd - M, len = t1 - T0, w = Math.min(2.6, bw - 2 * M);
  if (len < 3.0 || w < 2.0) return null;
  const sc = bw / 2, side = rng.chance(0.5) ? 1 : -1;
  const tee = P(sc - side * (w / 2 - 0.5), T0 + 0.45), cup = P(sc + side * (w / 2 - 0.5), t1 - 0.55);
  const blocks: GRect[] = [];
  const cands: GPt[] = [P(sc + side * (w / 2 - 0.35), T0 + len * 0.3), P(sc - side * (w / 2 - 0.35), T0 + len * 0.62), P(sc, T0 + len * 0.18), P(sc, t1 - 0.25), P(sc + side * 0.3, T0 + len * 0.78)];
  for (const c of rng.shuffle(cands)) {
    if (blocks.length >= 3) break;
    const b = blockAt(c.x, c.z, 0.16, 0.16);
    if (segRectDist(tee, cup, b) < 0.3 || rectDist(b, tee) < 0.45 || rectDist(b, cup) < 0.45 || blocks.some(q => rectGap(q, b) < 0.3)) continue;
    blocks.push(b);
  }
  return {...empty('plateau', 2), play: [R(sc - w / 2, T0, sc + w / 2, t1)], blocks, tee, cup, path: [tee, cup]};
};

export const GOLF_DESIGNS: Readonly<Record<GolfDesign, DesignFn>> = {straight, dogleg, zigzag, gate, obstacle, island, tier, hairpin, plateau};
export const GOLF_DESIGN_IDS = Object.keys(GOLF_DESIGNS) as GolfDesign[];

// ---------------------------------------------------------------------------------------------
// Geometry helpers

function rectDist(r: GRect, p: GPt): number {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1), dz = Math.max(r.z0 - p.z, 0, p.z - r.z1);
  return Math.hypot(dx, dz);
}
function rectGap(a: GRect, b: GRect): number {
  const dx = Math.max(a.x0 - b.x1, 0, b.x0 - a.x1), dz = Math.max(a.z0 - b.z1, 0, b.z0 - a.z1);
  return Math.hypot(dx, dz);
}
/** Least distance from the segment a -> b to a rect (sampled finely: exact enough for clearance checks). */
export function segRectDist(a: GPt, b: GPt, r: GRect): number {
  const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.01));
  let d = Infinity;
  for (let k = 0; k <= n; k++) d = Math.min(d, rectDist(r, {x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n}));
  return d;
}
const inRect = (r: GRect, x: number, z: number) => x > r.x0 + EPS && x < r.x1 - EPS && z > r.z0 + EPS && z < r.z1 - EPS;
const uniq = (vs: number[]) => [...new Set(vs.map(r4))].sort((p, q) => p - q);

/** The compression grid of a rect set (cell (i, j) spans xs[i]..xs[i+1] x zs[j]..zs[j+1]). */
function gridOf(rects: readonly GRect[]) {
  const xs = uniq(rects.flatMap(r => [r.x0, r.x1])), zs = uniq(rects.flatMap(r => [r.z0, r.z1]));
  return {xs, zs, nx: xs.length - 1, nz: zs.length - 1, cx: (i: number) => (xs[i] + xs[i + 1]) / 2, cz: (j: number) => (zs[j] + zs[j + 1]) / 2};
}

/** The outline edges of a rect union (merged runs; `side` = the outward side: N = -z, S = +z, W = -x, E = +x). */
export function outlineEdges(rects: readonly GRect[]): {edges: OutlineEdge[]; inAt: (x: number, z: number) => boolean; corner: (x: number, z: number) => number} {
  const G = gridOf(rects);
  const cell = new Uint8Array(Math.max(0, G.nx * G.nz));
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) if (rects.some(r => inRect(r, G.cx(i), G.cz(j)))) cell[j * G.nx + i] = 1;
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < G.nx && j < G.nz && cell[j * G.nx + i] === 1;
  const raw: OutlineEdge[] = [];
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) {
    if (!at(i, j)) continue;
    if (!at(i - 1, j)) raw.push({side: 'W', c: G.xs[i], a: G.zs[j], b: G.zs[j + 1]});
    if (!at(i + 1, j)) raw.push({side: 'E', c: G.xs[i + 1], a: G.zs[j], b: G.zs[j + 1]});
    if (!at(i, j - 1)) raw.push({side: 'N', c: G.zs[j], a: G.xs[i], b: G.xs[i + 1]});
    if (!at(i, j + 1)) raw.push({side: 'S', c: G.zs[j + 1], a: G.xs[i], b: G.xs[i + 1]});
  }
  raw.sort((p, q) => (p.side < q.side ? -1 : p.side > q.side ? 1 : p.c - q.c || p.a - q.a));
  const edges: OutlineEdge[] = [];
  for (const e of raw) {
    const last = edges[edges.length - 1];
    if (last && last.side === e.side && Math.abs(last.c - e.c) < EPS && Math.abs(last.b - e.a) < EPS) last.b = e.b;
    else edges.push({...e});
  }
  // occupancy of the four cells round a grid point (1 = a convex corner, 3 = a concave one)
  const corner = (x: number, z: number): number => {
    const i = G.xs.findIndex(v => Math.abs(v - x) < EPS), j = G.zs.findIndex(v => Math.abs(v - z) < EPS);
    if (i < 0 || j < 0) return 2;
    return +at(i - 1, j - 1) + +at(i, j - 1) + +at(i - 1, j) + +at(i, j);
  };
  return {edges, inAt: (x, z) => rects.some(r => inRect(r, x, z)), corner};
}

/**
 * The bumper rails round a playing area: one rect outside each outline edge. Corners: a run along x (N / S) reaches over a convex
 * corner's square; a run along z (W / E) stops a rail short of a concave corner (the x run covers it) — no gap, no doubled corner.
 */
export function railRects(play: readonly GRect[]): {rails: {r: GRect; side: Side}[]; edges: OutlineEdge[]} {
  const {edges, corner} = outlineEdges(play);
  const rails = edges.map(e => {
    if (e.side === 'N' || e.side === 'S') {
      const ea = corner(e.a, e.c) === 1 ? T : 0, eb = corner(e.b, e.c) === 1 ? T : 0;
      return {side: e.side, r: e.side === 'N' ? R(e.a - ea, e.c - T, e.b + eb, e.c) : R(e.a - ea, e.c, e.b + eb, e.c + T)};
    }
    const ca = corner(e.c, e.a) === 3 ? T : 0, cb = corner(e.c, e.b) === 3 ? T : 0;
    return {side: e.side, r: e.side === 'W' ? R(e.c - T, e.a + ca, e.c, e.b - cb) : R(e.c, e.a + ca, e.c + T, e.b - cb)};
  }).filter(q => q.r.x1 - q.r.x0 > EPS && q.r.z1 - q.r.z0 > EPS);
  return {rails, edges};
}

/** Splits a rect into equal pieces with hypot(hx, hz) <= maxR (fewest pieces). */
export function splitPiece(r: GRect, maxR = GOLF_PIECE_MAX_R - 0.005): GRect[] {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  let best: [number, number] | null = null;
  for (let nx = 1; nx <= 40 && !best; nx++) for (let nz = 1; nz <= 40; nz++) {
    if (Math.hypot(w / nx / 2, d / nz / 2) <= maxR && (!best || nx * nz < best[0] * best[1])) { best = [nx, nz]; break; }
  }
  // (the first nx that fits with its least nz is not always the fewest overall: try the transposed search too)
  for (let nz = 1; nz <= 40; nz++) for (let nx = 1; nx <= 40; nx++) {
    if (Math.hypot(w / nx / 2, d / nz / 2) <= maxR) { if (!best || nx * nz < best[0] * best[1]) best = [nx, nz]; break; }
  }
  const [nx, nz] = best ?? [Math.ceil(w), Math.ceil(d)];
  const out: GRect[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) out.push(R(r.x0 + w * i / nx, r.z0 + d * j / nz, r.x0 + w * (i + 1) / nx, r.z0 + d * (j + 1) / nz));
  return out;
}

/** Builds a planned hole into its course pieces (same frame). */
export function buildHole(plan: HolePlan): BuiltHole {
  const {rails: rr, edges} = railRects(plan.play);
  const half = GOLF_CUP_PIECE / 2, cup = R(plan.cup.x - half, plan.cup.z - half, plan.cup.x + half, plan.cup.z + half);
  const deckSrc = [...plan.play, ...plan.fill, ...rr.map(q => q.r)];
  const G = gridOf([...deckSrc, cup, ...plan.tier]);
  // cell labels: 0 none, 1 green, 2 tier, 3 cup
  const lab = new Uint8Array(Math.max(0, G.nx * G.nz));
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) {
    const x = G.cx(i), z = G.cz(j);
    if (!deckSrc.some(r => inRect(r, x, z))) continue;
    lab[j * G.nx + i] = inRect(cup, x, z) ? 3 : plan.tier.some(r => inRect(r, x, z)) ? 2 : 1;
  }
  const seen = new Uint8Array(lab.length), deck: BuiltHole['deck'] = [];
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) {
    const L = lab[j * G.nx + i];
    if (L === 0 || L === 3 || seen[j * G.nx + i]) continue;
    let i2 = i;
    while (i2 + 1 < G.nx && lab[j * G.nx + i2 + 1] === L && !seen[j * G.nx + i2 + 1]) i2++;
    let j2 = j;
    grow: while (j2 + 1 < G.nz) {
      for (let k = i; k <= i2; k++) if (lab[(j2 + 1) * G.nx + k] !== L || seen[(j2 + 1) * G.nx + k]) break grow;
      j2++;
    }
    for (let jj = j; jj <= j2; jj++) for (let k = i; k <= i2; k++) seen[jj * G.nx + k] = 1;
    for (const r of splitPiece(R(G.xs[i], G.zs[j], G.xs[i2 + 1], G.zs[j2 + 1]))) deck.push({r, tier: L === 2});
  }
  // rails: cut at the tier lines (a rail on the tier stands on its top), then into collider pieces
  const rails: BuiltHole['rails'] = [];
  for (const q of rr) {
    const alongX = q.r.x1 - q.r.x0 >= q.r.z1 - q.r.z0, lo = alongX ? q.r.x0 : q.r.z0, hi = alongX ? q.r.x1 : q.r.z1;
    const cuts = uniq([lo, hi, ...plan.tier.flatMap(t => (alongX ? [t.x0, t.x1] : [t.z0, t.z1])).filter(v => v > lo + EPS && v < hi - EPS)]);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const seg = alongX ? R(cuts[k], q.r.z0, cuts[k + 1], q.r.z1) : R(q.r.x0, cuts[k], q.r.x1, cuts[k + 1]);
      const tierOn = plan.tier.some(t => inRect(t, (seg.x0 + seg.x1) / 2, (seg.z0 + seg.z1) / 2));
      for (const r of splitPiece(seg)) rails.push({r, tier: tierOn, side: q.side});
    }
  }
  return {plan, deck, cup, rails, edges};
}

/** The hole's ball-path obstacles: rails, blocks, arch posts (rects, same frame). */
export function holeObstacles(h: BuiltHole): GRect[] {
  const A = GOLF_ARCH, posts = h.plan.arches.flatMap(a => [R(a.x - A.w / 2, a.z - A.d / 2, a.x - A.w / 2 + A.post, a.z + A.d / 2), R(a.x + A.w / 2 - A.post, a.z - A.d / 2, a.x + A.w / 2, a.z + A.d / 2)]);
  return [...h.rails.map(q => q.r), ...h.plan.blocks, ...posts];
}
/** Does the ball's line (a ball radius + `margin` wide) clear every obstacle of its hole? */
export function golfPathClear(h: BuiltHole, margin = 0.01): boolean {
  const obs = holeObstacles(h), p = h.plan.path;
  for (let k = 0; k + 1 < p.length; k++) for (const o of obs) if (segRectDist(p[k], p[k + 1], o) < GOLF_BALL_R + margin) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// The hall: rows of bays along its long axis, a promenade between them, end aisles / gaps at its openings

/** An opening of the hall on its boundary (world m): its centre, the wall it is in, half its width. */
export interface HallOpening { x: number; z: number; side: Side; half: number }
/** A hole bay (world m): its rect, the axis its row runs along, and where its tee end is. */
export interface GolfBay {
  rect: GRect;
  row: number;
  /** The row runs along world x (else z). */
  alongX: boolean;
  /** The bay's tee end is on its low (-1: rect's x0 / z0 across the row) or high (+1) side. */
  teeSide: -1 | 1;
  /** Its order along the row (low -> high). */
  a: number;
}
export interface HallPlan { bays: GolfBay[]; aisles: GRect[]; alongX: boolean; rows: number; depth: number }

/** Walking aisles: the promenade between rows, end aisles where openings are, gaps in a row in front of an opening (m). */
export const GOLF_AISLES = {wall: 0.45, promenade: 2.0, end: 2.0, gap: 0.8, between: 1.2, minBay: 3.4, maxBay: 7.0, maxDepth: 7.5} as const;

export function planHall(hall: GRect, openings: readonly HallOpening[]): HallPlan {
  const A = GOLF_AISLES, alongX = hall.x1 - hall.x0 >= hall.z1 - hall.z0;
  const a0 = alongX ? hall.x0 : hall.z0, a1 = alongX ? hall.x1 : hall.z1, b0 = alongX ? hall.z0 : hall.x0, b1 = alongX ? hall.z1 : hall.x1, B = b1 - b0;
  const endLo: Side = alongX ? 'W' : 'N', endHi: Side = alongX ? 'E' : 'S', longLo: Side = alongX ? 'N' : 'W', longHi: Side = alongX ? 'S' : 'E';
  const along = (o: HallOpening) => (alongX ? o.x : o.z);
  const rows = Math.max(1, Math.min(3, Math.floor((B - 2 * A.wall + A.promenade) / (A.minBay + 0.6 + A.promenade))));
  const band = (B - 2 * A.wall - (rows - 1) * A.promenade) / rows, depth = Math.min(A.maxDepth, band);
  const aisles: GRect[] = [];
  const toWorld = (pa0: number, pb0: number, pa1: number, pb1: number): GRect => alongX ? R(pa0, pb0, pa1, pb1) : R(pb0, pa0, pb1, pa1);
  // end aisles
  const lo = a0 + (openings.some(o => o.side === endLo) ? A.end : A.wall), hi = a1 - (openings.some(o => o.side === endHi) ? A.end : A.wall);
  if (openings.some(o => o.side === endLo)) aisles.push(toWorld(a0, b0, a0 + A.end, b1));
  if (openings.some(o => o.side === endHi)) aisles.push(toWorld(a1 - A.end, b0, a1, b1));
  const bays: GolfBay[] = [];
  const rowSpans: {row: number; bLo: number; bHi: number; teeSide: -1 | 1; free: [number, number][]}[] = [];
  for (let k = 0; k < rows; k++) {
    const s0 = b0 + A.wall + k * (band + A.promenade), s1 = s0 + band;
    // the tee end faces the promenade (row 0: its high side; the last row: its low side; a middle row: its low side)
    const teeSide: -1 | 1 = k === 0 && rows > 1 ? 1 : -1;
    const bLo = teeSide > 0 ? s1 - depth : s0, bHi = teeSide > 0 ? s1 : s0 + depth;
    if (k > 0) aisles.push(toWorld(a0, s0 - A.promenade, a1, s0));
    // gaps in front of the openings in the row's own wall (row 0: the low long wall; the last row: the high long wall)
    let free: [number, number][] = [[lo, hi]];
    for (const o of openings) {
      const own = (k === 0 && o.side === longLo) || (k === rows - 1 && o.side === longHi);
      if (!own) continue;
      const g0 = along(o) - o.half - A.gap, g1 = along(o) + o.half + A.gap;
      aisles.push(toWorld(g0, k === 0 ? b0 : s0, g1, k === 0 ? s1 : b1));
      free = free.flatMap(([f0, f1]) => [[f0, Math.min(f1, g0)], [Math.max(f0, g1), f1]] as [number, number][]).filter(([f0, f1]) => f1 - f0 > 0.01);
    }
    rowSpans.push({row: k, bLo, bHi, teeSide, free});
  }
  // bay widths: aim for 6-9 holes (wider bays when more would fit)
  const count = (target: number) => rowSpans.reduce((n, r) => n + r.free.reduce((m, [f0, f1]) => m + Math.max(0, Math.floor((f1 - f0 + A.between) / (target + A.between))), 0), 0);
  let target = 5.2;
  if (count(target) < 6) for (const t of [4.8, 4.4, 4.0, 3.7, A.minBay]) { target = t; if (count(t) >= 6) break; }
  else while (count(target) > 9 && target < 12) target += 0.3;
  for (const r of rowSpans) for (const [f0, f1] of r.free) {
    const n = Math.max(0, Math.floor((f1 - f0 + A.between) / (target + A.between)));
    if (!n) continue;
    const w = Math.min(A.maxBay, (f1 - f0 - (n - 1) * A.between) / n), gap = n > 1 ? (f1 - f0 - n * w) / (n - 1) : 0, start = n > 1 ? f0 : f0 + (f1 - f0 - w) / 2;
    for (let q = 0; q < n; q++) {
      const s = start + q * (w + gap);
      bays.push({rect: toWorld(s, r.bLo, s + w, r.bHi), row: r.row, alongX, teeSide: r.teeSide, a: s});
    }
  }
  // the promenade between rows also runs past a single row's tee end
  if (rows === 1) aisles.push(toWorld(a0, b1 - A.wall - A.promenade, a1, b1 - A.wall));
  return {bays, aisles, alongX, rows, depth};
}

/** The bays in course order: round the rows as a loop (row 0 low -> high, the next row back), starting at the bay nearest `start`. */
export function bayOrder(plan: HallPlan, start: GPt): GolfBay[] {
  const byRow = (k: number) => plan.bays.filter(b => b.row === k).sort((p, q) => p.a - q.a);
  const loop: GolfBay[] = [];
  for (let k = 0; k < plan.rows; k++) loop.push(...(k % 2 === 0 ? byRow(k) : byRow(k).reverse()));
  if (!loop.length) return loop;
  const d = (b: GolfBay) => Math.hypot((b.rect.x0 + b.rect.x1) / 2 - start.x, (b.rect.z0 + b.rect.z1) / 2 - start.z);
  const i0 = loop.reduce((bi, b, i) => (d(b) < d(loop[bi]) ? i : bi), 0);
  return [...loop.slice(i0), ...loop.slice(0, i0)];
}

/** A bay's local frame: s along its row (mirrored or not), t from its tee end (the promenade side) into the bay. */
export interface BayFrame { bw: number; bd: number; toWorld: (p: GPt) => GPt; rect: (r: GRect) => GRect; sAlongX: boolean; tDir: GPt }
export function bayFrame(b: GolfBay, mirror: boolean): BayFrame {
  const r = b.rect, alongX = b.alongX;
  const a0 = alongX ? r.x0 : r.z0, a1 = alongX ? r.x1 : r.z1, c0 = alongX ? r.z0 : r.x0, c1 = alongX ? r.z1 : r.x1;
  const bw = a1 - a0, bd = c1 - c0;
  const toWorld = (p: GPt): GPt => {
    const a = mirror ? a1 - p.x : a0 + p.x, c = b.teeSide > 0 ? c1 - p.z : c0 + p.z;
    return alongX ? P(a, c) : P(c, a);
  };
  const rect = (q: GRect): GRect => { const A = toWorld({x: q.x0, z: q.z0}), Bq = toWorld({x: q.x1, z: q.z1}); return R(A.x, A.z, Bq.x, Bq.z); };
  const tDir = alongX ? {x: 0, z: b.teeSide > 0 ? -1 : 1} : {x: b.teeSide > 0 ? -1 : 1, z: 0};
  return {bw, bd, toWorld, rect, sAlongX: alongX, tDir};
}

/** Picks a design for a bay: the first not yet used that fits (seeded order), else any that fits (the least used). */
export function planHole(bw: number, bd: number, used: Map<GolfDesign, number>, rng: Rng): HolePlan | null {
  const order = rng.shuffle(GOLF_DESIGN_IDS.slice());
  const tryOne = (d: GolfDesign): HolePlan | null => {
    const plan = GOLF_DESIGNS[d](bw, bd, rng);
    return plan && golfPathClear(buildHole(plan)) ? plan : null;
  };
  for (const d of order) if (!used.get(d)) { const p = tryOne(d); if (p) return p; }
  for (const d of order.sort((p, q) => (used.get(p) ?? 0) - (used.get(q) ?? 0))) { const p = tryOne(d); if (p) return p; }
  return null;
}
