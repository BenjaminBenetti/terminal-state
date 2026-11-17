// Task studio-market-irregular-envelope-20261116-210503-01: THE SURVIVOR MARKET, layout version 6 — version 5's crevice settlement
// (gen/market/v5/) inside an IRREGULAR ENVELOPE. User, after playing version 5: "very very nice. You've captured the vibe perfectly. We
// just need to make things less square! The market is still a large square! even with the bridges between sides. Looking up or down,
// its very obviously has a square ceiling. We need to just put some non uniformity in to it! Then it will be perfect!"
//
// Version 5's settlement stays as it is (its converted containers, terraces, stairs, bridges, shops, bar, den, the flat way from the
// train). What changes is the concrete and rock that enclose it, so no view up, down or along the crevice shows one big box:
//  - OVERHEAD: no flat lid at 19.5 m. A stepped SLOT zig-zags down the crevice (each stretch its own sideways offset, width and height;
//    the end stretches lower, so the crevice closes over its square and its weir). Each rock face steps out under it in concrete LEDGES
//    (each side its own count, widths, heights and breaks, staggered against the other side's), down to OVERHANGS 3.55 m over the top
//    terrace. One or two slanting concrete RIBS cross part or all of the width. No edge runs dead straight: the slot runs diagonally
//    from one stretch's line into the next, every slot / ledge edge wanders row by row, and a few ragged rock POCKETS cut the overhead
//    higher or hang it lower.
//  - THE UPPER FACES: deep rock-cut ALCOVES where the top terrace's container row gives way (uneven setbacks into the rock), and every
//    top-storey nook a sheltered alcove under its own soffit (no rod or lamp hangs from the open void).
//  - THE ENDS: a high CLEFT cut into each end wall above the settlement (over the platform hall's vault; past the weir), stepped narrower
//    and lower as it goes in. Its floor is out of reach (well over the top terrace): nobody walks there.
//  - DOWN: the chasm's bed is no longer one flat rectangle. Rubble SHELVES at stepped depths run along both walls (a lip under each walk
//    edge, deeper shelves beyond), and a deep CLEFT winds between them, changing direction down the crevice. Every shelf stays more
//    than a railing's drop below the walks, so the chasm keeps its railings.
// Pure data: a seeded plan on its own stream (gen/market/v5/index.ts forks it: version 5's draws never move) and its stamp onto the
// carve's grids. Canonical cells (the west side's frame, gen/market/v5/frame.ts); the stamp mirrors.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, SOLID, VOID, type Grid} from '../../grid';
import type {Level, RailRun} from '../../levels';
import {CREVICE, type creviceRows} from '../v5/frame';
import type {CreviceSettlement} from '../v7/settlement';

type Rows = ReturnType<typeof creviceRows>;

