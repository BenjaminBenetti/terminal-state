// Task reactor-playtest-round2-20261102 (lane ARRIVAL): THE ARRIVAL APPROACH of the Reactor — user (play test 2): "the reactor pit is to
// close to the subway stop. You should have to traverse through a small station area, before going through a hole in a wall, through a
// small tunnel, then you hit the reactor area!".
//
// The rim station no longer opens onto the pit. Between the platform's south wall and the pit's north wall the frame keeps a band of
// rock (`ReactorFrame.sep` rows, 14-17 m). Carved into it, on the rim storey (level 0, floor 0), ONE physical route:
//   platform --(1-2 wide openings in the platform wall)--> a SMALL STATION AREA (a ticket hall / concourse, 1-3 back-of-house rooms,
//   sometimes a service corridor) --> a BREACH: a hole broken through one of its walls (no door record, no frame: the open cells of the
//   bore run through the wall) --> a SHORT ROUGH TUNNEL (ragged rect segments of jittered width / centre / ceiling, rock finishes,
//   always at least one bend: no line of sight from the platform) --> a second hole through the pit's north wall onto the rim gallery:
//   the reveal.
// Recipes (seeded): 'hall' (the breach in the ticket hall's end wall), 'corridor' (a staff door into a service corridor, the breach at its
// far end), 'backroom' (the breach in the side wall of a store / electrical room behind the hall). The room program, the hall's size and
// position along the platform, the tunnel's direction / lengths / jitter and the reveal's position along the pit wall vary too.
//
// Canonical frame (gen/reactor/frame.ts): pit-local cells (px, pz), the station NORTH of the pit (pz < 0), 'E' variants mirror x on
// stamping (rectC). Rows: platform [-(Pd+1+sep), -(2+sep)], the platform wall row W0 = -(1+sep), the band [-sep, -2], the pit wall row
// -1, the rim gallery from pz 0. Pure data; draws only from the rng it is given (a fork of the attempt's stream).

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, SOLID, VOID, type Grid} from '../grid';
import type {Kit} from '../stationKit';
import type {Area, AreaKind, LightPlacement, Rect, RoomType, SignPlacement, StationLayout} from '../stationTypes';
import type {ReactorApproach, ReactorRect} from './reactorTypes';
import {ARRIVAL_SEP} from './frame';

/** Arrival dimensions (cells unless noted). */
export const ARRIVAL = {
  /** Band of rock between the platform's south wall and the pit's north wall (frame.ts draws it). */
  sep: ARRIVAL_SEP,
  /** Ticket hall: along the platform x deep. */
  hallAlong: [22, 32] as [number, number],
  hallDeep: [10, 12] as [number, number],
  hallCeil: 4.2,
  /** Platform -> hall openings: width, count. */
  door: [6, 8] as [number, number],
  /** Tunnel bore: width (cells), segment length, ceiling (m), lateral leg length. */
  bore: [4, 6] as [number, number],
  seg: [5, 8] as [number, number],
  boreCeil: [2.9, 3.5] as [number, number],
  lateral: [12, 26] as [number, number],
  /** Accepted tunnel centreline length (m): "a few tens of metres at most". */
  lengthM: [10, 30] as [number, number],
  /** The reveal hole stays this many cells off the pit's corners. */
  corner: 6,
} as const;

export type ArrivalRecipe = 'hall' | 'corridor' | 'backroom';
export const ARRIVAL_RECIPES: readonly ArrivalRecipe[] = ['hall', 'corridor', 'backroom'];

/** What carveArrival returns (canvas cells; the crop origin is (0, 0), so these ARE grid cells). */
export interface ArrivalCarve {
  recipe: ArrivalRecipe;
  hall: Area;
  corridor: Area | null;
  /** Back-of-house rooms of the station area (the breached room first in 'backroom'). */
  rooms: Area[];
  /** Tunnel segments, breach first, reveal last. */
  tunnel: Area[];
  /** Platform -> hall openings (door rects). */
  platformDoors: Rect[];
  /** The breached wall cells (one wall thickness) and the area whose wall it is. */
  breach: Rect;
  breachFrom: number;
  /** The pit-wall cells of the reveal hole and the rim gallery area beyond it. */
  reveal: Rect;
  revealDeck: number;
  /** Tunnel centreline (canvas cell coordinates, continuous), breach -> reveal. */
  path: {x: number; z: number}[];
}

export interface ArrivalInput {
  k: Kit;
  rng: Rng;
  sep: number;
  PX0: number; PZ0: number; PW: number; PD: number;
  /** Platform canonical span [p0, p1) along px and its area. */
  p0: number; p1: number;
  platform: Area;
  /** The rim gallery on the north wall (pz 0 .. gwR). */
  rimN: {area: number};
  cx: (px: number) => number;
  rectC: (px: number, pz: number, w: number, h: number) => Rect;
  /** Canvas core bounds (cells). */
  coreW: number; coreH: number;
}

/** Why arrival attempts failed (QA / tests). */
export const ARRIVAL_FAILS: Record<string, number> = {};
const miss = (why: string): null => { ARRIVAL_FAILS[why] = (ARRIVAL_FAILS[why] ?? 0) + 1; return null; };

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

interface CRect { px: number; pz: number; w: number; h: number }

