// Task studio-mall-layout-variety-20261117-005520-01: the PLAN FAMILIES of layout version 2 (gen/mall/layoutVersion.ts) — skeletons
// for the plan variants (gen/mall/frame.ts MALL_PLAN_VARIANTS), planned over the same laid station block as the atrium family and
// returning the same MallSkeleton contract, so carving, shops, dressing, landmarks, populations, lighting, the patrol graph, Track2,
// the street exits and the window walls run unchanged (gen/mall/carve.ts reads the optional bridges / window ends / unit targets).
// The atrium family's planner (gen/mall/skeleton.ts planSkeleton) is never entered for these variants and never edited by them.
//
// Real-mall research (reference/tasks/mall-layout-variety-20261117-005520/research/RESEARCH.md) — architectural relationships only:
//  - 'galleria': the long skylit galleria under one barrel vault with stacked balconies and bridges across the void (Toronto Eaton
//    Centre's galleria, Milan's Galleria Vittorio Emanuele II nave), closed by an anchor at one end (the dumbbell: anchors at the ends of
//    a linear mall pull shoppers past every in-line unit) and a glazed end court looking over the parking at the other;
//  - 'crossroads': the cruciform / T galleria — a small crossing over the station and three skylit arms (Milan's octagon + arms; the
//    cluster mall's centre court with anchors at the wing ends);
//  - 'promenade': the outward-facing suburban mall edge — a long single-loaded promenade on the outer wall glazed toward the parking lot
//    (food courts / mall entrances facing the lot), shops on the inner side, anchors at both ends.
//
// Shared ARRIVAL module (every plan family): the station opening over the north platform and the front of the bed (the start stands
// under it and looks up to the roof), the Fountain court behind the north platform with the scissor escalator stack and the glass
// elevator in its north strip, the two service-stair cores and the north service corridor behind the arrival band (gen/mall/carve.ts).

import type {Rng} from '../../core/rng';
import type {TrackBlock} from '../stationKit';
import {FLOORS, RUN_CELLS, STRIP, WALK, type MallFrame} from './frame';
import {MALL_PLAN_FAILS, decompose, overlaps, type BridgePlan, type CellRect, type EndSpec, type LiftPlan, type MallSkeleton, type PatrolLine, type RunPlan, type Side4, type WalkPiece} from './skeleton';
import type {MallLotId} from './lots';

const fail = (why: string): null => { MALL_PLAN_FAILS[`plan-${why}`] = (MALL_PLAN_FAILS[`plan-${why}`] ?? 0) + 1; return null; };
const rect = (x0: number, y0: number, x1: number, y1: number): CellRect => ({x: x0, y: y0, w: x1 - x0, h: y1 - y0});
const range = (a: number, b: number): number[] => Array.from({length: b - a + 1}, (_, i) => a + i);

/** Mouth clearance (cells) in front of a public run on both storeys. */
const M = 6;

/** The arrival module's plan (canvas cells). */
interface Arrival {
  cz0: number;
  cxN0: number;
  cxN1: number;
  stripN: {y0: number; y1: number};
  court0: CellRect;
  runs: RunPlan[];
  lift: LiftPlan;
}

/**
 * The arrival module over the station opening [ox0, ox1): the court band [cxN0, cxN1) x [cz0, P2y) (the Fountain court on level 0, the
 * north gallery of every retail floor) holding the scissor escalator stack (station -> 1 -> 2 -> 3, one lane per storey pair,
 * alternating directions) and the glass elevator in its north strip — the atrium family's arrival, re-planned for a narrower opening
 * (the band is widened to the strip's program when the opening is small). Draw order: the court row offset, the elevator, the direction.
 */
