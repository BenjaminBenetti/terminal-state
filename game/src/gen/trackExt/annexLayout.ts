// Task studio-alpha-track2-round3-20261031-01 (lane LAYOUT): the PLAN of one service annex — a logical underground service level
// instead of a random room tree. User (round 3): "layout feels like it is not logical. The layout should have a logical arrangement
// matching what a real service area would be like. There must always be 1 cache room generated at least" (earlier: "the confusing
// maze of rooms").
//
// The plan (cells; one wall cell between areas, doors in the walls — the carver's rules, gen/trackExt/carve.ts):
//  1. ENTRY PASSAGE: the entry corridor from the tunnel / bed door (planned by the carver), lined with small staff rooms;
//  2. MAIN SERVICE CORRIDOR (the spine): at the passage's end a T (or an L, or straight on) into a 2 m corridor running across it,
//     extended in long straight runs of 10-16 m SEGMENTS joined by fire-door openings (each segment its own corridor area, so
//     door-hop depth still grows along it), bending (L) only where the rock runs out;
//  3. WINGS: a few perpendicular secondary corridors (1.5-2 m) off reserved slots on the spine's sides, 1-2 segments each;
//  4. ROOMS LINED UP along both sides of every corridor in sequence — each opens onto its corridor, abutting its neighbours (one wall),
//     with a consistent bay depth per corridor side: small staff rooms (4-5.5 m deep) on the entry passage and the spine junction,
//     larger plant rooms (5-8 m) beyond; closets among them; every corridor end closes with an END ROOM (no corridor to nowhere);
//  5. MACHINERY HALLS (TrackExtConfig.annex.hall, 2-3 per annex) on the rhythm of the area target, as side rooms of a corridor or
//     as the end room of a run;
//  6. THE HIDEOUT: a room (not a closet / corridor / hall) of >= 3.5 x 4 m and >= 14 m² in the deepest third of the annex's
//     door-hop range (Area.depth, the bands gen/annexCache.ts uses), a dead end — chosen (end rooms of deep runs first, moderate
//     size first) or, when none exists, added off the deepest corridors (or behind a deep room). ServiceAnnex.hideout records it;
//  7. one optional LOOP: a door from a corridor into a corridor / room it backs onto, far apart in the door graph (never the hideout).
// A segment that ends up with no room is undone (its end becomes an end room). Every choice is growth-aware (the crop grid budget:
// Subway 260k, Office 80k, Mall 75k cells) and runs on the annex's own rng. The purposes are zoned later from this structure
// (gen/annexRooms.ts assignAnnexRooms: staff near the entry, plant districts, old stores at the deep end).

import type {Rng} from '../../core/rng';
import {CELL} from '../grid';
import type {Rect} from '../stationTypes';
import type {TrackExtConfig} from './types';
import {SERVICE_LAYOUT} from './config';

export type LaidKind = 'corridor' | 'room' | 'closet';
type AnnexCfg = TrackExtConfig['annex'];

/** The carver's primitives the planner works through (gen/trackExt/carve.ts Carver.grow; all in canvas cells). */
export interface LayoutPrims {
  /** Interior cell of a new area: core / other-group margins, inside the virtual window, not claimed by this annex. */
  free(x: number, y: number): boolean;
  /** Wall-ring cell around a new area: inside the virtual window and not claimed by this annex's group. */
  ring(x: number, y: number): boolean;
  /** The carver's rect test (interior free + ring) and crop budget / growth of a rect. */
  rectOk(r: Rect): boolean;
  fits(r: Rect): boolean;
  growth(r: Rect): number;
  /** Adds an area (local id) / a door between two local areas. */
  add(r: Rect, kind: LaidKind, parent: number, depth: number, hall: boolean): number;
  door(r: Rect, a: number, b: number): number;
  /** Door rect in the shared wall of p and c (null when it does not fit). */
  wallDoor(p: Rect, c: Rect, width: number): Rect | null;
  /** Floor cells laid so far (areas + doors). */
  cells(): number;
  /** Transaction marks over everything the prims record. */
  mark(): unknown;
  undo(m: unknown): void;
}

/** One laid area of the plan (local id = carver area index). */
export interface LaidArea { id: number; r: Rect; kind: LaidKind; depth: number; hall: boolean; host: number; endRoom: boolean }

