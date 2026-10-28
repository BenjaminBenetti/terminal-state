// Iteration 08 (Lane S): WHERE filler stock stands — the boards of every stocked holder (holder-local,
// front +Z, origin bottom-centre, metres) and a deterministic dresser that fills them with believable
// facings: product blocks side by side, rows front-to-back, stacks where the package stacks, sold-out
// gaps, looted facings (front rows taken, the back ones left), the odd knocked-over can. Pure maths
// (no three.js) so placement is unit-tested: no piece overlaps another, a board, the real loot lots
// or the space above the board; every piece is seated on the deck (or on the piece below it).
//
// Real loot always comes first: a facing behind a lot stops short of it (LOT_GAP), nothing is ever
// put in front of a lot, and lots keep their own surfaces (items/lootLayout.ts) untouched.

import {mulberry32, hashString} from '../core/rng';
import {CATEGORY_SPARSE, CATEGORY_STOCK, DEFAULT_SPARSE, STOCK_ARCHES, ARCH_INDEX, type StockArch, type StockCategory} from './shelfStockCatalog';

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

/** Holder-local axis-aligned box (real loot lot extents, collision boards). */
export interface Box3Like { min: V3; max: V3 }

/** A deck stock stands on (holder-local). */
export interface Board {
  /** Free rect on the deck. */
  x0: number; x1: number; z0: number; z1: number;
  /** Nominal deck top. */
  y: number;
  /** Highest point a piece may reach (underside of whatever is above). */
  top: number;
  /**
   * Max deck height under a footprint rect, NaN when part of the rect is off the deck (measured
   * heightmap of a generated model). Absent: a flat board at `y` over the rect.
   */
  deck?: (x0: number, z0: number, x1: number, z1: number) => number;
  /**
   * 'rows': facings / rows / stacks. 'lean': thin pieces leaning back against a slanted backing
   * (magazines); `lean` = backing tilt (rad, top toward -Z), `back` = z of the backing's front face at
   * deck height. 'flat': pieces lying flat, stacked (newspaper bin). 'spots': fixed spots (`spots`
   * x/z centres: flower buckets on a stepped stand). 'hang': pieces hung on hooks (`hooks` x / y of
   * each hook rod's centre, rod radius `rod`, from the pegboard face z0 out to the tip z1; key blanks).
   */
  mode: 'rows' | 'lean' | 'flat' | 'spots' | 'hang';
  lean?: number;
  back?: number;
  spots?: [number, number][];
  hooks?: [number, number][];
  rod?: number;
  /** What this board holds when it differs from the holder's category (a key-cutting bench's key wall). */
  category?: StockCategory;
  /** Present: one label / colourway for the whole board (a crate of one fruit) — this offset plus a per-holder pick. */
  variant?: number;
  /** Filled to the brim: no sold-out gaps, no looted facings, full stacks (a crate of fruit). */
  full?: boolean;
}

/** One filler piece (holder-local). */
export interface StockPlacement {
  arch: number;
  variant: number;
  /** Centre of the piece's upright box (w x h x d), holder-local. */
  c: V3;
  /** Rotation of the piece (holder-local). */
  q: Q4;
  board: number;
  /** Index (in this holder's list) of the piece it rests on; -1 = the board. */
  on: number;
  /** Small per-piece colour jitter (0..1) for the render tint. */
  tint: number;
}

export interface DressInput {
  category: StockCategory;
  boards: readonly Board[];
  /** Real loot lots of the holder (holder-local AABBs). */
  lots: readonly Box3Like[];
  /** Deterministic seed (station seed + holder identity). */
  seed: number;
  /** Most rows deep per facing (station-wide thinning lowers it). */
  depthCap?: number;
}

/** Clearance kept around real loot lots. */
export const LOT_GAP = 0.025;
/** Iteration 12 (LOOT lane): rows deep of an intact leftover package (the rest of the facing long gone). */
export const INTACT_ROWS = 2;
/** Gap between neighbouring pieces in a facing / between facings (m). */
const GAP_SAME = 0.004, GAP_PRODUCT = 0.012, GAP_ROW = 0.006;
/** Tolerance of the overlap test (pieces may touch). */
const EPS = 0.0008;

