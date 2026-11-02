// Task reactor-expansion-20261101 (lane MINES): THE OLD MINE WORKINGS — the pure PLAN of the mines complex (gen/reactor/complex/mines.ts
// commits it into the shared Kit). User: "The generators you need to startup to clear the fog on each level should be in substantial
// sub complexes coming off the main shaft. Think bunkers, old mines, nuclear waste dumps …".
// Task reactor-playtest-round2-20261102 (lane MINES, user bullet 7: "the layout of reactor / reactor side areas is much to normal right
// now. Just like the subway it should be random! with logical rooms flowing in to one another! It should feel exploring a coherent
// space for the first time every time you play a new generation of the map!"): the fixed program became a SEEDED DRIFT / ROOM GRAPH.
//
// Story: the reactor builders broke into old service excavations behind the tier-2 pit wall and reused them. Every attempt draws a new
// topology, grown space by space where the rock allows:
//  1. the timbered ADIT from the entrance: short, long, or a dog-leg (in, then along the pit wall);
//  2. the haulage JUNCTION (the old shaft station) at its end, the adit entering it at a seeded point of its wall;
//  3. the MAIN HAULAGE (the rail line): a course of 1-4 drift segments out of a seeded junction wall — runs with jogs, bends left / right
//     / down — ending in the GENERATOR CAVERN (No. 2 stope, the tallest space), entered at a seeded point of its wall: the cavern lands
//     where the course ends (under the junction, beside it, a far corner);
//  4. at least one LOOP: the OLD MANWAY (junction / adit -> cavern by its own straight or L-shaped way), a RETURN AIRWAY (cavern -> an
//     earlier haulage segment), a CROSS-CUT between two drifts, a manway down to a later haulage segment;
//  5. the DEVELOPMENT HEADING: a dead-end drift sized from the drill jumbo's REAL kit size (world/reactor/minesAssets.ts minesModelSize:
//     the registry dims x the runtime fit), off the critical path — always, where the headroom allows;
//  6. a seeded subset of the optional spaces at LOGICAL places (MINE_LINKS): lamp / tool rooms by the adit or the junction, a FOOTWALL
//     DRIFT forking off the haulage, the powder magazine off a side drift away from the junction / cavern, the hoist room (winch over a
//     blind winze), the refuge chamber, the flooded sump (off the cavern / a lower drift), a collapsed drift (past a bend / off a
//     drift), worked-out stopes;
//  7. fill: worked-out stopes, then chambers grown into spare rock until the floor target.
//
// Geometry: everything is planned in a CANONICAL frame (c lateral, d depth from the pit wall inward) and converted to canvas cells by the
// slot's inward direction (and a seeded mirror). Spaces are rectangles separated by one-cell rock walls and joined by openings:
// drift-to-drift openings span the full overlap (a support set at a narrowing), room doors are narrower. Every carved cell stays inside
// the slot region with one cell of rock kept inside its edge (the adit alone crosses the region's edge row when the region starts behind
// the pit wall). Pure: no Kit writes (the planner only reads the storey grid), draws only from forks of the given rng.

import type {Rng} from '../../../core/rng';
import {CELL, SOLID, type Grid} from '../../grid';
import type {AreaKind, Rect, RoomType} from '../../stationTypes';
import type {ComplexRoom, ComplexSlot} from './types';
import {ANNEX_PICKED_KEY} from '../../../items/lootTables';
import {minesModelSize} from '../../../world/reactor/minesAssets';

/** Sizes (cells: 0.5 m) and clear heights (m above the storey floor) of the program. */
export const MINES = {
  /** Usable canonical extents a plan needs (cells, inside the region's rock margin). */
  minW: 52, minD: 50,
  /**
   * Target / accepted plan floor (m², every carved cell incl. openings). The host's "substantial" floor (500 m²) is counted AFTER the
   * furniture, set pieces and timber posts block their cells (~100-140 m² in the real level), so the plan aims >= 700 and never ships
   * under 560 (worked-out stopes / grown chambers fill spare rock first).
   */
  targetM2: 700, acceptM2: 560,
  /** Timbered drift run (cells along travel: adit + passages) a plan aims for, so the support sets (>= 6) have room between openings. */
  minRun: 60,
  /** Optional rooms / dead ends / stopes a plan aims for (lamp, tools, magazine, hoist, refuge, sump, collapse, stope). */
  minRooms: 4,
  /** Clear heights (m): drifts are tall enough that the timber sets keep >= 2.3 m clear. */
  clear: {portal: [3.3, 3.5], junction: [3.6, 3.9], drift: [3.3, 3.5], room: [3.0, 3.2], hoist: 5.2, cavern: [6.5, 8.0], min: 3.0},
  door: {portal: 2.9, set: 2.6, room: 2.3},
  attempts: 16,
  /**
   * The development heading round the drill jumbo (m): beside the rig (each side), before its boom (the face), behind it to the
   * mouth (past the opening's 1 m door zone and doorway volume), headroom over it; width floor (cells: a timbered drift).
   */
  heading: {side: 0.6, face: 0.3, mouth: 1.7, headroom: 0.3, minW: 6},
  /** The generator's skid centre / stand point clear of every opening of the cavern (cells). */
  genClear: 9, useClear: 4,
} as const;

/** A rectangle in the canonical frame (c lateral, d depth). */
export interface CRect { c: number; d: number; w: number; h: number }

/**
 * The development heading a drill rig of real size [length, height, depth] (m) needs: width / length (cells) and clear height (m) —
 * the rig centred across with MINES.heading.side each side, its boom MINES.heading.face off the face, MINES.heading.mouth behind it to
 * the mouth (the opening's 1 m door zone + doorway volume), MINES.heading.headroom over it.
 */
export function headingFor(dims: readonly [number, number, number]): {w: number; l: number; clear: number} {
  const [l, h, w] = dims, H = MINES.heading;
  return {w: Math.max(H.minW, Math.ceil((w + 2 * H.side) / CELL - 1e-6)), l: Math.ceil((l + H.face + H.mouth) / CELL - 1e-6) + 1, clear: h + H.headroom};
}

/** What a space is in the mine (dressing / visuals / adjacency): drift parts carry timber sets; the haulage chain carries the rail line. */
export type MinePart =
  | 'portal' | 'junction' | 'haulage' | 'manway' | 'airway' | 'crosscut' | 'branch' | 'heading' | 'cavern'
  | 'hoist' | 'magazine' | 'lamp' | 'tools' | 'sump' | 'collapse' | 'refuge' | 'stope';