function arrival(rng: Rng, f: MallFrame, block: TrackBlock, ox0: number, ox1: number): Arrival | null {
  const P2y = block.platforms[1].y;
  const cz0 = P2y - STRIP - WALK - rng.int(0, 1);
  const RL = RUN_CELLS;
  const need = RL + 2 * M + 7 + 2 * M + 4 + 8;
  let cxN0 = ox0 - f.gW, cxN1 = ox1 + f.gE;
  if (cxN1 - cxN0 < need) { const d = need - (cxN1 - cxN0); cxN0 -= d >> 1; cxN1 += d - (d >> 1); }
  // the Fountain court stays behind the north platform (its x range inside the platform's, a little slack at the ends)
  if (cxN0 < block.px0 - 2) { const d = block.px0 - 2 - cxN0; cxN0 += d; cxN1 += d; }
  if (cxN1 > block.px1 + 2) { const d = cxN1 - (block.px1 + 2); cxN0 -= d; cxN1 -= d; }
  if (cxN0 < block.px0 - 2 || cxN1 - cxN0 < need) return fail('arrival-narrow');
  const stripN = {y0: P2y - STRIP, y1: P2y};
  const cw = cxN1 - cxN0;
  const ea = cxN0 + M + Math.round((cw - 2 * M - RL - 7 - M - 4) * f.escAt);
  const laneA = rect(ea, stripN.y0, ea + RL, stripN.y0 + 3), laneB = rect(ea, stripN.y0 + 3, ea + RL, stripN.y1);
  let lx = cxN0 + Math.round((cw - 7) * f.liftAt);
  const liftClear = (x: number) => x >= cxN0 + 2 && x + 7 <= cxN1 - 2 && (x + 7 <= ea - M - 2 || x >= ea + RL + M + 2);
  if (!liftClear(lx)) {
    let got = -1;
    for (let d = 1; d < cw && got < 0; d++) for (const x of [lx + d, lx - d]) if (liftClear(x)) { got = x; break; }
    if (got < 0) return fail('arrival-lift');
    lx = got;
  }
  const shaft = rect(lx, stripN.y0, lx + 7, stripN.y1);
  const lift: LiftPlan = {shaft, cab: rect(lx + 1, stripN.y0 + 1, lx + 6, stripN.y0 + 5), landing: rect(lx, stripN.y0 - 4, lx + 7, stripN.y0), doorSide: 'N', door: {x: lx + 2, w: 3}};
  const upEast = rng.chance(0.5);
  const runs: RunPlan[] = [
    {id: 'esc-0', kind: 'escalator', lower: 0, rect: laneA, axis: 'x', from: upEast ? 'hi' : 'lo', side: 'N', zone: 'atrium'},
    {id: 'esc-1', kind: 'escalator', lower: 1, rect: laneB, axis: 'x', from: upEast ? 'lo' : 'hi', side: 'N', zone: 'atrium'},
    {id: 'esc-2', kind: 'escalator', lower: 2, rect: laneA, axis: 'x', from: upEast ? 'hi' : 'lo', side: 'N', zone: 'atrium'},
  ];
  return {cz0, cxN0, cxN1, stripN, court0: rect(cxN0, cz0, cxN1, P2y), runs, lift};
}