// ---------------------------------------------------------------------------------------
// Small quaternion / OBB maths

export function qMul(a: Q4, b: Q4): Q4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export const qAxis = (ax: number, ay: number, az: number, angle: number): Q4 => {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
};
/** Rotation: yaw about Y, then tilt about the (yawed) X, then roll about Z (three.js Euler 'YXZ'). */
export const qYXZ = (yaw: number, tilt = 0, roll = 0): Q4 => qMul(qMul(qAxis(0, 1, 0, yaw), qAxis(1, 0, 0, tilt)), qAxis(0, 0, 1, roll));
/** Rotate v by unit quaternion q. */
export function qRot(q: Q4, v: V3): V3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
/** Columns of the rotation matrix of q (the box's local axes in the parent frame). */
export function qAxes(q: Q4): [V3, V3, V3] {
  return [qRot(q, [1, 0, 0]), qRot(q, [0, 1, 0]), qRot(q, [0, 0, 1])];
}

export interface OBB { c: V3; ax: [V3, V3, V3]; h: V3 }

export function placementOBB(p: StockPlacement, shrink = 0): OBB {
  const a = STOCK_ARCHES[p.arch];
  // a ball is the same whichever way it turns: its bounding cube stays square to the holder
  const ax: [V3, V3, V3] = a.collider === 'sphere' ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : qAxes(p.q);
  return {c: p.c, ax, h: [Math.max(1e-4, a.w / 2 - shrink), Math.max(1e-4, a.h / 2 - shrink), Math.max(1e-4, a.d / 2 - shrink)]};
}

/** AABB half extents of an OBB. */
export function obbExtent(o: OBB): V3 {
  const e: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) e[k] = Math.abs(o.ax[0][k]) * o.h[0] + Math.abs(o.ax[1][k]) * o.h[1] + Math.abs(o.ax[2][k]) * o.h[2];
  return e;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Separating-axis test: do two oriented boxes overlap by more than `tol`? */
export function obbOverlap(A: OBB, B: OBB, tol = EPS): boolean {
  const T: V3 = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]];
  const axes: V3[] = [...A.ax, ...B.ax];
  for (const a of A.ax) for (const b of B.ax) { const c = cross(a, b); if (dot(c, c) > 1e-10) axes.push(c); }
  for (const L of axes) {
    const len = Math.sqrt(dot(L, L));
    const ra = A.h[0] * Math.abs(dot(A.ax[0], L)) + A.h[1] * Math.abs(dot(A.ax[1], L)) + A.h[2] * Math.abs(dot(A.ax[2], L));
    const rb = B.h[0] * Math.abs(dot(B.ax[0], L)) + B.h[1] * Math.abs(dot(B.ax[1], L)) + B.h[2] * Math.abs(dot(B.ax[2], L));
    if (Math.abs(dot(T, L)) > ra + rb - tol * len) return false;
  }
  return true;
}

/** OBB vs axis-aligned box overlap (more than `tol`). */
export function obbBoxOverlap(o: OBB, b: Box3Like, tol = EPS): boolean {
  const c: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const h: V3 = [(b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2];
  return obbOverlap(o, {c, ax: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], h}, tol);
}

/**
 * Deck footprint of a placed piece (x0, z0, x1, z1): the circle's bounding square for an upright
 * round package, else the AABB of its box. The dresser seats every piece on the highest deck point
 * under this rect (generated decks are uneven), so it never sinks into a board.
 */
export function footprintRect(p: StockPlacement): [number, number, number, number] {
  const A = STOCK_ARCHES[p.arch];
  const up = qRot(p.q, [0, 1, 0]);
  if (A.collider === 'sphere' || (A.collider === 'cylinder' && up[1] > 0.999)) return [p.c[0] - A.w / 2, p.c[2] - A.d / 2, p.c[0] + A.w / 2, p.c[2] + A.d / 2];
  const e = obbExtent(placementOBB(p));
  return [p.c[0] - e[0], p.c[2] - e[2], p.c[0] + e[0], p.c[2] + e[2]];
}

/** Lowest point of a placed piece (its OBB) — what rests on the deck. */
export function placementBottom(p: StockPlacement): number {
  return p.c[1] - obbExtent(placementOBB(p))[1];
}
export function placementTop(p: StockPlacement): number {
  return p.c[1] + obbExtent(placementOBB(p))[1];
}

