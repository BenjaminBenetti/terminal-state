// Task mall-playtest-revision-20261031 (lane GEN): the mall SKELETON — pure data in canvas cells, planned once per attempt after the
// station block (Kit.sideBlock) is laid and before any retail floor is carved:
//
//  - the ATRIUM openings per retail floor: floor 1's opening over the track bed and the front of the north platform (the station's
//    look-up column; an optional notched corner / bay makes it irregular), each higher floor's opening the "plus" growth of the one
//    below by the variant's per-side setbacks (stepped corners: a cone / offset / twisting stack, never one rectangle);
//  - the COURT: the gallery region around the atrium on every retail floor; its NORTH strip (directly behind the north platform:
//    the Fountain court on level 0) holds the station escalators, the floor-2 -> 3 escalators and the glass elevator; its SOUTH strip
//    the floor-1 -> 2 escalators; walkways >= 4 m beside both;
//  - the WINGS of the variant (corridor wings, a dead-end branch with a shop at its end, a loop of arcades around a block, an elbow
//    with a link back): walkway rects with the floors they exist on (upper floors step back) and their END segments (end units /
//    anchors close them);
//  - the PUBLIC RUNS: escalator banks in the court strips, public stairs in the wings (route choice away from the atrium).
// Lots, cores, washrooms and the station's back of house are placed by gen/mall/carve.ts on top of this plan.

import type {Rng} from '../../core/rng';
import type {TrackBlock} from '../stationKit';
import type {MallLotId} from './lots';
import {FLOORS, LANE, RUN_CELLS, STRIP, WALK, type MallFrame} from './frame';

export interface CellRect { x: number; y: number; w: number; h: number }
export type Side4 = 'N' | 'S' | 'E' | 'W';

export interface WalkPiece {
  id: string;
  rect: CellRect;
  /** Optional cell mask (stride W) inside the rect (the court follows the atrium's stepped outline). */
  mask?: Uint8Array;
  /** Retail floors (1..FLOORS) carrying this walkway. */
  floors: readonly number[];
  zone: 'court' | 'corridor' | 'court2' | 'link';
  label: string;
}

/** A corridor END (the short edge of a wing walkway): an end unit / anchor closes it on the floors listed. */
export interface EndSpec {
  id: string;
  /** Direction the unit extends from the walkway (away from it). */
  dir: Side4;
  /** First rock row / column beyond the walkway (the wall line holding the frontage) and the segment span along it. */
  line: number;
  a0: number;
  a1: number;
  /** Preferred family per floor (falls back to smaller families when it does not fit). */
  pref: Readonly<Record<number, MallLotId>>;
}

export interface RunPlan {
  id: string;
  kind: 'escalator' | 'stair';
  lower: number;
  rect: CellRect;
  axis: 'x' | 'z';
  /** Which end of the rect is the TOP (the run starts there at the upper floor). */
  from: 'lo' | 'hi';
  side: Side4;
  zone: 'atrium' | 'wing';
}

export interface LiftPlan { shaft: CellRect; cab: CellRect; landing: CellRect; doorSide: 'N' | 'S'; door: {x: number; w: number} }

export interface MallSkeleton {
  /** Canvas width (mask stride). */
  W: number;
  /** Station block rows / columns: north platform top row, bed top row, south platform top row, row after the south platform. */
  px0: number; px1: number; P2y: number; ty0: number; P1y: number; P1b: number;
  /** Atrium opening per retail floor (index 1..FLOORS; [0] = the floor-1 opening = the station column): mask + rect pieces. */
  open: Uint8Array[];
  openRects: CellRect[][];
  /** Bounding box per floor opening (cells, exclusive ends). */
  openBox: {x0: number; y0: number; x1: number; y1: number}[];
  /** The court (gallery region incl. the openings) — the same on every retail floor: bounding box + cell mask. */
  court: CellRect;
  courtMask: Uint8Array;
  /** Level-0 Fountain court behind the north platform (court columns, rows court.y .. P2y). */
  court0: CellRect;
  /** North / south strip rows (exclusive ends). */
  stripN: {y0: number; y1: number};
  stripS: {y0: number; y1: number};
  walks: WalkPiece[];
  ends: EndSpec[];
  runs: RunPlan[];
  lift: LiftPlan;
  foodFloor: number;
}