/** A mask builder over the canvas. */
class Mask {
  readonly m: Uint8Array;
  constructor(readonly W: number, readonly H: number) { this.m = new Uint8Array(W * H); }
  fill(r: CellRect, v = 1): this { for (let y = Math.max(0, r.y); y < Math.min(this.H, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(this.W, r.x + r.w); x++) this.m[y * this.W + x] = v; return this; }
  box(): {x0: number; y0: number; x1: number; y1: number} {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < this.m.length; i++) if (this.m[i]) { const x = i % this.W, y = (i / this.W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
    return {x0, y0, x1, y1};
  }
  copy(): Mask { const o = new Mask(this.W, this.H); o.m.set(this.m); return o; }
}

/** An end segment beyond a walkway rect side (the first rock row / column and the span along it). */
function endOf(id: string, r: CellRect, dir: Side4, pref: Readonly<Record<number, MallLotId>>, extra: Partial<Pick<EndSpec, 'exit' | 'window'>> = {}): EndSpec {
  const line = dir === 'W' ? r.x - 1 : dir === 'E' ? r.x + r.w : dir === 'N' ? r.y - 1 : r.y + r.h;
  const [a0, a1] = dir === 'W' || dir === 'E' ? [r.y, r.y + r.h] : [r.x, r.x + r.w];
  return {id, dir, line, a0, a1, pref, ...extra};
}

/** Bridge x positions along a nave section [a, b) (cells), `n` of them, evenly spread, deck width w; [] when it does not fit. */
function spread(a: number, b: number, n: number, w: number): number[] {
  if (n <= 0 || b - a < w + 4) return [];
  const k = Math.min(n, Math.floor((b - a) / (w + 10)) || 1);
  return Array.from({length: k}, (_, i) => Math.round(a + (b - a) * (i + 0.5) / k - w / 2));
}

/** Common finishing: opening boxes + rect decomposition of each floor's true opening. */
function finish(W: number, open: Uint8Array[], outline: Uint8Array[]): {openBox: MallSkeleton['openBox']; openRects: CellRect[][]} {
  const openBox = outline.map(m => { const q = new Mask(W, m.length / W); q.m.set(m); return q.box(); });
  const openRects = open.map((m, k) => { const b = openBox[k]; return decompose((x, y) => m[y * W + x] === 1, rect(b.x0, b.y0, b.x1, b.y1)); });
  return {openBox, openRects};
}

/** Plans the skeleton of a version-2 plan variant over a laid station block (null: the frame does not fit; the caller re-rolls). */
export function planFamilySkeleton(rng: Rng, f: MallFrame, block: TrackBlock, W: number, H: number): MallSkeleton | null {
  if (!f.plan) return fail('no-plan');
  if (f.variant === 'galleria') return planGalleria(rng, f, block, W, H);
  if (f.variant === 'crossroads') return planCrossroads(rng, f, block, W, H);
  if (f.variant === 'promenade') return planPromenade(rng, f, block, W, H);
  return fail(`variant-${f.variant}`);
}

/** An anchor's frontage across an end court (cells: the anchor-deep lot's 17 m minimum + its piers). */
const ANCHOR_FRONT = 44;
/** Depth of an end court holding a whole escalator bank along its axis with a mouth clear at both ends (cells). */
const END_COURT = RUN_CELLS + 2 * M + 2;

/**
 * An escalator bank inside an end court beyond a walkway's end: along the walkway's axis, its TOP toward the end (the anchor / the
 * glazing) and its foot toward the walkway, a mouth's clearance inside the court at both ends. `c0` = the court's first cell along
 * the axis on the walkway side for 'E' / 'S' ends, its outer cell for 'W' / 'N' ones; `mid` = the bank's centre across the axis.
 */
function endBank(id: string, end: Side4, lower: number, edge: number, mid: number): RunPlan {
  const lo = edge + M + 1;
  const a = end === 'W' || end === 'N' ? lo : edge + END_COURT - M - 1 - RUN_CELLS;
  const r = end === 'W' || end === 'E' ? rect(a, mid - 3, a + RUN_CELLS, mid + 3) : rect(mid - 3, a, mid + 3, a + RUN_CELLS);
  return {id, kind: 'escalator', lower, rect: r, axis: end === 'W' || end === 'E' ? 'x' : 'z', from: end === 'W' || end === 'N' ? 'lo' : 'hi', side: 'N', zone: 'wing'};
}

// ---------------------------------------------------------------------------------------------
// 'galleria' — the long skylit nave (the dumbbell)

/**
 * The GALLERIA: a long, narrow nave running west and east of the station opening on floors 2-3 (its floor-1 promenade beneath, open to
 * the barrel vault), balconies along both sides on every floor, bridges across the nave on floors 2 and 3 (never stacked, never over the
 * station column), an end court at each end of the nave holding an escalator bank (floor 1 -> 2 at one end, 2 -> 3 at the other), an
 * anchor (floor 1; end units above) closing one end and a glazed end wall over the parking lot closing the other (every floor; gen/mall/
 * windows.ts), a street arcade off the south balcony (floor 1) to the locked street doors.
 */
function planGalleria(rng: Rng, f: MallFrame, block: TrackBlock, W: number, H: number): MallSkeleton | null {
  const pf = f.plan!;
  const [P1, P2] = block.platforms;
  const px0 = block.px0, px1 = block.px1, P2y = P2.y, ty0 = P2.y + P2.h, P1y = P1.y, P1b = P1.y + P1.h;
  // --- the station opening = the nave's middle bay over the north platform and the front of the bed --------------------------------
  const ox0 = px0 + Math.round((f.Lp - f.VW) * f.atX), ox1 = ox0 + f.VW;
  const oz0 = P2y + f.nOff, oz1 = Math.min(oz0 + pf.slot, P1y - 2);
  if (oz1 - oz0 < 12) return fail('galleria-slot');
  const A = arrival(rng, f, block, ox0, ox1);
  if (!A) return null;
  // --- the nave (floors 2-3), its balconies, the end courts ------------------------------------------------------------------------
  // the end courts hold a whole escalator bank along the nave axis with a mouth clear at both ends (never reaching into the nave)
  const nb = pf.balcony, eb = END_COURT;
  const gx0 = Math.min(ox0 - pf.reachW, A.cxN0 - 8), gx1 = Math.max(ox1 + pf.reachE, A.cxN1 + 8);
  const band = rect(gx0 - eb, oz0 - nb, gx1 + eb, oz1 + nb);
  const court = new Mask(W, H).fill(band).fill(rect(A.cxN0, A.cz0, A.cxN1, oz0));
  const cb = court.box();
  const courtR = rect(cb.x0, cb.y0, cb.x1, cb.y1);
  if (courtR.x < 12 || courtR.y < 12 || courtR.x + courtR.w > W - 12) return fail('galleria-canvas');
  const nave = rect(gx0, oz0, gx1, oz1);
  // --- bridges: floor 2 one in each nave section (a third in the longer one), floor 3 between them; never over the station column ---
  const bw = pf.bridgeW, keep = 6;
  const westS: [number, number] = [gx0 + keep, ox0 - keep], eastS: [number, number] = [ox1 + keep, gx1 - keep];
  const longerW = westS[1] - westS[0] >= eastS[1] - eastS[0];
  const b2 = [...spread(westS[0], westS[1], pf.bridges >= 3 && longerW ? 2 : 1, bw), ...spread(eastS[0], eastS[1], pf.bridges >= 3 && !longerW ? 2 : 1, bw)];
  const b3: number[] = [];
  for (const [a, b] of [westS, eastS]) {
    // floor 3: one bridge per section, as far as it can be from the floor-2 decks below (never stacked: their soffits stay apart)
    let best = -1, bestD = -1;
    for (let x = a; x + bw <= b; x++) { const d = Math.min(...b2.map(q => Math.abs(q - x))); if (d > bestD) { bestD = d; best = x; } }
    if (best >= 0 && bestD >= bw + 8) b3.push(best);
  }
  if (b2.length < 2) return fail('galleria-bridges');
  const bridges: BridgePlan[] = [
    ...b2.map((x, i) => ({id: `bridge-2-${i + 1}`, level: 2, rect: rect(x, oz0, x + bw, oz1)})),
    ...b3.map((x, i) => ({id: `bridge-3-${i + 1}`, level: 3, rect: rect(x, oz0, x + bw, oz1)})),
  ];
  // --- openings: floor 1 = the station column; floors 2-3 = the nave less that floor's bridge decks; the records' outline = the nave ---
  const o1 = new Mask(W, H).fill(rect(ox0, oz0, ox1, oz1));
  const env = new Mask(W, H).fill(nave);
  const deckless = (lv: number) => { const m = env.copy(); for (const b of bridges) if (b.level === lv) m.fill(b.rect, 0); return m; };
  const open = [o1.m, o1.m, deckless(2).m, deckless(3).m];
  const outline = [o1.m, o1.m, env.m, env.m];
  // --- vertical runs: the arrival stack + an escalator bank in each end court (1 -> 2 at one end, 2 -> 3 at the other) ------------
  const runs = [...A.runs];
  const lowW = rng.chance(0.5) ? 1 : 2;
  const zc = Math.round((oz0 + oz1) / 2) - 3;
  for (const end of ['W', 'E'] as const) {
    const lower = end === 'W' ? lowW : 3 - lowW;
    // along the nave axis in the end court, its top toward the end (the anchor / the glazing), its foot toward the nave
    const x0 = end === 'W' ? gx0 - eb + M + 1 : gx1 + eb - M - 1 - RUN_CELLS;
    const r = rect(x0, zc, x0 + RUN_CELLS, zc + 6);
    runs.push({id: `esc-${end}${lower}`, kind: 'escalator', lower, rect: r, axis: 'x', from: end === 'W' ? 'lo' : 'hi', side: 'N', zone: 'wing'});
  }
  // --- walk pieces: the galleria court (balconies, end courts, the arrival band), the street arcade -------------------------------
  const walks: WalkPiece[] = [{id: 'court', rect: courtR, mask: court.m, floors: range(1, FLOORS), zone: 'court', label: 'Galleria'}];
  const ends: EndSpec[] = [];
  const glazed = pf.glazed;
  for (const end of ['W', 'E'] as const) {
    const zr = end === 'W' ? rect(gx0 - eb, oz0 - nb, gx0, oz1 + nb) : rect(gx1, oz0 - nb, gx1 + eb, oz1 + nb);
    ends.push(end === glazed ? endOf(`window-${end}`, zr, end, {}, {window: true}) : endOf(`end-${end}`, zr, end, {1: 'anchor-deep', 2: 'end-unit', 3: 'end-unit'}));
  }
  // the street arcade: off the south balcony in the nave section away from the glazed end, floor 1, to the locked street doors
  const WS = rng.int(10, 12), LSt = rng.int(16, 22);
  const sec = glazed === 'W' ? eastS : westS;
  const sx = Math.round(sec[0] + (sec[1] - sec[0] - WS) * rng.range(0.3, 0.7));
  const st = rect(sx, oz1 + nb, sx + WS, oz1 + nb + LSt);
  if (st.y + st.h > P1b + 30) return fail('galleria-street');
  walks.push({id: 'street', rect: st, floors: [1], zone: 'corridor', label: 'Street arcade'});
  ends.push(endOf('exit-street', st, 'S', {}, {exit: true}));
  for (const w of walks) if (w.rect.x < 10 || w.rect.y < 10 || w.rect.x + w.rect.w > W - 10 || w.rect.y + w.rect.h > H - 10) return fail('galleria-wing-canvas');
  for (const r of runs.slice(3)) for (const b of bridges) if (overlaps(r.rect, b.rect, 4)) return fail('galleria-run-bridge');
  // --- patrol lines: both balconies, every bridge, the end courts (the court's loop alone misses a long nave) ----------------------
  const patrol: PatrolLine[] = [];
  const nzN = oz0 - (nb >> 1), nzS = oz1 + (nb >> 1);
  patrol.push({floors: range(1, FLOORS), a: [gx0 - eb + 3, nzN], b: [gx1 + eb - 3, nzN]}, {floors: range(1, FLOORS), a: [gx0 - eb + 3, nzS], b: [gx1 + eb - 3, nzS]});
  patrol.push({floors: [1], a: [gx0 + 2, (oz0 + oz1) >> 1], b: [ox0 - 2, (oz0 + oz1) >> 1]}, {floors: [1], a: [ox1 + 2, (oz0 + oz1) >> 1], b: [gx1 - 2, (oz0 + oz1) >> 1]});
  for (const b of bridges) patrol.push({floors: [b.level], a: [b.rect.x + (bw >> 1), nzN], b: [b.rect.x + (bw >> 1), nzS]});
  for (const x of [gx0 - (eb >> 1), gx1 + (eb >> 1)]) patrol.push({floors: range(1, FLOORS), a: [x, oz0 - nb + 2], b: [x, oz1 + nb - 2]});
  const {openBox, openRects} = finish(W, open, outline);
  void ty0;
  return {
    W, px0, px1, P2y, ty0, P1y, P1b, open, openRects, openBox, court: courtR, courtMask: court.m, court0: A.court0,
    stripN: A.stripN, stripS: {y0: oz1 + nb, y1: oz1 + nb}, walks, ends, runs, lift: A.lift, foodFloor: f.foodFloor,
    bridges, openOutline: outline, patrol, units: {1: 11, 2: 10, 3: 9}, family: 'galleria',
  };
}

// ---------------------------------------------------------------------------------------------
// 'crossroads' — the cruciform / T galleria: a crossing over the station and three skylit arms

/**
 * The CROSSROADS: a crossing court over the station opening (wider than the arms) and three skylit arms off it — west and east along the
 * platforms, south across the tracks and beyond — balconies round every arm on every floor (each floor-1 arm a promenade under the
 * glass), an end court at each arm's end with an escalator bank, an anchor closing one side arm (floor 1; end units above), a glazed
 * end wall over the parking lot closing the other (west or east), end units closing the south arm, a bridge across the longer side arm on floor 2 and one across the
 * other side arm on floor 3 (never stacked), a street arcade off the south arm to the locked street doors (floor 1).
 */
function planCrossroads(rng: Rng, f: MallFrame, block: TrackBlock, W: number, H: number): MallSkeleton | null {
  const pf = f.plan!;
  const [P1, P2] = block.platforms;
  const px0 = block.px0, px1 = block.px1, P2y = P2.y, ty0 = P2.y + P2.h, P1y = P1.y, P1b = P1.y + P1.h;
  const ox0 = px0 + Math.round((f.Lp - f.VW) * f.atX), ox1 = ox0 + f.VW;
  const oz0 = P2y + f.nOff, oz1 = Math.min(oz0 + pf.slot, P1y - 2);
  if (oz1 - oz0 < 10) return fail('cross-slot');
  const A = arrival(rng, f, block, ox0, ox1);
  if (!A) return null;
  const nb = pf.balcony, eb = END_COURT;
  const gx0 = Math.min(ox0 - pf.reachW, A.cxN0 - 8), gx1 = Math.max(ox1 + pf.reachE, A.cxN1 + 8);
  // the south arm: narrower than the crossing, centred on it, from the nave out past the south platform
  const cx = (ox0 + ox1) >> 1, aw = Math.min(pf.slot, f.VW - 6), ax0 = cx - (aw >> 1), ax1 = ax0 + aw;
  // the crossing reaches a little way down the south arm (a court, not a mere junction) — leaving the arm room for its street arcade
  const cz1 = oz1 + Math.min(rng.int(5, 7), pf.reachS - nb - 16);
  const az1 = oz1 + pf.reachS;
  // the south end court: shallow, as wide as an end court is deep, its bank running across it (the arm stays compact)
  const sb = 6 + 2 * M + 2, sx0 = cx - (END_COURT >> 1), sx1 = sx0 + END_COURT;
  const nave = rect(gx0, oz0, gx1, oz1), crossing = rect(ox0, oz0, ox1, cz1), armS = rect(ax0, oz1, ax1, az1);
  const court = new Mask(W, H)
    .fill(rect(gx0 - eb, oz0 - nb, gx1 + eb, oz1 + nb))
    .fill(rect(ox0 - nb, oz1, ox1 + nb, cz1 + nb))
    .fill(rect(ax0 - nb, oz1, ax1 + nb, az1))
    .fill(rect(Math.min(sx0, ax0 - nb), az1, Math.max(sx1, ax1 + nb), az1 + sb))
    .fill(rect(A.cxN0, A.cz0, A.cxN1, oz0));
  const cb = court.box(), courtR = rect(cb.x0, cb.y0, cb.x1, cb.y1);
  if (courtR.x < 12 || courtR.y < 12 || courtR.x + courtR.w > W - 12 || courtR.y + courtR.h > H - 40) return fail('cross-canvas');
  // --- bridges: floor 2 across the longer side arm, floor 3 across the south arm ---------------------------------------------------
  const bw = pf.bridgeW, keep = 6;
  const westS: [number, number] = [gx0 + keep, ox0 - keep], eastS: [number, number] = [ox1 + keep, gx1 - keep];
  const westLonger = westS[1] - westS[0] >= eastS[1] - eastS[0];
  const b2 = spread(...(westLonger ? westS : eastS), 1, bw), b3 = spread(...(westLonger ? eastS : westS), 1, bw);
  if (!b2.length) return fail('cross-bridges');
  const bridges: BridgePlan[] = [
    {id: 'bridge-2-1', level: 2, rect: rect(b2[0], oz0, b2[0] + bw, oz1)},
    ...(b3.length ? [{id: 'bridge-3-1', level: 3, rect: rect(b3[0], oz0, b3[0] + bw, oz1)}] : []),
  ];
  // --- openings: floor 1 = the station column (the crossing over the platform); floors 2-3 = the cross less that floor's decks -----
  const o1 = new Mask(W, H).fill(rect(ox0, oz0, ox1, oz1));
  const env = new Mask(W, H).fill(nave).fill(crossing).fill(armS);
  const deckless = (lv: number) => { const m = env.copy(); for (const b of bridges) if (b.level === lv) m.fill(b.rect, 0); return m; };
  const open = [o1.m, o1.m, deckless(2).m, deckless(3).m];
  const outline = [o1.m, o1.m, env.m, env.m];
  // --- vertical runs: the arrival stack + a bank in each arm's end court (alternating storey pairs) --------------------------------
  const lowW = rng.chance(0.5) ? 1 : 2, lowS = rng.chance(0.5) ? 1 : 2;
  const zc = (oz0 + oz1) >> 1;
  const runs = [...A.runs,
    endBank(`esc-W${lowW}`, 'W', lowW, gx0 - eb, zc), endBank(`esc-E${3 - lowW}`, 'E', 3 - lowW, gx1, zc),
    {id: `esc-S${lowS}`, kind: 'escalator', lower: lowS, rect: rect(sx0 + M + 1, az1 + M + 1, sx0 + M + 1 + RUN_CELLS, az1 + M + 7), axis: 'x', from: rng.chance(0.5) ? 'lo' : 'hi', side: 'N', zone: 'wing'} as RunPlan];
  // --- walk pieces, ends --------------------------------------------------------------------------------------------------------------
  const walks: WalkPiece[] = [{id: 'court', rect: courtR, mask: court.m, floors: range(1, FLOORS), zone: 'court', label: 'Crossroads'}];
  const glazed = pf.glazed === 'S' ? 'W' : pf.glazed;
  const ends: EndSpec[] = [];
  for (const end of ['W', 'E'] as const) {
    const zr = end === 'W' ? rect(gx0 - eb, oz0 - nb, gx0, oz1 + nb) : rect(gx1, oz0 - nb, gx1 + eb, oz1 + nb);
    ends.push(end === glazed ? endOf(`window-${end}`, zr, end, {}, {window: true}) : endOf(`end-${end}`, zr, end, {1: 'anchor-deep', 2: 'end-unit', 3: 'end-unit'}));
  }
  const endS = rect(Math.min(sx0, ax0 - nb), az1, Math.max(sx1, ax1 + nb), az1 + sb);
  ends.push(endOf('end-S', endS, 'S', {1: 'end-unit', 2: 'end-unit', 3: 'end-unit'}));
  // the street arcade: off the south arm's balcony on the side away from the glazing, floor 1, out to the locked street doors
  // (its width at most the arm's room past the crossing's balcony: a short arm takes a narrower arcade instead of failing the attempt)
  const lo = cz1 + nb + 2, WS = Math.min(rng.int(10, 12), az1 - 2 - lo), LSt = rng.int(16, 22);
  const sy = Math.round(lo + (az1 - WS - 2 - lo) * rng.range(0.25, 0.75));
  const toW = glazed === 'E';
  const st = toW ? rect(ax0 - nb - LSt, sy, ax0 - nb, sy + WS) : rect(ax1 + nb, sy, ax1 + nb + LSt, sy + WS);
  if (WS < 10 || sy + WS > az1 - 2 || sy < lo) return fail('cross-street');
  walks.push({id: 'street', rect: st, floors: [1], zone: 'corridor', label: 'Street arcade'});
  ends.push(endOf('exit-street', st, toW ? 'W' : 'E', {}, {exit: true}));
  for (const w of walks) if (w.rect.x < 10 || w.rect.y < 10 || w.rect.x + w.rect.w > W - 10 || w.rect.y + w.rect.h > H - 10) return fail('cross-wing-canvas');
  for (const r of runs.slice(3)) for (const b of bridges) if (overlaps(r.rect, b.rect, 4)) return fail('cross-run-bridge');
  // --- patrol lines: the side arms' balconies, the south arm's balconies, the bridges, the end courts -------------------------------
  const patrol: PatrolLine[] = [];
  const nzN = oz0 - (nb >> 1), nzS = oz1 + (nb >> 1), sxW = ax0 - (nb >> 1), sxE = ax1 + (nb >> 1);
  patrol.push({floors: range(1, FLOORS), a: [gx0 - eb + 3, nzN], b: [gx1 + eb - 3, nzN]});
  patrol.push({floors: range(1, FLOORS), a: [gx0 - eb + 3, nzS], b: [sxW, nzS]}, {floors: range(1, FLOORS), a: [sxE, nzS], b: [gx1 + eb - 3, nzS]});
  patrol.push({floors: range(1, FLOORS), a: [sxW, nzS], b: [sxW, az1 + sb - 3]}, {floors: range(1, FLOORS), a: [sxE, nzS], b: [sxE, az1 + sb - 3]});
  patrol.push({floors: [1], a: [gx0 + 2, (oz0 + oz1) >> 1], b: [gx1 - 2, (oz0 + oz1) >> 1]}, {floors: [1], a: [cx, oz1 + 2], b: [cx, az1 - 2]});
  for (const b of bridges) patrol.push({floors: [b.level], a: [b.rect.x + (bw >> 1), nzN], b: [b.rect.x + (bw >> 1), nzS]});
  for (const x of [gx0 - (eb >> 1), gx1 + (eb >> 1)]) patrol.push({floors: range(1, FLOORS), a: [x, oz0 - nb + 2], b: [x, oz1 + nb - 2]});
  patrol.push({floors: range(1, FLOORS), a: [endS.x + 2, az1 + 3], b: [endS.x + endS.w - 2, az1 + 3]});
  const {openBox, openRects} = finish(W, open, outline);
  return {
    W, px0, px1, P2y, ty0, P1y, P1b, open, openRects, openBox, court: courtR, courtMask: court.m, court0: A.court0,
    stripN: A.stripN, stripS: {y0: az1 + sb, y1: az1 + sb}, walks, ends, runs, lift: A.lift, foodFloor: f.foodFloor,
    bridges, openOutline: outline, patrol, units: {1: 11, 2: 10, 3: 9}, family: 'crossroads',
  };
}

// ---------------------------------------------------------------------------------------------
// 'promenade' — the outward-facing mall: a glazed promenade along the outer wall

/**
 * The PROMENADE: a small skylit light well over the station (stepping wider on the upper floors) in a court behind the arrival band, a
 * mall corridor running south from it across the tracks to a long PROMENADE along the building's outer (south) wall — single-loaded:
 * shops on its inner side only, the outer side glazed floor to ceiling over the parking lot on every floor (gen/mall/windows.ts) — an
 * end court at each end of the promenade with an escalator bank and an anchor beyond it (floor 1; end units above), a street arcade
 * off the corridor to the locked street doors (floor 1).
 */
function planPromenade(rng: Rng, f: MallFrame, block: TrackBlock, W: number, H: number): MallSkeleton | null {
  const pf = f.plan!;
  const [P1, P2] = block.platforms;
  const px0 = block.px0, px1 = block.px1, P2y = P2.y, ty0 = P2.y + P2.h, P1y = P1.y, P1b = P1.y + P1.h;
  const ox0 = px0 + Math.round((f.Lp - f.VW) * f.atX), ox1 = ox0 + f.VW;
  const oz0 = P2y + f.nOff, oz1 = Math.min(oz0 + pf.slot, P1y - 2);
  if (oz1 - oz0 < 8) return fail('prom-slot');
  const A = arrival(rng, f, block, ox0, ox1);
  if (!A) return null;
  const nb = pf.balcony, eb = END_COURT, cx = (ox0 + ox1) >> 1;
  // the light-well court round the opening (and the arrival band behind it)
  const kx0 = Math.min(A.cxN0, ox0 - nb - 4), kx1 = Math.max(A.cxN1, ox1 + nb + 4), kz1 = oz1 + nb + 4;
  // the corridor south to the promenade, the promenade along the outer wall, its end courts
  const WW = f.WW, qz0 = Math.max(kz1 + pf.reachS, P1b + 10), qz1 = qz0 + pf.promW;
  const qx0 = Math.min(cx - pf.reachW - (f.VW >> 1), kx0 - 6), qx1 = Math.max(cx + pf.reachE + (f.VW >> 1), kx1 + 6);
  // (the end courts are anchor courts: deep enough across the promenade for an anchor's frontage, reaching back from the glass)
  const ez0 = Math.min(qz0, qz1 - ANCHOR_FRONT);
  const court = new Mask(W, H).fill(rect(kx0, A.cz0, kx1, kz1)).fill(rect(qx0, qz0, qx1, qz1)).fill(rect(qx0 - eb, ez0, qx0, qz1)).fill(rect(qx1, ez0, qx1 + eb, qz1));
  const cb = court.box(), courtR = rect(cb.x0, cb.y0, cb.x1, cb.y1);
  if (courtR.x < 12 || courtR.y < 12 || courtR.x + courtR.w > W - 12 || qz1 + 50 > H - 2) return fail('prom-canvas');
  const corridor = rect(cx - (WW >> 1), kz1, cx - (WW >> 1) + WW, qz0);
  // --- openings: the light well, a little wider on each floor up (nested: every floor's contains the one below) --------------------
  const well = (g: number) => new Mask(W, H).fill(rect(ox0 - g, oz0, ox1 + g, oz1 + g)).m;
  const o1 = well(0);
  const open = [o1, o1, well(2), well(4)];
  // --- vertical runs: the arrival stack + a bank in each end court of the promenade (alternating storey pairs) ---------------------
  const lowW = rng.chance(0.5) ? 1 : 2, zc = (ez0 + qz1) >> 1;
  const runs = [...A.runs, endBank(`esc-W${lowW}`, 'W', lowW, qx0 - eb, zc), endBank(`esc-E${3 - lowW}`, 'E', 3 - lowW, qx1, zc)];
  // --- walk pieces: the court (light well + promenade: the atrium zone, its long inner edge the food court's), the mall corridor ------
  const walks: WalkPiece[] = [
    {id: 'court', rect: courtR, mask: court.m, floors: range(1, FLOORS), zone: 'court', label: 'Promenade'},
    {id: 'mall', rect: corridor, floors: range(1, FLOORS), zone: 'corridor', label: 'Mall'},
  ];
  // ends: an anchor beyond each end court; the promenade's whole outer side glazed (the window end)
  const ends: EndSpec[] = [
    endOf('end-W', rect(qx0 - eb, ez0, qx0, qz1), 'W', {1: 'anchor-deep', 2: 'end-unit', 3: 'end-unit'}),
    endOf('end-E', rect(qx1, ez0, qx1 + eb, qz1), 'E', {1: 'anchor-deep', 2: 'end-unit', 3: 'end-unit'}),
    endOf('window-S', rect(qx0 - eb + 2, qz0, qx1 + eb - 2, qz1), 'S', {}, {window: true}),
  ];
  // the street arcade: off the light-well court's side toward the frame's street side, floor 1, out to the locked street doors
  const WS = Math.min(rng.int(10, 12), kz1 - 4 - oz0), LSt = rng.int(16, 22); // (a shallow court: a narrower arcade, never under 10)
  if (WS < 10) return fail('prom-street');
  const sz = Math.round(oz0 + (kz1 - 2 - WS - oz0) * rng.range(0.3, 0.7));
  const toW = pf.street === 'W';
  const st = toW ? rect(kx0 - LSt, sz, kx0, sz + WS) : rect(kx1, sz, kx1 + LSt, sz + WS);
  walks.push({id: 'street', rect: st, floors: [1], zone: 'corridor', label: 'Street arcade'});
  ends.push(endOf('exit-street', st, toW ? 'W' : 'E', {}, {exit: true}));
  for (const w of walks) if (w.rect.x < 10 || w.rect.y < 10 || w.rect.x + w.rect.w > W - 10 || w.rect.y + w.rect.h > H - 10) return fail('prom-wing-canvas');
  // --- patrol lines: the promenade (two lines), the corridor, the end courts, round the light well ---------------------------------
  const patrol: PatrolLine[] = [
    {floors: range(1, FLOORS), a: [qx0 - eb + 3, qz0 + 4], b: [qx1 + eb - 3, qz0 + 4]},
    {floors: range(1, FLOORS), a: [qx0 - eb + 3, qz1 - 4], b: [qx1 + eb - 3, qz1 - 4]},
    {floors: range(1, FLOORS), a: [cx, kz1 - 2], b: [cx, qz0 + 2]},
    {floors: range(1, FLOORS), a: [kx0 + 3, oz1 + 6], b: [kx1 - 3, oz1 + 6]},
  ];
  const outline = open;
  const {openBox, openRects} = finish(W, open, outline);
  return {
    W, px0, px1, P2y, ty0, P1y, P1b, open, openRects, openBox, court: courtR, courtMask: court.m, court0: A.court0,
    stripN: A.stripN, stripS: {y0: qz1, y1: qz1}, walks, ends, runs, lift: A.lift, foodFloor: f.foodFloor,
    patrol, family: 'promenade',
  };
}