// ---------------------------------------------------------------------------------------
// Dressing

type Rnd = () => number;

function pickWeighted(rows: readonly (readonly [string, number])[], r: Rnd): number {
  const total = rows.reduce((s, x) => s + x[1], 0);
  let k = r() * total;
  for (const [id, w] of rows) { k -= w; if (k < 0) return ARCH_INDEX[id]; }
  return ARCH_INDEX[rows[rows.length - 1][0]];
}

const flatDeck = (b: Board) => (x0: number, z0: number, x1: number, z1: number): number =>
  x0 >= b.x0 - 1e-6 && x1 <= b.x1 + 1e-6 && z0 >= b.z0 - 1e-6 && z1 <= b.z1 + 1e-6 ? b.y : NaN;

interface Ctx {
  out: StockPlacement[];
  obbs: OBB[];
  /** AABB half extents of each placed OBB (cheap reject before the separating-axis test). */
  ext: V3[];
  lots: readonly Box3Like[];
  r: Rnd;
}

/** Adds a placement unless it overlaps a placed piece or a lot. Returns its index or -1. */
function tryAdd(ctx: Ctx, p: StockPlacement, b: Board): number {
  const o = placementOBB(p);
  const e = obbExtent(o);
  if (p.c[1] + e[1] > b.top + 1e-6) return -1;
  for (const l of ctx.lots) if (obbBoxOverlap(o, l)) return -1;
  for (let i = 0; i < ctx.obbs.length; i++) {
    const q = ctx.obbs[i], f = ctx.ext[i];
    if (Math.abs(q.c[0] - o.c[0]) >= f[0] + e[0] || Math.abs(q.c[1] - o.c[1]) >= f[1] + e[1] || Math.abs(q.c[2] - o.c[2]) >= f[2] + e[2]) continue;
    if (obbOverlap(o, q)) return -1;
  }
  ctx.out.push(p);
  ctx.obbs.push(o);
  ctx.ext.push(e);
  return ctx.out.length - 1;
}