/** The planner's result: every area in laying order (the entry corridor first), the hideout room (local id) and the hall count. */
export interface ServicePlan { areas: LaidArea[]; hideout: number | null; halls: number }

type End = 'open' | 'link' | 'flush' | 'dead' | 'room';
type Role = 'entry' | 'spine' | 'wing';
interface Seg {
  id: number; r: Rect; ax: 'x' | 'y'; depth: number; role: Role; chain: number;
  /** Ends along the axis: [lo, hi]. */
  ends: [End, End];
  /** Blocked along-intervals per side (0 = minus / 1 = plus side), walls included: [s, e). */
  occ: [[number, number][], [number, number][]];
  slots: Slot[];
  rooms: number;
  hall: boolean;
}
interface Slot { seg: Seg; side: 0 | 1; t: number; w: number; state: 'free' | 'used' | 'dead' }
interface Prof { base: number; fi: Int16Array; fr: Int16Array }

const a0Of = (s: Seg) => (s.ax === 'x' ? s.r.x : s.r.y);
const a1Of = (s: Seg) => (s.ax === 'x' ? s.r.x + s.r.w : s.r.y + s.r.h);
const c0Of = (s: Seg) => (s.ax === 'x' ? s.r.y : s.r.x);
const c1Of = (s: Seg) => (s.ax === 'x' ? s.r.y + s.r.h : s.r.x + s.r.w);
const widthOf = (s: Seg) => c1Of(s) - c0Of(s);
/** World rect of an along (u) x cross (v) box in a segment's frame. */
const uvRect = (ax: 'x' | 'y', u0: number, u1: number, v0: number, v1: number): Rect =>
  (ax === 'x' ? {x: u0, y: v0, w: u1 - u0, h: v1 - v0} : {x: v0, y: u0, w: v1 - v0, h: u1 - u0});
const other = (ax: 'x' | 'y'): 'x' | 'y' => (ax === 'x' ? 'y' : 'x');

/**
 * Plans one annex from its entry corridor (already laid by the carver: local id `root`, running away from the door toward `away`).
 * `targetCells` = the annex's area target in floor cells. Returns null when not even the junction / a first room fits.
 */