/** Fixed numbers of the envelope (m unless noted; cells for widths / rows). */
export const ENVELOPE = {
  /** A version-6 kit's canvas rows (version 5's 134 + room for the south cleft). */
  canvasH: 146,
  /** The lowest soffit over any open crevice column (3.55 m over the top terrace's walk at 8.85 m, 0.6 m over its boxes' roof line),
   *  the highest. */
  low: 12.4,
  high: 23,
  /** Overhead surfaces at or above this are the raw rock; below it the concrete ledges, ribs and soffits (world/marketArch.ts). */
  rock: 19,
  /** Height quantum (m). */
  q: 0.05,
  /** Stretches down the crevice, the shortest (rows). */
  stretches: [5, 7] as const,
  minStretch: 10,
  /** The slot: sideways offset from the centre line, half widths (cells), height (the end stretches lower), the shoulder under it. */
  slot: {off: [3, 10] as const, half: [3, 7] as const, h: [20.4, 23] as const, end: [17.6, 19.4] as const, shoulder: [1, 2.4] as const, flip: 0.8,
    /** The share of a stretch's rows holding its own edges (the rest: a diagonal run into the next stretch's). */
    hold: 0.4},
  /** Ledges per side and stretch: count, the step down each (m), widths (cells; the outermost wider), the stagger of their breaks
   *  against the slot's (rows). */
  ledge: {n: [1, 3] as const, step: [1.2, 3.2] as const, w: [2, 6] as const, outer: [2, 9] as const, stagger: 4},
  /** How far (cells) the slot's and each ledge's edge wanders from row to row (walk). */
  jitter: {slot: 1, ledge: 2},
  /** Transverse ribs: count, thickness (rows), height, kept off the ends (rows), apart (rows), slant (rows per column, at most). */
  rib: {n: [1, 2] as const, t: [3, 5] as const, h: [14.6, 16.6] as const, margin: 12, apart: 10, slope: 0.35},
  /** Rock pockets: count; 2-3 overlapping patches each (cells); the share cut higher (cavities); how much higher / lower (m). */
  pocket: {n: [5, 9] as const, w: [2, 5] as const, up: 0.6, rise: [0.9, 2.2] as const, drop: [0.8, 1.6] as const},
  /** Top-terrace alcoves: per side 1 or 2, rows long, extra depth into the rock past the band (cells), soffit. */
  alcove: {len: [8, 13] as const, deep: [2, 4] as const, soffit: [12.6, 13.6] as const},
  /** Any other top-storey nook's soffit. */
  nook: [12.5, 13.3] as const,
  /** End clefts: floor, rows deep, columns wide, the mouth's ceiling, the inner part's step down / narrowing (cells). */
  cleft: {floor: [12.2, 13.2] as const, rows: [5, 8] as const, w: [10, 20] as const, ceil: [16, 19] as const, step: [1.4, 2.6] as const, narrow: [2, 5] as const},
  /** The chasm's bed: the lip under each walk edge (cells wide, depth), the shelves, the winding cleft (width cells, depth), the
   *  stretches of a side's shelves (rows). Every value at or below `lipMax` (> RAIL_DROP 1.3 under the walks: railed). */
  bed: {lip: [0, 2] as const, lipD: [-2.5, -1.8] as const, shelf: [-4.4, -3] as const, cleftW: [3, 5] as const, cleftD: [-6.9, -5.8] as const, run: [6, 14] as const, turns: [3, 5] as const, lipMax: -1.8},
} as const;

/** One end cleft part (canonical cells): a storey-3 VOID box over rock, its floor and ceiling (m). */
export interface CleftPart { x: number; y: number; w: number; h: number; floor: number; ceil: number }

/** One top-terrace alcove request: the carve takes the first candidate row that fits. */
export interface AlcovePlan { side: 'W' | 'E'; len: number; deep: number; soffit: number; rows: number[] }

/** The seeded envelope of one version-6 crevice (canonical cells). */
export interface CreviceEnvelope {
  W: number;
  H: number;
  /** Overhead height per canvas cell over the crevice's rows (NaN elsewhere). */
  over: Float32Array;
  /** The chasm's bed height per canvas cell (NaN off the chasm). */
  bed: Float32Array;
  alcoves: AlcovePlan[];
  /** Soffits for the other top-storey nooks, in carve order (cycled). */
  nooks: number[];
  clefts: CleftPart[];
  /** QA: the slot's stretches (rows, columns, height), the ribs. */
  stretches: {y0: number; y1: number; x0: number; x1: number; h: number}[];
  ribs: {y0: number; y1: number; x0: number; x1: number; h: number; slope: number}[];
}

const qh = (v: number) => Math.round(v / ENVELOPE.q) * ENVELOPE.q;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Breaks of `n` stretches over [a, b) (weights 0.7-1.3, each at least `min` long). */
function breaks(r: Rng, a: number, b: number, n: number, min: number): number[] {
  const w = Array.from({length: n}, () => r.range(0.7, 1.3)), sum = w.reduce((p, q) => p + q, 0);
  const out = [a];
  let acc = 0;
  for (let k = 0; k < n - 1; k++) { acc += w[k]; out.push(a + Math.round((b - a) * acc / sum)); }
  out.push(b);
  for (let k = 1; k < n; k++) out[k] = Math.max(out[k], out[k - 1] + min);
  for (let k = n - 1; k >= 1; k--) out[k] = Math.min(out[k], out[k + 1] - min);
  return out;
}
/** The stretch holding row y (index into breaks). */
function stretchOf(b: readonly number[], y: number): number {
  let k = 0;
  while (k + 2 < b.length && y >= b[k + 1]) k++;
  return k;
}
/** A bounded random walk, one value per row: a step of -1 / 0 / +1 every 2-4 rows, within [-a, a]. Rock edges
 *  wander with it instead of running dead straight. */