/** Facings / rows / stacks along a shelf board. */
function dressRows(ctx: Ctx, b: Board, bi: number, category: StockCategory, depthCap: number): void {
  const {r} = ctx;
  const deck = b.deck ?? flatDeck(b);
  const weights = CATEGORY_STOCK[category];
  // Iteration 12 (LOOT lane): abandoned shelves — more sold-out bays, more looted facings, more knocked-over pieces (coolers most)
  const sparse = CATEGORY_SPARSE[category] ?? DEFAULT_SPARSE;
  let x = b.x0 + 0.003;
  let run: {arch: number; variant: number; left: number} | null = null;
  let guard = 0;
  // one colourway for the whole board (a crate of one fruit): the board's offset + a per-holder pick
  const boardV = b.variant !== undefined ? b.variant + Math.floor(r() * 997) : undefined;
  while (x < b.x1 - 0.04 && guard++ < 400) {
    // Sold-out bay: a gap, sometimes with one knocked-over package lying in it.
    if (r() < sparse.gap && !b.full) {
      const gw = 0.06 + r() * 0.16;
      if (r() < sparse.tipped) tipped(ctx, b, bi, deck, weights, x, Math.min(b.x1, x + gw));
      x += gw;
      run = null;
      continue;
    }
    if (!run || run.left <= 0) {
      // a product that fits this board (height under the board above, depth, the width left)
      run = null;
      for (let tries = 0; tries < 8 && !run; tries++) {
        const a = pickWeighted(weights, r);
        const A = STOCK_ARCHES[a];
        const big = Math.max(A.w, A.d) * 0.026; // yaw jitter allowance
        if (A.h > b.top - b.y - 0.004 || A.d + big > b.z1 - b.z0 || A.w + big > b.x1 - x) continue;
        const rv = Math.floor(r() * A.variants);
        // iteration 12: an intact (unopened) package is a leftover — one facing (now and then two), never a full block
        const left = A.look === 'intact' ? (r() < 0.25 ? 2 : 1) : A.facings[0] + Math.floor(r() * (A.facings[1] - A.facings[0] + 1));
        run = {arch: a, variant: boardV !== undefined ? boardV % A.variants : rv, left};
      }
      if (!run) break;
    }
    const A = STOCK_ARCHES[run.arch];
    const cyl = A.collider !== 'box';
    // Boxes face the aisle (tiny yaw jitter); round packages turn their label roughly forward.
    const yaw = cyl ? (r() - 0.5) * 0.7 : (r() - 0.5) * 0.05;
    const ex = cyl ? A.w / 2 : (Math.abs(Math.cos(yaw)) * A.w + Math.abs(Math.sin(yaw)) * A.d) / 2;
    const ez = cyl ? A.d / 2 : (Math.abs(Math.sin(yaw)) * A.w + Math.abs(Math.cos(yaw)) * A.d) / 2;
    if (x + 2 * ex > b.x1) {
      // does not fit the rest of the board: try a narrower product once, else stop
      run = null;
      if (b.x1 - x < 0.09) break;
      x += 0.01;
      continue;
    }
    const a0 = x, a1 = x + 2 * ex, cx = (a0 + a1) / 2;
    // Real loot on this board in front of the facing: the facing stops short of it.
    let zf = b.z1;
    for (const l of ctx.lots) {
      if (l.max[0] <= a0 - LOT_GAP || l.min[0] >= a1 + LOT_GAP) continue;
      if (l.max[1] < b.y - 0.03 || l.min[1] > b.top) continue;
      zf = Math.min(zf, l.min[2] - LOT_GAP);
    }
    const pitch = 2 * ez + GAP_ROW;
    const rows = Math.min(A.look === 'intact' ? INTACT_ROWS : A.depth, depthCap, Math.floor((zf - b.z0 + GAP_ROW) / pitch));
    // Looted facing: the front packages are gone (the back one usually left behind).
    const taken = r() < sparse.taken && !b.full ? (rows > 1 ? 1 + Math.floor(r() * (rows - 1)) : r() < 0.4 ? 1 : 0) : 0;
    for (let k = 0; k < rows; k++) {
      if (k < taken) continue;
      const zc = zf - ez - k * pitch - 0.002;
      if (zc - ez < b.z0 - 1e-6) break;
      const dy = deck(a0, zc - ez, a1, zc + ez);
      if (!Number.isFinite(dy)) continue;
      const maxStack = Math.max(1, Math.min(A.stack, Math.floor((b.top - dy) / (A.h + 0.002))));
      const levels = A.stack > 1 && A.look !== 'intact' ? Math.max(1, maxStack - (r() < 0.3 && !b.full ? 1 : 0)) : 1;
      let below = -1, y = dy + 0.0015;
      for (let s = 0; s < levels; s++) {
        const j = s ? (r() - 0.5) * 0.04 : 0;
        const p: StockPlacement = {arch: run.arch, variant: run.variant, c: [cx + (s ? (r() - 0.5) * 0.004 : 0), y + A.h / 2, zc], q: qYXZ(yaw + j), board: bi, on: below, tint: r()};
        const i = tryAdd(ctx, p, b);
        if (i < 0) break;
        below = i;
        y += A.h + 0.0015;
      }
    }
    run.left--;
    x = a1 + (run.left > 0 ? GAP_SAME : GAP_PRODUCT + r() * 0.012);
  }
}