/**
 * Carves the arrival approach into the rim storey of `inp.k` (after the pit decks, before the side-complex slots and the rooms). Tries
 * the seeded recipe first, then the others, several draws each; null when nothing fits (the caller re-rolls the frame).
 */
export function carveArrival(inp: ArrivalInput): ArrivalCarve | null {
  const {rng} = inp;
  const first = rng.pick(ARRIVAL_RECIPES);
  const order = [first, ...rng.shuffle(ARRIVAL_RECIPES.filter(r => r !== first))];
  for (const recipe of order) {
    for (let t = 0; t < 10; t++) {
      const res = tryRecipe(inp, recipe, rng.fork(`arrival-${recipe}-${t}`));
      if (res) return res;
    }
  }
  return miss('no-recipe');
}

// ---------------------------------------------------------------------------------------------

/** One recipe draw on a scratch transaction: commits only when the whole route fits and nothing on the platform sees the pit. */
function tryRecipe(inp: ArrivalInput, recipe: ArrivalRecipe, rng: Rng): ArrivalCarve | null {
  const {k, sep, PW, rectC, cx, PZ0, p0, p1} = inp;
  const g = k.grid(0);
  const B0 = -sep, W0 = -(1 + sep);
  const tx = new Txn(k);
  const isSolid = (px: number, pz: number) => { const x = cx(px), y = PZ0 + pz; return g.inBounds(x, y) && g.cells[g.idx(x, y)] === SOLID; };
  /** The canonical rect (+ a 1-cell margin) is rock except cells of `allow` areas; inside the core canvas; above the pit (pz <= -1). */
  const free = (r: CRect, allow: ReadonlySet<number>, margin = 1): boolean => {
    const c = rectC(r.px, r.pz, r.w, r.h);
    if (c.x - 1 < 3 || c.y - 1 < 3 || c.x + c.w + 1 > inp.coreW - 3 || c.y + c.h + 1 > inp.coreH - 3) return false;
    if (r.pz + r.h > 0) return false;
    for (let pz = r.pz - margin; pz < r.pz + r.h + margin; pz++) for (let px = r.px - margin; px < r.px + r.w + margin; px++) {
      const inner = pz >= r.pz && pz < r.pz + r.h && px >= r.px && px < r.px + r.w;
      const x = cx(px), y = PZ0 + pz;
      if (!g.inBounds(x, y)) return false;
      const i = g.idx(x, y);
      if (g.cells[i] === SOLID) continue;
      if (!inner && allow.has(g.area[i])) continue;
      return false;
    }
    return true;
  };

  // --- the ticket hall: against the platform wall, somewhere along the platform ------------------------------------------------
  const hw = rng.int(...ARRIVAL.hallAlong), hd = rng.int(...ARRIVAL.hallDeep);
  let dir: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  const bw = rng.int(...ARRIVAL.bore);
  let L1 = rng.int(...ARRIVAL.lateral);
  // recipe sizes (drawn up front: they set how far the station area reaches back from the reveal column)
  const lc = rng.int(10, 18), cw = rng.int(4, 5);
  const ra = rng.int(10, 13), rd = rng.int(9, 10), over = rng.int(4, Math.max(4, ra - 4));
  const reach = () => (recipe === 'hall' ? L1 + hw : recipe === 'corridor' ? Math.max(8, L1 - lc) + lc + 1 + hw : L1 + ra - over + hw) + 1;
  // the reveal column (the tunnel's down leg): where the whole station area still lies under the platform
  const span = (d: 1 | -1): [number, number] => d > 0 ? [Math.max(ARRIVAL.corner, p0 + 3 + reach()), PW - ARRIVAL.corner - bw] : [ARRIVAL.corner, Math.min(PW - ARRIVAL.corner - bw, p1 - 3 - bw - reach())];
  let [lo, hi] = span(dir);
  if (hi < lo) { dir = dir > 0 ? -1 : 1; [lo, hi] = span(dir); }
  if (hi < lo) { L1 = ARRIVAL.lateral[0]; [lo, hi] = span(dir); }
  if (hi < lo) return miss('reveal-span');
  const dx = rng.int(lo, hi);
  let hall: Area | null = null, corridor: Area | null = null, src: Area | null = null;
  const rooms: Area[] = [];
  /** Breach source wall: the column (canonical px) of the wall cell and the rows it may span. */
  let wallPx = 0, rowLo = 0, rowHi = 0;
  const hallAt = (px: number): Area | null => {
    if (px < p0 + 3 || px + hw > p1 - 3) return null;
    const r: CRect = {px, pz: B0, w: hw, h: hd};
    if (!free(r, new Set([inp.platform.id]))) return null;
    return tx.area(rectC(r.px, r.pz, r.w, r.h), 'concourse', rng.chance(0.5) ? 'concourse' : 'fare-hall', ARRIVAL.hallCeil, inp.platform.id, {label: 'Ticket hall', publicSpace: true});
  };
  const sideRoom = (spec: RoomSpec, r: CRect, parent: Area): Area | null => {
    if (!free(r, new Set())) return null;
    const a = tx.area(rectC(r.px, r.pz, r.w, r.h), spec.kind ?? 'room', spec.type, spec.ceil ?? 3.4, parent.id, {label: spec.label, publicSpace: false});
    a.purpose = spec.purpose;
    return a;
  };
  const program = rng.shuffle(ROOM_POOL.slice());

  if (recipe === 'hall') {
    // the hall's end wall is breached; the lateral leg runs from it toward the reveal column
    const wall = dx + (dir > 0 ? 0 : bw) - dir * L1;
    hall = hallAt(dir > 0 ? wall - hw : wall + 1);
    if (!hall) return tx.abort('hall-fit');
    src = hall; wallPx = wall; rowLo = B0 + 1; rowHi = B0 + hd - 1;
  } else if (recipe === 'corridor') {
    // hall | staff door | service corridor (side rooms off it) | breach at its far end
    const L2 = Math.max(8, L1 - lc);
    const wall = dx + (dir > 0 ? 0 : bw) - dir * L2;
    const cpx = dir > 0 ? wall - lc : wall + 1; // corridor columns [cpx, cpx + lc)
    const hpx = dir > 0 ? cpx - 1 - hw : cpx + lc + 1;
    hall = hallAt(hpx);
    if (!hall) return tx.abort('hall-fit');
    const cpz = B0 + hd - cw - rng.int(0, Math.max(0, hd - cw - 3));
    const cr: CRect = {px: cpx, pz: cpz, w: lc, h: cw};
    if (!free(cr, new Set())) return tx.abort('corridor-fit');
    corridor = tx.area(rectC(cr.px, cr.pz, cr.w, cr.h), 'service', 'service-corridor', 3.0, hall.id, {label: 'Service corridor', publicSpace: false});
    corridor.purpose = 'service-corridor';
    // staff door through the hall's end wall (the column between them)
    const dwc = dir > 0 ? cpx - 1 : cpx + lc;
    tx.door(rectC(dwc, cpz + Math.floor((cw - Math.min(cw, 4)) / 2), 1, Math.min(cw, 4)), hall, corridor, 2.4, {staff: true});
    // a room off the corridor's south side (rows below it) when the band leaves room
    const spec = program.shift()!;
    const ra2 = Math.min(lc, ra);
    const rr: CRect = {px: dir > 0 ? cpx : cpx + lc - ra2, pz: cpz + cw + 1, w: ra2, h: rd};
    const room = rr.pz + rr.h <= -3 ? sideRoom(spec, rr, corridor) : null;
    if (room) {
      rooms.push(room);
      const d0 = rng.int(1, Math.max(1, ra2 - 5));
      tx.door(rectC(rr.px + d0, cpz + cw, Math.min(4, ra2 - 2), 1), corridor, room, 2.4, {staff: true});
    } else program.unshift(spec);
    src = corridor; wallPx = wall; rowLo = cpz; rowHi = cpz + cw;
  } else {
    // a store / electrical room behind the hall (its door in the hall's south wall); the breach in the room's far side wall
    const spec = rng.pick(BREACH_ROOMS);
    const wall = dx + (dir > 0 ? 0 : bw) - dir * L1;
    const rpx = dir > 0 ? wall - ra : wall + 1;
    // the hall overlaps the room's columns: its end comes `over` cells past the room's near end
    hall = hallAt(dir > 0 ? rpx + over - hw : rpx + ra - over);
    if (!hall) return tx.abort('hall-fit');
    const rr: CRect = {px: rpx, pz: B0 + hd + 1, w: ra, h: rd};
    if (rr.pz + rr.h > -3) return tx.abort('backroom-band');
    const room = sideRoom(spec, rr, hall);
    if (!room) return tx.abort('backroom-fit');
    rooms.push(room);
    // its door: the shared wall row under the hall, inside both spans
    const s0 = Math.max(rr.px, canonSpan(inp, hall)[0]) + 1, s1 = Math.min(rr.px + ra, canonSpan(inp, hall)[1]) - 1;
    if (s1 - s0 < 3) return tx.abort('backroom-door');
    const dw = Math.min(4, s1 - s0), d0 = s0 + rng.int(0, s1 - s0 - dw);
    tx.door(rectC(d0, B0 + hd, dw, 1), hall, room, 2.4, {staff: true});
    src = room; wallPx = wall; rowLo = rr.pz + 1; rowHi = rr.pz + rd - 1;
  }

  // --- the platform openings (1-2) into the hall ---------------------------------------------------------------------------------
  const [h0, h1] = canonSpan(inp, hall);
  const nDoors = hw >= 26 && rng.chance(0.5) ? 2 : 1;
  const platformDoors: Rect[] = [];
  {
    const ow = rng.int(...ARRIVAL.door), lo = Math.max(h0 + 2, p0 + 2), hi = Math.min(h1 - 2, p1 - 2) - ow;
    if (hi < lo) return tx.abort('platform-door');
    const spots = nDoors === 2 && hi - lo >= ow + 4 ? [lo + rng.int(0, 2), hi - rng.int(0, 2)] : [lo + rng.int(0, hi - lo)];
    for (const s of spots) {
      const r = rectC(s, W0, ow, 1);
      tx.door(r, inp.platform, hall, 4.0, {});
      platformDoors.push(r);
    }
  }

  // --- the breach + the rough tunnel ----------------------------------------------------------------------------------------------
  const bore = boreRoute(inp, rng, tx, free, isSolid, {src: src!, wallPx, rowLo, rowHi, dir, dx, bw});
  if (!bore) return tx.abort('tunnel');

  // --- more back of house off the hall (1-2), clear of the tunnel ---------------------------------------------------------------
  const want = recipe === 'hall' ? rng.int(1, 3) : rng.int(0, 2);
  for (let n = 0; n < want && program.length; n++) {
    const spec = program.shift()!;
    const ra = rng.int(10, 14), rd = rng.int(9, 11);
    const sides: ('S' | 'end')[] = rng.shuffle(['S', 'end']);
    let placed: Area | null = null;
    for (const side of sides) {
      if (placed) break;
      if (side === 'S') {
        for (let tries = 0; tries < 6 && !placed; tries++) {
          const px = h0 + rng.int(0, Math.max(0, hw - ra)), r: CRect = {px, pz: B0 + hd + 1, w: ra, h: rd};
          if (r.pz + r.h > -3) break;
          placed = sideRoom(spec, r, hall);
          if (placed) { const dw = 4, d0 = px + 1 + rng.int(0, Math.max(0, ra - dw - 2)); tx.door(rectC(d0, B0 + hd, dw, 1), hall, placed, 2.4, {staff: true}); }
        }
      } else {
        // the hall's far end (away from the tunnel), rows within the band
        const ra2 = Math.min(rd, hd + 4), rows = Math.min(sep - 3, ra);
        const px = dir > 0 ? h0 - 1 - ra2 : h1 + 1, r: CRect = {px, pz: B0, w: ra2, h: rows};
        placed = sideRoom(spec, r, hall);
        if (placed) { const dw = 4, z0 = B0 + 1 + rng.int(0, Math.max(0, Math.min(hd, rows) - dw - 2)); tx.door(rectC(dir > 0 ? h0 - 1 : h1, z0, 1, dw), hall, placed, 2.4, {staff: true}); }
      }
    }
    if (placed) rooms.push(placed);
  }

  const out: ArrivalCarve = {
    recipe, hall, corridor, rooms, tunnel: bore.segs, platformDoors, breach: bore.breach, breachFrom: src!.id, reveal: bore.reveal, revealDeck: inp.rimN.area, path: bore.path,
  };
  // the guard: nothing on the platform sees through the reveal hole (the only opening of the band onto the pit)
  if (platformSees(g, inp.platform, out.reveal)) return tx.abort('sightline');
  tx.commit();
  return out;
}