function walk(r: Rng, n: number, a: number): Int8Array {
  const out = new Int8Array(n);
  let v = r.int(-a, a), hold = 0;
  for (let i = 0; i < n; i++) {
    if (hold-- <= 0) { v = clamp(v + r.int(-1, 1), -a, a); hold = r.int(1, 3); }
    out[i] = v;
  }
  return out;
}

/** The envelope of a version-6 crevice: its frame's rows / columns `R` (gen/market/v5/frame.ts creviceRows), the canvas size, the
 *  envelope's own stream. `plan` (layout version 7, task studio-market-irregular-settlement-20261117-003819-01): the irregular settlement,
 *  whose pit's edges the chasm bed follows row by row (the same draws: absent, version 6's bed exactly). */
export function creviceEnvelope(R: Rows, W: number, H: number, r: Rng, plan?: CreviceSettlement): CreviceEnvelope {
  const E = ENVELOPE, S = CREVICE;
  // the open crevice's columns over the top terrace: [wallW, wallE) (the storey-3 walks' outer columns), its centre line
  const wallW = R.x0 + S.pitch + 1, wallE = R.x1 - S.pitch - 1, xm = (R.xc0 + R.xc1) / 2;
  const over = new Float32Array(W * H).fill(NaN), bed = new Float32Array(W * H).fill(NaN);

  // --- the slot's stretches (zig-zag), the ledges per side (staggered breaks), the shoulders ------------------------------------
  const N = r.int(E.stretches[0], E.stretches[1]);
  const b = breaks(r, R.z0, R.z1, N, E.minStretch);
  const stretches: CreviceEnvelope['stretches'] = [];
  let dir = r.chance(0.5) ? 1 : -1;
  for (let k = 0; k < N; k++) {
    const end = k === 0 || k === N - 1;
    if (k > 0 && r.chance(E.slot.flip)) dir = -dir;
    const c = xm + dir * r.int(E.slot.off[0], E.slot.off[1]);
    let x0 = Math.round(c - r.int(E.slot.half[0], E.slot.half[1])), x1 = Math.round(c + r.int(E.slot.half[0], E.slot.half[1]));
    x0 = Math.max(x0, wallW + 8); x1 = Math.min(x1, wallE - 8);
    if (x1 - x0 < 6) { const m = Math.round((x0 + x1) / 2); x0 = m - 3; x1 = m + 3; }
    stretches.push({y0: b[k], y1: b[k + 1], x0, x1, h: qh(end ? r.range(E.slot.end[0], E.slot.end[1]) : r.range(E.slot.h[0], E.slot.h[1]))});
  }
  type Side = {b: number[]; shoulder: number[]; ledges: {w: number; h: number}[][]};
  const sides: Record<'W' | 'E', Side> = {W: {b: [], shoulder: [], ledges: []}, E: {b: [], shoulder: [], ledges: []}};
  for (const s of ['W', 'E'] as const) {
    const sd = sides[s];
    sd.b = b.map((y, k) => (k === 0 || k === N ? y : y + r.int(-E.ledge.stagger, E.ledge.stagger)));
    for (let k = 1; k < N; k++) sd.b[k] = clamp(sd.b[k], sd.b[k - 1] + 4, b[N] - 4 * (N - k));
    for (let k = 0; k < N; k++) {
      const sh = stretches[k].h - r.range(E.slot.shoulder[0], E.slot.shoulder[1]);
      const n = r.int(E.ledge.n[0], E.ledge.n[1]);
      const list: {w: number; h: number}[] = [];
      let h = sh;
      for (let j = 0; j < n; j++) {
        h -= r.range(E.ledge.step[0], E.ledge.step[1]);
        const outer = j === n - 1;
        list.unshift({w: outer ? r.int(E.ledge.outer[0], E.ledge.outer[1]) : r.int(E.ledge.w[0], E.ledge.w[1]), h: qh(Math.max(E.low, h))});
      }
      sd.shoulder.push(qh(sh));
      sd.ledges.push(list);
    }
  }
  // the slot bends: its centre / edges hold through the middle of a stretch and run diagonally into the next stretch's; every edge
  // (the slot's, each ledge's) wanders row by row
  const nRows = R.z1 - R.z0, mid = (k: number) => (b[k] + b[k + 1]) / 2, plat = (k: number) => (b[k + 1] - b[k]) * E.slot.hold / 2;
  /** The slot's edge on row y: its stretch's own on the stretch's middle plateau, a straight run to the neighbour's plateau between. */
  const slotEdge = (y: number, e: 'x0' | 'x1') => {
    const yc = y + 0.5, k = stretchOf(b, y), m = mid(k), p = plat(k);
    if (Math.abs(yc - m) <= p) return stretches[k][e];
    const k2 = yc < m ? k - 1 : k + 1;
    if (k2 < 0 || k2 >= N) return stretches[k][e];
    const a = yc < m ? m - p : m + p, c = yc < m ? mid(k2) + plat(k2) : mid(k2) - plat(k2);
    const t = clamp((yc - a) / (c - a), 0, 1);
    return Math.round(stretches[k][e] + (stretches[k2][e] - stretches[k][e]) * t);
  };
  const wSlot0 = walk(r, nRows, E.jitter.slot), wSlot1 = walk(r, nRows, E.jitter.slot);
  const wLedge = {W: sides.W.ledges.map(() => [0, 1, 2].map(() => walk(r, nRows, E.jitter.ledge))), E: sides.E.ledges.map(() => [0, 1, 2].map(() => walk(r, nRows, E.jitter.ledge)))};
  for (let y = R.z0; y < R.z1; y++) {
    const st = stretches[stretchOf(b, y)], j = y - R.z0;
    let sx0 = slotEdge(y, 'x0') + wSlot0[j], sx1 = slotEdge(y, 'x1') + wSlot1[j];
    sx0 = Math.max(sx0, wallW + 6); sx1 = Math.min(sx1, wallE - 6);
    if (sx1 - sx0 < 5) { const m = Math.round((sx0 + sx1) / 2); sx0 = m - 2; sx1 = m + 3; }
    for (let x = 0; x < W; x++) {
      let h: number;
      if (x >= sx0 && x < sx1) h = st.h;
      else {
        const s: 'W' | 'E' = x < sx0 ? 'W' : 'E', sd = sides[s], k = stretchOf(sd.b, y);
        const d = s === 'W' ? x - wallW : wallE - 1 - x;
        h = sd.shoulder[k];
        let D = 0;
        const ls = sd.ledges[k];
        for (let q = 0; q < ls.length; q++) {
          const edge = Math.max(D + 1, D + ls[q].w + wLedge[s][k][q][j]);
          if (d < edge) { h = ls[q].h; break; }
          D = edge;
        }
        h = Math.min(h, st.h - 0.6); // (the slot stays the highest across its row)
      }
      over[y * W + x] = h;
    }
  }
  // --- ribs: a concrete beam slanting across part or all of the width, lower than the slot ----------------------------------------
  const ribs: CreviceEnvelope['ribs'] = [];
  const nR = r.int(E.rib.n[0], E.rib.n[1]);
  for (let t = 0; t < 20 && ribs.length < nR; t++) {
    const th = r.int(E.rib.t[0], E.rib.t[1]), y0 = r.int(R.z0 + E.rib.margin, R.z1 - E.rib.margin - th);
    const h = qh(r.range(E.rib.h[0], E.rib.h[1]));
    const span = r.next(), slope = r.range(-E.rib.slope, E.rib.slope);
    const x0 = span < 0.55 ? wallW : span < 0.775 ? wallW : Math.round(xm - r.int(2, 10));
    const x1 = span < 0.55 ? wallE : span < 0.775 ? Math.round(xm + r.int(2, 10)) : wallE;
    if (ribs.some(q => y0 < q.y1 + E.rib.apart && y0 + th > q.y0 - E.rib.apart)) continue;
    ribs.push({y0, y1: y0 + th, x0, x1, h, slope});
  }
  for (const rb of ribs) for (let x = rb.x0; x < rb.x1; x++) {
    const dy = Math.round((x - (rb.x0 + rb.x1) / 2) * rb.slope);
    for (let y = rb.y0 + dy; y < rb.y1 + dy; y++) if (y >= R.z0 && y < R.z1) over[y * W + x] = Math.min(over[y * W + x], rb.h);
  }
  // --- rock pockets: a few ragged patches of the overhead cut higher (cavities) or hanging lower (rock drops) ---------------------
  const nP = r.int(E.pocket.n[0], E.pocket.n[1]);
  for (let p = 0; p < nP; p++) {
    const cx = r.int(wallW + 2, wallE - 3), cy = r.int(R.z0 + 4, R.z1 - 5);
    const dh = r.chance(E.pocket.up) ? r.range(E.pocket.rise[0], E.pocket.rise[1]) : -r.range(E.pocket.drop[0], E.pocket.drop[1]);
    const parts = r.int(2, 3), hit = new Set<number>();
    for (let q = 0; q < parts; q++) {
      const w = r.int(E.pocket.w[0], E.pocket.w[1]), h = r.int(E.pocket.w[0], E.pocket.w[1]);
      const px = cx + r.int(-2, 2) - (w >> 1), py = cy + r.int(-2, 2) - (h >> 1);
      for (let y = Math.max(R.z0, py); y < Math.min(R.z1, py + h); y++) for (let x = Math.max(wallW, px); x < Math.min(wallE, px + w); x++) hit.add(y * W + x);
    }
    for (const i of hit) over[i] += dh;
  }
  for (let y = R.z0; y < R.z1; y++) for (let x = 0; x < W; x++) over[y * W + x] = qh(clamp(over[y * W + x], E.low, E.high));

  // --- the end clefts: storey-3 voids into the rock over the hall's vault (north) and past the south wall ---------------------------
  const clefts: CleftPart[] = [];
  for (const north of [true, false]) {
    const w = r.int(E.cleft.w[0], E.cleft.w[1]), c = Math.round(xm + r.int(-12, 12));
    const x0 = clamp(c - (w >> 1), wallW + 1, wallE - 1 - w), x1 = x0 + w;
    const rows = r.int(E.cleft.rows[0], E.cleft.rows[1]), mouth = Math.ceil(rows / 2);
    const floor = qh(r.range(E.cleft.floor[0], E.cleft.floor[1]));
    const c1 = qh(r.range(E.cleft.ceil[0], E.cleft.ceil[1])), c2 = qh(Math.max(floor + 2.4, c1 - r.range(E.cleft.step[0], E.cleft.step[1])));
    const n = r.int(E.cleft.narrow[0], E.cleft.narrow[1]), west = r.chance(0.5);
    const ix0 = west ? x0 + n : x0, ix1 = west ? x1 : x1 - n;
    // (north: the hall's south wall row R.pw and the rows over the vault behind it; south: the south wall row R.z1 and beyond)
    const m0 = north ? R.pw - mouth + 1 : R.z1, i0 = north ? R.pw - rows + 1 : R.z1 + mouth;
    clefts.push({x: x0, y: m0, w: x1 - x0, h: mouth, floor, ceil: c1});
    clefts.push({x: ix0, y: i0, w: ix1 - ix0, h: rows - mouth, floor, ceil: c2});
  }

  // --- the chasm's bed: a winding cleft between stepped shelves ----------------------------------------------------------------------
  const cw = R.xc1 - R.xc0, y0c = R.chasm0, y1c = R.chasm1;
  const turns = r.int(E.bed.turns[0], E.bed.turns[1]);
  const ctl: {y: number; x: number; w: number; d: number}[] = [];
  let side = r.chance(0.5) ? 1 : -1;
  for (let k = 0; k <= turns + 1; k++) {
    const y = k === 0 ? y0c : k === turns + 1 ? y1c : Math.round(y0c + (y1c - y0c) * (k + r.range(-0.3, 0.3)) / (turns + 1));
    side = -side;
    ctl.push({y, x: xm + side * r.range(1, Math.max(1.2, cw / 2 - 2.5)), w: r.int(E.bed.cleftW[0], E.bed.cleftW[1]), d: qh(r.range(E.bed.cleftD[0], E.bed.cleftD[1]))});
  }
  /** One side's shelves down the chasm: runs of rows, each its lip (cells wide, depth) and its shelf's depth. */
  const shelfRuns = () => {
    const runs: {y0: number; y1: number; lip: number; lipD: number; d: number}[] = [];
    for (let y = y0c; y < y1c;) {
      const n = r.int(E.bed.run[0], E.bed.run[1]);
      runs.push({y0: y, y1: Math.min(y1c, y + n), lip: r.int(E.bed.lip[0], E.bed.lip[1]), lipD: qh(r.range(E.bed.lipD[0], E.bed.lipD[1])), d: qh(r.range(E.bed.shelf[0], E.bed.shelf[1]))});
      y += n;
    }
    return runs;
  };
  const runsW = shelfRuns(), runsE = shelfRuns();
  // (the cleft's banks and the lips' edges wander row by row too)
  const wBank0 = walk(r, y1c - y0c, 1), wBank1 = walk(r, y1c - y0c, 1), wLipW = walk(r, y1c - y0c, 1), wLipE = walk(r, y1c - y0c, 1);
  for (let y = y0c; y < y1c; y++) {
    let k = 0;
    while (k + 2 < ctl.length && y >= ctl[k + 1].y) k++;
    const A = ctl[k], B = ctl[k + 1], t = B.y > A.y ? (y - A.y) / (B.y - A.y) : 0;
    // (version 7: the pit's own edges on this row, the cleft kept inside them)
    const px0 = plan ? R.xc0 + plan.pit.W[y] : R.xc0, px1 = plan ? R.xc1 - plan.pit.E[y] : R.xc1;
    const hw = (t < 0.5 ? A.w : B.w) / 2, cd = A.d, j = y - y0c;
    const cx = plan ? clamp(A.x + (B.x - A.x) * t, px0 + hw + 0.5, Math.max(px0 + hw + 0.5, px1 - hw - 0.5)) : A.x + (B.x - A.x) * t;
    const rw = runsW.find(q => y >= q.y0 && y < q.y1)!, re = runsE.find(q => y >= q.y0 && y < q.y1)!;
    const lw = Math.max(0, rw.lip + wLipW[j]), le = Math.max(0, re.lip + wLipE[j]);
    for (let x = px0; x < px1; x++) {
      let d: number;
      if (x + 0.5 > cx - hw + wBank0[j] && x + 0.5 < cx + hw + wBank1[j]) d = cd;
      else if (x + 0.5 < cx) d = x - px0 < lw ? rw.lipD : rw.d;
      else d = px1 - 1 - x < le ? re.lipD : re.d;
      bed[y * W + x] = qh(Math.min(E.bed.lipMax, d));
    }
  }

  // --- the top terrace's alcoves (one side one, the other one or two), the other top nooks' soffits ------------------------------------
  const alcoves: AlcovePlan[] = [];
  const nW = r.chance(0.5) ? 1 : 2, nE = nW === 2 ? 1 : r.chance(0.5) ? 1 : 2;
  for (const [s, n] of [['W', nW], ['E', nE]] as const) for (let j = 0; j < n; j++) {
    const len = r.int(E.alcove.len[0], E.alcove.len[1]);
    const rows: number[] = [];
    for (let t = 0; t < 24; t++) rows.push(r.int(R.z0 + 4, R.z1 - 4 - len));
    alcoves.push({side: s, len, deep: r.int(E.alcove.deep[0], E.alcove.deep[1]), soffit: qh(r.range(E.alcove.soffit[0], E.alcove.soffit[1])), rows});
  }
  const nooks = Array.from({length: 8}, () => qh(r.range(E.nook[0], E.nook[1])));
  return {W, H, over, bed, alcoves, nooks, clefts, stretches, ribs};
}

