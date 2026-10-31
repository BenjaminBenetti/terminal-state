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
  /** The court (gallery region incl. the openings) — the same on every retail floor. */
  court: CellRect;
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
  const bedRows = P1y - ty0;
  // --- Floor-1 opening (the station column): over the bed + the front of the north platform (the start stands under it) ---------
  const ox0 = px0 + Math.round((f.Lp - f.VW) * f.atX), ox1 = ox0 + f.VW;
  const overN = Math.min(f.overN + 4, P2.h - 6);
  const oz0 = ty0 - overN, oz1 = ty0 + bedRows + f.overS;
  const n = W * H;
  const o1 = new Uint8Array(n);
  const fillRect = (m: Uint8Array, r: CellRect, v = 1) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) m[y * W + x] = v; };
  fillRect(o1, rect(ox0, oz0, ox1, oz1));
  // irregular: a notched corner (a jutting floor-1 balcony) and / or a bay pushing the opening out on one side
  if (f.notch) {
    const nw = rng.int(5, 8), nh = rng.int(4, 6);
    const nx = f.notch.endsWith('W') ? ox0 : ox1 - nw, ny = f.notch.startsWith('N') ? oz0 : oz1 - nh;
    fillRect(o1, rect(nx, ny, nx + nw, ny + nh), 0);
  }
  if (f.bay === 'W' || f.bay === 'E') {
    const d = rng.int(3, 5), bz0 = oz0 + rng.int(3, 6), bz1 = oz1 - rng.int(3, 6);
    if (bz1 - bz0 >= 6) fillRect(o1, f.bay === 'W' ? rect(ox0 - d, bz0, ox0, bz1) : rect(ox1, bz0, ox1 + d, bz1));
  } else if (f.bay === 'S') {
    const d = rng.int(3, 4), bx0 = ox0 + rng.int(5, 9), bx1 = ox1 - rng.int(5, 9);
    if (bx1 - bx0 >= 8 && oz1 + d <= P1b - 4) fillRect(o1, rect(bx0, oz1, bx1, oz1 + d));
  }
  const box = (m: Uint8Array) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) if (m[i]) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
    return {x0, y0, x1, y1};
  };
  // --- Upper openings: the "plus" growth of the floor below's bounding box (stepped corners), nested; never past the north
  // platform's back edge (the north strip stays solid floor on every storey) --------------------------------------------------------
  const grow = (m: Uint8Array, s: readonly [number, number, number, number]): Uint8Array => {
    const b = box(m), out = m.slice();
    const N = Math.min(s[2], b.y0 - P2y);
    fillRect(out, rect(b.x0 - s[0], b.y0, b.x1 + s[1], b.y1));
    fillRect(out, rect(b.x0, b.y0 - Math.max(0, N), b.x1, b.y1 + s[3]));
    return out;
  };
  const o2 = grow(o1, f.step2), o3 = grow(o2, f.step3);
  const open = [o1, o1, o2, o3];
  const openBox = open.map(box);
  const b3 = openBox[3];
  if (b3.y0 < P2y) return fail('opening-north');
  // --- Court -------------------------------------------------------------------------------------------------------------------
  const cz0 = P2y - STRIP - WALK - rng.int(0, 2);
  const stripS = {y0: b3.y1, y1: b3.y1 + STRIP};
  const cz1 = Math.max(stripS.y1 + WALK + rng.int(0, 2), P1b);
  const cx0 = b3.x0 - f.gW, cx1 = b3.x1 + f.gE;
  const court = rect(cx0, cz0, cx1, cz1);
  if (cx0 < 12 || cz0 < 12) return fail('court-canvas');
  const court0 = rect(cx0, cz0, cx1, P2y);
  const stripN = {y0: P2y - STRIP, y1: P2y};
  // --- Runs in the court strips + the glass elevator --------------------------------------------------------------------------
  const RL = RUN_CELLS, M = 6;
  const runs: RunPlan[] = [];
  const cw = cx1 - cx0;
  // north strip: the station escalators (0 -> 1) and the floor 2 -> 3 bank stacked over them (scissor: opposite directions), the
  // elevator further along; both clear of each other and of the strip ends (mouths >= 6 cells of walkway)
  const ea = Math.max(cx0 + M, Math.min(cx1 - M - RL, cx0 + M + Math.round((cw - 2 * M - RL) * f.escAt)));
  const escN = rect(ea, stripN.y0, ea + RL, stripN.y1);
  let lx = cx0 + Math.round((cw - 7) * f.liftAt);
  const liftClear = (x: number) => x >= cx0 + 2 && x + 7 <= cx1 - 2 && (x + 7 <= escN.x - M - 2 || x >= escN.x + escN.w + M + 2);
  if (!liftClear(lx)) {
    let got = -1;
    for (let d = 1; d < cw && got < 0; d++) for (const x of [lx + d, lx - d]) if (liftClear(x)) { got = x; break; }
    if (got < 0) return fail('lift-strip');
    lx = got;
  }
  const shaft = rect(lx, stripN.y0, lx + 7, stripN.y1);
  const lift: LiftPlan = {shaft, cab: rect(lx + 1, stripN.y0 + 1, lx + 6, stripN.y0 + 5), landing: rect(lx, stripN.y0 - 4, lx + 7, stripN.y0), doorSide: 'N', door: {x: lx + 2, w: 3}};
  const upEast = rng.chance(0.5);
  runs.push({id: 'esc-N-0', kind: 'escalator', lower: 0, rect: escN, axis: 'x', from: upEast ? 'hi' : 'lo', side: 'N', zone: 'atrium'});
  runs.push({id: 'esc-N-2', kind: 'escalator', lower: 2, rect: escN, axis: 'x', from: upEast ? 'lo' : 'hi', side: 'N', zone: 'atrium'});
  // south strip: floor 1 -> 2, offset along the court from the north bank (a crisscross walk across the gallery)
  const sb = Math.max(cx0 + M, Math.min(cx1 - M - RL, cx1 - M - RL - Math.round((cw - 2 * M - RL) * f.escAt)));
  runs.push({id: 'esc-S-1', kind: 'escalator', lower: 1, rect: rect(sb, stripS.y0, sb + RL, stripS.y1), axis: 'x', from: rng.chance(0.5) ? 'hi' : 'lo', side: 'S', zone: 'atrium'});
  // --- Wings of the variant ----------------------------------------------------------------------------------------------------
  const walks: WalkPiece[] = [{id: 'court', rect: court, floors: range(1, FLOORS), zone: 'court', label: 'Atrium court'}];
  const ends: EndSpec[] = [];
  const WW = f.WW, zm = Math.round((cz0 + cz1) / 2);
  const wing = (id: string, r: CellRect, floors: number[], zone: WalkPiece['zone'], label: string) => { walks.push({id, rect: r, floors, zone, label}); return r; };
  const endOf = (id: string, r: CellRect, dir: Side4, pref: Record<number, MallLotId>) => {
    const line = dir === 'W' ? r.x - 1 : dir === 'E' ? r.x + r.w : dir === 'N' ? r.y - 1 : r.y + r.h;
    const [a0, a1] = dir === 'W' || dir === 'E' ? [r.y, r.y + r.h] : [r.x, r.x + r.w];
    ends.push({id, dir, line, a0, a1, pref});
  };
  const stairs: {wing: string; r: CellRect; lower: number}[] = [];
  if (f.variant === 'terrace-cross') {
    // west wing (every floor; an anchor closes it on floor 1, end units above), east wing (floors 1-2) with a dead-end branch off
    // it on floor 1 (a short side corridor ending in a shop)
    const zw = clampZ(zm + f.wingOff - (WW >> 1), cz0 + 4, cz1 - 4 - WW);
    const wW = wing('wing-W', rect(cx0 - f.wingA, zw, cx0, zw + WW), [1, 2, 3], 'corridor', 'West wing');
    endOf('end-W', wW, 'W', {1: 'anchor-deep', 2: 'end-unit', 3: 'end-unit'});
    const ze = clampZ(zm - f.wingOff - (WW >> 1), cz0 + 4, cz1 - 4 - WW);
    const wE = wing('wing-E', rect(cx1, ze, cx1 + f.wingB, ze + WW), [1, 2], 'corridor', 'East wing');
    endOf('end-E', wE, 'E', {1: 'end-unit', 2: 'end-unit'});
    const bx = cx1 + Math.round(f.wingB * rng.range(0.45, 0.6)), north = rng.chance(0.5), bw = 10;
    const br = north ? rect(bx, ze - f.branchLen, bx + bw, ze) : rect(bx, ze + WW, bx + bw, ze + WW + f.branchLen);
    wing('branch-E', br, [1], 'corridor', 'Side arcade');
    endOf('end-branch', br, north ? 'N' : 'S', {1: 'end-unit'});
    stairs.push({wing: 'wing-W', r: wW, lower: 1}, {wing: 'wing-W', r: wW, lower: 2});
  } else if (f.variant === 'arcade-loop') {
    // two arcades east of the court around a block of shops, joined by a small second court (a loop on floors 1-2; floor 3 keeps
    // the north arcade as a dead end), a short west branch with an end unit on floor 1
    const a = rng.int(-6, -2), LA = f.wingA;
    const nA = wing('arcade-N', rect(cx1, cz0 + a, cx1 + LA, cz0 + a + WW), [1, 2, 3], 'corridor', 'North arcade');
    const sA = wing('arcade-S', rect(cx1, cz1 - a - WW, cx1 + LA, cz1 - a), [1, 2], 'corridor', 'South arcade');
    const c2w = rng.int(18, 24);
    const c2 = wing('court-E', rect(cx1 + LA, cz0 + a, cx1 + LA + c2w, cz1 - a), [1, 2], 'court2', 'East court');
    endOf('end-court-E', c2, 'E', {1: 'anchor-deep', 2: 'end-unit'});
    // floor 3: the north arcade ends at the court's west edge line (no court there) -> an end unit
    ends.push({id: 'end-arcade-N3', dir: 'E', line: nA.x + nA.w, a0: nA.y, a1: nA.y + nA.h, pref: {3: 'end-unit'}});
    const zw = clampZ(zm + f.wingOff - (WW >> 1), cz0 + 4, cz1 - 4 - WW);
    const wW = wing('branch-W', rect(cx0 - f.branchLen - 8, zw, cx0, zw + WW), [1], 'corridor', 'West arcade');
    endOf('end-W', wW, 'W', {1: 'end-unit'});
    stairs.push({wing: 'arcade-S', r: sA, lower: 1}, {wing: 'arcade-N', r: nA, lower: 2});
  } else {
    // an elbow: a south wing turning west (floors 1-2) and a west wing (every floor); on floor 1 a link joins their west ends
    // (a loop around the south-west block), on floor 2 both end in shops, floor 3 keeps the west wing
    const xs = clampZ(cx0 + Math.round((cx1 - cx0) * rng.range(0.15, 0.35)), cx0 + 4, cx1 - 4 - WW);
    const LS = f.wingB;
    const sW = wing('wing-S', rect(xs, cz1, xs + WW, cz1 + LS), [1, 2], 'corridor', 'South wing');
    const Xw = cx0 - f.wingA;
    const el = wing('elbow', rect(Xw, cz1 + LS, xs + WW, cz1 + LS + WW), [1, 2], 'corridor', 'South-west arcade');
    const zw = clampZ(zm + f.wingOff - (WW >> 1), cz0 + 4, cz1 - 6 - WW);
    const wW = wing('wing-W', rect(Xw, zw, cx0, zw + WW), [1, 2, 3], 'corridor', 'West wing');
    wing('link-W', rect(Xw, zw + WW, Xw + WW, cz1 + LS), [1], 'link', 'West link');
    endOf('end-W', wW, 'W', {1: 'end-unit', 2: 'end-unit', 3: 'end-unit'});
    endOf('end-elbow', el, 'W', {1: 'anchor-deep', 2: 'anchor-deep'});
    stairs.push({wing: 'wing-S', r: sW, lower: 1}, {wing: 'wing-W', r: wW, lower: 2});
  }
  for (const w of walks) if (w.rect.x < 10 || w.rect.y < 10 || w.rect.x + w.rect.w > W - 10 || w.rect.y + w.rect.h > H - 10) return fail('wing-canvas');
  // --- Public stairs in the wings (a second public route per storey pair, away from the atrium) ---------------------------------
  for (const s of stairs) {
    const r = s.r, alongX = r.w >= r.h;
    // against the wing side whose frontage is cheaper (seeded), centred along the wing, mouths >= 6 cells inside it
    const len = alongX ? r.w : r.h;
    if (len < RL + 2 * M + 4) return fail(`stair-wing-${s.wing}`);
    const off = Math.round((len - RL) * rng.range(0.35, 0.65));
    const nearLo = rng.chance(0.5);
    const lane = LANE.stair;
    const sr = alongX
      ? rect(r.x + off, nearLo ? r.y : r.y + r.h - lane, r.x + off + RL, nearLo ? r.y + lane : r.y + r.h)
      : rect(nearLo ? r.x : r.x + r.w - lane, r.y + off, nearLo ? r.x + lane : r.x + r.w, r.y + off + RL);
    if (runs.some(q => overlaps(q.rect, sr, 6) && (q.lower === s.lower || q.lower + 1 === s.lower || q.lower === s.lower + 1))) return fail('stair-overlap');
    runs.push({id: `stair-${s.wing}-${s.lower}`, kind: 'stair', lower: s.lower, rect: sr, axis: alongX ? 'x' : 'z', from: rng.chance(0.5) ? 'hi' : 'lo', side: alongX ? (nearLo ? 'N' : 'S') : (nearLo ? 'W' : 'E'), zone: 'wing'});
  }
  const openRects = open.map((m, k) => { const b = openBox[k]; return decompose((x, y) => m[y * W + x] === 1, rect(b.x0, b.y0, b.x1, b.y1)); });
  return {W, px0, px1, P2y, ty0, P1y, P1b, open, openRects, openBox, court, court0, stripN, stripS, walks, ends, runs, lift, foodFloor: f.foodFloor};
}

function range(a: number, b: number): number[] {
  return Array.from({length: b - a + 1}, (_, i) => a + i);
}
function clampZ(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