/** Why the last attempts failed (QA / tests). */
export const MALL_PLAN_FAILS: Record<string, number> = {};
const fail = (why: string): null => { MALL_PLAN_FAILS[why] = (MALL_PLAN_FAILS[why] ?? 0) + 1; return null; };

const rect = (x0: number, y0: number, x1: number, y1: number): CellRect => ({x: x0, y: y0, w: x1 - x0, h: y1 - y0});

/** Greedy decomposition of a cell mask (within a rect) into maximal-run rectangles (row-major, deterministic). */
export function decompose(mask: (x: number, y: number) => boolean, r: CellRect): CellRect[] {
  const W = r.w, H = r.h;
  const used = new Uint8Array(W * H);
  const ok = (x: number, y: number) => !used[(y - r.y) * W + (x - r.x)] && mask(x, y);
  const out: CellRect[] = [];
  for (let y = r.y; y < r.y + H; y++) for (let x = r.x; x < r.x + W; x++) {
    if (!ok(x, y)) continue;
    let w = 1;
    while (x + w < r.x + W && ok(x + w, y)) w++;
    let h = 1;
    grow: while (y + h < r.y + H) {
      for (let xx = x; xx < x + w; xx++) if (!ok(xx, y + h)) break grow;
      h++;
    }
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[(yy - r.y) * W + (xx - r.x)] = 1;
    out.push({x, y, w, h});
  }
  return out;
}