/** Rock kept between an end cleft's floor and any band under it (m). */
export const CLEFT_SLAB = 2;

/** What the stamp did (QA / the record). */
export interface EnvelopeStamp { overhead: number; low: number; high: number; bed: number; deepest: number; clefts: number }

/**
 * Stamps the envelope onto a carved crevice's storey grids (world cells; `mirror` flips the canonical columns): every open column that
 * ends at the crevice's top (`top`) takes its overhead height; every chasm cell (storey-0 VOID inside the chasm) its bed; each end
 * cleft becomes storey-3 VOID where that storey is rock and every other storey's band there stays at least `CLEFT_SLAB` m under the
 * cleft's floor (rock between: over the platform hall's 7.2 m vault).
 */
export function stampEnvelope(env: CreviceEnvelope, grids: readonly Grid[], top: number, mirror: boolean, chasm: {x: number; y: number; w: number; h: number}): EnvelopeStamp {
  const W = grids[0].w, H = grids[0].h;
  const canon = (x: number) => (mirror ? W - 1 - x : x);
  const st: EnvelopeStamp = {overhead: 0, low: Infinity, high: -Infinity, bed: 0, deepest: 0, clefts: 0};
  for (const g of grids) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, c = g.cells[i];
    if ((c !== FLOOR && c !== VOID) || g.ceil[i] !== top) continue;
    const h = env.over[y * W + canon(x)];
    if (!Number.isFinite(h)) continue;
    g.ceil[i] = h;
    st.overhead++;
    st.low = Math.min(st.low, h); st.high = Math.max(st.high, h);
  }
  const g0 = grids[0];
  for (let y = chasm.y; y < chasm.y + chasm.h; y++) for (let x = chasm.x; x < chasm.x + chasm.w; x++) {
    const i = y * W + x, d = env.bed[y * W + canon(x)];
    if (g0.cells[i] !== VOID || !Number.isFinite(d)) continue;
    g0.floor[i] = d;
    st.bed++;
    st.deepest = Math.min(st.deepest, d);
  }
  const g3 = grids[3];
  for (const p of env.clefts) for (let y = p.y; y < p.y + p.h; y++) for (let cx = p.x; cx < p.x + p.w; cx++) {
    const x = canon(cx);
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
    const i = y * W + x;
    if (g3.cells[i] !== SOLID || grids.some(g => g !== g3 && g.cells[i] !== SOLID && !(g.hasCeil(i) && g.ceil[i] <= p.floor - CLEFT_SLAB))) continue;
    g3.cells[i] = VOID; g3.area[i] = -1; g3.floor[i] = p.floor; g3.ceil[i] = p.ceil;
    st.clefts++;
  }
  return st;
}

/**
 * Is this drop edge (gen/levels.ts Levels.unrailedDrops: its normal points back into the open cell it drops from) one of the
 * envelope's own, never walked: an end cleft's lip (that open cell a VOID cell of storey 1 or above: nobody reaches a cleft's floor,
 * well over the top terrace) or a step between two of the chasm bed's shelves (storey 0, VOID on both sides: under the walks'
 * railings)? It takes no railing (gen/market/v5/index.ts creviceRails) and is no unrailed drop (gen/market/v5/validate.ts).
 */
export function creviceEnvelopeDrop(layout: {levels: readonly Level[]}, r: RailRun): boolean {
  const g = layout.levels[r.level]?.grid;
  if (!g) return false;
  const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
  const [sx, sy] = g.cellOf(mx + r.nx * CELL / 2, mz + r.nz * CELL / 2);
  if (!g.inBounds(sx, sy) || g.cells[g.idx(sx, sy)] !== VOID) return false;
  if (r.level > 0) return true;
  const [tx, ty] = g.cellOf(mx - r.nx * CELL / 2, mz - r.nz * CELL / 2);
  return g.inBounds(tx, ty) && g.cells[g.idx(tx, ty)] === VOID;
}
