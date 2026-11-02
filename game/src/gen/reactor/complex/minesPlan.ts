// Task reactor-expansion-20261101 (lane MINES): THE OLD MINE WORKINGS — the pure PLAN of the mines complex (gen/reactor/complex/mines.ts
// commits it into the shared Kit). User: "The generators you need to startup to clear the fog on each level should be in substantial
// sub complexes coming off the main shaft. Think bunkers, old mines, nuclear waste dumps …".
//
// Story: the reactor builders broke into old service excavations behind the tier-2 pit wall and reused them: a timber-framed ADIT from
// the shaft gallery, the haulage JUNCTION (the old shaft station), the main HAULAGE drift with its narrow-gauge rail line (a lateral leg,
// then a deep leg) and the narrower old MANWAY on the other side, both running down to the big excavated STOPE where zone 2's auxiliary
// generator stands (the GENERATOR CAVERN: the tallest space), a CROSS-CUT through the pillar between them, the HOIST ROOM (a winch over
// a blind winze) off the junction, a POWDER MAGAZINE, the LAMP ROOM and TOOL ROOM beside the adit, a FLOODED sump drift and a
// COLLAPSED drift (dead ends) and, where the rock allows, a REFUGE chamber. Two routes from the adit to the cavern (haulage / manway),
// a second loop through the cross-cut.
//
// Geometry: everything is planned in a CANONICAL frame (c lateral, d depth from the pit wall inward; the haulage side is +c) and
// converted to canvas cells by the slot's inward direction (and a seeded mirror). Spaces are rectangles of different widths with jogs
// between drift segments (rough rock tunnels), separated by one-cell rock walls and joined by openings: drift-to-drift openings span
// the full overlap (a support set at a narrowing), room doors are narrower. Every carved cell stays inside the slot region with one
// cell of rock kept inside its edge (the adit alone crosses the region's edge row when the region starts behind the pit wall).
// Pure: no Kit writes (the planner only reads the storey grid), draws only from the given rng.

import type {Rng} from '../../../core/rng';
import {SOLID, type Grid} from '../../grid';
import type {AreaKind, Rect, RoomType} from '../../stationTypes';
import type {ComplexRoom, ComplexSlot} from './types';
import {ANNEX_PICKED_KEY} from '../../../items/lootTables';

/** Sizes (cells: 0.5 m) and clear heights (m above the storey floor) of the program. */
export const MINES = {
  /** Usable canonical extents a plan needs (cells, inside the region's rock margin). */
  minW: 52, minD: 50,
  /** Target walkable floor (m²) and the floor a plan must at least reach to be used. */
  targetM2: 600, acceptM2: 430,
  /** Clear heights (m): drifts are tall enough that the timber sets keep >= 2.3 m clear. */
  clear: {portal: [3.3, 3.5], junction: [3.6, 3.9], drift: [3.3, 3.5], room: [3.0, 3.2], hoist: 5.2, cavern: [6.5, 8.0], min: 3.0},
  door: {portal: 2.9, set: 2.6, room: 2.3},
  attempts: 10,
} as const;

/** A rectangle in the canonical frame (c lateral, d depth). */
export interface CRect { c: number; d: number; w: number; h: number }

export interface MineRoomPlan {
  key: string;
  label: string;
  role: ComplexRoom['role'];
  kind: AreaKind;
  type: RoomType;
  purpose: string;
  /** Canonical rect and the canvas rect (cells). */
  cr: CRect;
  rect: Rect;
  /** Clear height above the storey floor (m). */
  clear: number;
  /** The plan key of the space it opens from (null: the slot's front deck). */
  parent: string | null;
  /** What it is in the mine (dressing / visuals): drift segments carry the rail line on the haulage. */
  part: 'portal' | 'junction' | 'haulage' | 'manway' | 'crosscut' | 'cavern' | 'hoist' | 'magazine' | 'lamp' | 'tools' | 'sump' | 'collapse' | 'refuge';
}

export interface MineDoorPlan {
  a: string | null; // null = the slot's front deck (the entrance)
  b: string;
  rect: Rect;
  height: number;
  kind: 'portal' | 'set' | 'room';
}

export interface MineGeneratorPlan {
  room: string;
  /** Skid footprint (canvas cells; 4 x 8, long axis along canvas y like the shaft generators), yaw of the long axis. */
  foot: Rect;
  yaw: number;
  /** Stand point (canvas cell centre, continuous cells) and the facing yaw toward the skid's end panel. */
  use: {x: number; y: number; yaw: number};
}