/** Passages (timbered drifts the other spaces open off). */
export const MINE_DRIFTS: ReadonlySet<MinePart> = new Set(['portal', 'haulage', 'manway', 'airway', 'crosscut', 'branch']);

/**
 * The mine's logical adjacency: the spaces a part may open onto (an opening a–b is logical when either side lists the other; null =
 * the slot's front deck). Rooms open only off passages / the junction (lamp and tool rooms by the way in, the magazine never off the
 * junction, the adit or the cavern), dead ends (heading, sump, collapse) and rooms have one opening, never room to room.
 */
export const MINE_LINKS: Readonly<Record<MinePart, readonly (MinePart | null)[]>> = {
  portal: [null, 'portal', 'junction', 'manway'],
  junction: ['portal', 'haulage', 'manway', 'branch'],
  haulage: ['junction', 'haulage', 'cavern', 'manway', 'airway', 'crosscut', 'branch'],
  manway: ['junction', 'portal', 'haulage', 'manway', 'cavern', 'crosscut'],
  airway: ['cavern', 'haulage', 'airway', 'crosscut'],
  crosscut: ['haulage', 'manway', 'airway', 'branch', 'crosscut'],
  branch: ['haulage', 'junction', 'manway', 'crosscut', 'airway', 'branch'],
  cavern: ['haulage', 'manway', 'airway'],
  heading: ['haulage', 'manway', 'airway', 'crosscut', 'branch', 'junction'],
  lamp: ['portal', 'junction'],
  tools: ['portal', 'junction', 'haulage'],
  magazine: ['branch', 'crosscut', 'airway', 'manway', 'haulage'],
  hoist: ['junction', 'haulage', 'manway', 'crosscut', 'branch'],
  refuge: ['haulage', 'manway', 'airway', 'crosscut', 'branch', 'junction', 'cavern'],
  sump: ['cavern', 'haulage', 'manway', 'airway'],
  collapse: ['haulage', 'manway', 'airway', 'crosscut', 'branch', 'junction'],
  stope: ['cavern', 'haulage', 'manway', 'airway', 'crosscut', 'branch', 'junction'],
};

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
  /** What it is in the mine (dressing / visuals): the haulage chain's segments carry the rail line. */
  part: MinePart;
  /** Direction of travel (canonical: c lateral, d depth): a drift's support sets stand across it, whatever its rect's proportions. */
  travel?: 'c' | 'd';
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

/**
 * What a plan's topology drew (QA / tests / docs): the adit ('straight' | 'long' | 'dogleg-l' | 'dogleg-r'), the haulage course
 * (canonical D = inward, L / R = lateral, one letter per segment), the cavern's place in the region (lateral third L / C / R +
 * m(id) / d(eep)), the loops, the optional spaces placed.
 */
export interface MineShape { adit: string; course: string; cavern: string; loops: string[]; spaces: string[]; attempt: number }

export interface MinePlan {
  rooms: MineRoomPlan[];
  doors: MineDoorPlan[];
  generator: MineGeneratorPlan;
  /** Walkable cells (rooms + openings). */
  cells: number;
  /** Timbered drift run (cells along travel). */
  run: number;
  mirror: boolean;
  /** Canonical extents used (QA). */
  W: number;
  D: number;
  shape: MineShape;
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
// Planner (canonical occupancy + read-only storey grid checks, both as prefix sums: every fit test is O(1))

type Dir = 'up' | 'down' | 'left' | 'right';
const LAT = (d: Dir) => d === 'left' || d === 'right';
/** Driven toward +c / +d. */
const POS = (d: Dir) => d === 'down' || d === 'right';
const OPP: Readonly<Record<Dir, Dir>> = {up: 'down', down: 'up', left: 'right', right: 'left'};
const LETTER: Readonly<Record<Dir, string>> = {up: 'U', down: 'D', left: 'L', right: 'R'};
/** Along-wall offsets of a child for a parent wall span [s0, s1) and the child's along extent `al`. */
type Offs = (s0: number, s1: number, al: number) => number[];
type DoorOpt = {kind: MineDoorPlan['kind']; full?: boolean; width?: number; margin?: number; pick?: 'mid' | 'rand' | 'lo' | 'hi'};
type SpaceOpt = Omit<MineRoomPlan, 'key' | 'cr' | 'rect' | 'parent'>;

/** The rect `along` x `deep` on `side` of P (one rock cell between) at along-wall offset a0. */
function beside(P: CRect, side: Dir, a0: number, along: number, deep: number): CRect {
  switch (side) {
    case 'down': return {c: a0, d: P.d + P.h + 1, w: along, h: deep};
    case 'up': return {c: a0, d: P.d - 1 - deep, w: along, h: deep};
    case 'left': return {c: P.c - 1 - deep, d: a0, w: deep, h: along};
    default: return {c: P.c + P.w + 1, d: a0, w: deep, h: along};
  }
}
/** P's extent along its `side` wall: c for up / down, d for left / right. */
const wallSpan = (P: CRect, side: Dir): [number, number] => (LAT(side) ? [P.d, P.d + P.h] : [P.c, P.c + P.w]);

class Planner {
  readonly rooms: MineRoomPlan[] = [];
  readonly doors: (MineDoorPlan & {cr: CRect})[] = [];
  /** The direction each drift was driven in (its far end: bends and continuations leave from there). */
  readonly dir = new Map<string, Dir>();
  /** Opening veto (the generator's reserved skid / stand point). */
  guard: ((a: string, b: string, door: Rect) => boolean) | null = null;
  private readonly occ: Uint8Array;
  private occSum: Int32Array | null = null;
  /** Static prefix sum of the cells that are not untouched rock (the entrance span excepted): canonical c in [-1, W], d in [dLo, D]. */
  private readonly bad: Int32Array;
  private readonly dLo: number;
  constructor(readonly f: MineFrame, g: Grid, readonly rng: Rng, E: Rect) {
    const {W, D} = f;
    this.occ = new Uint8Array(W * D);
    this.dLo = Math.min(f.dPortal, 0) - 1;
    const cols = W + 2, rows = D - this.dLo + 1, C = cols + 1;
    const S = new Int32Array(C * (rows + 1));
    for (let r = 0; r < rows; r++) {
      let run = 0;
      for (let k = 0; k < cols; k++) {
        const q = f.rect(k - 1, r + this.dLo, 1, 1);
        const inE = q.x >= E.x && q.x < E.x + E.w && q.y >= E.y && q.y < E.y + E.h;
        run += !inE && (!g.inBounds(q.x, q.y) || g.cells[g.idx(q.x, q.y)] !== SOLID) ? 1 : 0;
        S[(r + 1) * C + k + 1] = S[r * C + k + 1] + run;
      }
    }
    this.bad = S;
  }
  room(key: string): MineRoomPlan | undefined { return this.rooms.find(r => r.key === key); }
  count(part: MinePart): number { let n = 0; for (const r of this.rooms) if (r.part === part) n++; return n; }