/** Canonical px span [a0, a1) of a canvas area rect. */
function canonSpan(inp: ArrivalInput, a: Rect): [number, number] {
  const p = inp.cx(0) < inp.cx(1) ? a.x - inp.PX0 : inp.PX0 + inp.PW - 1 - (a.x + a.w - 1);
  return [p, p + a.w];
}

// ---------------------------------------------------------------------------------------------
// The bore

interface BoreSpec { src: Area; wallPx: number; rowLo: number; rowHi: number; dir: 1 | -1; dx: number; bw: number }

/**
 * The breach + the tunnel: a lateral leg (along x, from the source's wall column toward the reveal column) and the down leg (along z,
 * through the pit wall row onto the rim gallery). Ragged: segment widths / centres / ceilings jitter; consecutive segments always share
 * >= 3 cells of their touching edge (1.5 m: a walkable seam).
 */
function boreRoute(inp: ArrivalInput, rng: Rng, tx: Txn, free: (r: CRect, allow: ReadonlySet<number>, margin?: number) => boolean,
  isSolid: (px: number, pz: number) => boolean, s: BoreSpec): {segs: Area[]; breach: Rect; reveal: Rect; path: {x: number; z: number}[]} | null {
  const {rectC} = inp;
  const segs: Area[] = [];
  const path: {x: number; z: number}[] = [];
  const toCanvas = (px: number, pz: number) => ({x: inp.cx(0) < inp.cx(1) ? inp.PX0 + px : inp.PX0 + inp.PW - px, z: inp.PZ0 + pz});
  const add = (r: CRect, allow: Set<number>, label: string): Area | null => {
    if (!free(r, allow)) return miss('bore-1');
    const a = tx.area(rectC(r.px, r.pz, r.w, r.h), 'service', 'service-corridor', r2(rng.range(...ARRIVAL.boreCeil)), s.src.id, {label, publicSpace: false});
    segs.push(a);
    return a;
  };
  // the breach rows: inside the source's wall span, >= 1 cell off its corners
  const w0 = Math.min(rng.int(...ARRIVAL.bore), s.rowHi - s.rowLo);
  if (w0 < 4) return miss('bore-2');
  let c = s.rowLo + rng.int(0, s.rowHi - s.rowLo - w0) + w0 / 2; // lateral centre row (continuous)
  // lateral leg: from the wall column to the elbow (the reveal column's segment)
  const elbowLo = s.dx - 1, elbowHi = s.dx + s.bw + 1; // elbow columns [lo, hi)
  let x = s.wallPx; // next column to fill (canonical), moving by dir
  const end = s.dir > 0 ? elbowLo : elbowHi - 1;
  let prev: Area | null = null, w = w0;
  const breachRows = {lo: Math.round(c - w0 / 2), hi: Math.round(c - w0 / 2) + w0};
  for (let n = 0; (s.dir > 0 ? x < end : x > end); n++) {
    const rem = Math.abs(end - x);
    let len = Math.min(rng.int(...ARRIVAL.seg), rem);
    if (rem - len < 4) len = rem; // no sliver segment at the end of the leg
    if (n > 0) { w = rng.int(...ARRIVAL.bore); c += rng.pick([-1, 0, 0, 1]); }
    let lo = Math.round(c - w / 2);
    if (n === 0) lo = breachRows.lo;
    // keep the overlap with the previous segment (>= 3 rows) and the leg inside the band (off the platform wall, off the pit wall)
    if (prev) {
      const pr = prevRows(prev);
      lo = Math.max(pr.lo - w + 3, Math.min(pr.hi - 3, lo));
      lo = Math.max(-inp.sep, Math.min(-5 - w, lo));
      if (Math.min(pr.hi, lo + w) - Math.max(pr.lo, lo) < 3) return miss('bore-3');
    }
    const r: CRect = {px: s.dir > 0 ? x : x - len + 1, pz: lo, w: len, h: n === 0 ? w0 : w};
    const allow = new Set<number>(prev ? segs.map(q => q.id) : [s.src.id]);
    const a = add(r, allow, 'Breach tunnel');
    if (!a) return miss('bore-4');
    path.push(toCanvas(r.px + r.w / 2, r.pz + r.h / 2));
    prev = a;
    x += s.dir * len;
  }
  if (!prev) return miss('bore-5');
  // the elbow: the reveal column's width (+ jitter), the lateral leg's rows
  const pr = prevRows(prev);
  const ew = Math.max(4, Math.min(6, s.bw + 2));
  const elbow: CRect = {px: s.dir > 0 ? elbowLo : elbowHi - ew, pz: pr.lo + rng.int(-1, 1), w: ew, h: Math.max(4, Math.min(6, pr.hi - pr.lo))};
  elbow.pz = Math.max(pr.lo - elbow.h + 3, Math.min(pr.hi - 3, elbow.pz));
  elbow.pz = Math.max(-inp.sep, Math.min(-5 - elbow.h, elbow.pz));
  if (Math.min(pr.hi, elbow.pz + elbow.h) - Math.max(pr.lo, elbow.pz) < 3) return miss('bore-elbow');
  let ea = add(elbow, new Set(segs.map(q => q.id)), 'Breach tunnel');
  if (!ea) return miss('bore-6');
  path.push(toCanvas(elbow.px + elbow.w / 2, elbow.pz + elbow.h / 2));
  // down leg: from under the elbow to the pit wall row (-1), each segment overlapping the one above by >= 3 columns
  let z = elbow.pz + elbow.h, cc = elbow.px + elbow.w / 2, last: Area = ea;
  let lastCols = {lo: elbow.px, hi: elbow.px + elbow.w};
  while (z <= -1) {
    let len = Math.min(rng.int(...ARRIVAL.seg), -z);
    if (-z - len < 4) len = -z; // the reveal segment is never a sliver
    const wd = rng.int(...ARRIVAL.bore);
    cc += rng.pick([-1, 0, 0, 1]);
    let lo = Math.round(cc - wd / 2);
    lo = Math.max(lastCols.lo - wd + 3, Math.min(lastCols.hi - 3, lo));
    // the reveal (the segment through the pit wall row) stays clear of the pit's corners
    if (z + len - 1 >= -1) lo = Math.max(ARRIVAL.corner, Math.min(inp.PW - ARRIVAL.corner - wd, lo));
    if (Math.min(lastCols.hi, lo + wd) - Math.max(lastCols.lo, lo) < 3) return miss('bore-7');
    const r: CRect = {px: lo, pz: z, w: wd, h: len};
    // the last segment opens onto the rim gallery (its deck cells are allowed in the margin)
    const allow = new Set<number>(segs.map(q => q.id));
    if (z + len - 1 >= -1) allow.add(inp.rimN.area);
    const a = add(r, allow, 'Breach tunnel');
    if (!a) return miss('bore-8');
    path.push(toCanvas(r.px + r.w / 2, r.pz + r.h / 2));
    lastCols = {lo, hi: lo + wd};
    last = a;
    z += len;
    void ea; ea = a;
  }
  // the reveal: the segment's cells in the pit wall row, every one with rim gallery floor right beyond it
  const lastR = prevRect(inp, last);
  for (let px = lastR.px; px < lastR.px + lastR.w; px++) if (isSolid(px, 0)) return miss('bore-9');
  path.push(toCanvas(lastR.px + lastR.w / 2, 0.5));
  // the first point: the breach's middle on the source's side of the wall
  path.unshift(toCanvas(s.wallPx + (s.dir > 0 ? 0 : 1), (breachRows.lo + breachRows.hi) / 2));
  const breach = rectC(s.wallPx, breachRows.lo, 1, w0);
  const reveal = rectC(lastR.px, -1, lastR.w, 1);
  return {segs, breach, reveal, path};

  function prevRows(a: Area): {lo: number; hi: number} { return {lo: a.y - inp.PZ0, hi: a.y - inp.PZ0 + a.h}; }
}