export interface MinePlan {
  rooms: MineRoomPlan[];
  doors: MineDoorPlan[];
  generator: MineGeneratorPlan;
  /** Walkable cells (rooms + openings). */
  cells: number;
  mirror: boolean;
  /** Canonical extents used (QA). */
  W: number;
  D: number;
}

/** The canonical frame of a slot: canonical rects / points -> canvas cells. */
export interface MineFrame {
  W: number;
  D: number;
  mirror: boolean;
  /** Entrance span (canonical c, exclusive end) and the first canonical row of the adit (<= 0: it reaches back to the pit wall). */
  ec0: number;
  ec1: number;
  dPortal: number;
  rect(c: number, d: number, w: number, h: number): Rect;
  /** Continuous canonical point -> continuous canvas cell coordinates. */
  pt(c: number, d: number): {x: number; y: number};
}

export function mineFrame(slot: ComplexSlot, mirror: boolean): MineFrame | null {
  const {region: R, entrance: E, inward} = slot;
  const alongX = inward === 'N' || inward === 'S';
  const sgn = inward === 'S' || inward === 'E' ? 1 : -1;
  const eRow = alongX ? E.y : E.x;
  const lat0 = alongX ? R.x : R.y, lat1 = alongX ? R.x + R.w : R.y + R.h;
  const r0 = alongX ? R.y : R.x, r1 = alongX ? R.y + R.h - 1 : R.x + R.w - 1;
  const va = (r0 - eRow) * sgn, vb = (r1 - eRow) * sgn;
  const vNear = Math.min(va, vb), vFar = Math.max(va, vb);
  const U0 = lat0 + 1, U1 = lat1 - 1;
  const V0 = Math.max(1, vNear + 1), V1 = vFar;
  const W = U1 - U0, D = V1 - V0;
  if (W <= 0 || D <= 0) return null;
  const e0 = alongX ? E.x : E.y, e1 = e0 + (alongX ? E.w : E.h);
  const ec0 = mirror ? U1 - e1 : e0 - U0;
  return {
    W, D, mirror, ec0, ec1: ec0 + (e1 - e0), dPortal: 1 - V0,
    rect(c, d, w, h) {
      const u0 = mirror ? U1 - (c + w) : U0 + c;
      const vA = V0 + d, vB = V0 + d + h - 1;
      const row0 = sgn > 0 ? eRow + vA : eRow - vB;
      return alongX ? {x: u0, y: row0, w, h} : {x: row0, y: u0, w: h, h: w};
    },
    pt(c, d) {
      const u = mirror ? U1 - c : U0 + c;
      const v = V0 + d;
      const row = sgn > 0 ? eRow + v : eRow + 1 - v;
      return alongX ? {x: u, y: row} : {x: row, y: u};
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Planner (canonical occupancy + read-only storey grid checks)

type Side = 'up' | 'down' | 'left' | 'right';

class Planner {
  readonly rooms: MineRoomPlan[] = [];
  readonly doors: MineDoorPlan[] = [];
  private readonly occ: Uint8Array;
  constructor(readonly f: MineFrame, readonly g: Grid, readonly rng: Rng, readonly entrance: Rect) {
    this.occ = new Uint8Array(f.W * f.D);
  }
  room(key: string): MineRoomPlan | undefined { return this.rooms.find(r => r.key === key); }

  /**
   * The rect (plus a one-cell margin) is untouched rock: inside the usable frame, clear of planned spaces, SOLID on the storey grid
   * (the entrance span itself may already be open: the host's doorway).
   */
  fits(c: number, d: number, w: number, h: number, dMin = 0): boolean {
    const {W, D} = this.f;
    if (w < 1 || h < 1 || c < 0 || c + w > W || d < dMin || d + h > D) return false;
    for (let y = Math.max(0, d - 1); y <= Math.min(D - 1, d + h); y++) for (let x = Math.max(0, c - 1); x <= Math.min(W - 1, c + w); x++) if (this.occ[y * W + x]) return false;
    const r = this.f.rect(c - 1, d - 1, w + 2, h + 2), E = this.entrance;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (x >= E.x && x < E.x + E.w && y >= E.y && y < E.y + E.h) continue;
      if (!this.g.inBounds(x, y) || this.g.cells[this.g.idx(x, y)] !== SOLID) return false;
    }
    return true;
  }

  add(key: string, cr: CRect, o: Omit<MineRoomPlan, 'key' | 'cr' | 'rect'>): MineRoomPlan {
    this.mark(cr, 1);
    const r: MineRoomPlan = {key, cr, rect: this.f.rect(cr.c, cr.d, cr.w, cr.h), ...o};
    this.rooms.push(r);
    return r;
  }
  /** Removes the last planned space (its rock comes back). */
  undo(): void {
    const r = this.rooms.pop();
    if (r) this.mark(r.cr, 0);
  }
  private mark(cr: CRect, v: number): void {
    const {W, D} = this.f;
    for (let y = Math.max(0, cr.d); y < Math.min(D, cr.d + cr.h); y++) for (let x = cr.c; x < cr.c + cr.w; x++) this.occ[y * W + x] = v;
  }

  /** Opening through the one-cell wall between two planned spaces: full overlap (`full`) or `width` cells kept `margin` off the ends. */
  door(a: string, b: string, kind: MineDoorPlan['kind'], o: {full?: boolean; width?: number; margin?: number; pick?: 'mid' | 'rand'} = {}): boolean {
    const A = this.room(a), B = this.room(b);
    if (!A || !B) return false;
    const w = sharedWall(A.cr, B.cr);
    if (!w) return false;
    const margin = o.full ? 0 : o.margin ?? 1;
    const span = w.s1 - w.s0 - 2 * margin;
    const width = o.full ? span : Math.min(o.width ?? 3, span);
    if (width < 3) return false;
    const lo = w.s0 + margin, hi = w.s1 - margin - width;
    const s = o.pick === 'rand' ? this.rng.int(lo, hi) : Math.floor((lo + hi) / 2);
    const cr: CRect = w.horizontal ? {c: s, d: w.line, w: width, h: 1} : {c: w.line, d: s, w: 1, h: width};
    const height = kind === 'room' ? MINES.door.room : MINES.door.set;
    this.doors.push({a, b, rect: this.f.rect(cr.c, cr.d, cr.w, cr.h), height, kind});
    return true;
  }

  /**
   * A space attached to `parent` on `side` (one rock cell between): `along` cells along the shared wall, `deep` away from it; tries the
   * sizes from large to small and several offsets (aligned / centred / seeded) keeping >= `need` cells of overlap for the opening.
   */
  attach(parent: string, side: Side, along: readonly [number, number], deep: readonly [number, number], need = 5): CRect | null {
    const P = this.room(parent);
    if (!P) return null;
    const p = P.cr;
    const horiz = side === 'up' || side === 'down';
    const pa0 = horiz ? p.c : p.d, pa1 = horiz ? p.c + p.w : p.d + p.h;
    for (let dp = deep[1]; dp >= deep[0]; dp -= dp - deep[0] > 4 ? 2 : 1) {
      for (let al = along[1]; al >= along[0]; al -= al - along[0] > 4 ? 2 : 1) {
        const lo = pa0 - al + need, hi = pa1 - need;
        if (hi < lo) continue;
        const cands = [Math.round((pa0 + pa1) / 2 - al / 2), pa0, pa1 - al, this.rng.int(lo, hi), this.rng.int(lo, hi), lo, hi];
        for (const a0 of cands) {
          if (a0 < lo || a0 > hi) continue;
          const r: CRect = side === 'up' ? {c: a0, d: p.d - 1 - dp, w: al, h: dp}
            : side === 'down' ? {c: a0, d: p.d + p.h + 1, w: al, h: dp}
            : side === 'left' ? {c: p.c - 1 - dp, d: a0, w: dp, h: al}
            : {c: p.c + p.w + 1, d: a0, w: dp, h: al};
          if (this.fits(r.c, r.d, r.w, r.h)) return r;
        }
        if (dp === deep[0] && al === along[0]) break;
      }
      if (dp === deep[0]) break;
    }
    return null;
  }

  cells(): number {
    let n = 0;
    for (const r of this.rooms) n += r.rect.w * r.rect.h;
    for (const d of this.doors) n += d.rect.w * d.rect.h;
    return n;
  }
}

/** Shared one-cell wall of two canonical rects: horizontal = a wall ROW (constant d) spanning c in [s0, s1). */
export function sharedWall(a: CRect, b: CRect): {horizontal: boolean; line: number; s0: number; s1: number} | null {
  if (a.d + a.h + 1 === b.d || b.d + b.h + 1 === a.d) {
    const s0 = Math.max(a.c, b.c), s1 = Math.min(a.c + a.w, b.c + b.w);
    return s1 > s0 ? {horizontal: true, line: a.d + a.h + 1 === b.d ? a.d + a.h : b.d + b.h, s0, s1} : null;
  }
  if (a.c + a.w + 1 === b.c || b.c + b.w + 1 === a.c) {
    const s0 = Math.max(a.d, b.d), s1 = Math.min(a.d + a.h, b.d + b.h);
    return s1 > s0 ? {horizontal: false, line: a.c + a.w + 1 === b.c ? a.c + a.w : b.c + b.w, s0, s1} : null;
  }
  return null;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------------------------
// The program

/** Drifts: service-corridor passages (the station composer's service clusters: work lights, maintenance bays, caches, safety points). */
const DRIFT = {kind: 'passage' as AreaKind, type: 'service-corridor' as RoomType, purpose: 'service-corridor'};
/**
 * Dead ends (flooded sump, collapsed drift): bare rooms the dresser leaves empty (the picked-over purpose: no furniture rules, no
 * generated-prop uses, no plate), so the sump pump / barricade / rubble of the mines dress stand where the drift actually ends.
 */
const DEAD_END = {kind: 'room' as AreaKind, type: 'utility' as RoomType, purpose: ANNEX_PICKED_KEY};

/** Plans the mines in a slot (the best of a few seeded attempts); null when no attempt fits the program. */
export function planMines(slot: ComplexSlot, g: Grid, rng: Rng, ceilRel: number): MinePlan | null {
  let best: MinePlan | null = null;
  for (let attempt = 0; attempt < MINES.attempts; attempt++) {
    const p = tryPlan(slot, g, rng, ceilRel, attempt);
    if (!p) continue;
    if (!best || p.cells > best.cells) best = p;
    if (p.cells * 0.25 >= MINES.targetM2) return p;
  }
  return best && best.cells * 0.25 >= MINES.acceptM2 ? best : null;
}

function tryPlan(slot: ComplexSlot, g: Grid, rng: Rng, ceilRel: number, attempt: number): MinePlan | null {
  if (ceilRel < MINES.clear.min) return null;
  // the haulage takes the side with more room beside the entrance (seeded when both are roomy)
  const f0 = mineFrame(slot, false);
  if (!f0 || f0.W < MINES.minW || f0.D < MINES.minD) return null;
  const roomL = f0.ec0, roomR = f0.W - f0.ec1;
  const mirror = Math.abs(roomL - roomR) < 14 ? rng.chance(0.5) : roomL > roomR;
  const f = mirror ? mineFrame(slot, true)! : f0;
  const {W, D} = f;
  const P = new Planner(f, g, rng, slot.entrance);
  const big = attempt < 6; // later attempts shrink the program
  const clearOf = (r: readonly [number, number]) => r2(Math.min(ceilRel, rng.range(r[0], r[1])));
  const ew = f.ec1 - f.ec0;
  const aw = rng.int(6, 8), bw = rng.int(5, 6);

  // --- 1. The adit (portal) from the shaft gallery --------------------------------------------------------------------------------
  const pw = Math.min(10, Math.max(ew + 2, rng.int(6, 7)));
  const pc0 = clamp(Math.round((f.ec0 + f.ec1) / 2 - pw / 2), 0, W - pw);
  if (pc0 > f.ec0 || pc0 + pw < f.ec1) return null;
  const pl = rng.int(10, 12);
  if (!P.fits(pc0, f.dPortal, pw, pl - f.dPortal, f.dPortal)) return null;
  P.add('portal', {c: pc0, d: f.dPortal, w: pw, h: pl - f.dPortal}, {label: 'No. 2 adit', role: 'entry', ...DRIFT, clear: clearOf(MINES.clear.portal), parent: null, part: 'portal'});

  // --- 2. The haulage junction (old shaft station) --------------------------------------------------------------------------------
  const jd = Math.max(rng.int(9, 11), aw + 2), jd0 = pl + 1;
  let jw = big ? rng.int(20, 26) : rng.int(16, 20);
  let jc0 = -1;
  for (const shift of [0, rng.int(-4, 4), -4, 4, -8, 8, -12, 12]) {
    for (const w of [jw, jw - 4]) {
      const c = clamp(Math.round(pc0 + pw / 2 - w / 2) + shift, Math.max(0, pc0 + pw - w), Math.min(W - w, pc0));
      if (P.fits(c, jd0, w, jd)) { jc0 = c; jw = w; break; }
    }
    if (jc0 >= 0) break;
  }
  if (jc0 < 0) return null;
  P.add('junction', {c: jc0, d: jd0, w: jw, h: jd}, {label: 'Haulage junction', role: 'hall', ...DRIFT, clear: clearOf(MINES.clear.junction), parent: 'portal', part: 'junction'});
  if (!P.door('portal', 'junction', 'set', {width: pw - 2})) return null;
  const jBot = jd0 + jd; // the rock row under the junction

  // --- 3. The generator cavern (the stope) -------------------------------------------------------------------------------------
  const top = jBot + 1, avail = D - top;
  const cd = clamp(big ? rng.int(20, 26) : rng.int(16, 20), 14, avail - 13);
  if (cd < 14) return null;
  let pillar = avail - 1 - cd, below = 0;
  if (pillar > 22) { below = pillar - rng.int(15, 19); pillar -= below; }
  const cTop = top + pillar + 1;
  let cw = clamp(big ? rng.int(38, 50) : rng.int(30, 38), 28, W);
  let cl = -1;
  for (const shift of [rng.int(-4, 4), 0, -6, 6, -12, 12, -20, 20]) {
    for (const w of [cw, cw - 6, cw - 10]) {
      if (w < 28) continue;
      const c = clamp(Math.round(jc0 + jw / 2 - w / 2) + shift, 0, W - w);
      if (P.fits(c, cTop, w, cd)) { cl = c; cw = w; break; }
    }
    if (cl >= 0) break;
  }
  if (cl < 0) return null;
  const caveClear = r2(Math.max(MINES.clear.min, Math.min(ceilRel, rng.range(MINES.clear.cavern[0], MINES.clear.cavern[1]))));
  P.add('cavern', {c: cl, d: cTop, w: cw, h: cd}, {label: 'No. 2 stope · generator cavern', role: 'generator', kind: 'room', type: 'utility', purpose: 'generator-room', clear: caveClear, parent: 'junction', part: 'cavern'});

  // --- 4. The two routes down: the haulage (+c side, rail line) and the old manway (-c side) -------------------------------------
  const deep: Record<'haulage' | 'manway', string[]> = {haulage: [], manway: []};
  const route = (side: 'haulage' | 'manway'): boolean => {
    const right = side === 'haulage', w0 = right ? aw : bw;
    // column position at the cavern's end
    let col = right ? cl + cw - w0 - rng.int(0, 3) : cl + rng.int(0, 3);
    const underJ = (c: number) => c >= jc0 && c + w0 <= jc0 + jw;
    const beside = (c: number) => (right ? c >= jc0 + jw + 1 : c + w0 <= jc0 - 1);
    if (!underJ(col) && !beside(col)) col = right ? (col + w0 > jc0 + jw ? jc0 + jw - w0 : col) : (col < jc0 ? jc0 : col);
    if (col < cl || col + w0 > cl + cw) return false;
    let segTop: number, from: string;
    const key = (i: number) => `${side}-${i}`;
    let n = 0;
    const label = right ? 'Main haulage drift' : 'Old manway';
    const clear = clearOf(MINES.clear.drift);
    if (underJ(col)) {
      segTop = top;
      from = 'junction';
    } else {
      // the lateral leg out of the junction's side wall to the column
      const lw = w0;
      const lc0 = right ? jc0 + jw + 1 : col, lc1 = right ? col + w0 : jc0 - 1;
      if (lc1 - lc0 < w0 + 2) return false;
      const ld = jd0 + rng.int(0, jd - lw);
      if (!P.fits(lc0, ld, lc1 - lc0, lw)) return false;
      P.add(key(n), {c: lc0, d: ld, w: lc1 - lc0, h: lw}, {label, role: 'corridor', ...DRIFT, clear, parent: 'junction', part: side});
      if (!P.door('junction', key(n), 'set', {full: true})) return false;
      from = key(n++);
      segTop = ld + lw + 1;
    }
    // the deep leg in one or two segments (a jog between them)
    const len = cTop - 1 - segTop;
    if (len < 5) return false;
    const split = len >= 14 ? segTop + Math.floor(len * rng.range(0.38, 0.6)) : -1;
    const segs: CRect[] = split < 0 ? [{c: col, d: segTop, w: w0, h: len}] : [{c: col, d: segTop, w: w0, h: split - segTop}];
    if (split >= 0) {
      const w1 = clamp(w0 + rng.int(-1, 1), 5, 8);
      const c1 = clamp(col + rng.int(-1, 1), cl, cl + cw - w1);
      segs.push({c: c1, d: split + 1, w: w1, h: cTop - 1 - (split + 1)});
    }
    for (const s of segs) {
      if (!P.fits(s.c, s.d, s.w, s.h)) return false;
      P.add(key(n), s, {label, role: 'corridor', ...DRIFT, clear: clearOf(MINES.clear.drift), parent: from, part: side});
      if (!P.door(from, key(n), 'set', {full: true})) return false;
      deep[side].push(key(n));
      from = key(n++);
    }
    return P.door(from, 'cavern', 'set', {full: true});
  };
  if (!route('haulage') || !route('manway')) return null;
  const segsOf = (side: 'haulage' | 'manway') => deep[side].map(k => P.room(k)!);

  // --- 5. The cross-cut through the pillar (a second loop) -----------------------------------------------------------------------
  {
    const xw = rng.int(4, 5);
    const opts: {m: MineRoomPlan; h: MineRoomPlan; r0: number; r1: number}[] = [];
    for (const m of segsOf('manway')) for (const h of segsOf('haulage')) {
      const r0 = Math.max(m.cr.d, h.cr.d), r1 = Math.min(m.cr.d + m.cr.h, h.cr.d + h.cr.h);
      if (r1 - r0 >= xw + 2) opts.push({m, h, r0, r1});
    }
    rng.shuffle(opts);
    for (const o of opts) {
      const c0 = o.m.cr.c + o.m.cr.w + 1, c1 = o.h.cr.c - 1;
      if (c1 - c0 < 6) continue;
      const d = rng.int(o.r0 + 1, o.r1 - xw - 1);
      if (!P.fits(c0, d, c1 - c0, xw)) continue;
      P.add('crosscut', {c: c0, d, w: c1 - c0, h: xw}, {label: 'Cross-cut', role: 'corridor', ...DRIFT, clear: clearOf(MINES.clear.drift), parent: o.m.key, part: 'crosscut'});
      if (!P.door(o.m.key, 'crosscut', 'set', {full: true}) || !P.door('crosscut', o.h.key, 'set', {full: true})) return null;
      break;
    }
  }

  // --- 6. Rooms: hoist room, magazine, lamp room, tool room, the dead ends, the refuge ---------------------------------------------
  const roomClear = () => clearOf(MINES.clear.room);
  type Cand = {parent: string; side: Side; along: [number, number]; deep: [number, number]};
  const place = (key: string, cands: Cand[], o: Omit<MineRoomPlan, 'key' | 'cr' | 'rect' | 'parent'>, door: {kind: MineDoorPlan['kind']; full?: boolean; width?: number}): MineRoomPlan | null => {
    for (const c of cands) {
      if (!P.room(c.parent)) continue;
      const r = P.attach(c.parent, c.side, c.along, c.deep, door.full ? 4 : (door.width ?? 3) + 2);
      if (!r) continue;
      const room = P.add(key, r, {...o, parent: c.parent});
      if (!P.door(c.parent, key, door.kind, {full: door.full, width: door.width, pick: door.full ? 'mid' : 'rand'})) { P.undo(); continue; }
      return room;
    }
    return null;
  };
  const hasX = !!P.room('crosscut');
  const m0 = segsOf('manway')[0]?.key ?? 'junction', h0 = segsOf('haulage')[0]?.key ?? 'junction';
  const lastM = segsOf('manway').slice(-1)[0]?.key ?? 'cavern', lastH = segsOf('haulage').slice(-1)[0]?.key ?? 'cavern';
  // the hoist room (winch over a blind winze) opens off the junction; a second door into the manway / cross-cut where they touch
  const hoist = place('hoist', [
    {parent: 'junction', side: 'down', along: [12, 16], deep: [8, 11]},
    ...(hasX ? [{parent: 'crosscut', side: 'down' as Side, along: [12, 16] as [number, number], deep: [8, 10] as [number, number]}, {parent: 'crosscut', side: 'up' as Side, along: [12, 16] as [number, number], deep: [8, 10] as [number, number]}] : []),
    {parent: m0, side: 'left', along: [12, 16], deep: [10, 12]},
    {parent: h0, side: 'right', along: [12, 16], deep: [10, 12]},
  ], {label: 'Hoist room', role: 'shaft', kind: 'room', type: 'utility', purpose: 'electrical-closet', clear: r2(Math.min(ceilRel, MINES.clear.hoist)), part: 'hoist'}, {kind: 'room', width: 4});
  if (!hoist) return null;
  for (const k of [...segsOf('manway').map(r => r.key), ...(hasX ? ['crosscut'] : [])]) if (sharedWall(hoist.cr, P.room(k)!.cr) && P.door(k, 'hoist', 'room', {width: 3, pick: 'rand'})) break;
  // the powder magazine: off the cross-cut / a drift, away from the main haulage where the rock allows
  const mag = place('magazine', [
    ...(hasX ? [{parent: 'crosscut', side: 'down' as Side, along: [8, 11] as [number, number], deep: [7, 9] as [number, number]}, {parent: 'crosscut', side: 'up' as Side, along: [8, 11] as [number, number], deep: [7, 9] as [number, number]}] : []),
    {parent: m0, side: 'right', along: [8, 10], deep: [8, 10]},
    {parent: lastM, side: 'left', along: [8, 10], deep: [8, 10]},
    {parent: h0, side: 'left', along: [8, 10], deep: [8, 10]},
    {parent: lastH, side: 'right', along: [8, 10], deep: [8, 10]},
    {parent: 'junction', side: 'down', along: [8, 10], deep: [7, 9]},
    {parent: 'cavern', side: 'left', along: [8, 10], deep: [7, 9]},
    {parent: 'cavern', side: 'right', along: [8, 10], deep: [7, 9]},
  ], {label: 'Powder magazine', role: 'vault', kind: 'room', type: 'storage', purpose: 'storage', clear: roomClear(), part: 'magazine'}, {kind: 'room', width: 3});
  if (!mag) return null;
  // the lamp room and the tool room beside the adit (else off the junction / a drift)
  const besideAdit = (first: 'left' | 'right'): Cand[] => {
    const second = first === 'left' ? 'right' : 'left';
    return [
      {parent: 'portal', side: first, along: [9, 12], deep: [8, 11]},
      {parent: 'portal', side: second, along: [9, 12], deep: [8, 11]},
      {parent: 'junction', side: first, along: [8, 10], deep: [8, 11]},
      {parent: 'junction', side: second, along: [8, 10], deep: [8, 11]},
      {parent: 'junction', side: 'down', along: [9, 11], deep: [7, 9]},
      {parent: m0, side: 'left', along: [9, 11], deep: [7, 10]},
      {parent: h0, side: 'right', along: [9, 11], deep: [7, 10]},
      {parent: 'cavern', side: 'down', along: [9, 12], deep: [7, 9]},
    ];
  };
  const lamp = place('lamp', besideAdit('left'), {label: 'Lamp room', role: 'room', kind: 'room', type: 'crew-room', purpose: 'locker-room', clear: roomClear(), part: 'lamp'}, {kind: 'room', width: 3});
  const tools = place('tools', besideAdit('right'), {label: 'Mine tool room', role: 'store', kind: 'room', type: 'storage', purpose: 'workshop', clear: roomClear(), part: 'tools'}, {kind: 'room', width: 3});
  if (!lamp || !tools) return null;
  // the flooded sump drift (below / beside the cavern) and the collapsed drift (continuing a lateral leg / off the junction)
  const sumpLen: [number, number] = [8, big ? 18 : 12], deadW: [number, number] = [5, 6];
  const sump = place('sump', rng.shuffle<Cand>([
    ...(below >= 9 ? [{parent: 'cavern', side: 'down' as Side, along: deadW, deep: sumpLen}] : []),
    {parent: 'cavern', side: 'left', along: deadW, deep: sumpLen},
    {parent: 'cavern', side: 'right', along: deadW, deep: sumpLen},
  ]).concat([
    {parent: lastM, side: 'left', along: deadW, deep: sumpLen},
    {parent: lastH, side: 'right', along: deadW, deep: sumpLen},
    {parent: 'cavern', side: 'down', along: deadW, deep: [8, 9]},
  ]), {label: 'Flooded sump drift', role: 'corridor', ...DEAD_END, clear: clearOf(MINES.clear.drift), part: 'sump'}, {kind: 'set', full: true});
  const legH = P.rooms.find(r => r.part === 'haulage' && r.cr.h <= 8 && r.cr.w > r.cr.h)?.key, legM = P.rooms.find(r => r.part === 'manway' && r.cr.h <= 8 && r.cr.w > r.cr.h)?.key;
  const collapse = place('collapse', [
    ...(legH ? [{parent: legH, side: 'right' as Side, along: [5, 6] as [number, number], deep: [8, 16] as [number, number]}] : []),
    ...(legM ? [{parent: legM, side: 'left' as Side, along: [5, 6] as [number, number], deep: [8, 16] as [number, number]}] : []),
    {parent: 'junction', side: 'left', along: [5, 6], deep: [8, 14]},
    {parent: 'junction', side: 'right', along: [5, 6], deep: [8, 14]},
    {parent: m0, side: 'left', along: [5, 6], deep: [8, 14]},
    {parent: h0, side: 'right', along: [5, 6], deep: [8, 14]},
  ], {label: 'Collapsed drift', role: 'corridor', ...DEAD_END, clear: clearOf(MINES.clear.drift), part: 'collapse'}, {kind: 'set', full: true});
  if (!sump && !collapse) return null;
  // the refuge chamber (optional)
  place('refuge', [
    ...(hasX ? [{parent: 'crosscut', side: 'down' as Side, along: [8, 10] as [number, number], deep: [6, 8] as [number, number]}] : []),
    {parent: m0, side: 'left', along: [8, 10], deep: [7, 9]},
    {parent: lastM, side: 'left', along: [8, 10], deep: [7, 9]},
    {parent: h0, side: 'right', along: [8, 10], deep: [7, 9]},
    {parent: 'cavern', side: 'left', along: [8, 10], deep: [7, 9]},
    {parent: 'cavern', side: 'right', along: [8, 10], deep: [7, 9]},
  ], {label: 'Refuge chamber', role: 'room', kind: 'room', type: 'crew-room', purpose: 'first-aid-room', clear: roomClear(), part: 'refuge'}, {kind: 'room', width: 3});

  // --- 7. Labels of the drift segments, the generator ------------------------------------------------------------------------------
  for (const side of ['haulage', 'manway'] as const) {
    const segs = P.rooms.filter(r => r.part === side);
    const names = segs.length === 2 ? ['upper', 'lower'] : ['upper', 'middle', 'lower', 'lower'];
    segs.forEach((r, i) => { r.label = `${side === 'haulage' ? 'Main haulage drift' : 'Old manway'}${segs.length > 1 ? ` · ${names[Math.min(3, i)]}` : ''}`; });
  }
  const gen = placeGenerator(P, rng);
  if (!gen) return null;
  return {rooms: P.rooms, doors: [{a: null, b: 'portal', rect: {...slot.entrance}, height: MINES.door.portal, kind: 'portal'}, ...P.doors], generator: gen, cells: P.cells() + slot.entrance.w * slot.entrance.h, mirror, W, D};
}

/**
 * The generator in the cavern: a 4 x 8 cell skid (long axis along canvas y, yaw PI/2: the shaft generators' convention), kept >= 3 cells
 * off the side walls, >= 2 off the end walls and >= 9 cells off the cavern's openings; the stand point 1.5 cells beyond one end (yaw 0 =
 * facing -z from the south end, PI = facing +z from the north end), its cell >= 1 cell off the wall.
 */
function placeGenerator(P: Planner, rng: Rng): MineGeneratorPlan | null {
  const C = P.room('cavern');
  if (!C) return null;
  const R = C.rect;
  const openings = P.doors.filter(d => d.a === 'cavern' || d.b === 'cavern').map(d => ({x: d.rect.x + d.rect.w / 2, y: d.rect.y + d.rect.h / 2}));
  const cands: {foot: Rect; use: {x: number; y: number; yaw: number}; score: number}[] = [];
  for (let y = R.y + 2; y + 8 <= R.y + R.h - 2; y++) for (let x = R.x + 3; x + 4 <= R.x + R.w - 3; x++) {
    const foot: Rect = {x, y, w: 4, h: 8};
    const cx = x + 2, cy = y + 4;
    const near = Math.min(...openings.map(o => Math.hypot(o.x - cx, o.y - cy)));
    if (near < 9) continue;
    for (const south of [true, false]) {
      const uy = south ? y + 8 + 1.5 : y - 1.5;
      if (Math.floor(uy) < R.y + 1 || Math.floor(uy) > R.y + R.h - 2) continue;
      const use = {x: cx, y: uy, yaw: south ? 0 : Math.PI};
      const dUse = Math.min(...openings.map(o => Math.hypot(o.x - use.x, o.y - use.y)));
      // central, away from the openings, the stand point toward the room's middle
      const centre = Math.hypot(cx - (R.x + R.w / 2), cy - (R.y + R.h / 2));
      cands.push({foot, use, score: Math.min(near, 16) + Math.min(dUse, 12) * 0.5 - centre * 0.6 + rng.next() * 2});
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  return {room: 'cavern', foot: best.foot, yaw: Math.PI / 2, use: best.use};
}