/** A package knocked over in a sold-out gap (cans / bottles roll onto their side). */
function tipped(ctx: Ctx, b: Board, bi: number, deck: NonNullable<Board['deck']>, weights: readonly (readonly [string, number])[], x0: number, x1: number): void {
  const {r} = ctx;
  const a = pickWeighted(weights, r);
  const A = STOCK_ARCHES[a];
  if (A.collider !== 'cylinder' || A.h > x1 - x0 - 0.01) return;
  const cx = x0 + (x1 - x0) / 2, zc = Math.min(b.z1, b.z0 + (b.z1 - b.z0) * (0.55 + r() * 0.3)) - A.d / 2;
  const yaw = (r() - 0.5) * 0.5;
  const p: StockPlacement = {arch: a, variant: Math.floor(r() * A.variants), c: [cx, 0, zc], q: qYXZ(yaw, 0, Math.PI / 2), board: bi, on: -1, tint: r()};
  const f = footprintRect(p);
  if (f[0] < b.x0 || f[2] > b.x1 || f[1] < b.z0 || f[3] > b.z1) return;
  const dy = deck(f[0], f[1], f[2], f[3]);
  if (!Number.isFinite(dy)) return;
  p.c[1] = dy + 0.0015 + obbExtent(placementOBB(p))[1];
  // real loot first: a knocked-over piece never lies in front of a lot (iteration 12: coolers tip far more of them)
  const top = p.c[1] + obbExtent(placementOBB(p))[1];
  for (const l of ctx.lots) {
    if (l.max[0] <= f[0] - LOT_GAP || l.min[0] >= f[2] + LOT_GAP || l.max[1] < dy - 0.03 || l.min[1] > top) continue;
    if (f[3] > l.min[2] - LOT_GAP) return;
  }
  tryAdd(ctx, p, b);
}

/** Thin pieces (magazines) leaning back against a slanted backing, a few copies deep. */
function dressLean(ctx: Ctx, b: Board, bi: number, category: StockCategory): void {
  const {r} = ctx;
  const weights = CATEGORY_STOCK[category];
  const lean = b.lean ?? 0.3, back = b.back ?? b.z0;
  let x = b.x0 + 0.004;
  while (x < b.x1 - 0.05) {
    const a = pickWeighted(weights, r);
    const A = STOCK_ARCHES[a];
    if (x + A.w > b.x1) break;
    if (r() < 0.25) { x += A.w * (0.5 + r() * 0.6); continue; } // sold-out title (iteration 12: a picked-over rack)
    const variant = Math.floor(r() * A.variants);
    const copies = 1 + Math.floor(r() * 3);
    const cx = x + A.w / 2;
    // The pile leans at the backing tilt (top toward -Z). Copy k: its back face on the backing plane
    // pushed k thicknesses forward (it leans on the copy behind it), its bottom-back edge (the
    // lowest edge of a back-leaning sheet) on the ledge.
    const q = qYXZ(0, -lean);
    const up = qRot(q, [0, 1, 0]), fwd = qRot(q, [0, 0, 1]);
    const g = 0.0012, cosL = Math.cos(lean);
    let below = -1;
    for (let k = 0; k < copies; k++) {
      const ez = back + 0.002 + k * (A.d + g) / cosL;
      const c: V3 = [cx, b.y + 0.0012 + up[1] * A.h / 2 + fwd[1] * A.d / 2, ez + up[2] * A.h / 2 + fwd[2] * A.d / 2];
      // bottom-front edge must stay behind the ledge lip
      if (ez + fwd[2] * A.d > b.z1) break;
      const p: StockPlacement = {arch: a, variant: k === copies - 1 ? variant : Math.floor(r() * A.variants), c, q, board: bi, on: below, tint: r()};
      const i = tryAdd(ctx, p, b);
      if (i < 0) break;
      below = i;
    }
    x += A.w + 0.012 + r() * 0.01;
  }
}

/** Pieces lying flat in small stacks (newspapers in a bin). */
function dressFlat(ctx: Ctx, b: Board, bi: number, category: StockCategory): void {
  const {r} = ctx;
  const weights = category === 'magazines' ? [['news', 1] as const] : CATEGORY_STOCK[category];
  let x = b.x0 + 0.004;
  while (x < b.x1 - 0.1) {
    const a = pickWeighted(weights, r);
    const A = STOCK_ARCHES[a];
    if (x + A.w > b.x1) break;
    const zc = Math.min(b.z1 - A.d / 2, (b.z0 + b.z1) / 2 + (r() - 0.5) * 0.02);
    const levels = 1 + Math.floor(r() * Math.max(1, Math.min(A.stack, Math.floor((b.top - b.y) / A.h))));
    let below = -1, y = b.y + 0.0015;
    for (let s = 0; s < levels; s++) {
      const p: StockPlacement = {arch: a, variant: Math.floor(r() * A.variants), c: [x + A.w / 2 + (r() - 0.5) * 0.01, y + A.h / 2, zc], q: qYXZ((r() - 0.5) * 0.08), board: bi, on: below, tint: r()};
      const i = tryAdd(ctx, p, b);
      if (i < 0) break;
      below = i;
      y += A.h + 0.0015;
    }
    x += A.w + 0.015 + r() * 0.02;
  }
}