  private occIn(c: number, d: number, w: number, h: number): number {
    const {W, D} = this.f;
    const c0 = Math.max(0, c), d0 = Math.max(0, d), c1 = Math.min(W, c + w), d1 = Math.min(D, d + h);
    if (c1 <= c0 || d1 <= d0) return 0;
    const C = W + 1;
    if (!this.occSum) {
      const S = new Int32Array(C * (D + 1));
      for (let y = 0; y < D; y++) {
        let run = 0;
        for (let x = 0; x < W; x++) { run += this.occ[y * W + x]; S[(y + 1) * C + x + 1] = S[y * C + x + 1] + run; }
      }
      this.occSum = S;
    }
    const S = this.occSum;
    return S[d1 * C + c1] - S[d0 * C + c1] - S[d1 * C + c0] + S[d0 * C + c0];
  }
  private badIn(c: number, d: number, w: number, h: number): number {
    const C = this.f.W + 3, x0 = c + 1, y0 = d - this.dLo, x1 = x0 + w, y1 = y0 + h, S = this.bad;
    return S[y1 * C + x1] - S[y0 * C + x1] - S[y1 * C + x0] + S[y0 * C + x0];
  }

  /**
   * The rect (plus a one-cell margin) is untouched rock: inside the usable frame, clear of planned spaces, SOLID on the storey grid
   * (the entrance span itself may already be open: the host's doorway).
   */
  fits(c: number, d: number, w: number, h: number, dMin = 0): boolean {
    const {W, D} = this.f;
    if (w < 1 || h < 1 || c < 0 || c + w > W || d < dMin || d + h > D) return false;
    if (this.occIn(c - 1, d - 1, w + 2, h + 2)) return false;
    return this.badIn(c - 1, d - 1, w + 2, h + 2) === 0;
  }
  fitsR(r: CRect, dMin = 0): boolean { return this.fits(r.c, r.d, r.w, r.h, dMin); }

  add(key: string, cr: CRect, o: Omit<MineRoomPlan, 'key' | 'cr' | 'rect'>): MineRoomPlan {
    this.mark(cr, 1);
    const r: MineRoomPlan = {key, cr, rect: this.f.rect(cr.c, cr.d, cr.w, cr.h), ...o};
    this.rooms.push(r);
    return r;
  }
  /** Removes the last planned space and its openings (its rock comes back). */
  undo(): void {
    const r = this.rooms.pop();
    if (!r) return;
    this.mark(r.cr, 0);
    for (let i = this.doors.length - 1; i >= 0; i--) if (this.doors[i].a === r.key || this.doors[i].b === r.key) this.doors.splice(i, 1);
  }
  private mark(cr: CRect, v: number): void {
    const {W, D} = this.f;
    for (let y = Math.max(0, cr.d); y < Math.min(D, cr.d + cr.h); y++) for (let x = cr.c; x < cr.c + cr.w; x++) this.occ[y * W + x] = v;
    this.occSum = null;
  }

  /**
   * Opening through the one-cell wall between two planned spaces: full overlap (`full`) or `width` cells kept `margin` off the ends, at
   * the `pick`ed spot or the nearest one the guard accepts.
   */
  door(a: string, b: string, o: DoorOpt): boolean {
    const A = this.room(a), B = this.room(b);
    if (!A || !B) return false;
    const w = sharedWall(A.cr, B.cr);
    if (!w) return false;
    const margin = o.full ? 0 : o.margin ?? 1;
    const span = w.s1 - w.s0 - 2 * margin;
    const width = o.full ? span : Math.min(o.width ?? 3, span);
    if (width < 3) return false;
    const lo = w.s0 + margin, hi = w.s1 - margin - width;
    const first = o.pick === 'rand' ? this.rng.int(lo, hi) : o.pick === 'lo' ? lo : o.pick === 'hi' ? hi : Math.floor((lo + hi) / 2);
    for (let k = 0; k <= hi - lo; k++) for (const s of k ? [first - k, first + k] : [first]) {
      if (s < lo || s > hi) continue;
      const cr: CRect = w.horizontal ? {c: s, d: w.line, w: width, h: 1} : {c: w.line, d: s, w: 1, h: width};
      const rect = this.f.rect(cr.c, cr.d, cr.w, cr.h);
      if (this.guard && !this.guard(a, b, rect)) continue;
      this.doors.push({a, b, rect, height: o.kind === 'room' ? MINES.door.room : MINES.door.set, kind: o.kind, cr});
      return true;
    }
    return false;
  }
  /** An opening of `R` lies in its `side` wall. */
  doorOn(R: MineRoomPlan, side: Dir): boolean {
    const r = R.cr;
    return this.doors.some(q => (q.a === R.key || q.b === R.key) && (side === 'up' ? q.cr.h === 1 && q.cr.d === r.d - 1
      : side === 'down' ? q.cr.h === 1 && q.cr.d === r.d + r.h : side === 'left' ? q.cr.w === 1 && q.cr.c === r.c - 1 : q.cr.w === 1 && q.cr.c === r.c + r.w));
  }

  /** Candidate rects on `side` of `parent`: depth (outer) x along x the along-wall offsets, in the given orders. */
  *cands(parent: string, side: Dir, alongs: readonly number[], deeps: readonly number[], offs: Offs): Generator<CRect> {
    const P = this.room(parent);
    if (!P) return;
    const [s0, s1] = wallSpan(P.cr, side);
    for (const dp of deeps) for (const al of alongs) for (const a0 of offs(s0, s1, al)) yield beside(P.cr, side, a0, al, dp);
  }
  /** The first candidate that fits and takes its opening from `parent` (null: none). */
  put(key: string, parent: string, side: Dir, alongs: readonly number[], deeps: readonly number[], offs: Offs, o: SpaceOpt, door: DoorOpt): MineRoomPlan | null {
    for (const r of this.cands(parent, side, alongs, deeps, offs)) {
      if (!this.fitsR(r)) continue;
      const room = this.add(key, r, {...o, parent, travel: LAT(side) ? 'c' : 'd'});
      if (this.door(parent, key, door)) { this.dir.set(key, side); return room; }
      this.undo();
    }
    return null;
  }