function prevRect(inp: ArrivalInput, a: Area): CRect {
  const [p] = canonSpan(inp, a);
  return {px: p, pz: a.y - inp.PZ0, w: a.w, h: a.h};
}

// ---------------------------------------------------------------------------------------------
// Rooms of the station area

interface RoomSpec { type: RoomType; label: string; purpose: string; kind?: AreaKind; ceil?: number }
/** The back-of-house rooms a small station area plausibly has (gen/purposes.ts back-of-house purposes; dressed by the station dresser). */
const ROOM_POOL: readonly RoomSpec[] = [
  {type: 'agent-office', label: 'Ticket office', purpose: 'agent-office'},
  {type: 'crew-room', label: 'Station staff room', purpose: 'staff-room'},
  {type: 'washroom', label: 'Washroom', purpose: 'washroom'},
  {type: 'storage', label: 'Custodial room', purpose: 'custodial-room', ceil: 3.2},
  {type: 'crew-room', label: 'Crew locker room', purpose: 'locker-room'},
  {type: 'utility', label: 'First-aid room', purpose: 'first-aid-room'},
];
/** Rooms whose back wall it is plausible to find broken through (recipe 'backroom'). */
const BREACH_ROOMS: readonly RoomSpec[] = [
  {type: 'utility', label: 'Electrical room', purpose: 'electrical-room'},
  {type: 'storage', label: 'Maintenance storage', purpose: 'storage', ceil: 3.2},
  {type: 'utility', label: 'Signal relay room', purpose: 'signal-room'},
];