export const inRect = (r: CellRect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
export const overlaps = (a: CellRect, b: CellRect, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/**
 * Plans the skeleton over a laid station block (canvas cells). Null when the frame does not fit (the caller re-rolls the frame).
 */
export function planSkeleton(rng: Rng, f: MallFrame, block: TrackBlock, W: number, H: number): MallSkeleton | null {
  const [P1, P2] = block.platforms;
  const px0 = block.px0, px1 = block.px1, P2y = P2.y, ty0 = P2.y + P2.h, P1y = P1.y, P1b = P1.y + P1.h;
  const n = W * H;
  const fillRect = (m: Uint8Array, r: CellRect, v = 1) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) m[y * W + x] = v; };
  const box = (m: Uint8Array) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) if (m[i]) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
    return {x0, y0, x1, y1};
  };
  // --- Floor-1 opening (the station column): over the north platform (all but its back rows: the start stands under it) and the
  // north part of the track bed; a notched corner (a jutting floor-1 balcony) and / or a bay make it irregular ------------------------
  const ox0 = px0 + Math.round((f.Lp - f.VW) * f.atX), ox1 = ox0 + f.VW;
  const oz0 = P2y + f.nOff, oz1 = Math.min(ty0 + f.bedOver, P1y + 2);
  const o1 = new Uint8Array(n);
  fillRect(o1, rect(ox0, oz0, ox1, oz1));
  if (f.notch) {
    const nw = rng.int(5, 8), nh = rng.int(4, 6);
    const nx = f.notch.endsWith('W') ? ox0 : ox1 - nw, ny = f.notch.startsWith('N') ? oz0 : oz1 - nh;
    fillRect(o1, rect(nx, ny, nx + nw, ny + nh), 0);
  }
  if (f.bay === 'W' || f.bay === 'E') {
    const d = rng.int(3, 5), bz0 = oz0 + rng.int(3, 5), bz1 = oz1 - rng.int(2, 4);
    if (bz1 - bz0 >= 6) fillRect(o1, f.bay === 'W' ? rect(ox0 - d, bz0, ox0, bz1) : rect(ox1, bz0, ox1 + d, bz1));
  } else if (f.bay === 'S') {
    const d = rng.int(3, 5), bx0 = ox0 + rng.int(4, 8), bx1 = ox1 - rng.int(4, 8);
    if (bx1 - bx0 >= 8 && oz1 + d <= P1b - 2) fillRect(o1, rect(bx0, oz1, bx1, oz1 + d));
  }
  // --- Upper openings: the "plus" growth of the floor below's bounding box (stepped corners), nested; never north of the north
  // platform's back rows (the escalator strip behind the platform stays solid floor on every storey) ----------------------------------
  const grow = (m: Uint8Array, s: readonly [number, number, number, number]): Uint8Array => {
    const b = box(m), out = m.slice();
    const N = Math.max(0, Math.min(s[2], b.y0 - (P2y + 1)));
    fillRect(out, rect(b.x0 - s[0], b.y0, b.x1 + s[1], b.y1));
    fillRect(out, rect(b.x0, b.y0 - N, b.x1, b.y1 + s[3]));
    return out;
  };
  const o2 = grow(o1, f.step2), o3 = grow(o2, f.step3);
  const open = [o1, o1, o2, o3];
  const openBox = open.map(box);
  const b3 = openBox[3];
  if (b3.y0 < P2y + 1) return fail('opening-north');
  // --- Court: a full-width north gallery (the escalator / elevator strip behind the north platform + a walkway) and, south of it,
  // the top opening dilated by the gallery margins — the court's outline follows the atrium's stepped corners (never one rectangle)
  const cz0 = P2y - STRIP - WALK - rng.int(0, 1);
  const cxN0 = b3.x0 - f.gW, cxN1 = b3.x1 + f.gE;
  const courtMask = new Uint8Array(n);
  fillRect(courtMask, rect(cxN0, cz0, cxN1, b3.y0 + 2));
  for (let i = 0; i < n; i++) {
    if (!o3[i]) continue;
    const x = i % W, y = (i / W) | 0;
    // box dilation (concave corners keep their size: the stepped outline survives at the gallery's distance)
    for (let yy = y; yy <= y + f.gS; yy++) {
      const r = yy * W;
      for (let xx = x - f.gW; xx <= x + f.gE; xx++) courtMask[r + xx] = 1;
    }
  }
  const cb = box(courtMask);
  const court = rect(cb.x0, cb.y0, cb.x1, cb.y1);
  if (court.x < 12 || court.y < 12) return fail('court-canvas');
  const court0 = rect(cxN0, cz0, cxN1, P2y);
  const stripN = {y0: P2y - STRIP, y1: P2y};
  const stripS = {y0: b3.y1, y1: b3.y1};
  // --- The escalator stack (scissor: one lane per storey pair, alternating lanes / directions) + the glass elevator, both in the
  // north strip, clear of each other; mouths >= 6 cells of walkway --------------------------------------------------------------------
  const RL = RUN_CELLS, M = 6;
  const runs: RunPlan[] = [];
  const cw = cxN1 - cxN0;
  if (cw < RL + 2 * M + 7 + 2 * M + 4) return fail('court-narrow');
  const ea = cxN0 + M + Math.round((cw - 2 * M - RL - 7 - M - 4) * f.escAt);
  const laneA = rect(ea, stripN.y0, ea + RL, stripN.y0 + 3), laneB = rect(ea, stripN.y0 + 3, ea + RL, stripN.y1);
  let lx = cxN0 + Math.round((cw - 7) * f.liftAt);
  const liftClear = (x: number) => x >= cxN0 + 2 && x + 7 <= cxN1 - 2 && (x + 7 <= ea - M - 2 || x >= ea + RL + M + 2);
  if (!liftClear(lx)) {
    let got = -1;
    for (let d = 1; d < cw && got < 0; d++) for (const x of [lx + d, lx - d]) if (liftClear(x)) { got = x; break; }
    if (got < 0) return fail('lift-strip');
    lx = got;
  }
  const shaft = rect(lx, stripN.y0, lx + 7, stripN.y1);
  const lift: LiftPlan = {shaft, cab: rect(lx + 1, stripN.y0 + 1, lx + 6, stripN.y0 + 5), landing: rect(lx, stripN.y0 - 4, lx + 7, stripN.y0), doorSide: 'N', door: {x: lx + 2, w: 3}};
  const upEast = rng.chance(0.5);
  runs.push({id: 'esc-0', kind: 'escalator', lower: 0, rect: laneA, axis: 'x', from: upEast ? 'hi' : 'lo', side: 'N', zone: 'atrium'});
  runs.push({id: 'esc-1', kind: 'escalator', lower: 1, rect: laneB, axis: 'x', from: upEast ? 'lo' : 'hi', side: 'N', zone: 'atrium'});
  runs.push({id: 'esc-2', kind: 'escalator', lower: 2, rect: laneA, axis: 'x', from: upEast ? 'hi' : 'lo', side: 'N', zone: 'atrium'});
  // --- Wings of the variant (attached to the court mask's actual edge row by row) ---------------------------------------------
  const walks: WalkPiece[] = [{id: 'court', rect: court, mask: courtMask, floors: range(1, FLOORS), zone: 'court', label: 'Atrium court'}];
  const ends: EndSpec[] = [];
  const WW = f.WW, zm = Math.round((court.y + court.y + court.h) / 2);
  const westEdge = (y0: number, y1: number) => { let e = -Infinity; for (let y = y0; y < y1; y++) for (let x = court.x; x < court.x + court.w; x++) if (courtMask[y * W + x]) { e = Math.max(e, x); break; } return e; };
  const eastEdge = (y0: number, y1: number) => { let e = Infinity; for (let y = y0; y < y1; y++) for (let x = court.x + court.w - 1; x >= court.x; x--) if (courtMask[y * W + x]) { e = Math.min(e, x + 1); break; } return e; };
  const southEdge = (x0: number, x1: number) => { let e = Infinity; for (let x = x0; x < x1; x++) for (let y = court.y + court.h - 1; y >= court.y; y--) if (courtMask[y * W + x]) { e = Math.min(e, y + 1); break; } return e; };
  const wing = (id: string, r: CellRect, floors: number[], zone: WalkPiece['zone'], label: string) => { walks.push({id, rect: r, floors, zone, label}); return r; };
  const endOf = (id: string, r: CellRect, dir: Side4, pref: Record<number, MallLotId>) => {
    const line = dir === 'W' ? r.x - 1 : dir === 'E' ? r.x + r.w : dir === 'N' ? r.y - 1 : r.y + r.h;
    const [a0, a1] = dir === 'W' || dir === 'E' ? [r.y, r.y + r.h] : [r.x, r.x + r.w];
    ends.push({id, dir, line, a0, a1, pref});
  };
  const stairs: {wing: string; r: CellRect; lower: number; side?: 'lo' | 'hi'}[] = [];
  // rows / columns of a wing must meet the court: clamp into the court's span
  const zClamp = (z: number) => clampZ(z, Math.max(court.y + 2, stripN.y1 + 1), court.y + court.h - 2 - WW);
  if (f.variant === 'terrace-cross') {
    // west wing (every floor; an anchor closes it on floor 1, end units above), east wing (floors 1-2) with a dead-end branch off
    // it on floor 1 (a short side arcade ending in a shop)
    const zw = zClamp(zm + f.wingOff - (WW >> 1));
    const xw1 = westEdge(zw, zw + WW);
    const wW = wing('wing-W', rect(xw1 - f.wingA, zw, xw1, zw + WW), [1, 2, 3], 'corridor', 'West wing');
    endOf('end-W', wW, 'W', {1: 'anchor-deep', 2: 'end-unit', 3: 'end-unit'});
    const ze = zClamp(zm - f.wingOff - (WW >> 1));
    const xe0 = eastEdge(ze, ze + WW);
    const wE = wing('wing-E', rect(xe0, ze, xe0 + f.wingB, ze + WW), [1, 2], 'corridor', 'East wing');
    endOf('end-E', wE, 'E', {1: 'end-unit', 2: 'end-unit'});
    const bx = xe0 + Math.round(f.wingB * rng.range(0.62, 0.72)), north = rng.chance(0.5), bw = 10;
    const br = north ? rect(bx, ze - f.branchLen, bx + bw, ze) : rect(bx, ze + WW, bx + bw, ze + WW + f.branchLen);
    wing('branch-E', br, [1], 'corridor', 'Side arcade');
    endOf('end-branch', br, north ? 'N' : 'S', {1: 'end-unit'});
    // floor 1 -> 2 stair in the east wing on the side away from the branch mouth; 2 -> 3 in the west wing
    stairs.push({wing: 'wing-E', r: wE, lower: 1, side: north ? 'hi' : 'lo'}, {wing: 'wing-W', r: wW, lower: 2});
  } else if (f.variant === 'arcade-loop') {
    // two arcades east of the court around a block of shops, joined by a small second court (a loop on floors 1-2; floor 3 keeps
    // the north arcade as a dead end), a short west branch with an end unit on floor 1
    const LA = f.wingA;
    // the block between the arcades holds two rows of shops back to back: arcades pushed out past the court's north / south edges
    const zn = court.y - rng.int(6, 10), zs = court.y + court.h - WW + rng.int(6, 10);
    // each arcade starts at the court's actual east edge along its own rows (the court steps in toward its south end); both end on
    // one line, where the second court joins them
    const xn0 = eastEdge(Math.max(zn, court.y), zn + WW), xs0 = eastEdge(zs, Math.min(zs + WW, court.y + court.h));
    const xE = Math.max(xn0, xs0) + LA;
    const nA = wing('arcade-N', rect(xn0, zn, xE, zn + WW), [1, 2, 3], 'corridor', 'North arcade');
    const sA = wing('arcade-S', rect(xs0, zs, xE, zs + WW), [1, 2], 'corridor', 'South arcade');
    const c2w = rng.int(18, 22);
    const c2 = wing('court-E', rect(xE, zn, xE + c2w, zs + WW), [1, 2], 'court2', 'East court');
    endOf('end-court-E', c2, 'E', {1: 'anchor-deep', 2: 'end-unit'});
    ends.push({id: 'end-arcade-N3', dir: 'E', line: nA.x + nA.w, a0: nA.y, a1: nA.y + nA.h, pref: {3: 'end-unit'}});
    const zw = zClamp(zm + f.wingOff - (WW >> 1));
    const xw1 = westEdge(zw, zw + WW);
    const wW = wing('branch-W', rect(xw1 - f.branchLen - 8, zw, xw1, zw + WW), [1], 'corridor', 'West arcade');
    endOf('end-W', wW, 'W', {1: 'end-unit'});
    stairs.push({wing: 'arcade-S', r: sA, lower: 1}, {wing: 'arcade-N', r: nA, lower: 2});
  } else {
    // an elbow: a south wing turning west (floors 1-2) and a west wing (every floor); on floor 1 a link joins their west ends
    // (a loop around the south-west block), on floor 2 both end in shops, floor 3 keeps the west wing
    const xs = clampZ(court.x + rng.int(2, 8), court.x + 2, court.x + court.w - 4 - WW);
    const ys0 = southEdge(xs, xs + WW);
    const LS = f.wingB;
    const sW = wing('wing-S', rect(xs, ys0, xs + WW, ys0 + LS), [1, 2], 'corridor', 'South wing');
    const zw = zClamp(zm + f.wingOff - (WW >> 1));
    const xw1 = westEdge(zw, zw + WW);
    const Xw = xw1 - f.wingA;
    const el = wing('elbow', rect(Xw, ys0 + LS, xs + WW, ys0 + LS + WW), [1, 2], 'corridor', 'South-west arcade');
    const wW = wing('wing-W', rect(Xw, zw, xw1, zw + WW), [1, 2, 3], 'corridor', 'West wing');
    if (ys0 + LS - (zw + WW) < 16) return fail('elbow-short');
    wing('link-W', rect(Xw, zw + WW, Xw + WW, ys0 + LS), [1], 'link', 'West link');
    endOf('end-W', wW, 'W', {1: 'end-unit', 2: 'end-unit', 3: 'end-unit'});
    endOf('end-elbow', el, 'W', {1: 'anchor-deep', 2: 'anchor-deep'});
    stairs.push({wing: 'wing-S', r: sW, lower: 1}, {wing: 'wing-W', r: wW, lower: 2});
  }
  for (const w of walks) if (w.rect.x < 10 || w.rect.y < 10 || w.rect.x + w.rect.w > W - 10 || w.rect.y + w.rect.h > H - 10) return fail('wing-canvas');
  // --- Public stairs in the wings (a second public route per storey pair, away from the atrium) ---------------------------------
  for (const s of stairs) {
    const r = s.r, alongX = r.w >= r.h;
    const len = alongX ? r.w : r.h;
    if (len < RL + 2 * M + 2) return fail(`stair-wing-${s.wing}`);
    const nearLo = s.side ? s.side === 'lo' : rng.chance(0.5);
    const lane = LANE.stair;
    const at = (off: number) => alongX
      ? rect(r.x + off, nearLo ? r.y : r.y + r.h - lane, r.x + off + RL, nearLo ? r.y + lane : r.y + r.h)
      : rect(nearLo ? r.x : r.x + r.w - lane, r.y + off, nearLo ? r.x + lane : r.x + r.w, r.y + off + RL);
    // clear of the court (and of its mouth margin) — slide along the wing away from it when the wing overlaps the court
    const inCourt = (q: CellRect) => { for (let y = q.y - M; y < q.y + q.h + M; y++) for (let x = q.x - (alongX ? M : 0); x < q.x + q.w + (alongX ? M : 0); x++) if (y >= 0 && courtMask[y * W + x] && (alongX ? y >= q.y && y < q.y + q.h : x >= q.x && x < q.x + q.w)) return true; return false; };
    const pref = M + Math.round((len - RL - 2 * M) * rng.range(0.3, 0.7));
    let sr: CellRect | null = null;
    for (let d = 0; d <= len && !sr; d++) for (const off of d ? [pref + d, pref - d] : [pref]) if (off >= M && off + RL + M <= len && !inCourt(at(off))) { sr = at(off); break; }
    if (!sr) return fail('stair-in-court');
    if (runs.some(q => overlaps(q.rect, sr, 6) && (q.lower === s.lower || q.lower + 1 === s.lower || q.lower === s.lower + 1))) return fail('stair-overlap');
    runs.push({id: `stair-${s.wing}-${s.lower}`, kind: 'stair', lower: s.lower, rect: sr, axis: alongX ? 'x' : 'z', from: rng.chance(0.5) ? 'hi' : 'lo', side: alongX ? (nearLo ? 'N' : 'S') : (nearLo ? 'W' : 'E'), zone: 'wing'});
  }
  const openRects = open.map((m, k) => { const b = openBox[k]; return decompose((x, y) => m[y * W + x] === 1, rect(b.x0, b.y0, b.x1, b.y1)); });
  return {W, px0, px1, P2y, ty0, P1y, P1b, open, openRects, openBox, court, courtMask, court0, stripN, stripS, walks, ends, runs, lift, foodFloor: f.foodFloor};
}

function range(a: number, b: number): number[] {
  return Array.from({length: b - a + 1}, (_, i) => a + i);
}
function clampZ(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