  /** Grows a space one row at a time on its sides without an opening, up to `cap` cells along c / d, while `more()`. */
  grow(key: string, capW: number, capH: number, more: () => boolean): void {
    const R = this.room(key);
    if (!R) return;
    for (let pass = 0; pass < 24 && more(); pass++) {
      let grew = false;
      for (const side of this.rng.shuffle<Dir>(['up', 'down', 'left', 'right'])) {
        const r = R.cr;
        if (!more() || (LAT(side) ? r.w >= capW : r.h >= capH) || this.doorOn(R, side)) continue;
        const nr: CRect = side === 'up' ? {c: r.c, d: r.d - 1, w: r.w, h: r.h + 1} : side === 'down' ? {...r, h: r.h + 1}
          : side === 'left' ? {c: r.c - 1, d: r.d, w: r.w + 1, h: r.h} : {...r, w: r.w + 1};
        this.mark(r, 0);
        const ok = this.fitsR(nr);
        this.mark(ok ? nr : r, 1);
        if (ok) { R.cr = nr; R.rect = this.f.rect(nr.c, nr.d, nr.w, nr.h); grew = true; }
      }
      if (!grew) break;
    }
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
const uniq = (v: number[]) => [...new Set(v)];
/** hi, hi - step, ... down to lo (lo always last). */
const steps = (hi: number, lo: number, step = 2): number[] => { const o: number[] = []; for (let v = hi; v > lo; v -= step) o.push(v); o.push(lo); return o; };

/** Local frames for connect(): identity, mirror in c, transpose, transpose + mirror (each its own inverse pairing). */
const flipC = (r: CRect): CRect => ({c: -(r.c + r.w), d: r.d, w: r.w, h: r.h});
const transp = (r: CRect): CRect => ({c: r.d, d: r.c, w: r.h, h: r.w});
const FRAMES: readonly {f: (r: CRect) => CRect; b: (r: CRect) => CRect; t: boolean}[] = [
  {f: r => r, b: r => r, t: false},
  {f: flipC, b: flipC, t: false},
  {f: transp, b: transp, t: true},
  {f: r => flipC(transp(r)), b: r => transp(flipC(r)), t: true},
];

// ---------------------------------------------------------------------------------------------------------------------------------
// The program

/** Drifts: service-corridor passages (the station composer's service clusters: work lights, maintenance bays, caches, safety points). */
const DRIFT = {kind: 'passage' as AreaKind, type: 'service-corridor' as RoomType, purpose: 'service-corridor'};
/**
 * Dead ends (flooded sump, collapsed drift, the development heading, worked-out stopes): bare rooms the dresser leaves empty (the
 * picked-over purpose: no furniture rules, no generated-prop uses, no plate), so the sump pump / barricade / rubble / drill jumbo of the
 * mines dress stand where the drift actually ends.
 */
const DEAD_END = {kind: 'room' as AreaKind, type: 'utility' as RoomType, purpose: ANNEX_PICKED_KEY};
/** The optional rooms / dead ends / stopes. */
const OPTIONAL_ROOMS: ReadonlySet<MinePart> = new Set(['lamp', 'tools', 'magazine', 'hoist', 'refuge', 'sump', 'collapse', 'stope']);
/** How many kinds of optional room a plan has. */
const roomCount = (rooms: readonly MineRoomPlan[]) => new Set(rooms.filter(r => OPTIONAL_ROOMS.has(r.part)).map(r => r.part)).size;

/** Plans the mines in a slot (the first seeded attempt that reaches the floor target, else the largest accepted); null when none fits. */
export function planMines(slot: ComplexSlot, g: Grid, rng: Rng, ceilRel: number): MinePlan | null {
  let best: MinePlan | null = null;
  // the aims met (floor target, timbered run, optional spaces), then the floor
  const met = (p: MinePlan) => +(p.cells * CELL * CELL >= MINES.targetM2) + +(p.run >= MINES.minRun) + +(roomCount(p.rooms) >= MINES.minRooms);
  const score = (p: MinePlan) => met(p) * 1e6 + p.cells;
  for (let attempt = 0; attempt < MINES.attempts; attempt++) {
    const p = tryPlan(slot, g, rng.fork(`mines-plan-${attempt}`), ceilRel, attempt);
    if (!p) continue;
    if (met(p) === 3) return p;
    if (!best || score(p) > score(best)) best = p;
  }
  return best && best.cells * 0.25 >= MINES.acceptM2 ? best : null;
}

function tryPlan(slot: ComplexSlot, g: Grid, rng: Rng, ceilRel: number, attempt: number): MinePlan | null {
  if (ceilRel < MINES.clear.min) return null;
  const f0 = mineFrame(slot, false);
  if (!f0 || f0.W < MINES.minW || f0.D < MINES.minD) return null;
  const mirror = rng.chance(0.5);
  const f = mirror ? mineFrame(slot, true)! : f0;
  const {W, D} = f;
  const P = new Planner(f, g, rng, slot.entrance);
  const lite = attempt >= 10; // the last attempts draw a simpler, smaller program
  const clearOf = (r: readonly [number, number]) => r2(Math.min(ceilRel, rng.range(r[0], r[1])));
  const shape: MineShape = {adit: 'straight', course: '', cavern: '', loops: [], spaces: [], attempt};
  const drift = (label: string, part: MinePart): SpaceOpt => ({label, role: part === 'portal' ? 'entry' : 'corridor', ...DRIFT, clear: clearOf(part === 'portal' ? MINES.clear.portal : MINES.clear.drift), part});
  // along-wall offsets (seeded orders)
  /** The child's span inside the parent's, `m` cells off its ends. */
  const inside = (m: number): Offs => (s0, s1, al) => { const lo = s0 + m, hi = s1 - m - al; return hi < lo ? [] : rng.shuffle(uniq([lo, hi, Math.round((lo + hi) / 2), rng.int(lo, hi), rng.int(lo, hi)])); };
  /** The child's span containing the parent's, `m` cells beyond its ends. */
  const contain = (m: number): Offs => (s0, s1, al) => { const lo = s1 + m - al, hi = s0 - m; return hi < lo ? [] : rng.shuffle(uniq([lo, hi, Math.round((lo + hi) / 2), rng.int(lo, hi)])); };
  /** Inside the parent's span, a cell off its ends where it can be, else flush (a dead end continuing a drift as wide as itself). */
  const within: Offs = (s0, s1, al) => uniq([...inside(1)(s0, s1, al), ...inside(0)(s0, s1, al)]);
  /** Overlapping the parent's span by >= `need` cells. */
  const overlap = (need: number): Offs => (s0, s1, al) => {
    const lo = s0 - al + need, hi = s1 - need;
    return hi < lo ? [] : rng.shuffle(uniq([lo, hi, Math.round((lo + hi) / 2), rng.int(lo, hi), rng.int(lo, hi), s0, s1 - al].filter(v => v >= lo && v <= hi)));
  };
  /** At the far end of a drift driven `d` (a bend there). */
  const atEnd = (d: Dir): Offs => (s0, s1, al) => (POS(d) ? [s1 - al, s1 - al - 1] : [s0, s0 + 1]).filter(v => v >= s0 && v + al <= s1);
  /** Straight on past a drift's end with a small jog (>= 5 cells or the narrower width shared). */
  const jog: Offs = (s0, s1, al) => rng.shuffle([-2, -1, 0, 1, 2].map(j => s0 + j)).filter(a0 => Math.min(a0 + al, s1) - Math.max(a0, s0) >= Math.min(al, s1 - s0, 5));
  const roomOf = (d: Dir, R: CRect) => (d === 'left' ? R.c : d === 'right' ? W - R.c - R.w : d === 'down' ? D - R.d - R.h : R.d);
  const drifts = (): string[] => P.rooms.filter(r => MINE_DRIFTS.has(r.part) && r.part !== 'portal').map(r => r.key);
  /** (parent, side) slots: a drift's two ribs (+ its far end where `ends` and nothing opens there), any side of another space. */
  const slotsOf = (keys: readonly string[], o: {ends?: boolean; ribs?: boolean} = {}): [string, Dir][] => {
    const out: [string, Dir][] = [];
    for (const k of keys) {
      const R = P.room(k), d = P.dir.get(k);
      if (!R) continue;
      const sides: Dir[] = MINE_DRIFTS.has(R.part) && d
        ? [...(o.ribs !== false ? (LAT(d) ? ['up', 'down'] as Dir[] : ['left', 'right'] as Dir[]) : []), ...(o.ends && !P.doorOn(R, d) ? [d] : [])]
        : ['up', 'down', 'left', 'right'];
      for (const s of rng.shuffle(sides)) out.push([k, s]);
    }
    return out;
  };

  // --- 1. The adit (portal) from the shaft gallery: short, long or a dog-leg ------------------------------------------------------
  const ew = f.ec1 - f.ec0;
  const pw = Math.min(10, Math.max(ew + 2, rng.int(6, 7)));
  const aditKind = lite ? 'straight' : rng.weighted<'straight' | 'long' | 'dogleg'>([['straight', 3], ['long', 2], ['dogleg', 4]]);
  const lw = rng.int(6, 7);
  const len0 = aditKind === 'long' ? rng.int(14, 19) : aditKind === 'dogleg' ? rng.int(lw + 1, lw + 4) : rng.int(8, 12);
  const pcs = rng.shuffle(uniq([f.ec0 - (pw - ew), f.ec0 - Math.floor((pw - ew) / 2), f.ec0].map(v => clamp(v, 0, W - pw))));
  const portalO = drift('No. 2 adit', 'portal');
  let portal: MineRoomPlan | null = null;
  for (const L of [len0, len0 - 2, len0 + 2, len0 - 4]) {
    for (const pc0 of pcs) {
      if (L < 5 || pc0 > f.ec0 || pc0 + pw < f.ec1 || !P.fits(pc0, f.dPortal, pw, L - f.dPortal, f.dPortal)) continue;
      portal = P.add('portal', {c: pc0, d: f.dPortal, w: pw, h: L - f.dPortal}, {...portalO, parent: null, travel: 'd'});
      break;
    }
    if (portal) break;
  }
  if (!portal) return null;
  P.dir.set('portal', 'down');
  let aditEnd = 'portal';
  shape.adit = aditKind === 'long' ? 'long' : 'straight';
  if (aditKind === 'dogleg') {
    // in, then along the pit wall toward the roomier side (seeded when both are roomy)
    const sides = rng.shuffle<Dir>(['left', 'right']).sort((a, b) => +(roomOf(b, portal!.cr) >= 26) - +(roomOf(a, portal!.cr) >= 26));
    for (const side of sides) {
      if (P.put('portal-1', 'portal', side, [lw], steps(rng.int(12, 18), 8), atEnd('down'), portalO, {kind: 'set', full: true})) { aditEnd = 'portal-1'; shape.adit = `dogleg-${side[0]}`; break; }
    }
  }

  // --- 2. The haulage junction (old shaft station) at the adit's end --------------------------------------------------------------
  const aDir = P.dir.get(aditEnd)!;
  const jd = rng.int(8, 11), jw = lite ? rng.int(14, 18) : rng.int(16, 24);
  const jo: SpaceOpt = {...drift('Haulage junction', 'junction'), role: 'hall', clear: clearOf(MINES.clear.junction)};
  const J = aDir === 'down'
    ? P.put('junction', aditEnd, 'down', uniq([jw, jw - 4, 14]), [jd, 9, 8], contain(0), jo, {kind: 'set', width: pw - 2})
    : P.put('junction', aditEnd, aDir, uniq([jd, 10, 11, 9]), uniq([jw, jw - 4, 14]), contain(1), jo, {kind: 'set', full: true});
  if (!J) return null;

  // --- 3. The main haulage: a seeded course of drift segments, the generator cavern where it ends -----------------------------------
  const jIn = OPP[aDir];
  const exits = (['down', 'left', 'right'] as Dir[]).filter(d => d !== jIn);
  const nextDir = (from: CRect, prev: Dir | null): Dir => {
    const w = (d: Dir, big: number, mid: number) => (roomOf(d, from) >= big ? 1.6 : roomOf(d, from) >= mid ? 0.6 : 0.05);
    if (prev === null) return rng.weighted(exits.map(d => [d, d === 'down' ? 1.6 * w('down', 30, 20) : w(d, 28, 18)] as const));
    if (prev === 'down') return rng.weighted<Dir>([['left', w('left', 24, 14)], ['right', w('right', 24, 14)], ['down', 0.4 * w('down', 26, 18)]]);
    return rng.weighted<Dir>([['down', 2.5 * w('down', 22, 16)], [prev, w(prev, 22, 14)]]);
  };
  const aw = rng.int(6, 8);
  const caveClear = r2(Math.max(MINES.clear.min, Math.min(ceilRel, rng.range(MINES.clear.cavern[0], MINES.clear.cavern[1]))));
  const capA = lite ? rng.int(20, 30) : rng.int(26, 44), capB = lite ? rng.int(16, 20) : rng.int(18, 28);
  const caveO: SpaceOpt = {label: 'No. 2 stope · generator cavern', role: 'generator', kind: 'room', type: 'utility', purpose: 'generator-room', clear: caveClear, part: 'cavern'};
  const cavernAt = (seg: string): boolean => !!P.put('cavern', seg, P.dir.get(seg)!, steps(capA, 18), steps(capB, 16), contain(1), caveO, {kind: 'set', full: true});
  const n = lite ? rng.int(1, 2) : rng.weighted([[1, 1], [2, 4], [3, 4], [4, 2]] as const);
  const haul: string[] = [];
  let from = 'junction', prev: Dir | null = null;
  for (let i = 0; i < n; i++) {
    const F = P.room(from)!, dir = nextDir(F.cr, prev), last = i === n - 1;
    const w = i ? clamp(aw + rng.int(-1, 1), 6, 8) : aw, key = `haulage-${i}`;
    const offs: Offs = from === 'junction' ? within : dir === prev ? jog : atEnd(prev!);
    const pref = LAT(dir) ? rng.int(8, 22) : rng.int(6, 16), lo = last ? 4 : 9;
    let ok = false;
    for (const L of uniq([pref, pref + 4, pref - 3, pref - 6, pref - 9, lo].filter(v => v >= lo))) {
      for (const r of P.cands(from, dir, [w], [L], offs)) {
        if (!P.fitsR(r)) continue;
        P.add(key, r, {...drift('Main haulage drift', 'haulage'), parent: from, travel: LAT(dir) ? 'c' : 'd'});
        if (!P.door(from, key, {kind: 'set', full: true})) { P.undo(); continue; }
        P.dir.set(key, dir);
        if (last && !cavernAt(key)) { P.undo(); continue; }
        ok = true;
        break;
      }
      if (ok) break;
    }
    if (!ok) {
      // the course stops here: the cavern at the end of the drift so far
      if (!haul.length || !cavernAt(haul[haul.length - 1])) return null;
      break;
    }
    haul.push(key);
    from = key;
    prev = dir;
  }
  shape.course = haul.map(k => LETTER[P.dir.get(k)!]).join('');
  const cave = P.room('cavern')!;
  {
    const cx = cave.cr.c + cave.cr.w / 2, cy = cave.cr.d + cave.cr.h / 2;
    shape.cavern = `${'LCR'[clamp(Math.floor(cx / (W / 3)), 0, 2)]}${cy < D * 0.6 ? 'm' : 'd'}`;
  }

  // --- 4. The generator, reserved now: later openings into the cavern keep clear of its skid and stand point ------------------------
  const gen = placeGenerator(P, rng);
  if (!gen) return null;
  {
    const gx = gen.foot.x + gen.foot.w / 2, gy = gen.foot.y + gen.foot.h / 2;
    P.guard = (a, b, r) => {
      if (a !== 'cavern' && b !== 'cavern') return true;
      const mx = r.x + r.w / 2, my = r.y + r.h / 2;
      return Math.hypot(mx - gx, my - gy) >= MINES.genClear && Math.hypot(mx - gen.use.x, my - gen.use.y) >= MINES.useClear;
    };
  }

  // --- 5. Loops: a second way between two spaces (straight or L-shaped drifts through untouched rock) -------------------------------
  const connect = (aKey: string, bKey: string, part: MinePart, label: string, straight = false): boolean => {
    const A = P.room(aKey)?.cr, B = P.room(bKey)?.cr;
    if (!A || !B) return false;
    const w1 = rng.int(5, 6), w2 = rng.int(5, 6);
    const cands: {segs: CRect[]; tr: ('c' | 'd')[]; upper: string; lower: string}[] = [];
    for (const F of FRAMES) {
      const a = F.f(A), b = F.f(B);
      let U = a, L = b, uk = aKey, lk = bKey;
      if (b.d + b.h < a.d) { U = b; L = a; uk = bKey; lk = aKey; } else if (!(a.d + a.h < b.d)) continue;
      const map = (segs: CRect[], tr: ('c' | 'd')[]) => cands.push({segs: segs.map(F.b), tr: tr.map(t => (F.t ? (t === 'c' ? 'd' : 'c') : t)), upper: uk, lower: lk});
      const top = U.d + U.h + 1;
      // (every leg >= 5 cells: a passage, never a slot) straight down between them
      {
        const lo = Math.max(U.c, L.c) + 1, hi = Math.min(U.c + U.w, L.c + L.w) - 1 - w1, h = L.d - 1 - top;
        if (h >= 5 && hi >= lo) for (let k = 0; k < 3; k++) map([{c: rng.int(lo, hi), d: top, w: w1, h}], ['d']);
      }
      if (straight) continue;
      // down out of U, then across into L's near side wall
      {
        const xlo = U.c + 1, xhi = Math.min(U.c + U.w - 1 - w1, L.c - w1 - 7);
        const ylo = Math.max(L.d + 1 + w2, top + w2 + 2), yhi = L.d + L.h - 1;
        if (xhi >= xlo && yhi >= ylo) for (let k = 0; k < 4; k++) {
          const x = rng.int(xlo, xhi), yE = rng.int(ylo, yhi);
          map([{c: x, d: top, w: w1, h: yE - top}, {c: x + w1 + 1, d: yE - w2, w: L.c - 1 - (x + w1 + 1), h: w2}], ['d', 'c']);
        }
      }
      // across out of U's side wall, then down into L's top
      {
        const ylo = U.d + 1, yhi = U.d + U.h - 1 - w1;
        const xlo = Math.max(L.c + 1 + w2, U.c + U.w + 1 + w2 + 2), xhi = L.c + L.w - 1;
        if (yhi >= ylo && xhi >= xlo) for (let k = 0; k < 4; k++) {
          const y = rng.int(ylo, yhi), xE = rng.int(xlo, xhi), s2 = y + w1 + 1;
          if (L.d - 1 - s2 >= 5) map([{c: U.c + U.w + 1, d: y, w: xE - (U.c + U.w + 1), h: w1}, {c: xE - w2, d: s2, w: w2, h: L.d - 1 - s2}], ['c', 'd']);
        }
      }
    }
    for (const cd of rng.shuffle(cands)) {
      if (!cd.segs.every(s => P.fitsR(s))) continue;
      const n0 = P.count(part);
      let par = cd.upper, added = 0, ok = true;
      for (let i = 0; i < cd.segs.length; i++) {
        const s = cd.segs[i], key = `${part}-${n0 + i}`, pc = P.room(par)!.cr;
        if (!P.fitsR(s)) { ok = false; break; }
        P.add(key, s, {...drift(label, part), parent: par, travel: cd.tr[i]});
        added++;
        if (!P.door(par, key, {kind: 'set', full: true})) { ok = false; break; }
        P.dir.set(key, cd.tr[i] === 'd' ? (s.d > pc.d ? 'down' : 'up') : (s.c > pc.c ? 'right' : 'left'));
        par = key;
      }
      if (ok && !P.door(par, cd.lower, {kind: 'set', full: true})) ok = false;
      if (ok) return true;
      while (added-- > 0) P.undo();
    }
    return false;
  };
  {
    const manway = () => connect('junction', 'cavern', 'manway', 'Old manway') || (aditEnd !== 'portal' && connect(aditEnd, 'cavern', 'manway', 'Old manway'));
    const airway = () => rng.shuffle(haul.slice(0, -1)).some(k => connect('cavern', k, 'airway', 'Return airway'));
    const crosscut = () => {
      const pairs: [string, string][] = [];
      for (let i = 0; i < haul.length; i++) for (let j = i + 2; j < haul.length; j++) pairs.push([haul[i], haul[j]]);
      for (const m of P.rooms.filter(r => r.part === 'manway' || r.part === 'airway')) for (const h of haul) pairs.push([m.key, h]);
      return rng.shuffle(pairs).some(([a, b]) => connect(a, b, 'crosscut', 'Cross-cut', true));
    };
    const manwayDown = () => rng.shuffle(haul.slice(1)).some(k => connect('junction', k, 'manway', 'Old manway'));
    const order: [string, () => boolean][] = [...rng.shuffle<[string, () => boolean]>([['manway', manway], ['airway', airway]]), ...rng.shuffle<[string, () => boolean]>([['crosscut', crosscut], ['manway-down', manwayDown]])];
    const want = rng.chance(0.45) ? 2 : 1;
    for (const [name, fn] of order) {
      if (shape.loops.length >= want) break;
      if (fn()) shape.loops.push(name);
    }
    if (!shape.loops.length) return null;
  }

  // --- 6. The development heading: a dead-end drift the drill jumbo (its REAL kit size) parks in, boom to the face -------------------
  {
    const {w: hw, l: hl, clear: hc} = headingFor(minesModelSize('drillRig'));
    if (ceilRel >= hc) {
      const o: SpaceOpt = {label: 'Development heading', role: 'corridor', ...DEAD_END, clear: r2(Math.min(ceilRel, Math.max(hc, rng.range(MINES.clear.drift[0], MINES.clear.drift[1])))), part: 'heading'};
      let hd: MineRoomPlan | null = null;
      for (const [p, s] of slotsOf(rng.shuffle([...drifts(), 'junction']), {ends: true})) if ((hd = P.put('heading', p, s, [hw, hw + 1], uniq([hl + rng.int(2, 8), hl + 2, hl]), within, o, {kind: 'set', full: true}))) break;
      if (!hd) return null;
      shape.spaces.push('heading');
    }
  }

  // --- 7. The optional spaces (a seeded subset, each at a logical place) ------------------------------------------------------------
  const roomClear = () => clearOf(MINES.clear.room);
  const roomDoor = (width = 3): DoorOpt => ({kind: 'room', width, pick: 'rand'});
  const place = (key: string, slots: [string, Dir][], alongs: number[], deeps: number[], o: SpaceOpt, door: DoorOpt, offs?: Offs): MineRoomPlan | null => {
    const of = offs ?? overlap(door.full ? 3 : (door.width ?? 3) + 2);
    for (const [p, s] of slots) { const r = P.put(key, p, s, alongs, deeps, of, o, door); if (r) return r; }
    return null;
  };
  const near = () => P.rooms.filter(r => r.part === 'portal').map(r => r.key).concat('junction');
  const branches = () => P.rooms.filter(r => r.part === 'branch').map(r => r.key);
  const ofPart = (...parts: MinePart[]) => P.rooms.filter(r => parts.includes(r.part)).map(r => r.key);
  const want = {lamp: rng.chance(0.85), tools: rng.chance(0.8), magazine: rng.chance(0.75), hoist: rng.chance(0.7), refuge: rng.chance(0.55), sump: rng.chance(0.6), collapse: rng.chance(0.6), stope: rng.chance(0.6), branch: rng.chance(0.55)};
  const ROOMS = ['lamp', 'tools', 'magazine', 'hoist', 'refuge', 'sump', 'collapse', 'stope'] as const;
  while (ROOMS.filter(k => want[k]).length < 4) want[rng.pick(ROOMS)] = true;
  const deadW = [5, 6];
  const programs: Record<string, () => MineRoomPlan | null> = {
    lamp: () => place('lamp', slotsOf(near()), steps(12, 9, 1), steps(11, 8, 1), {label: 'Lamp room', role: 'room', kind: 'room', type: 'crew-room', purpose: 'locker-room', clear: roomClear(), part: 'lamp'}, roomDoor()),
    tools: () => place('tools', slotsOf([...near(), haul[0]]), steps(11, 8, 1), steps(10, 8, 1), {label: 'Mine tool room', role: 'store', kind: 'room', type: 'storage', purpose: 'workshop', clear: roomClear(), part: 'tools'}, roomDoor()),
    branch: () => place('branch', slotsOf(rng.shuffle([...haul, 'junction'])), [rng.int(5, 6)], steps(rng.int(12, 20), 9), drift('Footwall drift', 'branch'), {kind: 'set', full: true}, inside(2)),
    magazine: () => place('magazine', slotsOf([...rng.shuffle(branches()), ...rng.shuffle([...ofPart('crosscut', 'airway', 'manway'), ...haul.slice(1)])], {ends: true}), steps(11, 8, 1), steps(9, 7, 1), {label: 'Powder magazine', role: 'vault', kind: 'room', type: 'storage', purpose: 'storage', clear: roomClear(), part: 'magazine'}, roomDoor()),
    hoist: () => place('hoist', slotsOf(rng.shuffle(['junction', ...haul.slice(0, 2), ...ofPart('crosscut', 'manway', 'branch')])), steps(16, 12), steps(11, 8, 1), {label: 'Hoist room', role: 'shaft', kind: 'room', type: 'utility', purpose: 'electrical-closet', clear: r2(Math.min(ceilRel, MINES.clear.hoist)), part: 'hoist'}, roomDoor(4)),
    refuge: () => place('refuge', slotsOf(rng.shuffle([...drifts(), 'junction', 'cavern'])), steps(10, 8, 1), steps(8, 6, 1), {label: 'Refuge chamber', role: 'room', kind: 'room', type: 'crew-room', purpose: 'first-aid-room', clear: roomClear(), part: 'refuge'}, roomDoor()),
    sump: () => place('sump', slotsOf([...rng.shuffle(['cavern', haul[haul.length - 1]]), ...rng.shuffle(ofPart('manway', 'airway'))], {ends: true}), deadW, steps(rng.int(10, 18), 8), {label: 'Flooded sump drift', role: 'corridor', ...DEAD_END, clear: clearOf(MINES.clear.drift), part: 'sump'}, {kind: 'set', full: true}, within),
    collapse: () => place('collapse', slotsOf(rng.shuffle([...drifts(), 'junction']), {ends: true}), deadW, steps(rng.int(11, 16), 10), {label: 'Collapsed drift', role: 'corridor', ...DEAD_END, clear: clearOf(MINES.clear.drift), part: 'collapse'}, {kind: 'set', full: true}, within),
    stope: () => stope(),
  };
  let stopes = 0;
  const stope = (): MineRoomPlan | null => {
    const key = stopes ? `stope-${stopes}` : 'stope';
    const r = place(key, slotsOf([...rng.shuffle(['cavern', ...branches()]), ...rng.shuffle(drifts())], {ends: true}), steps(rng.int(12, 18), 10), steps(rng.int(10, 16), 8), {label: `Worked-out stope No. ${[1, 3, 4, 5][stopes]}`, role: 'hall', ...DEAD_END, clear: r2(Math.max(MINES.clear.min, Math.min(ceilRel, rng.range(4.2, 5.2)))), part: 'stope'}, {kind: 'set', width: 6, pick: 'rand'});
    if (r) stopes++;
    return r;
  };
  // lamp / tool rooms first (the way in is short of rock), then a footwall drift (rooms may open off it), the rest in a seeded order
  const order = [...(['lamp', 'tools'] as const).filter(k => want[k]), ...(want.branch ? ['branch'] : []), ...rng.shuffle(['magazine', 'hoist', 'refuge', 'sump', 'collapse', 'stope'].filter(k => want[k as keyof typeof want]))];
  for (const k of order) if (programs[k]()) shape.spaces.push(k);
  // at least MINES.minRooms of them: the spaces not drawn try their logical places too (the fill adds stopes after this)
  for (const k of rng.shuffle(ROOMS.filter(q => !want[q] && q !== 'stope'))) {
    if (roomCount(P.rooms) >= MINES.minRooms) break;
    if (programs[k]()) shape.spaces.push(k);
  }

  // --- 8. Fill until the floor target: the cavern grown into spare rock, a worked-out stope or two, the other chambers grown, then
  //        (rarely) more stopes ----------------------------------------------------------------------------------------------------
  const target = MINES.targetM2 / (CELL * CELL) - slot.entrance.w * slot.entrance.h;
  const more = () => P.cells() < target;
  const grow = (k: string) => {
    const part = P.room(k)!.part;
    const [cw, ch] = part === 'cavern' ? [48, 32] : part === 'stope' ? [22, 18] : [14, 12];
    P.grow(k, cw, ch, more);
  };
  grow('cavern');
  while (more() && stopes < 2 && stope()) shape.spaces.push('stope');
  for (const k of [...ofPart('stope'), ...rng.shuffle(ofPart('lamp', 'tools', 'magazine', 'hoist', 'refuge'))]) if (more()) grow(k);
  while (more() && stopes < 4 && stope()) { shape.spaces.push('stope'); grow(`stope-${stopes - 1}`); }

  // --- 9. Labels of the multi-segment drifts --------------------------------------------------------------------------------------
  for (const part of ['haulage', 'manway', 'airway'] as const) {
    const segs = P.rooms.filter(r => r.part === part);
    segs.forEach((r, i) => { r.label = `${r.label}${segs.length < 2 ? '' : ` · ${i === 0 ? 'upper' : i === segs.length - 1 ? 'lower' : 'middle'}`}`; });
  }
  const cuts = P.rooms.filter(r => r.part === 'crosscut');
  if (cuts.length > 1) cuts.forEach((r, i) => { r.label = `Cross-cut No. ${i + 1}`; });

  const cells = P.cells() + slot.entrance.w * slot.entrance.h;
  if (cells * CELL * CELL < MINES.acceptM2) return null;
  const run = P.rooms.filter(r => MINE_DRIFTS.has(r.part)).reduce((s, r) => s + (r.travel === 'c' ? r.cr.w : r.cr.h), 0);
  return {
    rooms: P.rooms, doors: [{a: null, b: 'portal', rect: {...slot.entrance}, height: MINES.door.portal, kind: 'portal'}, ...P.doors.map(({cr: _cr, ...d}) => d)],
    generator: gen, cells, run, mirror, W, D, shape,
  };
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
    if (near < MINES.genClear) continue;
    for (const south of [true, false]) {
      const uy = south ? y + 8 + 1.5 : y - 1.5;
      if (Math.floor(uy) < R.y + 1 || Math.floor(uy) > R.y + R.h - 2) continue;
      const use = {x: cx, y: uy, yaw: south ? 0 : Math.PI};
      const dUse = Math.min(...openings.map(o => Math.hypot(o.x - use.x, o.y - use.y)));
      if (dUse < MINES.useClear) continue;
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