// ---------------------------------------------------------------------------------------------
// A scratch transaction on the Kit (areas / doors added by a recipe draw are undone when it does not fit)

class Txn {
  private readonly areas0: number;
  private readonly doors0: number;
  /** Cells written by doors (index, previous cell / area / ceil / floor). */
  private readonly undo: [number, number, number, number, number][] = [];
  constructor(private readonly k: Kit) { this.areas0 = k.areas.length; this.doors0 = k.doors.length; }
  area(r: Rect, kind: AreaKind, type: RoomType, ceil: number, parent: number, opts: {label: string; publicSpace: boolean}): Area {
    return this.k.addArea(r, kind, type, ceil, parent, opts);
  }
  door(r: Rect, a: Area, b: Area, h: number, extra: {staff?: boolean}): void {
    const g = this.k.grid(0);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = g.idx(x, y); this.undo.push([i, g.cells[i], g.area[i], g.ceil[i], g.floor[i]]); }
    this.k.carveDoor(r, a, b, h, false, extra);
  }
  abort(why: string): null {
    const g = this.k.grid(0);
    for (let n = this.undo.length - 1; n >= 0; n--) { const [i, c, a, ce, f] = this.undo[n]; g.cells[i] = c; g.area[i] = a; g.ceil[i] = ce; g.floor[i] = f; }
    this.k.doors.length = this.doors0;
    while (this.k.areas.length > this.areas0) this.k.undoLast(this.k.areas[this.k.areas.length - 1]);
    return miss(why);
  }
  commit(): void { this.undo.length = 0; }
}