export function planServiceArea(P: LayoutPrims, rng: Rng, A: AnnexCfg, root: {id: number; r: Rect; away: 'N' | 'S' | 'E' | 'W'}, targetCells: number): ServicePlan | null {
  const L = A.layout ?? SERVICE_LAYOUT, H = A.hall;
  const cl = (m: number) => Math.max(1, Math.round(m / CELL));
  const cr = (r: readonly [number, number]) => rng.int(cl(r[0]), cl(r[1]));
  const doorW = A.doorCells, closetMax = cl(A.closetMax), roomMin = cl(A.roomMin[0]);
  const hallWant = H ? rng.int(H.count[0], H.count[1]) : 0;
  const spineWant = rng.int(L.spineSegments[0], L.spineSegments[1]), wingsWant = rng.int(L.wings[0], L.wings[1]);
  const segs: Seg[] = [], laid: LaidArea[] = [], wingLen = new Map<number, number>(), wingWant = new Map<number, number>();
  let halls = 0, chains = 1, spineSegs = 0, wings = 0, relaxed = false;
  const stopAt = targetCells * 0.94, cap = targetCells;

  const ax0: 'x' | 'y' = root.away === 'N' || root.away === 'S' ? 'y' : 'x';
  const farHi = root.away === 'S' || root.away === 'E';
  const entry: Seg = {id: root.id, r: root.r, ax: ax0, depth: 1, role: 'entry', chain: 0, ends: farHi ? ['link', 'open'] : ['open', 'link'], occ: [[], []], slots: [], rooms: 0, hall: false};
  segs.push(entry);
  laid.push({id: root.id, r: root.r, kind: 'corridor', depth: 1, hall: false, host: -1, endRoom: false});

  const hallDue = () => !!H && halls < hallWant && P.cells() >= targetCells * (halls + 0.5) / (hallWant + 1);
  const zone = (s: Seg) => (s.depth <= 2 ? 'staff' : 'plant') as 'staff' | 'plant';
  const drawWidth = (z: 'staff' | 'plant') => { const [lo, hi] = rng.weighted(L.widths[z].map(([a, b, w]) => [[a, b], w] as [[number, number], number])); return rng.int(cl(lo), cl(hi)); };
  const maxWidth = (z: 'staff' | 'plant') => cl(Math.max(...L.widths[z].map(e => e[1])));

  // ---- profiles: free depth beside a corridor side, per along cell (exact rectOk equivalent for rooms lined on that side)
  const sideCell = (s: Seg, side: 0 | 1, t: number, k: number): [number, number] => {
    const v = side === 0 ? c0Of(s) - 1 - k : c1Of(s) + k;
    return s.ax === 'x' ? [t, v] : [v, t];
  };
  const profile = (s: Seg, side: 0 | 1, K: number): Prof => {
    const base = a0Of(s) - 1, n = a1Of(s) - base + 1, fi = new Int16Array(n), fr = new Int16Array(n);
    for (let j = 0; j < n; j++) {
      const t = base + j;
      let k = 0;
      while (k <= K + 1) { const [x, y] = sideCell(s, side, t, k); if (!P.ring(x, y)) break; k++; }
      fr[j] = k;
      let m = 0;
      const lim = Math.min(K, k - 1);
      while (m < lim) { const [x, y] = sideCell(s, side, t, m + 1); if (!P.free(x, y)) break; m++; }
      fi[j] = m;
    }
    return {base, fi, fr};
  };
  /** Deepest room (<= D) the profile allows over along [t, t + w). */
  const depthAt = (p: Prof, t: number, w: number, D: number): number => {
    for (let x = t; x < t + w; x++) D = Math.min(D, p.fi[x - p.base]);
    for (let x = t - 1; x <= t + w; x++) D = Math.min(D, p.fr[x - p.base] - 2);
    return D;
  };
  const sideRect = (s: Seg, side: 0 | 1, t: number, w: number, D: number): Rect =>
    uvRect(s.ax, t, t + w, side === 0 ? c0Of(s) - 1 - D : c1Of(s) + 1, side === 0 ? c0Of(s) - 1 : c1Of(s) + 1 + D);
  const block = (s: Seg, side: 0 | 1, t: number, w: number) => { s.occ[side].push([t - 1, t + w + 1]); s.occ[side].sort((p, q) => p[0] - q[0]); };
  /** Free along-runs [s, e) of a side (the complement of its blocked intervals within the segment). */
  const runsOf = (s: Seg, side: 0 | 1): [number, number][] => {
    const out: [number, number][] = [];
    let t = a0Of(s);
    for (const [p, q] of s.occ[side]) { if (p > t) out.push([t, p]); t = Math.max(t, q); }
    if (a1Of(s) > t) out.push([t, a1Of(s)]);
    return out;
  };

  const addRoom = (s: Seg, r: Rect, hall: boolean, endRoom: boolean): number | null => {
    const kind: LaidKind = !hall && r.w <= closetMax && r.h <= closetMax ? 'closet' : 'room';
    if (!P.fits(r)) return null;
    const dw = P.wallDoor(s.r, r, kind === 'closet' ? 2 : Math.min(doorW, widthOf(s)));
    if (!dw) return null;
    const id = P.add(r, kind, s.id, s.depth + 1, hall);
    P.door(dw, s.id, id);
    laid.push({id, r, kind, depth: s.depth + 1, hall, host: s.id, endRoom});
    if (hall) { halls++; s.hall = true; }
    s.rooms++;
    return id;
  };

  /** One run of a corridor side: rooms in sequence, one wall between them, a consistent bay depth `D` where the rock allows. */
  const fillRun = (s: Seg, side: 0 | 1, p: Prof, run: [number, number], D: number, budget: number): void => {
    const z = zone(s), Dmin = roomMin, wMax = maxWidth(z);
    let t = run[0];
    while (run[1] - t >= roomMin) {
      if (P.cells() >= budget) return;
      let w = Math.min(drawWidth(z), run[1] - t);
      const rest = run[1] - t - w - 1;
      if (rest >= 0 && rest < roomMin && run[1] - t <= wMax) w = run[1] - t;
      // a closet-wide slot is a closet (janitor / supply / electrical): shallow as well
      const Dw = w <= closetMax ? Math.min(D, rng.int(roomMin, closetMax)) : D;
      let placed = false;
      for (let ww = w; ww >= roomMin && !placed; ww--) {
        const d = depthAt(p, t, ww, ww <= closetMax ? Dw : D);
        if (d < Dmin) continue;
        if (P.cells() + ww * d > budget + 40) continue;
        if (addRoom(s, sideRect(s, side, t, ww, d), false, false) !== null) { block(s, side, t, ww); t += ww + 1; placed = true; }
      }
      if (!placed) t++;
    }
  };

  /** A machinery hall on a side of `s` (least crop growth over the feasible spots), true when placed. */
  const sideHall = (s: Seg, side: 0 | 1, p: Prof): boolean => {
    if (!H || s.hall) return false;
    let best: {t: number; along: number; deep: number; g: number} | null = null;
    for (let k = 0; k < H.tries; k++) {
      const sh = cr(H.short), lo = rng.int(Math.max(sh, cl(H.long[0])), cl(H.long[1]));
      const [along, deep] = rng.chance(0.5) ? [lo, sh] : [sh, lo];
      if (P.cells() + along * deep > targetCells * (1 + H.slack)) continue;
      for (const [r0, r1] of runsOf(s, side)) {
        if (r1 - r0 < along) continue;
        const t = rng.int(r0, r1 - along);
        if (depthAt(p, t, along, deep) < deep) continue;
        const r = sideRect(s, side, t, along, deep);
        if (!P.fits(r)) continue;
        const g = P.growth(r);
        if (!best || g < best.g) best = {t, along, deep, g};
      }
    }
    if (!best) return false;
    if (addRoom(s, sideRect(s, side, best.t, best.along, best.deep), true, false) === null) return false;
    block(s, side, best.t, best.along);
    return true;
  };

  /** Lines both sides of a new segment (and reserves its wing slots); returns the rooms laid. */
  const lineSeg = (s: Seg): void => {
    const z = zone(s), bay = L.bay[z];
    for (const side of rng.shuffle([0, 1] as (0 | 1)[])) {
      // (a hall-deep profile only while a hall is due: the free-depth scan is the planner's main cost)
      const deepScan = !!H && hallDue() && s.depth >= 2;
      const p = profile(s, side, deepScan ? cl(H!.long[1]) : cl(Math.max(bay[1], 8)));
      if (deepScan) sideHall(s, side, p);
      // a wing slot: room for a perpendicular corridor to pass the bay and carry rooms of its own
      if (s.role === 'spine' && wings + segs.filter(q => q.slots.some(sl => sl.state === 'free')).length < wingsWant + 1 && rng.chance(L.slotChance)) {
        const w = cr(L.wingWidth), runs = runsOf(s, side).filter(([r0, r1]) => r1 - r0 >= w + 2);
        if (runs.length) {
          const [r0, r1] = rng.pick(runs), t = rng.chance(0.6) ? (rng.chance(0.5) ? r0 + 1 : r1 - w - 1) : rng.int(r0 + 1, Math.max(r0 + 1, r1 - w - 1));
          if (t >= r0 && t + w <= r1 && depthAt(p, t, w, cl(8)) >= cl(8)) { s.slots.push({seg: s, side, t, w, state: 'free'}); block(s, side, t, w); }
        }
      }
      const D = cr(bay);
      for (const run of runsOf(s, side)) fillRun(s, side, p, run, D, cap);
    }
  };

  // ---- corridor segments
  interface Opt { r: Rect; ax: 'x' | 'y'; ends: [End, End]; pref: number; g: number; role: Role; newChain: boolean }
  const fitsSeg = (r: Rect) => P.fits(r) && P.rectOk(r);
  const segLen = () => (relaxed ? rng.int(cl(6), cl(L.segment[0])) : cr(L.segment));
  /** Options at an open end of `s` (end 0 = lo, 1 = hi): straight on, a T or an L into a perpendicular corridor. */
  const endOpts = (s: Seg, end: 0 | 1, junction: boolean): Opt[] => {
    const out: Opt[] = [];
    const a0 = a0Of(s), a1 = a1Of(s), c0 = c0Of(s), c1 = c1Of(s);
    const role: Role = s.role === 'entry' ? 'spine' : s.role;
    const width = role === 'spine' ? cr(L.spineWidth) : cr(L.wingWidth);
    const prefs = junction ? {straight: 0.8, T: 3, L: 1.2} : relaxed ? {straight: 1, T: 0.6, L: 0.8} : {straight: 1, T: 0.12, L: 0.35};
    // straight on (same width: a fire-door opening between the segments)
    {
      const len = segLen(), u0 = end ? a1 + 1 : a0 - 1 - len;
      out.push({r: uvRect(s.ax, u0, u0 + len, c0, c1), ax: s.ax, ends: end ? ['link', 'open'] : ['open', 'link'], pref: prefs.straight, g: 0, role: junction ? 'spine' : role, newChain: junction});
    }
    // a perpendicular corridor across the end: T (both ways) or L (one way, flush with the incoming corridor's side)
    const len = Math.max(segLen(), (c1 - c0) + 2 * roomMin + 2);
    const u0 = end ? a1 + 1 : a0 - 1 - width;
    const mid = Math.round((c0 + c1) / 2 - len / 2);
    out.push({r: uvRect(s.ax, u0, u0 + width, mid, mid + len), ax: other(s.ax), ends: ['open', 'open'], pref: prefs.T, g: 0, role: 'spine' === role || junction ? 'spine' : role, newChain: true});
    out.push({r: uvRect(s.ax, u0, u0 + width, c1 - len, c1), ax: other(s.ax), ends: ['open', 'flush'], pref: prefs.L, g: 0, role, newChain: true});
    out.push({r: uvRect(s.ax, u0, u0 + width, c0, c0 + len), ax: other(s.ax), ends: ['flush', 'open'], pref: prefs.L, g: 0, role, newChain: true});
    return out;
  };
  const bayBox = (r: Rect, ax: 'x' | 'y'): Rect => {
    const b = cl(6);
    return ax === 'x' ? {x: r.x, y: r.y - b, w: r.w, h: r.h + 2 * b} : {x: r.x - b, y: r.y, w: r.w + 2 * b, h: r.h};
  };
  const scoreOpts = (opts: Opt[]): Opt[] => {
    const ok: Opt[] = [];
    for (const o of opts) { if (!fitsSeg(o.r)) continue; o.g = P.growth(bayBox(o.r, o.ax)); ok.push(o); }
    return ok;
  };
  const growthFactor = (g: number) => 1 / (1 + g / L.growthScale);
  const pickOpt = (ok: Opt[]): Opt => rng.weighted(ok.map(o => [o, o.pref * growthFactor(o.g)] as [Opt, number]));

  /** Lays a segment off `from` through `door`-able wall, lines it; undone (null) when it carries no room. */
  const laySeg = (from: Seg, o: Opt, chain: number): Seg | null => {
    const m = P.mark(), n0 = laid.length, h0 = halls, fromHall = from.hall;
    const dw = P.wallDoor(from.r, o.r, Math.min(doorW, widthOf(from), o.ax === 'x' ? o.r.h : o.r.w));
    if (!dw) return null;
    const id = P.add(o.r, 'corridor', from.id, from.depth + 1, false);
    P.door(dw, from.id, id);
    const s: Seg = {id, r: o.r, ax: o.ax, depth: from.depth + 1, role: o.role, chain, ends: o.ends, occ: [[], []], slots: [], rooms: 0, hall: false};
    laid.push({id, r: o.r, kind: 'corridor', depth: s.depth, hall: false, host: from.id, endRoom: false});
    segs.push(s);
    lineSeg(s);
    if (s.rooms === 0 && !s.slots.length) {
      P.undo(m); laid.length = n0; halls = h0; from.hall = fromHall; segs.pop();
      return null;
    }
    return s;
  };

  // ---- 1. the junction at the entry passage's far end: the main service corridor across it (T / L) or straight on
  {
    const far: 0 | 1 = farHi ? 1 : 0;
    const ok = scoreOpts(endOpts(entry, far, true));
    let J: Seg | null = null;
    for (let k = 0; k < 4 && ok.length && !J; k++) {
      const o = pickOpt(ok);
      ok.splice(ok.indexOf(o), 1);
      J = laySeg(entry, o, chains++);
    }
    entry.ends[far] = J ? 'link' : 'dead';
    lineSeg(entry);
  }

  // ---- 2. growth: extend the spine, grow wings off its slots, until ~the area target
  const act = (): boolean => {
    const acts: [() => boolean, number][] = [];
    for (const s of segs) {
      for (const e of [0, 1] as const) {
        if (s.ends[e] !== 'open') continue;
        const w = s.role === 'spine' ? (spineSegs < spineWant ? 3 : 0.7) : s.role === 'wing' ? ((wingLen.get(s.chain) ?? 1) < (wingWant.get(s.chain) ?? 1) ? 1.6 : 0.35) : 0.5;
        acts.push([() => {
          const ok = scoreOpts(endOpts(s, e, false));
          while (ok.length) {
            const o = pickOpt(ok);
            ok.splice(ok.indexOf(o), 1);
            const n = laySeg(s, o, o.newChain ? chains++ : s.chain);
            if (!n) continue;
            s.ends[e] = 'link';
            if (n.role === 'spine') spineSegs++;
            else if (n.role === 'wing') wingLen.set(n.chain, (wingLen.get(n.chain) ?? 0) + 1);
            if (o.newChain && n.role === 'wing') wingWant.set(n.chain, rng.int(L.wingSegments[0], L.wingSegments[1]));
            return true;
          }
          s.ends[e] = 'dead';
          return false;
        }, w]);
      }
      for (const sl of s.slots) {
        if (sl.state !== 'free') continue;
        acts.push([() => {
          const t = sl.t, c0 = c0Of(s), c1 = c1Of(s);
          const opts: Opt[] = [];
          for (let k = 0; k < 2; k++) {
            const len = segLen(), r = sl.side === 0 ? uvRect(s.ax, t, t + sl.w, c0 - 1 - len, c0 - 1) : uvRect(s.ax, t, t + sl.w, c1 + 1, c1 + 1 + len);
            opts.push({r, ax: other(s.ax), ends: sl.side === 0 ? ['open', 'link'] : ['link', 'open'], pref: 1, g: 0, role: 'wing', newChain: true});
          }
          const ok = scoreOpts(opts);
          while (ok.length) {
            const o = pickOpt(ok);
            ok.splice(ok.indexOf(o), 1);
            const chain = chains++;
            const n = laySeg(s, o, chain);
            if (!n) continue;
            sl.state = 'used'; wings++;
            wingLen.set(chain, 1); wingWant.set(chain, rng.int(L.wingSegments[0], L.wingSegments[1]));
            return true;
          }
          sl.state = 'dead';
          return false;
        }, wings < wingsWant ? 2.2 : 0.35]);
      }
    }
    if (!acts.length) return false;
    rng.weighted(acts)();
    return true;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let guard = 0; guard < A.steps && P.cells() < stopAt; guard++) if (!act()) break;
    if (P.cells() >= stopAt) break;
    // relaxed pass (tight rock): shorter segments, bends allowed everywhere, failed ends / slots retried
    relaxed = true;
    for (const s of segs) { for (const e of [0, 1] as const) if (s.ends[e] === 'dead') s.ends[e] = 'open'; for (const sl of s.slots) if (sl.state === 'dead') sl.state = 'free'; }
  }

  // ---- 3. end rooms: every corridor end that leads on to nothing closes with a room (deepest first; the hideout-sized ones there)
  const endRoom = (s: Seg, e: 0 | 1, o: {hall?: boolean; hide?: boolean; budget: number}): number | null => {
    const a0 = a0Of(s), a1 = a1Of(s), c0 = c0Of(s), c1 = c1Of(s), wc = c1 - c0;
    for (let k = 0; k < (o.hall ? H!.tries : 6); k++) {
      let deep: number, across: number;
      if (o.hall && H) { const sh = cr(H.short), lo = rng.int(Math.max(sh, cl(H.long[0])), cl(H.long[1])); [deep, across] = rng.chance(0.5) ? [lo, sh] : [sh, lo]; }
      else if (o.hide) { deep = rng.int(cl(4.5), cl(6)); across = rng.int(cl(4), cl(5.5)); }
      else { deep = cr(L.bay[zone(s)]); across = rng.int(Math.max(wc, roomMin), Math.max(wc, roomMin) + cl(4)); }
      if (k >= 3 && !o.hall) { deep = Math.max(roomMin, deep - 2 * (k - 2)); across = Math.max(roomMin, Math.min(across, wc + 4)); }
      if (P.cells() + deep * across > o.budget) continue;
      const v0 = rng.int(c1 - across, c0), u0 = e ? a1 + 1 : a0 - 1 - deep;
      const r = uvRect(s.ax, u0, u0 + deep, v0, v0 + across);
      if (!P.rectOk(r)) continue;
      const id = addRoom(s, r, !!o.hall, true);
      if (id !== null) { s.ends[e] = 'room'; return id; }
    }
    return null;
  };
  const openEnds = () => segs.flatMap(s => ([0, 1] as const).filter(e => s.ends[e] === 'open' || s.ends[e] === 'dead').map(e => ({s, e}))).sort((p, q) => q.s.depth - p.s.depth);
  openEnds().forEach(({s, e}, k) => {
    if (hallDue() || (H && halls === 0 && hallWant > 0)) { if (endRoom(s, e, {hall: true, budget: targetCells * (1 + (H?.slack ?? 0))}) !== null) return; }
    // the two deepest ends close with a hideout-sized store room (4-5.5 x 4.5-6 m), the rest with a bay-deep room
    endRoom(s, e, {hide: k < 2, budget: targetCells * 1.03});
  });
  // unused wing slots: a room / closet in the gap when the target allows (else it stays a stretch of blank wall)
  for (const s of segs) for (const sl of s.slots) {
    if (sl.state === 'used') continue;
    sl.state = 'dead';
    s.occ[sl.side] = s.occ[sl.side].filter(([p, q]) => !(p === sl.t - 1 && q === sl.t + sl.w + 1));
    const prof = profile(s, sl.side, cl(L.bay.plant[1]));
    const run = runsOf(s, sl.side).find(([r0, r1]) => r0 <= sl.t && r1 >= sl.t + sl.w);
    if (run) fillRun(s, sl.side, prof, run, cr(L.bay[zone(s)]), cap);
  }
  // at least one machinery hall (the corpus showed annexes without one): ends first, then any corridor side
  if (H && halls === 0 && hallWant > 0) {
    for (const {s, e} of openEnds()) if (halls === 0) endRoom(s, e, {hall: true, budget: targetCells * 1.04});
    for (const s of segs.slice().sort((p, q) => q.depth - p.depth)) for (const side of [0, 1] as const) if (halls === 0 && s.depth >= 2) sideHall(s, side, profile(s, side, cl(H.long[1])));
  }
  if (laid.length < 3) return null;

  // ---- 4. the hideout: a dead-end room of >= 3.5 x 4 m in the deepest third (end rooms of deep runs, moderate size first)
  const HD = L.hideout;
  const hsh = cl(HD.short), hlo = cl(HD.long), hm2 = HD.m2 / (CELL * CELL);
  const dMaxOf = () => Math.max(...laid.map(a => a.depth));
  const deep = (d: number, dMax: number) => dMax > 1 && Math.floor((3 * (d - 1)) / (dMax - 1 + 1e-9)) >= 2;
  const suits = (a: LaidArea, dMax: number) => a.kind === 'room' && !a.hall && Math.min(a.r.w, a.r.h) >= hsh && Math.max(a.r.w, a.r.h) >= hlo && a.r.w * a.r.h >= hm2 - 1e-9 && deep(a.depth, dMax);
  let hideout: number | null = null;
  const choose = (): number | null => {
    const dMax = dMaxOf(), c = laid.filter(a => suits(a, dMax));
    if (!c.length) return null;
    const dLo = Math.min(...c.map(a => a.depth)), med = (a: LaidArea) => Math.min(a.r.w, a.r.h) * CELL >= 4.5 && a.r.w * a.r.h * CELL * CELL >= 26;
    return rng.weighted(c.map(a => {
      const m2 = a.r.w * a.r.h * CELL * CELL;
      return [a.id, (m2 >= HD.prefer[0] && m2 <= HD.prefer[1] ? 3 : m2 < HD.prefer[0] ? 2 : 1) * (med(a) ? 0.4 : 1) * (a.endRoom ? 2 : 1) * (1 + a.depth - dLo)] as [number, number];
    }));
  };
  hideout = choose();
  if (hideout === null) {
    // none: add one off the deepest corridors (a side bay, else an end), else behind a deep room (an inner store room)
    const dMax = dMaxOf();
    for (const s of segs.filter(q => deep(q.depth + 1, dMax)).sort((p, q) => q.depth - p.depth)) {
      if (hideout !== null) break;
      for (const side of [0, 1] as const) {
        if (hideout !== null) break;
        const prof = profile(s, side, cl(6));
        for (const [r0, r1] of runsOf(s, side)) {
          for (let t = r0; t + hlo <= r1 && hideout === null; t++) {
            for (const w of [cl(5), cl(4.5), hlo, hsh]) {
              if (t + w > r1) continue;
              const d = Math.min(depthAt(prof, t, w, cl(5.5)));
              if (d < hsh || Math.max(w, d) < hlo || w * d < hm2) continue;
              const id = addRoom(s, sideRect(s, side, t, w, d), false, false);
              if (id !== null) { block(s, side, t, w); hideout = id; break; }
            }
          }
        }
      }
      for (const e of [0, 1] as const) if (hideout === null && (s.ends[e] === 'open' || s.ends[e] === 'dead')) hideout = endRoom(s, e, {hide: true, budget: Infinity});
    }
    if (hideout === null) {
      for (const a of laid.filter(q => q.kind === 'room' && !q.hall && deep(q.depth, dMax)).sort((p, q) => q.depth - p.depth)) {
        for (const side of rng.shuffle(['N', 'S', 'E', 'W'] as const)) {
          const w = cl(4.5), d = cl(5), r = a.r;
          const c: Rect = side === 'N' ? {x: r.x + Math.max(0, Math.floor((r.w - w) / 2)), y: r.y - 1 - d, w, h: d} : side === 'S' ? {x: r.x + Math.max(0, Math.floor((r.w - w) / 2)), y: r.y + r.h + 1, w, h: d}
            : side === 'W' ? {x: r.x - 1 - d, y: r.y + Math.max(0, Math.floor((r.h - w) / 2)), w: d, h: w} : {x: r.x + r.w + 1, y: r.y + Math.max(0, Math.floor((r.h - w) / 2)), w: d, h: w};
          if (!P.rectOk(c) || !P.fits(c)) continue;
          const dw = P.wallDoor(r, c, doorW);
          if (!dw) continue;
          const id = P.add(c, 'room', a.id, a.depth + 1, false);
          P.door(dw, a.id, id);
          laid.push({id, r: c, kind: 'room', depth: a.depth + 1, hall: false, host: a.id, endRoom: false});
          hideout = id;
          break;
        }
        if (hideout !== null) break;
      }
    }
    if (hideout !== null && !suits(laid.find(a => a.id === hideout)!, dMaxOf())) hideout = choose();
  }

  // ---- 5. one loop: a door from a corridor into a corridor / room it backs onto, far apart in the door graph (never the hideout)
  if (rng.chance(A.loopChance)) {
    const adj = new Map<number, number[]>(laid.map(a => [a.id, []]));
    for (const a of laid) if (a.host >= 0) { adj.get(a.id)!.push(a.host); adj.get(a.host)?.push(a.id); }
    const hops = (s: number): Map<number, number> => {
      const d = new Map<number, number>([[s, 0]]), q = [s];
      for (let h = 0; h < q.length; h++) for (const o of adj.get(q[h]) ?? []) if (!d.has(o)) { d.set(o, d.get(q[h])! + 1); q.push(o); }
      return d;
    };
    const pairs: [LaidArea, LaidArea][] = [];
    for (const c of laid) {
      if (c.kind !== 'corridor') continue;
      const d = hops(c.id);
      for (const o of laid) {
        if (o.id === c.id || o.kind === 'closet' || o.id === hideout || (o.kind === 'corridor' && o.id < c.id) || (d.get(o.id) ?? 99) < 4) continue;
        pairs.push([c, o]);
      }
    }
    for (const [c, o] of rng.shuffle(pairs)) {
      const dw = P.wallDoor(c.r, o.r, Math.min(doorW, Math.min(c.r.w, c.r.h), o.kind === 'corridor' ? Math.min(o.r.w, o.r.h) : doorW));
      if (!dw) continue;
      P.door(dw, c.id, o.id);
      break;
    }
  }
  return {areas: laid, hideout, halls};
}