/** One piece per fixed spot (flower buckets), some spots sold out. */
function dressSpots(ctx: Ctx, b: Board, bi: number, category: StockCategory): void {
  const {r} = ctx;
  const weights = CATEGORY_STOCK[category];
  for (const [sx, sz] of b.spots ?? []) {
    if (r() < 0.22) continue; // iteration 12: emptier stands
    const a = pickWeighted(weights, r);
    const A = STOCK_ARCHES[a];
    // jitter kept inside the step's own band (a bucket as wide as its step never leans into the riser behind it)
    const jx = (r() - 0.5) * 0.02, jz = (r() - 0.5) * 0.02;
    const cz = Math.max(Math.min(sz + jz, b.z1 - A.d / 2), Math.min(sz, b.z0 + A.d / 2));
    const cx = Math.max(Math.min(sx + jx, b.x1 - A.w / 2), Math.min(sx, b.x0 + A.w / 2));
    const p: StockPlacement = {arch: a, variant: Math.floor(r() * A.variants), c: [cx, b.y + 0.0015 + A.h / 2, cz], q: qYXZ(r() * Math.PI * 2), board: bi, on: -1, tint: r()};
    tryAdd(ctx, p, b);
  }
}

/**
 * Pieces hung on pegboard hooks (key blanks): one to three per hook from the board face outwards,
 * each just under its rod (the ring round the rod), hanging plumb with a little swing; some hooks
 * sold out.
 */
function dressHang(ctx: Ctx, b: Board, bi: number, category: StockCategory): void {
  const {r} = ctx;
  const weights = CATEGORY_STOCK[category];
  const rod = b.rod ?? 0.002;
  for (const [hx, hy] of b.hooks ?? []) {
    if (r() < 0.15) continue;
    const a = pickWeighted(weights, r);
    const A = STOCK_ARCHES[a];
    const copies = 1 + Math.floor(r() * Math.min(3, A.depth));
    // spaced by the collider thickness (no overlapping bodies when woken), the first one against the board
    const pitch = A.d * (A.fit?.[2] ?? 1) + 0.0015;
    for (let k = 0; k < copies; k++) {
      const zc = b.z0 + 0.004 + pitch / 2 + k * pitch;
      if (zc + A.d / 2 > b.z1) break;
      const swing = (r() - 0.5) * 0.12, yaw = (r() - 0.5) * 0.16;
      // top of the swung blank 1.5 mm under the rod
      const lift = Math.abs(Math.sin(swing)) * A.w / 2 + Math.cos(swing) * A.h / 2;
      const p: StockPlacement = {arch: a, variant: Math.floor(r() * A.variants), c: [hx + (r() - 0.5) * 0.002, hy - rod - 0.0015 - lift, zc], q: qYXZ(yaw, 0, swing), board: bi, on: -1, tint: r()};
      tryAdd(ctx, p, b);
    }
  }
}

/** Fill every board of a holder. Deterministic for a given input. */
export function dressHolder(input: DressInput): StockPlacement[] {
  const ctx: Ctx = {out: [], obbs: [], ext: [], lots: input.lots, r: mulberry32(input.seed >>> 0)};
  input.boards.forEach((b, i) => {
    const cat = b.category ?? input.category;
    if (b.mode === 'rows') dressRows(ctx, b, i, cat, input.depthCap ?? 3);
    else if (b.mode === 'lean') dressLean(ctx, b, i, cat);
    else if (b.mode === 'flat') dressFlat(ctx, b, i, cat);
    else if (b.mode === 'hang') dressHang(ctx, b, i, cat);
    else dressSpots(ctx, b, i, cat);
  });
  return ctx.out;
}

/** Seed of a holder's stock: station seed + prop identity (position / kind), stable across rebuilds. */
export function holderStockSeed(stationSeed: number, kind: string, x: number, z: number, y: number): number {
  return hashString(`stock:${kind}:${Math.round(x * 100)}:${Math.round(z * 100)}:${Math.round(y * 100)}`, stationSeed >>> 0);
}

export type {StockArch};