// ---------------------------------------------------------------------------------------------
// Sight

/**
 * True when some platform cell sees a cell of the reveal hole along a straight line through open (non-rock) rim-storey cells (sampled
 * every quarter cell; corners count as closed). The reveal is the band's only opening onto the pit, so false = the pit is hidden.
 */
export function platformSees(g: Grid, platform: Rect, reveal: Rect): boolean {
  const open = (x: number, y: number) => g.inBounds(x, y) && (g.cells[g.idx(x, y)] === FLOOR || g.cells[g.idx(x, y)] === VOID);
  const targets: [number, number][] = [];
  for (let y = reveal.y; y < reveal.y + reveal.h; y++) for (let x = reveal.x; x < reveal.x + reveal.w; x++) for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]]) targets.push([x + ox, y + oy]);
  for (let y = platform.y; y < platform.y + platform.h; y += 2) for (let x = platform.x; x < platform.x + platform.w; x += 1) {
    const sx = x + 0.5, sy = y + 0.5;
    for (const [tx, ty] of targets) {
      const n = Math.ceil(Math.hypot(tx - sx, ty - sy) * 4);
      let clear = true;
      for (let s = 1; s < n && clear; s++) {
        const px = sx + (tx - sx) * s / n, py = sy + (ty - sy) * s / n;
        if (!open(Math.floor(px), Math.floor(py))) clear = false;
      }
      if (clear) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// After the crop: the record, signs, holds

/** The arrival record (world metres; grid = canvas cells, crop origin (0, 0)). */
export function approachRecord(a: ArrivalCarve): ReactorApproach {
  const rw = (r: Rect): ReactorRect => ({x0: r3(r.x * CELL), z0: r3(r.y * CELL), x1: r3((r.x + r.w) * CELL), z1: r3((r.y + r.h) * CELL)});
  const path = a.path.map(p => ({x: r3(p.x * CELL), z: r3(p.z * CELL)}));
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return {
    recipe: a.recipe, hall: a.hall.id, station: [a.hall.id, ...(a.corridor ? [a.corridor.id] : []), ...a.rooms.map(r => r.id)], tunnel: a.tunnel.map(s => s.id),
    doors: a.platformDoors.map(rw), breach: rw(a.breach), breachFrom: a.breachFrom, reveal: rw(a.reveal), revealDeck: a.revealDeck, path, length: r3(length),
  };
}

/** Cells kept prop-free through the station dresser: every tunnel cell and 2 m in front of the breach / the reveal / the hall doors. */
export function arrivalHolds(layout: StationLayout, a: ArrivalCarve): {level: number; cells: number[]}[] {
  const g = layout.levels[0].grid, cells: number[] = [];
  const ids = new Set(a.tunnel.map(s => s.id));
  for (const s of a.tunnel) for (let y = s.y - 4; y < s.y + s.h + 4; y++) for (let x = s.x - 4; x < s.x + s.w + 4; x++) {
    if (!g.inBounds(x, y)) continue;
    const i = g.idx(x, y);
    if (g.cells[i] !== FLOOR) continue;
    // the tunnel itself, and the 4 cells of the source / gallery right at its two holes
    if (ids.has(g.area[i]) || near(x, y, a.breach, 4) || near(x, y, a.reveal, 4)) cells.push(i);
  }
  for (const d of a.platformDoors) for (let y = d.y - 4; y <= d.y + 4; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) if (g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR) cells.push(g.idx(x, y));
  return [{level: 0, cells}];
  function near(x: number, y: number, r: Rect, d: number): boolean { return x >= r.x - d && x < r.x + r.w + d && y >= r.y - d && y < r.y + r.h + d; }
}

/**
 * Wayfinding (dynamic sign plates, after the dresser): over each platform opening "RIM ACCESS" (facing the platform); in the source
 * room beside the breach "TO RIM GALLERY" (arrow toward the hole); on the rim gallery beside the reveal "RIM CONTROL OFFICE" (arrow
 * along the gallery toward the office's door when it is on that side).
 */
export function arrivalSigns(layout: StationLayout, a: ArrivalCarve, office?: {x: number; z: number}): number {
  const g = layout.levels[0].grid, n0 = layout.signs.length;
  const push = (s: SignPlacement) => layout.signs.push(s);
  // over the platform openings (the platform side: the wall row's north face; rot 0 faces +z … the platform lies on the -z side of the
  // wall in both mirrors, so the plate faces -z: rot PI)
  for (const d of a.platformDoors) {
    push({x: r3((d.x + d.w / 2) * CELL), y: 4.3, z: r3(d.y * CELL - 0.02), rot: Math.PI, kind: 'exit', text: 'RIM ACCESS', area: a.hall.parent >= 0 ? a.hall.parent : a.hall.id, w: 1.6});
  }
  // beside the breach, on the source room's wall facing into it
  {
    const b = a.breach, src = layout.areas[a.breachFrom];
    if (src && b.w === 1) {
      // an x-normal wall (the hole spans rows): the plate on the same wall, beside the hole, facing into the source
      const intoSrc = (src.x + src.w / 2) < b.x ? -1 : 1, rot = intoSrc > 0 ? Math.PI / 2 : -Math.PI / 2;
      const zs = [b.y * CELL - 0.95, (b.y + b.h) * CELL + 0.95];
      const wx = intoSrc > 0 ? (b.x + 1) * CELL + 0.02 : b.x * CELL - 0.02;
      for (const z of zs) {
        const [cx, cz] = g.cellOf(wx + intoSrc * 0.3, z);
        if (!g.inBounds(cx, cz) || g.cells[g.idx(cx, cz)] !== FLOOR || g.area[g.idx(cx, cz)] !== src.id) continue;
        // the wall behind it is rock over the plate's width
        const [bx] = g.cellOf(wx - intoSrc * 0.25, z);
        if (g.cells[g.idx(bx, cz)] !== SOLID) continue;
        // viewer's right (cos rot, -sin rot): the hole lies toward +z or -z of the plate
        const toward = z < b.y * CELL ? 1 : -1, right = -Math.sin(rot);
        push({x: r3(wx), y: 1.9, z: r3(z), rot, kind: 'service', text: 'TO RIM GALLERY', area: src.id, arrow: toward * right > 0 ? 'right' : 'left', w: 1.4});
        break;
      }
    } else if (src && b.h === 1) {
      const intoSrc = (src.y + src.h / 2) < b.y ? -1 : 1, rot = intoSrc > 0 ? 0 : Math.PI;
      const wz = intoSrc > 0 ? (b.y + 1) * CELL + 0.02 : b.y * CELL - 0.02;
      for (const x of [b.x * CELL - 0.95, (b.x + b.w) * CELL + 0.95]) {
        const [cx, cz] = g.cellOf(x, wz + intoSrc * 0.3);
        if (!g.inBounds(cx, cz) || g.cells[g.idx(cx, cz)] !== FLOOR || g.area[g.idx(cx, cz)] !== src.id) continue;
        const toward = x < b.x * CELL ? 1 : -1, right = Math.cos(rot);
        push({x: r3(x), y: 1.9, z: r3(wz), rot, kind: 'service', text: 'TO RIM GALLERY', area: src.id, arrow: toward * right > 0 ? 'right' : 'left', w: 1.4});
        break;
      }
    }
  }
  // on the rim gallery's north wall beside the reveal, facing the pit (+z: rot 0)
  if (office) {
    const r = a.reveal, z = (r.y + 1) * CELL + 0.02;
    const side = office.x < (r.x + r.w / 2) * CELL ? -1 : 1;
    for (const x of side < 0 ? [r.x * CELL - 1.0, (r.x + r.w) * CELL + 1.0] : [(r.x + r.w) * CELL + 1.0, r.x * CELL - 1.0]) {
      const [cx, cz] = g.cellOf(x, z + 0.3), [bx, bz] = g.cellOf(x, z - 0.3);
      if (!g.inBounds(cx, cz) || g.cells[g.idx(cx, cz)] !== FLOOR || g.area[g.idx(cx, cz)] !== a.revealDeck || g.cells[g.idx(bx, bz)] !== SOLID) continue;
      push({x: r3(x), y: 2.2, z: r3(z), rot: 0, kind: 'service', text: 'RIM CONTROL OFFICE', area: a.revealDeck, arrow: side > 0 ? 'right' : 'left', w: 1.8});
      break;
    }
  }
  return layout.signs.length - n0;
}

/** After applyLighting: the tunnel is lit by dim, steady work lamps (one per segment, at its centre, under its ceiling). */
export function arrivalLights(layout: StationLayout, a: ArrivalCarve): void {
  const ids = new Set(a.tunnel.map(s => s.id));
  layout.lights = layout.lights.filter(l => !ids.has(l.area) || (l.level ?? 0) !== 0);
  a.tunnel.forEach((s, i) => {
    if (i % 2 === 1 && i !== a.tunnel.length - 1) return;
    const l: LightPlacement = {x: r3((s.x + s.w / 2) * CELL), y: r3(s.ceil - 0.15), z: r3((s.y + s.h / 2) * CELL), rot: s.w >= s.h ? 0 : Math.PI / 2, area: s.id, broken: false, flicker: i === 0, warm: true, power: 0.55, dying: false};
    layout.lights.push(l);
    s.lighting = 'dim';
  });
}

// ---------------------------------------------------------------------------------------------
// Validation (gen/reactor/validate.ts reactorIssues)

const cellsOfRect = (r: ReactorRect): Rect => ({x: Math.round(r.x0 / CELL), y: Math.round(r.z0 / CELL), w: Math.round((r.x1 - r.x0) / CELL), h: Math.round((r.z1 - r.z0) / CELL)});

/**
 * The arrival approach: the record; the platform opens only into the station area (never onto a pit deck); on foot the rim gallery is
 * reached from the start through the reveal, and with the BREACH closed no pit deck of the rim is reachable (the tunnel is the one way
 * in); no line of sight from the platform through the reveal; the tunnel's length within ARRIVAL.lengthM.
 */
export function arrivalIssues(layout: StationLayout): string[] {
  const info = layout.reactor;
  if (!info) return [];
  const ap = info.approach;
  if (!ap) return ['arrival: no approach record'];
  const issues: string[] = [];
  const g = layout.levels[0].grid, P = layout.areas[layout.platform];
  for (const id of [...ap.station, ...ap.tunnel]) if (!layout.areas[id] || (layout.areas[id].level ?? 0) !== 0) issues.push(`arrival: area ${id} not on the rim`);
  for (const d of layout.doors) {
    if (d.a !== P.id && d.b !== P.id) continue;
    const o = layout.areas[d.a === P.id ? d.b : d.a];
    if (o?.role?.startsWith('reactor-')) issues.push(`arrival: the platform opens onto ${o.label}`);
  }
  if (!layout.doors.some(d => (d.a === P.id && d.b === ap.hall) || (d.b === P.id && d.a === ap.hall))) issues.push('arrival: no platform opening into the ticket hall');
  // on foot over the rim storey (no links: the pit decks of the rim are level 0)
  const [sx, sy] = g.cellOf(info.start.x, info.start.z);
  const pitDecks = new Set(layout.areas.filter(a => (a.level ?? 0) === 0 && a.role?.startsWith('reactor-') && a.role !== 'reactor-room').map(a => a.id));
  const reach = (): Uint8Array => {
    const seen = new Uint8Array(g.w * g.h), q = [g.idx(sx, sy)];
    seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % g.w, y = (i / g.w) | 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox, ny = y + oy;
        if (!g.inBounds(nx, ny)) continue;
        const j = g.idx(nx, ny);
        if (seen[j] || g.cells[j] !== FLOOR || g.blocked[j] || g.rampIdx[j] >= 0) continue;
        seen[j] = 1; q.push(j);
      }
    }
    return seen;
  };
  const reachesPit = (seen: Uint8Array) => { for (let i = 0; i < seen.length; i++) if (seen[i] && pitDecks.has(g.area[i])) return true; return false; };
  const rv = cellsOfRect(ap.reveal), br = cellsOfRect(ap.breach);
  const open = reach();
  let revealOk = false;
  for (let y = rv.y; y < rv.y + rv.h; y++) for (let x = rv.x; x < rv.x + rv.w; x++) if (g.inBounds(x, y) && open[g.idx(x, y)]) revealOk = true;
  if (!revealOk) issues.push('arrival: the reveal is not reachable on foot from the start');
  if (!reachesPit(open)) issues.push('arrival: the rim gallery is not reachable on foot from the start');
  {
    const saved: [number, number][] = [];
    for (let y = br.y; y < br.y + br.h; y++) for (let x = br.x; x < br.x + br.w; x++) { const i = g.idx(x, y); saved.push([i, g.blocked[i]]); g.blocked[i] = 1; }
    const cut = reach();
    for (const [i, b] of saved) g.blocked[i] = b;
    if (reachesPit(cut)) issues.push('arrival: the rim gallery is reachable without the breach');
  }
  if (platformSees(g, P, rv)) issues.push('arrival: the platform sees through the reveal');
  if (!(ap.length >= ARRIVAL.lengthM[0] && ap.length <= ARRIVAL.lengthM[1])) issues.push(`arrival: tunnel ${ap.length.toFixed(1)} m`);
  return issues;
}
